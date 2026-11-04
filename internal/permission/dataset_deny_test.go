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
//

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

// 库级「排除」的 fixture：同一租户里 4 个库，覆盖
//
//	kb-team      全团队允许
//	kb-deny      全团队允许 + member-1 被排除
//	kb-own       member-1 自建（permission=owner）
//	kb-own-deny  member-1 自建 + 自己被排除（排除对创建者无效）
type datasetDenyFixture struct {
	db      *gorm.DB
	checker *Checker
}

func newDatasetDenyFixture(t *testing.T) datasetDenyFixture {
	t.Helper()

	db, err := gorm.Open(sqlite.Open("file:"+url.QueryEscape(t.Name())+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&entity.Tenant{}, &entity.User{}, &entity.UserTenant{},
		&entity.Knowledgebase{}, &entity.ResourceGrant{}, &entity.Department{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	const tenantID = "tenant-deny"
	valid := string(entity.StatusValid)
	enabled := true
	tenantName := "deny"
	if err := db.Create(&entity.Tenant{ID: tenantID, Name: &tenantName, Enabled: &enabled}).Error; err != nil {
		t.Fatalf("seed tenant: %v", err)
	}
	for _, uid := range []string{"owner-1", "admin-1", "member-1", "member-2"} {
		if err := db.Create(&entity.User{ID: uid, Email: uid + "@example.com"}).Error; err != nil {
			t.Fatalf("seed user %s: %v", uid, err)
		}
	}
	memberships := []struct {
		id   string
		user string
		role TenantRole
	}{
		{"ut-owner", "owner-1", RoleOwner},
		{"ut-admin", "admin-1", RoleAdmin},
		{"ut-member-1", "member-1", RoleNormal},
		{"ut-member-2", "member-2", RoleNormal},
	}
	for _, m := range memberships {
		if err := db.Create(&entity.UserTenant{
			ID: m.id, UserID: m.user, TenantID: tenantID,
			Role: string(m.role), Status: &valid,
		}).Error; err != nil {
			t.Fatalf("seed membership %s: %v", m.id, err)
		}
	}

	datasets := []*entity.Knowledgebase{
		{ID: "kb-team", TenantID: tenantID, Name: "全团队", CreatedBy: "owner-1",
			Permission: entity.ResourceVisibilityTenantOwner, Status: &valid},
		{ID: "kb-deny", TenantID: tenantID, Name: "全团队排除一人", CreatedBy: "owner-1",
			Permission: entity.ResourceVisibilityTenantOwner, Status: &valid},
		{ID: "kb-own", TenantID: tenantID, Name: "成员自建", CreatedBy: "member-1",
			Permission: entity.ResourceVisibilityOwner, Status: &valid},
		{ID: "kb-own-deny", TenantID: tenantID, Name: "成员自建且排除自己", CreatedBy: "member-1",
			Permission: entity.ResourceVisibilityOwner, Status: &valid},
	}
	for _, kb := range datasets {
		if err := db.Create(kb).Error; err != nil {
			t.Fatalf("seed kb %s: %v", kb.ID, err)
		}
	}

	grants := []*entity.ResourceGrant{
		// 全团队可编辑：成员本来就能看到这两个库。
		{ID: "g-team", ResourceKind: string(ResourceKindDataset), ResourceID: "kb-team",
			SubjectKind: entity.GrantSubjectTeam, Permission: "edit", Effect: entity.GrantEffectAllow},
		{ID: "g-deny-team", ResourceKind: string(ResourceKindDataset), ResourceID: "kb-deny",
			SubjectKind: entity.GrantSubjectTeam, Permission: "edit", Effect: entity.GrantEffectAllow},
		// 再单独把 member-1 排除：deny 必须压过上面那条 team allow。
		{ID: "g-deny", ResourceKind: string(ResourceKindDataset), ResourceID: "kb-deny",
			SubjectKind: entity.GrantSubjectUser, SubjectID: "member-1", Permission: "read", Effect: entity.GrantEffectDeny},
		// 创建者被排除：应当无效（创建者在判定链最前面就返回了）。
		{ID: "g-own-deny", ResourceKind: string(ResourceKindDataset), ResourceID: "kb-own-deny",
			SubjectKind: entity.GrantSubjectUser, SubjectID: "member-1", Permission: "read", Effect: entity.GrantEffectDeny},
	}
	for _, grant := range grants {
		grant.TenantID = tenantID
		if err := db.Create(grant).Error; err != nil {
			t.Fatalf("seed grant %s: %v", grant.ID, err)
		}
	}

	return datasetDenyFixture{db: db, checker: NewDatabaseChecker(db)}
}

func (f datasetDenyFixture) check(t *testing.T, userID, datasetID string, operation Operation) error {
	t.Helper()
	return f.checker.CheckResource(context.Background(), Subject{UserID: userID},
		ResourceRef{Kind: ResourceKindDataset, ID: datasetID}, operation)
}

func (f datasetDenyFixture) queryScopeIDs(t *testing.T, userID string) []string {
	t.Helper()
	scope, err := f.checker.QueryScope(context.Background(), Subject{UserID: userID}, ScopeQuery{
		Kind: ResourceKindDataset, Operation: OperationRead,
	})
	if err != nil {
		t.Fatalf("QueryScope(%s): %v", userID, err)
	}
	var ids []string
	if err := scope.Apply(f.db.Model(&entity.Knowledgebase{})).Order("knowledgebase.id").
		Pluck("knowledgebase.id", &ids).Error; err != nil {
		t.Fatalf("query datasets: %v", err)
	}
	sort.Strings(ids)
	return ids
}

func TestDatasetDenyBeatsTeamGrant(t *testing.T) {
	fixture := newDatasetDenyFixture(t)

	// 被排除的人：全团队允许也盖不回来。
	if err := fixture.check(t, "member-1", "kb-deny", OperationRead); !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("member-1 读被排除的库 error = %v, want %v", err, ErrPermissionDenied)
	}
	// 同一条 team allow 对没被排除的人照常生效 —— 排除是精确到主体的。
	if err := fixture.check(t, "member-2", "kb-deny", OperationRead); err != nil {
		t.Fatalf("member-2 读同库 error = %v, want nil", err)
	}
	// 写操作同样进不去（排除是整体不可见，不是只挡读）。
	if err := fixture.check(t, "member-1", "kb-deny", OperationUpdate); !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("member-1 改被排除的库 error = %v, want %v", err, ErrPermissionDenied)
	}
}

func TestDatasetDenyIgnoredForCreatorAndManagement(t *testing.T) {
	fixture := newDatasetDenyFixture(t)

	// 创建者不受排除影响：否则一条 deny 就能把库锁到没人能取消它。
	if err := fixture.check(t, "member-1", "kb-own-deny", OperationRead); err != nil {
		t.Fatalf("创建者读自建库 error = %v, want nil", err)
	}
	// 租户管理员同样不受影响（管理层由档位与角色决定，排除只作用于普通成员）。
	if err := fixture.check(t, "admin-1", "kb-deny", OperationRead); err != nil {
		t.Fatalf("租户管理员读被排除的库 error = %v, want nil", err)
	}
	if err := fixture.check(t, "owner-1", "kb-deny", OperationDelete); err != nil {
		t.Fatalf("租户 owner 删被排除的库 error = %v, want nil", err)
	}
}

func TestQueryScopeExcludesDeniedDatasets(t *testing.T) {
	fixture := newDatasetDenyFixture(t)

	// 列表与单条判定必须给出同一份答案：少了这一条，被排除的人会出现
	// 「列表里有、点进去 404」（D1 的反向版本）。
	got := fixture.queryScopeIDs(t, "member-1")
	want := []string{"kb-own", "kb-own-deny", "kb-team"}
	if len(got) != len(want) {
		t.Fatalf("QueryScope(member-1) = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("QueryScope(member-1) = %v, want %v", got, want)
		}
	}

	// 没被排除的人不受影响。
	other := fixture.queryScopeIDs(t, "member-2")
	if len(other) != 2 || other[0] != "kb-deny" || other[1] != "kb-team" {
		t.Fatalf("QueryScope(member-2) = %v, want [kb-deny kb-team]", other)
	}
}

func TestDocumentRuleClauseFailsClosedWhenDatasetDenied(t *testing.T) {
	fixture := newDatasetDenyFixture(t)

	clause, args, ok := documentRuleClause(context.Background(), fixture.db, Subject{UserID: "member-1"}, "kb-deny")
	if !ok {
		t.Fatal("库级已被排除时，文件级必须收紧而不是「不过滤」")
	}
	if clause != "0 = 1" || len(args) != 0 {
		t.Fatalf("clause = %q args = %v, want 恒假谓词", clause, args)
	}
}
