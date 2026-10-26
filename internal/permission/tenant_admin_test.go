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

// teamFixture mirrors the production shape that exposed the bug: one team
// tenant whose owner is also the tenant id, a member promoted to 租户管理员
// through the console (role_id only, enum stays 'normal'), and a plain member.
type teamFixture struct {
	db      *gorm.DB
	checker *Checker
}

func newTeamFixture(t *testing.T) teamFixture {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+url.QueryEscape(t.Name())+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&entity.Knowledgebase{}, &entity.UserTenant{}, &entity.ResourceGrant{},
		&entity.User{}, &entity.Tenant{}, &entity.Department{}, &entity.Role{},
		&entity.Chat{}, &entity.Search{},
	); err != nil {
		t.Fatalf("migrate permission tables: %v", err)
	}

	valid := string(entity.StatusValid)
	roles := []entity.Role{
		{ID: "role-tenant-admin", TenantID: "team-a", Name: "租户管理员", IsBuiltin: true},
		{ID: "role-normal", TenantID: "team-a", Name: "普通成员", IsBuiltin: true},
	}
	for i := range roles {
		if err := db.Create(&roles[i]).Error; err != nil {
			t.Fatalf("create role %q: %v", roles[i].ID, err)
		}
	}
	users := []entity.User{
		{ID: "team-a", Nickname: "租户创建者", Email: "owner@example.com"},
		{ID: "u-admin", Nickname: "租户管理员", Email: "admin@example.com"},
		{ID: "u-member", Nickname: "普通成员", Email: "member@example.com"},
		{ID: "outsider", Nickname: "外部成员", Email: "outsider@example.com"},
	}
	for i := range users {
		if err := db.Create(&users[i]).Error; err != nil {
			t.Fatalf("create user %q: %v", users[i].ID, err)
		}
	}
	memberships := []entity.UserTenant{
		{ID: "m-owner", UserID: "team-a", TenantID: "team-a", Role: string(RoleOwner), Status: &valid},
		{ID: "m-admin", UserID: "u-admin", TenantID: "team-a", Role: string(RoleNormal), RoleID: "role-tenant-admin", Status: &valid},
		{ID: "m-member", UserID: "u-member", TenantID: "team-a", Role: string(RoleNormal), RoleID: "role-normal", Status: &valid},
		{ID: "m-outside", UserID: "outsider", TenantID: "other-tenant", Role: string(RoleOwner), Status: &valid},
	}
	for i := range memberships {
		if err := db.Create(&memberships[i]).Error; err != nil {
			t.Fatalf("create membership %q: %v", memberships[i].ID, err)
		}
	}
	datasets := []entity.Knowledgebase{
		{ID: "ds-private", TenantID: "team-a", CreatedBy: "team-a", Name: "私有库", Permission: string(entity.TenantPermissionMe), Status: &valid},
		{ID: "ds-team", TenantID: "team-a", CreatedBy: "team-a", Name: "团队库", Permission: string(entity.TenantPermissionTeam), Status: &valid},
	}
	for i := range datasets {
		if err := db.Create(&datasets[i]).Error; err != nil {
			t.Fatalf("create dataset %q: %v", datasets[i].ID, err)
		}
	}
	chats := []entity.Chat{
		{ID: "chat-1", TenantID: "team-a", LLMSetting: entity.JSONMap{}, PromptConfig: entity.JSONMap{}, KBIDs: entity.JSONSlice{}, DoRefer: "1", Status: &valid},
	}
	for i := range chats {
		if err := db.Create(&chats[i]).Error; err != nil {
			t.Fatalf("create chat %q: %v", chats[i].ID, err)
		}
	}
	searches := []entity.Search{
		{ID: "search-1", TenantID: "team-a", CreatedBy: "team-a", Name: "团队检索", SearchConfig: entity.JSONMap{}, Status: &valid},
	}
	for i := range searches {
		if err := db.Create(&searches[i]).Error; err != nil {
			t.Fatalf("create search %q: %v", searches[i].ID, err)
		}
	}

	return teamFixture{db: db, checker: NewDatabaseChecker(db)}
}

