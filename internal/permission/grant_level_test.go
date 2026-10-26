//
//  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
//
//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.
//

package permission

import (
	"context"
	"errors"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"ragflow/internal/entity"
)

// 只读授权必须把写操作全部挡掉，同时保留「看 + 检索」。
func TestReadOnlyOperationsDropsWriteOperations(t *testing.T) {
	full := []Operation{
		OperationRead, OperationCreate, OperationUpdate, OperationDelete,
		OperationDeleteContent, OperationShare, OperationRun, OperationUse,
	}
	got := readOnlyOperations(full)

	allowed := make(map[Operation]bool, len(got))
	for _, op := range got {
		allowed[op] = true
	}

	for _, want := range []Operation{OperationRead, OperationRun, OperationUse} {
		if !allowed[want] {
			t.Errorf("read-only should keep %q", want)
		}
	}
	for _, banned := range []Operation{
		OperationCreate, OperationUpdate, OperationDelete, OperationDeleteContent, OperationShare,
	} {
		if allowed[banned] {
			t.Errorf("read-only must not keep %q", banned)
		}
	}
}

// 建一套最小 fixture：别人名下的 private 知识库 + 当前用户的一条授权。
func setupGrantFixture(t *testing.T, grantPermission string) (*gorm.DB, string, ResourceRef) {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{TranslateError: true})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err = db.AutoMigrate(
		&entity.Tenant{}, &entity.User{}, &entity.UserTenant{},
		&entity.Knowledgebase{}, &entity.ResourceGrant{}, &entity.Department{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	valid := string(entity.StatusValid)
	enabled := true
	const (
		tenantID = "tenant-1"
		ownerID  = "owner-1"
		memberID = "member-1"
		kbID     = "kb-1"
	)

	tenantName := "t"
	if err := db.Create(&entity.Tenant{ID: tenantID, Name: &tenantName, Enabled: &enabled}).Error; err != nil {
		t.Fatalf("seed tenant: %v", err)
	}
	for _, uid := range []string{ownerID, memberID} {
		if err := db.Create(&entity.User{ID: uid, Email: uid + "@example.com"}).Error; err != nil {
			t.Fatalf("seed user %s: %v", uid, err)
		}
	}
	if err := db.Create(&entity.UserTenant{
		ID: "ut-owner", UserID: ownerID, TenantID: tenantID,
		Role: string(RoleOwner), Status: &valid,
	}).Error; err != nil {
		t.Fatalf("seed owner membership: %v", err)
	}
	if err := db.Create(&entity.UserTenant{
		ID: "ut-member", UserID: memberID, TenantID: tenantID,
		Role: string(RoleNormal), Status: &valid,
	}).Error; err != nil {
		t.Fatalf("seed member membership: %v", err)
	}

	// permission=me 对应 VisibilityPrivate：默认只有 owner 可见，
	// resource_grant 是它唯一的例外通道。
	if err := db.Create(&entity.Knowledgebase{
		ID: kbID, TenantID: tenantID, Name: "kb", CreatedBy: ownerID,
		Permission: string(VisibilityPrivate), Status: &valid,
	}).Error; err != nil {
		t.Fatalf("seed kb: %v", err)
	}

	if err := db.Create(&entity.ResourceGrant{
		ID: "grant-1", TenantID: tenantID,
		ResourceKind: string(ResourceKindDataset), ResourceID: kbID,
		SubjectKind: entity.GrantSubjectUser, SubjectID: memberID,
		Permission: grantPermission,
	}).Error; err != nil {
		t.Fatalf("seed grant: %v", err)
	}

	return db, memberID, ResourceRef{Kind: ResourceKindDataset, ID: kbID}
}

// 只读授权：能看到能检索，但改不了也删不了。
func TestGrantReadLevelAllowsViewButNotEdit(t *testing.T) {
	db, memberID, ref := setupGrantFixture(t, "read")
	checker := NewDatabaseChecker(db)
	ctx := context.Background()
	subject := Subject{UserID: memberID}

	for _, op := range []Operation{OperationRead, OperationRun, OperationUse} {
		if err := checker.CheckResource(ctx, subject, ref, op); err != nil {
			t.Errorf("read grant should allow %q, got %v", op, err)
		}
	}
	for _, op := range []Operation{OperationUpdate, OperationDelete, OperationDeleteContent, OperationShare} {
		if err := checker.CheckResource(ctx, subject, ref, op); !errors.Is(err, ErrPermissionDenied) {
			t.Errorf("read grant must deny %q, got err=%v", op, err)
		}
	}
}

// 可编辑授权：写操作放行（保持这个字段出现之前的行为）。
func TestGrantEditLevelAllowsUpdate(t *testing.T) {
	db, memberID, ref := setupGrantFixture(t, "edit")
	checker := NewDatabaseChecker(db)
	ctx := context.Background()
	subject := Subject{UserID: memberID}

	for _, op := range []Operation{OperationRead, OperationUpdate, OperationDeleteContent, OperationRun} {
		if err := checker.CheckResource(ctx, subject, ref, op); err != nil {
			t.Errorf("edit grant should allow %q, got %v", op, err)
		}
	}
}

// 空 permission（这个字段出现之前写入的存量行）必须按 edit 处理，
// 否则升级后所有已授权的成员会瞬间失去编辑权。
func TestGrantEmptyPermissionTreatedAsEdit(t *testing.T) {
	db, memberID, ref := setupGrantFixture(t, "")
	checker := NewDatabaseChecker(db)

	if err := checker.CheckResource(context.Background(), Subject{UserID: memberID}, ref, OperationUpdate); err != nil {
		t.Fatalf("empty permission should behave as edit, got %v", err)
	}
}

// 同一主体同时命中只读和可编辑时取更强的那个。
func TestGrantLevelPrefersEdit(t *testing.T) {
	db, memberID, ref := setupGrantFixture(t, "read")
	// 再补一条可编辑授权（不同 subject_kind，模拟部门可编辑 + 个人只读）
	if err := db.Create(&entity.ResourceGrant{
		ID: "grant-team", TenantID: "tenant-1",
		ResourceKind: string(ResourceKindDataset), ResourceID: ref.ID,
		SubjectKind: entity.GrantSubjectTeam, SubjectID: "",
		Permission: "edit",
	}).Error; err != nil {
		t.Fatalf("seed team grant: %v", err)
	}

	checker := NewDatabaseChecker(db)
	if err := checker.CheckResource(context.Background(), Subject{UserID: memberID}, ref, OperationUpdate); err != nil {
		t.Fatalf("edit grant should win over read, got %v", err)
	}
}
