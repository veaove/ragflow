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

// seedDocument 在 fixture 的知识库里补一个文件。
func seedDocument(t *testing.T, db *gorm.DB, id string) {
	t.Helper()
	name := id + ".txt"
	if err := db.Create(&entity.Document{
		ID: id, KbID: "kb-1", ParserID: "naive", ParserConfig: entity.JSONMap{},
		Type: "pdf", CreatedBy: "owner-1", Name: &name, Suffix: "txt",
	}).Error; err != nil {
		t.Fatalf("seed document %s: %v", id, err)
	}
}

// seedDocumentGrant 给文件补一条规则。
func seedDocumentGrant(t *testing.T, db *gorm.DB, id, documentID, subjectKind, subjectID, permission, effect string) {
	t.Helper()
	if err := db.Create(&entity.ResourceGrant{
		ID: id, TenantID: "tenant-1",
		ResourceKind: string(ResourceKindDocument), ResourceID: documentID,
		SubjectKind: subjectKind, SubjectID: subjectID,
		Permission: permission, Effect: effect,
	}).Error; err != nil {
		t.Fatalf("seed grant %s: %v", id, err)
	}
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

// 单文件判定必须和列表谓词给出同样的结论：进得去库、但文件被拒绝 / 不在名单里
// 的人，直连 document_id 读内容要被挡住；继承与 allow 的照常放行。
func TestCheckDocumentAccessMatchesListVisibility(t *testing.T) {
	db, memberID := setupDocumentScopeFixture(t)
	ctx := context.Background()
	subject := Subject{UserID: memberID}

	for _, docID := range []string{"doc-inherit", "doc-allow"} {
		if err := CheckDocumentAccess(ctx, db, subject, "kb-1", docID, OperationRead); err != nil {
			t.Errorf("%s should be readable, got %v", docID, err)
		}
	}
	for _, docID := range []string{"doc-deny", "doc-others", "doc-team-deny"} {
		if err := CheckDocumentAccess(ctx, db, subject, "kb-1", docID, OperationRead); !errors.Is(err, ErrPermissionDenied) {
			t.Errorf("%s must be denied, got %v", docID, err)
		}
	}
	// 库主人不受文件级规则影响。
	for _, docID := range []string{"doc-deny", "doc-others"} {
		if err := CheckDocumentAccess(ctx, db, Subject{UserID: "owner-1"}, "kb-1", docID, OperationRead); err != nil {
			t.Errorf("owner should read %s, got %v", docID, err)
		}
	}
	// 调用方传错库时以文件自己的 kb_id 为准：不能靠"传一个自己当主人的库"
	// 绕过文件级规则。
	if err := CheckDocumentAccess(ctx, db, subject, "kb-owned-by-someone-else", "doc-deny", OperationRead); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("wrong dataset must not bypass file rules, got %v", err)
	}
	// 不传库时从文件反查，结论不变。
	if err := CheckDocumentAccess(ctx, db, subject, "", "doc-others", OperationRead); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("dataset should be resolved from the document, got %v", err)
	}
}

// 只读级别只放行"看 + 检索 + 解析"，编辑权才放行写操作。
func TestCheckDocumentAccessHonoursGrantLevel(t *testing.T) {
	db, memberID := setupDocumentScopeFixture(t)
	seedDocument(t, db, "doc-edit")
	seedDocumentGrant(t, db, "g-edit", "doc-edit",
		entity.GrantSubjectUser, memberID, "edit", entity.GrantEffectAllow)

	ctx := context.Background()
	subject := Subject{UserID: memberID}

	if err := CheckDocumentAccess(ctx, db, subject, "kb-1", "doc-edit", OperationUpdate); err != nil {
		t.Fatalf("edit grant should allow update, got %v", err)
	}
	if err := CheckDocumentAccess(ctx, db, subject, "kb-1", "doc-allow", OperationUpdate); !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("read grant must deny update, got %v", err)
	}
	// run/use（检索、问答）属于只读的一种形态。
	for _, op := range []Operation{OperationRun, OperationUse} {
		if err := CheckDocumentAccess(ctx, db, subject, "kb-1", "doc-allow", op); err != nil {
			t.Errorf("read grant should allow %q, got %v", op, err)
		}
	}
}

// 检索链路用同一份规则算出"要摘掉的文件"。
func TestHiddenDocumentIDsMatchesFileRules(t *testing.T) {
	db, memberID := setupDocumentScopeFixture(t)
	ctx := context.Background()

	hidden, err := HiddenDocumentIDs(ctx, db, Subject{UserID: memberID}, []string{"kb-1"})
	if err != nil {
		t.Fatalf("HiddenDocumentIDs: %v", err)
	}
	want := []string{"doc-deny", "doc-others", "doc-team-deny"}
	if !equalStringSlices(hidden["kb-1"], want) {
		t.Fatalf("hidden documents = %v, want %v", hidden["kb-1"], want)
	}

	hidden, err = HiddenDocumentIDs(ctx, db, Subject{UserID: "owner-1"}, []string{"kb-1"})
	if err != nil {
		t.Fatalf("HiddenDocumentIDs(owner): %v", err)
	}
	if len(hidden) != 0 {
		t.Fatalf("owner should have nothing hidden, got %v", hidden)
	}

	// 一个规则都没有的库不该触发逐库判定。
	hidden, err = HiddenDocumentIDs(ctx, db, Subject{UserID: memberID}, []string{"kb-empty"})
	if err != nil {
		t.Fatalf("HiddenDocumentIDs(empty kb): %v", err)
	}
	if len(hidden) != 0 {
		t.Fatalf("kb without rules should hide nothing, got %v", hidden)
	}
}
