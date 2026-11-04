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

package service

import (
	"context"
	"strings"
	"testing"

	"gorm.io/gorm"

	"ragflow/internal/dao"
	"ragflow/internal/entity"
)

type grantDenyFixture struct {
	db *gorm.DB
}

// setupGrantDenyFixture 一个租户、一个知识库（创建者 user-creator，租户 owner
// 是 user-owner），用来覆盖 SetGrants 的排除规则校验。
func setupGrantDenyFixture(t *testing.T) grantDenyFixture {
	t.Helper()

	db := setupServiceTestDB(t)
	pushServiceDB(t, db)

	valid := string(entity.StatusValid)
	enabled := true
	tenantName := "华夏基金"
	if err := db.Create(&entity.Tenant{ID: "t1", Name: &tenantName, Enabled: &enabled}).Error; err != nil {
		t.Fatalf("seed tenant: %v", err)
	}
	for _, uid := range []string{"user-owner", "user-creator", "user-victim"} {
		if err := db.Create(&entity.User{ID: uid, Email: uid + "@example.com"}).Error; err != nil {
			t.Fatalf("seed user %s: %v", uid, err)
		}
	}
	members := []struct{ id, user, role string }{
		{"ut-owner", "user-owner", "owner"},
		{"ut-creator", "user-creator", "normal"},
		{"ut-victim", "user-victim", "normal"},
	}
	for _, m := range members {
		if err := db.Create(&entity.UserTenant{
			ID: m.id, UserID: m.user, TenantID: "t1", Role: m.role, Status: &valid,
		}).Error; err != nil {
			t.Fatalf("seed membership %s: %v", m.id, err)
		}
	}
	if err := db.Create(&entity.Knowledgebase{
		ID: "kb1", TenantID: "t1", Name: "07-帮助中心", CreatedBy: "user-creator",
		Permission: entity.ResourceVisibilityTenantOwner, Status: &valid,
	}).Error; err != nil {
		t.Fatalf("seed kb: %v", err)
	}
	return grantDenyFixture{db: db}
}

func (f grantDenyFixture) grants(t *testing.T, kind, resourceID string) []*entity.ResourceGrant {
	t.Helper()
	rows, err := dao.NewResourceGrantDAO().ListByResource(context.Background(), f.db, "t1", kind, resourceID)
	if err != nil {
		t.Fatalf("list grants: %v", err)
	}
	return rows
}

func (f grantDenyFixture) effectOf(t *testing.T, kind, resourceID, subjectID string) string {
	t.Helper()
	for _, row := range f.grants(t, kind, resourceID) {
		if row.SubjectID == subjectID {
			return normalizeGrantEffect(row.Effect)
		}
	}
	return ""
}

// 全团队允许 + 单人排除：这是「全员可见后排除个别人」的本体。
func TestSetGrantsAcceptsDatasetDeny(t *testing.T) {
	fixture := setupGrantDenyFixture(t)
	svc := NewResourceGrantService()

	err := svc.SetGrants(context.Background(), "t1", "dataset", "kb1", "", []GrantSubject{
		{Kind: entity.GrantSubjectTeam, Permission: GrantPermissionEdit, Effect: entity.GrantEffectAllow},
		{Kind: entity.GrantSubjectUser, ID: "user-victim", Permission: GrantPermissionRead, Effect: entity.GrantEffectDeny},
	})
	if err != nil {
		t.Fatalf("SetGrants: %v", err)
	}

	if got := fixture.effectOf(t, "dataset", "kb1", "user-victim"); got != entity.GrantEffectDeny {
		t.Fatalf("victim effect = %q, want deny", got)
	}
	rows := fixture.grants(t, "dataset", "kb1")
	if len(rows) != 2 {
		t.Fatalf("rows = %d, want 2", len(rows))
	}
}

// 「排除全团队」等价于清空授权：不给这个入口，保存时就要拒绝。
func TestSetGrantsRejectsTeamDeny(t *testing.T) {
	fixture := setupGrantDenyFixture(t)
	svc := NewResourceGrantService()

	err := svc.SetGrants(context.Background(), "t1", "dataset", "kb1", "", []GrantSubject{
		{Kind: entity.GrantSubjectTeam, Permission: GrantPermissionRead, Effect: entity.GrantEffectDeny},
	})
	if err == nil || !strings.Contains(err.Error(), "全团队") {
		t.Fatalf("err = %v, want 拒绝全团队排除", err)
	}
	if rows := fixture.grants(t, "dataset", "kb1"); len(rows) != 0 {
		t.Fatalf("拒绝时不应落库，got %d rows", len(rows))
	}
}

