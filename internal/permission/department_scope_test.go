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

// departmentFixture seeds one tenant with a two-level department tree plus a
// sibling department, and one private dataset per creator. Every case below
// reads from it so the assertions differ only in who is asking.
type departmentFixture struct {
	db      *gorm.DB
	checker *Checker
}

func newDepartmentFixture(t *testing.T) departmentFixture {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+url.QueryEscape(t.Name())+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&entity.Knowledgebase{}, &entity.UserTenant{}, &entity.ResourceGrant{},
		&entity.User{}, &entity.Tenant{}, &entity.Department{},
	); err != nil {
		t.Fatalf("migrate permission tables: %v", err)
	}

	valid := string(entity.StatusValid)
	departments := []entity.Department{
		{ID: "dept-root", TenantID: "dept-tenant", Name: "研发部"},
		{ID: "dept-child", TenantID: "dept-tenant", ParentID: "dept-root", Name: "后端组"},
		{ID: "dept-other", TenantID: "dept-tenant", Name: "市场部"},
		{ID: "dept-foreign", TenantID: "other-tenant", Name: "外部部门"},
	}
	for i := range departments {
		if err := db.Create(&departments[i]).Error; err != nil {
			t.Fatalf("create department %q: %v", departments[i].ID, err)
		}
	}
	users := []entity.User{
		{ID: "dept-admin", Nickname: "部门管理员", Email: "dept-admin@example.com", DepartmentID: "dept-root"},
		{ID: "member-child", Nickname: "子部门成员", Email: "member-child@example.com", DepartmentID: "dept-child"},
		{ID: "member-other", Nickname: "他部门成员", Email: "member-other@example.com", DepartmentID: "dept-other"},
		{ID: "member-none", Nickname: "未分配成员", Email: "member-none@example.com"},
		{ID: "foreign-admin", Nickname: "外部管理员", Email: "foreign-admin@example.com", DepartmentID: "dept-foreign"},
	}
	for i := range users {
		if err := db.Create(&users[i]).Error; err != nil {
			t.Fatalf("create user %q: %v", users[i].ID, err)
		}
	}
	memberships := []entity.UserTenant{
		{ID: "m-owner", UserID: "tenant-owner", TenantID: "dept-tenant", Role: string(RoleOwner), Status: &valid},
		{ID: "m-admin", UserID: "dept-admin", TenantID: "dept-tenant", Role: string(RoleAdmin), Status: &valid},
		{ID: "m-child", UserID: "member-child", TenantID: "dept-tenant", Role: string(RoleNormal), Status: &valid},
		{ID: "m-other", UserID: "member-other", TenantID: "dept-tenant", Role: string(RoleNormal), Status: &valid},
		{ID: "m-none", UserID: "member-none", TenantID: "dept-tenant", Role: string(RoleNormal), Status: &valid},
		{ID: "m-foreign-owner", UserID: "foreign-owner", TenantID: "other-tenant", Role: string(RoleOwner), Status: &valid},
		{ID: "m-foreign-admin", UserID: "foreign-admin", TenantID: "other-tenant", Role: string(RoleAdmin), Status: &valid},
	}
	for i := range memberships {
		if err := db.Create(&memberships[i]).Error; err != nil {
			t.Fatalf("create membership %q: %v", memberships[i].ID, err)
		}
	}
	datasets := []entity.Knowledgebase{
		{ID: "ds-child", TenantID: "dept-tenant", CreatedBy: "member-child", Name: "子部门私有库", Permission: string(entity.TenantPermissionMe), Status: &valid},
		{ID: "ds-other", TenantID: "dept-tenant", CreatedBy: "member-other", Name: "他部门私有库", Permission: string(entity.TenantPermissionMe), Status: &valid},
		{ID: "ds-none", TenantID: "dept-tenant", CreatedBy: "member-none", Name: "未分配成员私有库", Permission: string(entity.TenantPermissionMe), Status: &valid},
	}
	for i := range datasets {
		if err := db.Create(&datasets[i]).Error; err != nil {
			t.Fatalf("create dataset %q: %v", datasets[i].ID, err)
		}
	}

	return departmentFixture{db: db, checker: NewDatabaseChecker(db)}
}

func (f departmentFixture) check(t *testing.T, userID, datasetID string, operation Operation) error {
	t.Helper()
	return f.checker.CheckResource(context.Background(), Subject{UserID: userID},
		ResourceRef{Kind: ResourceKindDataset, ID: datasetID}, operation)
}

func TestDepartmentSubtreeIncludesDescendants(t *testing.T) {
	fixture := newDepartmentFixture(t)

	cases := []struct {
		name string
		root string
		want []string
	}{
		{name: "root_with_child", root: "dept-root", want: []string{"dept-root", "dept-child"}},
		{name: "leaf", root: "dept-child", want: []string{"dept-child"}},
		{name: "unassigned", root: "", want: nil},
		// A department row may be deleted while its members keep the id: the id
		// itself must survive, otherwise those members' content disappears.
		{name: "missing_root_keeps_itself", root: "dept-gone", want: []string{"dept-gone"}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			got, err := DepartmentSubtree(context.Background(), fixture.db, testCase.root)
			if err != nil {
				t.Fatalf("DepartmentSubtree(%q) error = %v", testCase.root, err)
			}
			sort.Strings(got)
			want := append([]string(nil), testCase.want...)
			sort.Strings(want)
			if len(got) != len(want) {
				t.Fatalf("DepartmentSubtree(%q) = %v, want %v", testCase.root, got, want)
			}
			for i := range want {
				if got[i] != want[i] {
					t.Fatalf("DepartmentSubtree(%q) = %v, want %v", testCase.root, got, want)
				}
			}
		})
	}
}

