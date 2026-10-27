//
// Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

//go:build !enterprise

package permission

import (
	"context"
	"errors"
	"net/url"
	"sort"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"ragflow/internal/entity"
)

// teamGrantFixture reproduces the shape that produced a real cross-tenant leak
// in production: tenant "华夏" marked its private datasets as team-visible,
// which the console stores as resource_grant rows with subject_kind='team'.
// Tenant "嘉实" was then created empty and its owner — a member of 嘉实 only —
// still saw all of 华夏's datasets in the knowledge-base list.
type teamGrantFixture struct {
	db      *gorm.DB
	checker *Checker
}

func newTeamGrantFixture(t *testing.T) teamGrantFixture {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+url.QueryEscape(t.Name())+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&entity.Knowledgebase{}, &entity.UserTenant{}, &entity.ResourceGrant{},
		&entity.User{}, &entity.Tenant{}, &entity.Role{},
	); err != nil {
		t.Fatalf("migrate permission tables: %v", err)
	}

	valid := string(entity.StatusValid)
	users := []entity.User{
		{ID: "huaxia-owner", Nickname: "华夏 owner", Email: "huaxia-owner@example.com"},
		{ID: "huaxia-member", Nickname: "华夏成员", Email: "huaxia-member@example.com"},
		{ID: "jiashi-owner", Nickname: "嘉实 owner", Email: "jiashi-owner@example.com"},
		{ID: "outsider", Nickname: "无租户用户", Email: "outsider@example.com"},
	}
	for i := range users {
		if err := db.Create(&users[i]).Error; err != nil {
			t.Fatalf("create user %q: %v", users[i].ID, err)
		}
	}
	memberships := []entity.UserTenant{
		{ID: "m-huaxia-owner", UserID: "huaxia-owner", TenantID: "huaxia", Role: string(RoleOwner), Status: &valid},
		{ID: "m-huaxia-member", UserID: "huaxia-member", TenantID: "huaxia", Role: string(RoleNormal), Status: &valid},
		{ID: "m-jiashi-owner", UserID: "jiashi-owner", TenantID: "jiashi", Role: string(RoleOwner), Status: &valid},
	}
	for i := range memberships {
		if err := db.Create(&memberships[i]).Error; err != nil {
			t.Fatalf("create membership %q: %v", memberships[i].ID, err)
		}
	}
	// permission=me keeps them private by default, so the only thing that can
	// open them up is the grant row below.
	datasets := []entity.Knowledgebase{
		{ID: "ds-team-1", TenantID: "huaxia", CreatedBy: "huaxia-owner", Name: "产品手册", Permission: string(entity.TenantPermissionMe), Status: &valid},
		{ID: "ds-team-2", TenantID: "huaxia", CreatedBy: "huaxia-owner", Name: "合同模板", Permission: string(entity.TenantPermissionMe), Status: &valid},
	}
	for i := range datasets {
		if err := db.Create(&datasets[i]).Error; err != nil {
			t.Fatalf("create dataset %q: %v", datasets[i].ID, err)
		}
	}
	grants := []entity.ResourceGrant{
		{ID: "g-team-1", TenantID: "huaxia", ResourceKind: string(ResourceKindDataset), ResourceID: "ds-team-1", SubjectKind: entity.GrantSubjectTeam, SubjectID: "", Permission: "read"},
		{ID: "g-team-2", TenantID: "huaxia", ResourceKind: string(ResourceKindDataset), ResourceID: "ds-team-2", SubjectKind: entity.GrantSubjectTeam, SubjectID: "", Permission: "read"},
	}
	for i := range grants {
		if err := db.Create(&grants[i]).Error; err != nil {
			t.Fatalf("create grant %q: %v", grants[i].ID, err)
		}
	}

	return teamGrantFixture{db: db, checker: NewDatabaseChecker(db)}
}

func (f teamGrantFixture) visible(t *testing.T, userID string) []string {
	t.Helper()
	scope, err := f.checker.QueryScope(context.Background(), Subject{UserID: userID}, ScopeQuery{
		Kind: ResourceKindDataset, Operation: OperationRead,
	})
	if err != nil {
		t.Fatalf("QueryScope(datasets, %q) error = %v", userID, err)
	}
	var ids []string
	if err := scope.Apply(f.db.Model(&entity.Knowledgebase{})).Order("knowledgebase.id").
		Pluck("knowledgebase.id", &ids).Error; err != nil {
		t.Fatalf("query authorized datasets for %q: %v", userID, err)
	}
	sort.Strings(ids)
	return ids
}

