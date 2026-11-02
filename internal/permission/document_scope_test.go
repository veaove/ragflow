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
	"sort"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"ragflow/internal/entity"
)

// 文件级授权的判定 fixture：一个 permission=team 的知识库（普通成员因此
// 本来就看得见全库）+ 四个文件，分别覆盖"继承 / allow / deny / 他人名单"。
func setupDocumentScopeFixture(t *testing.T) (*gorm.DB, string) {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{TranslateError: true})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err = db.AutoMigrate(
		&entity.Tenant{}, &entity.User{}, &entity.UserTenant{},
		&entity.Knowledgebase{}, &entity.Document{}, &entity.ResourceGrant{},
		&entity.Department{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	const (
		tenantID = "tenant-1"
		ownerID  = "owner-1"
		memberID = "member-1"
		otherID  = "member-2"
		kbID     = "kb-1"
	)
	valid := string(entity.StatusValid)
	enabled := true
	tenantName := "t"
	if err := db.Create(&entity.Tenant{ID: tenantID, Name: &tenantName, Enabled: &enabled}).Error; err != nil {
		t.Fatalf("seed tenant: %v", err)
	}
	for _, uid := range []string{ownerID, memberID, otherID} {
		if err := db.Create(&entity.User{ID: uid, Email: uid + "@example.com"}).Error; err != nil {
			t.Fatalf("seed user %s: %v", uid, err)
		}
	}
	members := []struct {
		id   string
		user string
		role TenantRole
	}{
		{"ut-owner", ownerID, RoleOwner},
		{"ut-member", memberID, RoleNormal},
		{"ut-other", otherID, RoleNormal},
	}
	for _, m := range members {
		if err := db.Create(&entity.UserTenant{
			ID: m.id, UserID: m.user, TenantID: tenantID,
			Role: string(m.role), Status: &valid,
		}).Error; err != nil {
			t.Fatalf("seed membership %s: %v", m.id, err)
		}
	}
	// permission=team：普通成员本来就能看整个库，文件级规则才会有"收紧"的意义。
	if err := db.Create(&entity.Knowledgebase{
		ID: kbID, TenantID: tenantID, Name: "kb", CreatedBy: ownerID,
		Permission: string(entity.TenantPermissionTeam), Status: &valid,
	}).Error; err != nil {
		t.Fatalf("seed kb: %v", err)
	}

	docs := []string{"doc-inherit", "doc-allow", "doc-deny", "doc-others", "doc-team-deny"}
	for _, id := range docs {
		name := id + ".txt"
		if err := db.Create(&entity.Document{
			ID: id, KbID: kbID, ParserID: "naive", ParserConfig: entity.JSONMap{},
			Type: "pdf", CreatedBy: ownerID, Name: &name, Suffix: "txt",
		}).Error; err != nil {
			t.Fatalf("seed document %s: %v", id, err)
		}
	}

	grants := []*entity.ResourceGrant{
		// 只对本人开的口子。
		{ID: "g-allow", ResourceKind: string(ResourceKindDocument), ResourceID: "doc-allow",
			SubjectKind: entity.GrantSubjectUser, SubjectID: memberID, Permission: "read", Effect: entity.GrantEffectAllow},
		// 把本人排除掉。
		{ID: "g-deny", ResourceKind: string(ResourceKindDocument), ResourceID: "doc-deny",
			SubjectKind: entity.GrantSubjectUser, SubjectID: memberID, Permission: "read", Effect: entity.GrantEffectDeny},
		// 名单里只有别人：显式规则接管后本人不再继承库级可见范围。
		{ID: "g-others", ResourceKind: string(ResourceKindDocument), ResourceID: "doc-others",
			SubjectKind: entity.GrantSubjectUser, SubjectID: otherID, Permission: "edit", Effect: entity.GrantEffectAllow},
		// 全团队 allow + 本人 deny：deny 必须压过 allow。
		{ID: "g-team", ResourceKind: string(ResourceKindDocument), ResourceID: "doc-team-deny",
			SubjectKind: entity.GrantSubjectTeam, SubjectID: "", Permission: "edit", Effect: entity.GrantEffectAllow},
		{ID: "g-team-deny", ResourceKind: string(ResourceKindDocument), ResourceID: "doc-team-deny",
			SubjectKind: entity.GrantSubjectUser, SubjectID: memberID, Permission: "read", Effect: entity.GrantEffectDeny},
	}
	for _, g := range grants {
		g.TenantID = tenantID
		if err := db.Create(g).Error; err != nil {
			t.Fatalf("seed grant %s: %v", g.ID, err)
		}
	}
	return db, memberID
}

func visibleDocumentIDs(t *testing.T, db *gorm.DB, subject Subject, kbID string) []string {
	t.Helper()
	scope := DocumentVisibility(context.Background(), db, subject, kbID)
	query := db.Table("document").Where("document.kb_id = ?", kbID)
	query = scope.Apply(query)

	ids := make([]string, 0)
	if err := query.Pluck("document.id", &ids).Error; err != nil {
		t.Fatalf("query visible documents: %v", err)
	}
	sort.Strings(ids)
	return ids
}

func equalStringSlices(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// 普通成员的可见文件：继承的留下，allow 的留下，deny / 他人名单的消失。
func TestDocumentVisibilityAppliesFileRules(t *testing.T) {
	db, memberID := setupDocumentScopeFixture(t)
	got := visibleDocumentIDs(t, db, Subject{UserID: memberID}, "kb-1")
	want := []string{"doc-allow", "doc-inherit"}
	if !equalStringSlices(got, want) {
		t.Fatalf("visible documents = %v, want %v", got, want)
	}
}

// 库的主人不受文件级规则影响：一条 deny 不能把文件锁到没人能取消它。
func TestDocumentVisibilityLetsOwnerSeeEverything(t *testing.T) {
	db, _ := setupDocumentScopeFixture(t)
	got := visibleDocumentIDs(t, db, Subject{UserID: "owner-1"}, "kb-1")
	want := []string{"doc-allow", "doc-deny", "doc-inherit", "doc-others", "doc-team-deny"}
	if !equalStringSlices(got, want) {
		t.Fatalf("owner visible documents = %v, want %v", got, want)
	}
}

// 没有规则时不过滤：scope 是"无限制"，谓词不能把任何行挡掉。
func TestDocumentVisibilityWithoutRulesKeepsEverything(t *testing.T) {
	db, _ := setupDocumentScopeFixture(t)
	// otherID 只被点名在 doc-others 上，其余三个文件对他是继承。
	got := visibleDocumentIDs(t, db, Subject{UserID: "member-2"}, "kb-1")
	want := []string{"doc-inherit", "doc-others", "doc-team-deny"}
	if !equalStringSlices(got, want) {
		t.Fatalf("visible documents = %v, want %v", got, want)
	}
}

// effect 为空（effect 列出现之前写入的存量行）必须按 allow 处理，
// 否则升级之后这些文件会从"已授权"变成"谁都看不见"。
func TestDocumentVisibilityTreatsEmptyEffectAsAllow(t *testing.T) {
	db, memberID := setupDocumentScopeFixture(t)
	if err := db.Model(&entity.ResourceGrant{}).
		Where("id = ?", "g-allow").
		Update("effect", "").Error; err != nil {
		t.Fatalf("clear effect: %v", err)
	}
	got := visibleDocumentIDs(t, db, Subject{UserID: memberID}, "kb-1")
	want := []string{"doc-allow", "doc-inherit"}
	if !equalStringSlices(got, want) {
		t.Fatalf("empty effect should behave as allow, got %v want %v", got, want)
	}
}