func TestDepartmentAdminSeesDepartmentContent(t *testing.T) {
	fixture := newDepartmentFixture(t)

	// 本部门子部门成员建的内容：可见，但只读。
	if err := fixture.check(t, "dept-admin", "ds-child", OperationRead); err != nil {
		t.Errorf("部门管理员读本部门内容 error = %v, want nil", err)
	}
	if err := fixture.check(t, "dept-admin", "ds-child", OperationRun); err != nil {
		t.Errorf("部门管理员检索本部门内容 error = %v, want nil", err)
	}
	for _, operation := range []Operation{OperationUpdate, OperationDelete, OperationShare} {
		if err := fixture.check(t, "dept-admin", "ds-child", operation); !errors.Is(err, ErrPermissionDenied) {
			t.Errorf("部门管理员 %s 本部门内容 error = %v, want %v", operation, err, ErrPermissionDenied)
		}
	}

	// 兄弟部门与未分配成员的内容不在其子树里。
	if err := fixture.check(t, "dept-admin", "ds-other", OperationRead); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("部门管理员读他部门内容 error = %v, want %v", err, ErrPermissionDenied)
	}
	if err := fixture.check(t, "dept-admin", "ds-none", OperationRead); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("部门管理员读未分配成员内容 error = %v, want %v", err, ErrPermissionDenied)
	}
}

func TestDepartmentScopeDoesNotLeakAcrossTenantsOrRoles(t *testing.T) {
	fixture := newDepartmentFixture(t)

	// 普通成员不是部门管理员：同部门也看不到别人的私有内容。
	if err := fixture.check(t, "member-other", "ds-child", OperationRead); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("普通成员读同事私有内容 error = %v, want %v", err, ErrPermissionDenied)
	}
	// 别个租户的部门管理员，即使部门 id 恰好被引用，也管不到本租户的内容。
	if err := fixture.check(t, "foreign-admin", "ds-child", OperationRead); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("外部租户部门管理员读本租户内容 error = %v, want %v", err, ErrPermissionDenied)
	}
	// 租户管理员本来就看得见整个租户，改部门逻辑不能把它弄丢。
	if err := fixture.check(t, "tenant-owner", "ds-other", OperationDelete); err != nil {
		t.Errorf("租户管理员删除本租户内容 error = %v, want nil", err)
	}
}

func TestDepartmentAdminQueryScopeMatchesSingleResourceCheck(t *testing.T) {
	fixture := newDepartmentFixture(t)

	scope, err := fixture.checker.QueryScope(context.Background(), Subject{UserID: "dept-admin"}, ScopeQuery{
		Kind: ResourceKindDataset, Operation: OperationRead,
	})
	if err != nil {
		t.Fatalf("QueryScope(datasets, dept admin) error = %v", err)
	}
	var ids []string
	if err := scope.Apply(fixture.db.Model(&entity.Knowledgebase{})).Order("knowledgebase.id").
		Pluck("knowledgebase.id", &ids).Error; err != nil {
		t.Fatalf("query authorized datasets: %v", err)
	}
	if len(ids) != 1 || ids[0] != "ds-child" {
		t.Fatalf("QueryScope(datasets, dept admin) = %v, want [ds-child]", ids)
	}

	// 普通成员仍然只能看到 team 可见的库（本 fixture 里一个都没有）。
	memberScope, err := fixture.checker.QueryScope(context.Background(), Subject{UserID: "member-other"}, ScopeQuery{
		Kind: ResourceKindDataset, Operation: OperationRead,
	})
	if err != nil {
		t.Fatalf("QueryScope(datasets, member) error = %v", err)
	}
	var memberIDs []string
	if err := memberScope.Apply(fixture.db.Model(&entity.Knowledgebase{})).Order("knowledgebase.id").
		Pluck("knowledgebase.id", &memberIDs).Error; err != nil {
		t.Fatalf("query authorized datasets for member: %v", err)
	}
	if len(memberIDs) != 0 {
		t.Fatalf("QueryScope(datasets, member) = %v, want none", memberIDs)
	}

	// 列表 SQL 与逐条判定必须给出同一个答案。
	for _, datasetID := range []string{"ds-child", "ds-other", "ds-none"} {
		singleErr := fixture.check(t, "dept-admin", datasetID, OperationRead)
		listed := false
		for _, id := range ids {
			if id == datasetID {
				listed = true
				break
			}
		}
		if listed != (singleErr == nil) {
			t.Errorf("dataset %q: QueryScope listed=%v but CheckResource error = %v", datasetID, listed, singleErr)
		}
	}
}
