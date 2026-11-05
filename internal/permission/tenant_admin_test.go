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
	"time"

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

// setVisibility 直接改资源表的可见性列，模拟控制台把资源调成某一档。
func (f teamFixture) setVisibility(t *testing.T, table, id, visibility string) {
	t.Helper()
	if err := f.db.Table(table).Where("id = ?", id).Update("permission", visibility).Error; err != nil {
		t.Fatalf("set visibility %s/%s: %v", table, id, err)
	}
}

// grant 写一条逐人授权，模拟控制台给普通成员开权限。
func (f teamFixture) grant(t *testing.T, kind, resourceID, userID, level string) {
	t.Helper()
	now := time.Now().UnixMilli()
	row := &entity.ResourceGrant{
		ID:       "grant-" + kind + "-" + resourceID + "-" + userID,
		TenantID: "team-a", ResourceKind: kind, ResourceID: resourceID,
		SubjectKind: entity.GrantSubjectUser, SubjectID: userID,
		Permission: level, Effect: entity.GrantEffectAllow,
		BaseModel: entity.BaseModel{CreateTime: &now, UpdateTime: &now},
	}
	if err := f.db.Create(row).Error; err != nil {
		t.Fatalf("grant %s/%s to %s: %v", kind, resourceID, userID, err)
	}
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

// 租户管理员（控制台只写 role_id、枚举仍是 normal）看得到本租户的全部资源，
// 含 owner（仅所有者可见）档 —— 与知识库列表 SQL 的 callerIsOwner 分支同一
// 口径。五类资源共用这条判定，否则同一份授权会在知识库生效、在知识问答 /
// 知识搜索 / 智能体 / 记忆里失效。
func TestTenantAdminSeesEveryTier(t *testing.T) {
	fixture := newTeamFixture(t)

	for _, op := range []Operation{OperationRead, OperationDelete} {
		if err := fixture.check(t, "u-admin", ResourceKindDataset, "ds-private", op); err != nil {
			t.Errorf("租户管理员 owner 档知识库 %v error = %v, want nil", op, err)
		}
	}
	if err := fixture.check(t, "u-admin", ResourceKindDataset, "ds-team", OperationRead); err != nil {
		t.Errorf("租户管理员读团队知识库 error = %v, want nil", err)
	}
	if ids := fixture.scopeIDs(t, "u-admin", ResourceKindDataset, OperationRead); len(ids) != 2 ||
		ids[0] != "ds-private" || ids[1] != "ds-team" {
		t.Errorf("租户管理员知识库列表 = %v, want [ds-private ds-team]", ids)
	}

	// 问答 / 搜索默认 owner 档：同样对租户管理员可见，不必先改成管理层可见。
	if err := fixture.check(t, "u-admin", ResourceKindChat, "chat-1", OperationRead); err != nil {
		t.Errorf("租户管理员读 owner 档知识问答 error = %v, want nil", err)
	}
	if err := fixture.check(t, "u-admin", ResourceKindSearchApp, "search-1", OperationUpdate); err != nil {
		t.Errorf("租户管理员改 owner 档知识搜索 error = %v, want nil", err)
	}
}

// 普通成员不在任何一档里：即使资源是「租户管理层可见」，也要显式授权才看得到。
func TestPlainMemberNeedsExplicitGrant(t *testing.T) {
	fixture := newTeamFixture(t)

	if err := fixture.check(t, "u-member", ResourceKindChat, "chat-1", OperationRead); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("普通成员读知识问答 error = %v, want %v", err, ErrPermissionDenied)
	}
	if ids := fixture.scopeIDs(t, "u-member", ResourceKindChat, OperationRead); len(ids) != 0 {
		t.Errorf("普通成员问答列表 = %v, want []", ids)
	}
	if err := fixture.check(t, "u-member", ResourceKindSearchApp, "search-1", OperationRun); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("普通成员用知识搜索 error = %v, want %v", err, ErrPermissionDenied)
	}
	if err := fixture.check(t, "u-member", ResourceKindDataset, "ds-private", OperationRead); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("普通成员读私有知识库 error = %v, want %v", err, ErrPermissionDenied)
	}
	// team 值归一到「租户管理层可见」，普通成员仍不在内。
	if err := fixture.check(t, "u-member", ResourceKindDataset, "ds-team", OperationRead); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("普通成员读团队知识库 error = %v, want %v", err, ErrPermissionDenied)
	}

	// 逐人授权后按级别放行：只读授权只能看和检索，不能改。
	fixture.grant(t, "dataset", "ds-team", "u-member", "read")
	fixture.grant(t, "chat", "chat-1", "u-member", "read")
	if err := fixture.check(t, "u-member", ResourceKindDataset, "ds-team", OperationRead); err != nil {
		t.Errorf("授权后普通成员读团队知识库 error = %v, want nil", err)
	}
	if err := fixture.check(t, "u-member", ResourceKindChat, "chat-1", OperationRead); err != nil {
		t.Errorf("授权后普通成员读知识问答 error = %v, want nil", err)
	}
	if err := fixture.check(t, "u-member", ResourceKindChat, "chat-1", OperationUpdate); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("只读授权改知识问答 error = %v, want %v", err, ErrPermissionDenied)
	}
	if ids := fixture.scopeIDs(t, "u-member", ResourceKindChat, OperationRead); len(ids) != 1 || ids[0] != "chat-1" {
		t.Errorf("授权后普通成员问答列表 = %v, want [chat-1]", ids)
	}

	// 跨租户一律拒绝：租户边界不参与授权。
	if err := fixture.check(t, "outsider", ResourceKindChat, "chat-1", OperationRead); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("外部租户读知识问答 error = %v, want %v", err, ErrPermissionDenied)
	}
	if err := fixture.check(t, "outsider", ResourceKindSearchApp, "search-1", OperationRead); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("外部租户读知识搜索 error = %v, want %v", err, ErrPermissionDenied)
	}
}

// 平台超级管理员（user.is_superuser）跨租户可见，且来源单独标记。
func TestPlatformAdminSeesEveryTier(t *testing.T) {
	fixture := newTeamFixture(t)

	flag := true
	if err := fixture.db.Model(&entity.User{}).Where("id = ?", "outsider").
		Update("is_superuser", flag).Error; err != nil {
		t.Fatalf("promote superuser: %v", err)
	}

	for _, tc := range []struct {
		kind ResourceKind
		id   string
	}{
		{ResourceKindDataset, "ds-private"},
		{ResourceKindDataset, "ds-team"},
		{ResourceKindChat, "chat-1"},
		{ResourceKindSearchApp, "search-1"},
	} {
		access, err := fixture.checker.ResolveAccess(context.Background(), Subject{UserID: "outsider"},
			ResourceRef{Kind: tc.kind, ID: tc.id})
		if err != nil {
			t.Errorf("超管读 %s/%s error = %v, want nil", tc.kind, tc.id, err)
			continue
		}
		if access.Source != AccessSourcePlatformAdmin {
			t.Errorf("超管读 %s/%s source = %q, want %q", tc.kind, tc.id, access.Source, AccessSourcePlatformAdmin)
		}
	}
}