func (f teamFixture) check(t *testing.T, userID string, kind ResourceKind, id string, operation Operation) error {
	t.Helper()
	return f.checker.CheckResource(context.Background(), Subject{UserID: userID},
		ResourceRef{Kind: kind, ID: id}, operation)
}

func (f teamFixture) scopeIDs(t *testing.T, userID string, kind ResourceKind, operation Operation) []string {
	t.Helper()
	scope, err := f.checker.Scope(context.Background(), Subject{UserID: userID}, ScopeQuery{Kind: kind, Operation: operation})
	if err != nil {
		t.Fatalf("Scope(%s) error = %v", kind, err)
	}
	ids := append([]string(nil), scope.ResourceIDs...)
	sort.Strings(ids)
	return ids
}

// 线上现象：控制台把成员设成「租户管理员」（只写 role_id），他在数据面上
// 却仍是普通成员 —— 知识库列表空、问答和搜索也空。
func TestTenantAdminAssignedByRoleIDSeesWholeTenant(t *testing.T) {
	fixture := newTeamFixture(t)

	if err := fixture.check(t, "u-admin", ResourceKindDataset, "ds-private", OperationRead); err != nil {
		t.Errorf("租户管理员读私有知识库 error = %v, want nil", err)
	}
	if err := fixture.check(t, "u-admin", ResourceKindDataset, "ds-private", OperationDelete); err != nil {
		t.Errorf("租户管理员删私有知识库 error = %v, want nil", err)
	}
	if ids := fixture.scopeIDs(t, "u-admin", ResourceKindDataset, OperationRead); len(ids) != 2 {
		t.Errorf("租户管理员知识库列表 = %v, want both datasets", ids)
	}
	if err := fixture.check(t, "u-admin", ResourceKindChat, "chat-1", OperationRead); err != nil {
		t.Errorf("租户管理员读知识问答 error = %v, want nil", err)
	}
	if err := fixture.check(t, "u-admin", ResourceKindSearchApp, "search-1", OperationUpdate); err != nil {
		t.Errorf("租户管理员改知识搜索 error = %v, want nil", err)
	}
}

func TestPlainMemberSeesTenantAppsButNotPrivateDatasets(t *testing.T) {
	fixture := newTeamFixture(t)

	// 问答与搜索是租户级资产：成员看得到、用得了。
	if err := fixture.check(t, "u-member", ResourceKindChat, "chat-1", OperationRead); err != nil {
		t.Errorf("普通成员读知识问答 error = %v, want nil", err)
	}
	if ids := fixture.scopeIDs(t, "u-member", ResourceKindChat, OperationRead); len(ids) != 1 || ids[0] != "chat-1" {
		t.Errorf("普通成员问答列表 = %v, want [chat-1]", ids)
	}
	if err := fixture.check(t, "u-member", ResourceKindSearchApp, "search-1", OperationRun); err != nil {
		t.Errorf("普通成员用知识搜索 error = %v, want nil", err)
	}
	// 改别人的搜索配置仍然不放行。
	if err := fixture.check(t, "u-member", ResourceKindSearchApp, "search-1", OperationUpdate); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("普通成员改他人搜索 error = %v, want %v", err, ErrPermissionDenied)
	}
	// 私有知识库仍归租户管理员和创建者。
	if err := fixture.check(t, "u-member", ResourceKindDataset, "ds-private", OperationRead); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("普通成员读私有知识库 error = %v, want %v", err, ErrPermissionDenied)
	}
	// team 可见的知识库成员能看。
	if err := fixture.check(t, "u-member", ResourceKindDataset, "ds-team", OperationRead); err != nil {
		t.Errorf("普通成员读团队知识库 error = %v, want nil", err)
	}

	// 跨租户一律拒绝。
	if err := fixture.check(t, "outsider", ResourceKindChat, "chat-1", OperationRead); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("外部租户读知识问答 error = %v, want %v", err, ErrPermissionDenied)
	}
	if err := fixture.check(t, "outsider", ResourceKindSearchApp, "search-1", OperationRead); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("外部租户读知识搜索 error = %v, want %v", err, ErrPermissionDenied)
	}
}