// TestTeamGrantDoesNotLeakAcrossTenants is the regression test for the
// incident: a team grant says "everyone in this tenant", never "everyone".
func TestTeamGrantDoesNotLeakAcrossTenants(t *testing.T) {
	fixture := newTeamGrantFixture(t)

	for _, userID := range []string{"jiashi-owner", "outsider"} {
		if got := fixture.visible(t, userID); len(got) != 0 {
			t.Errorf("QueryScope(datasets, %q) = %v, want none", userID, got)
		}
		for _, datasetID := range []string{"ds-team-1", "ds-team-2"} {
			err := fixture.checker.CheckResource(context.Background(), Subject{UserID: userID},
				ResourceRef{Kind: ResourceKindDataset, ID: datasetID}, OperationRead)
			if !errors.Is(err, ErrPermissionDenied) {
				t.Errorf("CheckResource(%q, %q) error = %v, want %v", userID, datasetID, err, ErrPermissionDenied)
			}
		}
	}
}

// TestTeamGrantStaysVisibleToTenantMembers guards the fix from over-correcting:
// the tenant that owns the grant must keep seeing its own datasets, and a
// read-only grant must not turn into an edit right.
func TestTeamGrantStaysVisibleToTenantMembers(t *testing.T) {
	fixture := newTeamGrantFixture(t)

	want := []string{"ds-team-1", "ds-team-2"}
	if got := fixture.visible(t, "huaxia-member"); len(got) != len(want) {
		t.Fatalf("QueryScope(datasets, huaxia-member) = %v, want %v", got, want)
	} else {
		for i := range want {
			if got[i] != want[i] {
				t.Fatalf("QueryScope(datasets, huaxia-member) = %v, want %v", got, want)
			}
		}
	}

	if err := fixture.checker.CheckResource(context.Background(), Subject{UserID: "huaxia-member"},
		ResourceRef{Kind: ResourceKindDataset, ID: "ds-team-1"}, OperationRead); err != nil {
		t.Errorf("同租户成员读 team 授权资源 error = %v, want nil", err)
	}
	for _, operation := range []Operation{OperationUpdate, OperationDelete} {
		err := fixture.checker.CheckResource(context.Background(), Subject{UserID: "huaxia-member"},
			ResourceRef{Kind: ResourceKindDataset, ID: "ds-team-1"}, operation)
		if !errors.Is(err, ErrPermissionDenied) {
			t.Errorf("只读 team 授权下 %s error = %v, want %v", operation, err, ErrPermissionDenied)
		}
	}
}

// TestDepartmentGrantIgnoresUsersWithoutDepartment covers the other half of the
// same condition: an unassigned user has an empty department id, which must not
// be compared against subject_id — an empty department grant would otherwise
// match every user in the system.
func TestDepartmentGrantIgnoresUsersWithoutDepartment(t *testing.T) {
	fixture := newTeamGrantFixture(t)

	emptyDepartmentGrant := entity.ResourceGrant{
		ID: "g-dept-empty", TenantID: "huaxia", ResourceKind: string(ResourceKindDataset),
		ResourceID: "ds-team-1", SubjectKind: entity.GrantSubjectDepartment, SubjectID: "", Permission: "edit",
	}
	if err := fixture.db.Create(&emptyDepartmentGrant).Error; err != nil {
		t.Fatalf("create empty department grant: %v", err)
	}

	// outsider 没有部门，也没加入 huaxia：这条空部门授权不能把他放进来。
	err := fixture.checker.CheckResource(context.Background(), Subject{UserID: "outsider"},
		ResourceRef{Kind: ResourceKindDataset, ID: "ds-team-1"}, OperationRead)
	if !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("空部门授权对无部门用户的 CheckResource error = %v, want %v", err, ErrPermissionDenied)
	}
	if got := fixture.visible(t, "outsider"); len(got) != 0 {
		t.Errorf("QueryScope(datasets, outsider) = %v, want none", got)
	}
}