// 判定链还没接排除谓词的类型先拒绝写入：写成功但判定不认比不支持更糟。
func TestSetGrantsRejectsDenyForUnsupportedKind(t *testing.T) {
	fixture := setupGrantDenyFixture(t)
	valid := string(entity.StatusValid)
	if err := fixture.db.AutoMigrate(&entity.Chat{}); err != nil {
		t.Fatalf("migrate chat: %v", err)
	}
	if err := fixture.db.Create(&entity.Chat{
		ID: "chat1", TenantID: "t1", Name: sptr("基金咨询"), CreatedBy: "user-creator",
		Permission: entity.ResourceVisibilityTenantOwner, Status: &valid,
	}).Error; err != nil {
		t.Fatalf("seed chat: %v", err)
	}
	svc := NewResourceGrantService()

	err := svc.SetGrants(context.Background(), "t1", "chat", "chat1", "", []GrantSubject{
		{Kind: entity.GrantSubjectUser, ID: "user-victim", Permission: GrantPermissionRead, Effect: entity.GrantEffectDeny},
	})
	if err == nil || !strings.Contains(err.Error(), "暂不支持") {
		t.Fatalf("err = %v, want 拒绝不支持的排除", err)
	}
}

// 创建者与租户 owner 在判定链里不受排除影响，写进去只会让人误以为生效。
func TestSetGrantsRejectsDenyOnCreatorAndTenantOwner(t *testing.T) {
	setupGrantDenyFixture(t)
	svc := NewResourceGrantService()

	for _, target := range []string{"user-creator", "user-owner"} {
		err := svc.SetGrants(context.Background(), "t1", "dataset", "kb1", "", []GrantSubject{
			{Kind: entity.GrantSubjectUser, ID: target, Permission: GrantPermissionRead, Effect: entity.GrantEffectDeny},
		})
		if err == nil {
			t.Fatalf("排除 %s 应当被拒绝", target)
		}
	}
}

// 老前端不认 effect，整表替换时会把 deny 写成 allow —— 那是悄悄放开权限。
func TestSetGrantsKeepsDenyWhenEffectOmitted(t *testing.T) {
	fixture := setupGrantDenyFixture(t)
	if err := fixture.db.Create(&entity.ResourceGrant{
		ID: "g-old-deny", TenantID: "t1",
		ResourceKind: "dataset", ResourceID: "kb1",
		SubjectKind: entity.GrantSubjectUser, SubjectID: "user-victim",
		Permission: GrantPermissionRead, Effect: entity.GrantEffectDeny,
	}).Error; err != nil {
		t.Fatalf("seed deny: %v", err)
	}
	svc := NewResourceGrantService()

	// Effect 留空 = 调用方没有表达取向，沿用库里的排除。
	if err := svc.SetGrants(context.Background(), "t1", "dataset", "kb1", "", []GrantSubject{
		{Kind: entity.GrantSubjectUser, ID: "user-victim", Permission: GrantPermissionRead},
	}); err != nil {
		t.Fatalf("SetGrants: %v", err)
	}
	if got := fixture.effectOf(t, "dataset", "kb1", "user-victim"); got != entity.GrantEffectDeny {
		t.Fatalf("effect = %q, want deny（不能被安静的放开）", got)
	}

	// 显式提交 allow 才是真的放开。
	if err := svc.SetGrants(context.Background(), "t1", "dataset", "kb1", "", []GrantSubject{
		{Kind: entity.GrantSubjectUser, ID: "user-victim", Permission: GrantPermissionRead, Effect: entity.GrantEffectAllow},
	}); err != nil {
		t.Fatalf("SetGrants(allow): %v", err)
	}
	if got := fixture.effectOf(t, "dataset", "kb1", "user-victim"); got != entity.GrantEffectAllow {
		t.Fatalf("effect = %q, want allow", got)
	}
}
