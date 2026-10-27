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

package dao

import (
	"context"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"ragflow/internal/common"
	"ragflow/internal/entity"
)

// setupRoleDB 建一张只含角色/权限/成员关系表的内存库。
func setupRoleDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{TranslateError: true})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err = db.AutoMigrate(
		&entity.Role{},
		&entity.RolePermission{},
		&entity.UserTenant{},
		&entity.User{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}

// ─── ConsoleModules / builtinRoles 常量断言 ──────────────────────────────────

func TestConsoleModulesNotEmpty(t *testing.T) {
	if len(ConsoleModules) == 0 {
		t.Fatal("ConsoleModules should not be empty")
	}
	// 必须包含常用的核心模块
	required := []string{"dataset", "chat", "member", "role", "organization", "overview", "model"}
	for _, m := range required {
		found := false
		for _, got := range ConsoleModules {
			if got == m {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("ConsoleModules missing expected module %q", m)
		}
	}
}

// ─── buildPermissionRows ──────────────────────────────────────────────────────

func TestBuildPermissionRowsAll(t *testing.T) {
	rows := buildPermissionRows("role-1", map[string]string{"*": "all"})
	if len(rows) != len(ConsoleModules) {
		t.Fatalf("rows = %d, want %d (one per ConsoleModules)", len(rows), len(ConsoleModules))
	}
	for _, r := range rows {
		if r.RoleID != "role-1" {
			t.Fatalf("RoleID = %q, want role-1", r.RoleID)
		}
		if !r.CanView || !r.CanCreate || !r.CanEdit || !r.CanDelete || !r.CanManage {
			t.Fatalf("module %q: all action should grant every flag", r.Module)
		}
	}
}

func TestBuildPermissionRowsViewOnly(t *testing.T) {
	rows := buildPermissionRows("role-1", map[string]string{"*": "view"})
	for _, r := range rows {
		if !r.CanView {
			t.Fatalf("module %q: CanView should be true", r.Module)
		}
		if r.CanCreate || r.CanEdit || r.CanDelete || r.CanManage {
			t.Fatalf("module %q: view-only should not grant other flags", r.Module)
		}
	}
}

func TestBuildPermissionRowsMixed(t *testing.T) {
	rows := buildPermissionRows("role-1", map[string]string{
		"*":      "view",
		"member": "manage",
		"role":   "all",
	})
	byModule := map[string]*entity.RolePermission{}
	for _, r := range rows {
		r := r
		byModule[r.Module] = r
	}

	// member → manage: view + manage
	if m := byModule["member"]; !m.CanView || !m.CanManage || m.CanCreate {
		t.Fatalf("member manage: view+manage only, got %+v", m)
	}
	// role → all
	if r := byModule["role"]; !r.CanView || !r.CanCreate || !r.CanEdit || !r.CanDelete || !r.CanManage {
		t.Fatalf("role all: every flag, got %+v", r)
	}
	// dataset（默认 view）
	if d := byModule["dataset"]; !d.CanView || d.CanCreate || d.CanManage {
		t.Fatalf("dataset default view, got %+v", d)
	}
}

func TestBuildPermissionRowsUnknownModuleIgnored(t *testing.T) {
	// grant 里的 key 不在 ConsoleModules 里时不会产生多余行
	rows := buildPermissionRows("role-1", map[string]string{
		"*":         "view",
		"not_a_mod": "all",
	})
	if len(rows) != len(ConsoleModules) {
		t.Fatalf("rows = %d, want exactly ConsoleModules count (unknown key should be ignored)", len(rows), len(ConsoleModules))
	}
}

func TestBuildPermissionRowsUnknownActionDefault(t *testing.T) {
	rows := buildPermissionRows("role-1", map[string]string{
		"dataset": "bogus",
	})
	byModule := map[string]*entity.RolePermission{}
	for _, r := range rows {
		r := r
		byModule[r.Module] = r
	}
	// action="" 时应该什么权限都没有（全 false）
	if d := byModule["dataset"]; d.CanView || d.CanCreate || d.CanEdit || d.CanDelete || d.CanManage {
		t.Fatalf("unknown action should result in all-false row, got %+v", d)
	}
}

// ─── builtinRoleNameForEnum ───────────────────────────────────────────────────

func TestBuiltinRoleNameForEnum(t *testing.T) {
	cases := []struct {
		enum    string
		want    string
		wantOK  bool
	}{
		{"owner", "租户管理员", true},
		{"admin", "部门管理员", true},
		{"normal", "普通成员", true},
		{"", "", false},
		{"guest", "", false},
		{"OWNER", "", false},
	}
	for _, c := range cases {
		got, ok := builtinRoleNameForEnum(c.enum)
		if ok != c.wantOK || got != c.want {
			t.Errorf("builtinRoleNameForEnum(%q) = (%q, %v), want (%q, %v)",
				c.enum, got, ok, c.want, c.wantOK)
		}
	}
}

// ─── EnsureBuiltinRoles ───────────────────────────────────────────────────────

func TestEnsureBuiltinRolesCreatesThreeRoles(t *testing.T) {
	db := setupRoleDB(t)
	dao := NewRoleDAO()
	ctx := context.Background()

	if err := dao.EnsureBuiltinRoles(ctx, db, "tenant-1"); err != nil {
		t.Fatalf("EnsureBuiltinRoles: %v", err)
	}

	var roles []entity.Role
	if err := db.Where("tenant_id = ?", "tenant-1").Find(&roles).Error; err != nil {
		t.Fatalf("list roles: %v", err)
	}
	if len(roles) != 3 {
		t.Fatalf("roles count = %d, want 3", len(roles))
	}
	for _, r := range roles {
		if !r.IsBuiltin {
			t.Fatalf("role %q should be builtin", r.Name)
		}
	}
}

func TestEnsureBuiltinRolesCreatesPermissionRowsForAllModules(t *testing.T) {
	db := setupRoleDB(t)
	dao := NewRoleDAO()
	ctx := context.Background()

	if err := dao.EnsureBuiltinRoles(ctx, db, "tenant-1"); err != nil {
		t.Fatalf("EnsureBuiltinRoles: %v", err)
	}

	var roles []entity.Role
	if err := db.Where("tenant_id = ? AND is_builtin = ?", "tenant-1", true).Find(&roles).Error; err != nil {
		t.Fatalf("list builtin roles: %v", err)
	}

	for _, role := range roles {
		var perms []entity.RolePermission
		if err := db.Where("role_id = ?", role.ID).Find(&perms).Error; err != nil {
			t.Fatalf("list perms for %s: %v", role.Name, err)
		}
		if len(perms) != len(ConsoleModules) {
			t.Fatalf("%s permission rows = %d, want %d", role.Name, len(perms), len(ConsoleModules))
		}
	}
}

func TestEnsureBuiltinRolesIdempotent(t *testing.T) {
	db := setupRoleDB(t)
	dao := NewRoleDAO()
	ctx := context.Background()

	if err := dao.EnsureBuiltinRoles(ctx, db, "tenant-1"); err != nil {
		t.Fatalf("first call: %v", err)
	}
	if err := dao.EnsureBuiltinRoles(ctx, db, "tenant-1"); err != nil {
		t.Fatalf("second call: %v", err)
	}

	var roles []entity.Role
	if err := db.Where("tenant_id = ? AND is_builtin = ?", "tenant-1", true).Find(&roles).Error; err != nil {
		t.Fatal(err)
	}
	if len(roles) != 3 {
		t.Fatalf("roles after double ensure = %d, still want 3", len(roles))
	}
}

func TestEnsureBuiltinRolesPerTenant(t *testing.T) {
	db := setupRoleDB(t)
	dao := NewRoleDAO()
	ctx := context.Background()

	if err := dao.EnsureBuiltinRoles(ctx, db, "tenant-1"); err != nil {
		t.Fatal(err)
	}
	if err := dao.EnsureBuiltinRoles(ctx, db, "tenant-2"); err != nil {
		t.Fatal(err)
	}

	var count int64
	db.Model(&entity.Role{}).Where("tenant_id IN ? AND is_builtin = ?", []string{"tenant-1", "tenant-2"}, true).Count(&count)
	if count != 6 {
		t.Fatalf("total builtin roles = %d, want 6 (3 per tenant)", count)
	}
}

// ─── backfillBuiltinRolePermissions ──────────────────────────────────────────

func TestEnsureBuiltinRolesBackfillsMissingModules(t *testing.T) {
	db := setupRoleDB(t)
	dao := NewRoleDAO()
	ctx := context.Background()

	// 先只建两个角色的权限行（模拟老租户 ConsoleModules 增长前的种子）
	if err := dao.EnsureBuiltinRoles(ctx, db, "tenant-1"); err != nil {
		t.Fatal(err)
	}

	var roles []entity.Role
	db.Where("tenant_id = ? AND is_builtin = ?", "tenant-1", true).Find(&roles)

	// 手动删一些模块的行，模拟 ConsoleModules 后来增长
	targetModules := []string{"qc_rule", "qc_realtime", "qc_hit", "qc_config", "mcp", "apikey"}
	for _, role := range roles {
		for _, m := range targetModules {
			db.Where("role_id = ? AND module = ?", role.ID, m).Delete(&entity.RolePermission{})
		}
	}

	// 重新 ensure → 应该补齐
	if err := dao.EnsureBuiltinRoles(ctx, db, "tenant-1"); err != nil {
		t.Fatalf("re-ensure: %v", err)
	}

	for _, role := range roles {
		var perms []entity.RolePermission
		db.Where("role_id = ?", role.ID).Find(&perms)
		if len(perms) != len(ConsoleModules) {
			t.Fatalf("role %s rows after backfill = %d, want %d", role.Name, len(perms), len(ConsoleModules))
		}
	}
}

func TestBackfillSkipsRenamedBuiltinRole(t *testing.T) {
	db := setupRoleDB(t)
	dao := NewRoleDAO()
	ctx := context.Background()

	if err := dao.EnsureBuiltinRoles(ctx, db, "tenant-1"); err != nil {
		t.Fatal(err)
	}

	var adminRole entity.Role
	db.Where("tenant_id = ? AND name = ?", "tenant-1", "部门管理员").Take(&adminRole)

	// 改个名
	db.Model(&adminRole).Update("name", "运维管理员")

	// 删掉这个角色所有权限行
	db.Where("role_id = ?", adminRole.ID).Delete(&entity.RolePermission{})

	// backfill 应该跳过它（名字不匹配 builtinRoleSpec）
	if err := dao.EnsureBuiltinRoles(ctx, db, "tenant-1"); err != nil {
		t.Fatal(err)
	}

	var count int64
	db.Model(&entity.RolePermission{}).Where("role_id = ?", adminRole.ID).Count(&count)
	if count != 0 {
		t.Fatalf("renamed builtin role should NOT be auto-backfilled, got %d rows", count)
	}
}

// ─── Create / Update / Delete ─────────────────────────────────────────────────

func TestRoleDAOCreate(t *testing.T) {
	db := setupRoleDB(t)
	dao := NewRoleDAO()
	ctx := context.Background()

	role := &entity.Role{
		ID:          common.GenerateUUID(),
		TenantID:    "tenant-1",
		Name:        "自定义角色",
		Description: "测试",
		IsBuiltin:   false,
	}
	grant := map[string]string{"dataset": "all", "*": "view"}
	if err := dao.Create(ctx, db, role, grant); err != nil {
		t.Fatalf("Create: %v", err)
	}

	var stored entity.Role
	if err := db.Where("id = ?", role.ID).Take(&stored).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Name != "自定义角色" {
		t.Fatalf("Name = %q, want 自定义角色", stored.Name)
	}

	var perms []entity.RolePermission
	db.Where("role_id = ?", role.ID).Find(&perms)
	if len(perms) != len(ConsoleModules) {
		t.Fatalf("permission rows = %d, want %d", len(perms), len(ConsoleModules))
	}
}

func TestRoleDAOUpdateRenamesRole(t *testing.T) {
	db := setupRoleDB(t)
	dao := NewRoleDAO()
	ctx := context.Background()

	role := &entity.Role{
		ID:       common.GenerateUUID(),
		TenantID: "tenant-1",
		Name:     "旧名",
	}
	db.Create(role)

	if err := dao.Update(ctx, db, "tenant-1", role.ID, map[string]any{"name": "新名", "description": "新描述"}); err != nil {
		t.Fatalf("Update: %v", err)
	}

	var stored entity.Role
	db.Where("id = ?", role.ID).Take(&stored)
	if stored.Name != "新名" || stored.Description != "新描述" {
		t.Fatalf("Update not applied: Name=%q, Desc=%q", stored.Name, stored.Description)
	}
}

func TestRoleDAOUpdateRejectsMissingRole(t *testing.T) {
	db := setupRoleDB(t)
	dao := NewRoleDAO()
	ctx := context.Background()

	err := dao.Update(ctx, db, "tenant-1", "nonexistent-id", map[string]any{"name": "x"})
	if err == nil {
		t.Fatal("Update should fail on missing role")
	}
}

func TestRoleDAODeleteRemovesRoleAndPermissions(t *testing.T) {
	db := setupRoleDB(t)
	dao := NewRoleDAO()
	ctx := context.Background()

	role := &entity.Role{
		ID:       common.GenerateUUID(),
		TenantID: "tenant-1",
		Name:     "待删除角色",
	}
	db.Create(role)
	rows := buildPermissionRows(role.ID, map[string]string{"*": "view"})
	db.Create(&rows)

	if err := dao.Delete(ctx, db, "tenant-1", role.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	var rc int64
	db.Model(&entity.Role{}).Where("id = ?", role.ID).Count(&rc)
	if rc != 0 {
		t.Fatal("role should be deleted")
	}
	var pc int64
	db.Model(&entity.RolePermission{}).Where("role_id = ?", role.ID).Count(&pc)
	if pc != 0 {
		t.Fatal("permission rows should be cascade-deleted")
	}
}

// ─── ListByTenant / Get ───────────────────────────────────────────────────────

func TestRoleDAOListByTenant(t *testing.T) {
	db := setupRoleDB(t)
	dao := NewRoleDAO()
	ctx := context.Background()

	if err := dao.EnsureBuiltinRoles(ctx, db, "tenant-1"); err != nil {
		t.Fatal(err)
	}

	// 再加一个自定义角色
	custom := &entity.Role{ID: common.GenerateUUID(), TenantID: "tenant-1", Name: "自定义"}
	db.Create(custom)

	roles, matrix, err := dao.ListByTenant(ctx, db, "tenant-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(roles) != 4 {
		t.Fatalf("roles = %d, want 4 (3 builtin + 1 custom)", len(roles))
	}
	// 排序：builtin DESC, name ASC → builtin 先
	if !roles[0].IsBuiltin {
		t.Fatal("first role should be builtin (sort: is_builtin DESC)")
	}
	if _, ok := matrix[custom.ID]; !ok {
		t.Fatal("custom role missing from matrix map")
	}
}

func TestRoleDAOListByTenantEmpty(t *testing.T) {
	db := setupRoleDB(t)
	dao := NewRoleDAO()

	roles, matrix, err := dao.ListByTenant(context.Background(), db, "no-such-tenant")
	if err != nil {
		t.Fatal(err)
	}
	if len(roles) != 0 {
		t.Fatalf("roles = %d, want 0", len(roles))
	}
	if len(matrix) != 0 {
		t.Fatalf("matrix = %d, want 0", len(matrix))
	}
}

func TestRoleDAOGet(t *testing.T) {
	db := setupRoleDB(t)
	dao := NewRoleDAO()
	ctx := context.Background()

	role := &entity.Role{ID: common.GenerateUUID(), TenantID: "tenant-1", Name: "get-test"}
	db.Create(role)

	got, err := dao.Get(ctx, db, "tenant-1", role.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Name != "get-test" {
		t.Fatalf("Name = %q, want get-test", got.Name)
	}
}

func TestRoleDAOGetWrongTenant(t *testing.T) {
	db := setupRoleDB(t)
	dao := NewRoleDAO()
	ctx := context.Background()

	role := &entity.Role{ID: common.GenerateUUID(), TenantID: "tenant-1", Name: "other-tenant"}
	db.Create(role)

	_, err := dao.Get(ctx, db, "tenant-2", role.ID)
	if err == nil {
		t.Fatal("Get across tenants should fail")
	}
}

// ─── ReplacePermissions ──────────────────────────────────────────────────────

func TestRoleDAOReplacePermissionsOverwrites(t *testing.T) {
	db := setupRoleDB(t)
	dao := NewRoleDAO()
	ctx := context.Background()

	if err := dao.EnsureBuiltinRoles(ctx, db, "tenant-1"); err != nil {
		t.Fatal(err)
	}

	var role entity.Role
	db.Where("tenant_id = ? AND name = ?", "tenant-1", "普通成员").Take(&role)

	// 先看看原来的 view 权限
	var before []entity.RolePermission
	db.Where("role_id = ?", role.ID).Find(&before)
	if len(before) == 0 {
		t.Fatal("expected permission rows before replace")
	}

	// 构造新矩阵：只留 dataset 和 chat 两个模块，全部 true
	newRows := []*entity.RolePermission{
		{Module: "dataset", CanView: true, CanCreate: true, CanEdit: true, CanDelete: true, CanManage: true},
		{Module: "chat", CanView: true},
	}
	if err := dao.ReplacePermissions(ctx, db, "tenant-1", role.ID, newRows); err != nil {
		t.Fatalf("ReplacePermissions: %v", err)
	}

	var after []entity.RolePermission
	db.Where("role_id = ?", role.ID).Find(&after)
	if len(after) != 2 {
		t.Fatalf("after replace = %d rows, want 2", len(after))
	}
	byMod := map[string]*entity.RolePermission{}
	for _, r := range after {
		r := r
		byMod[r.Module] = r
	}
	if !byMod["dataset"].CanCreate {
		t.Fatal("dataset.CanCreate should be true after replace")
	}
	if byMod["chat"].CanCreate {
		t.Fatal("chat.CanCreate should be false (only view)")
	}
}

func TestRoleDAOReplacePermissionsAllowsBuiltinRole(t *testing.T) {
	// commit fc47e5a8 之后 builtin 角色不再阻止 ReplacePermissions
	db := setupRoleDB(t)
	dao := NewRoleDAO()
	ctx := context.Background()

	if err := dao.EnsureBuiltinRoles(ctx, db, "tenant-1"); err != nil {
		t.Fatal(err)
	}

	var adminRole entity.Role
	db.Where("tenant_id = ? AND name = ? AND is_builtin = ?", "tenant-1", "租户管理员", true).Take(&adminRole)

	// 故意把 admin 的权限减为空矩阵 —— 验证 ReplacePermissions 不拦 builtin
	if err := dao.ReplacePermissions(ctx, db, "tenant-1", adminRole.ID, nil); err != nil {
		t.Fatalf("ReplacePermissions on builtin role should succeed, got %v", err)
	}
}

func TestRoleDAOReplacePermissionsRejectsMissingRole(t *testing.T) {
	db := setupRoleDB(t)
	dao := NewRoleDAO()

	err := dao.ReplacePermissions(context.Background(), db, "tenant-1", "no-such-role", []*entity.RolePermission{})
	if err == nil {
		t.Fatal("ReplacePermissions should fail on missing role")
	}
}

// ─── ModulePermission ────────────────────────────────────────────────────────

func TestModulePermissionOwnerExempt(t *testing.T) {
	db := setupRoleDB(t)
	dao := NewRoleDAO()
	ctx := context.Background()

	// owner 没有 role_id，也没有 role_permission 行 —— 仍然返回 nil（放行）
	db.Create(&entity.UserTenant{
		ID: "ut-1", UserID: "user-1", TenantID: "tenant-1",
		Role: "owner", RoleID: "", InvitedBy: "user-0",
	})

	row, err := dao.ModulePermission(ctx, db, "tenant-1", "user-1", "dataset")
	if err != nil {
		t.Fatal(err)
	}
	if row != nil {
		t.Fatal("owner should be exempt, row should be nil")
	}
}

func TestModulePermissionCustomRole(t *testing.T) {
	db := setupRoleDB(t)
	dao := NewRoleDAO()
	ctx := context.Background()

	if err := dao.EnsureBuiltinRoles(ctx, db, "tenant-1"); err != nil {
		t.Fatal(err)
	}

	var adminRole entity.Role
	db.Where("tenant_id = ? AND name = ?", "tenant-1", "普通成员").Take(&adminRole)

	db.Create(&entity.UserTenant{
		ID: "ut-1", UserID: "user-1", TenantID: "tenant-1",
		Role: "normal", RoleID: adminRole.ID, InvitedBy: "owner",
	})

	// 普通成员的 dataset 是 view-only
	row, err := dao.ModulePermission(ctx, db, "tenant-1", "user-1", "dataset")
	if err != nil {
		t.Fatal(err)
	}
	if row == nil {
		t.Fatal("expected row for dataset, got nil")
	}
	if !row.CanView {
		t.Fatal("普通成员 dataset.CanView should be true")
	}
	if row.CanCreate {
		t.Fatal("普通成员 dataset.CanCreate should be false")
	}
}

func TestModulePermissionEnumFallback(t *testing.T) {
	db := setupRoleDB(t)
	dao := NewRoleDAO()
	ctx := context.Background()

	if err := dao.EnsureBuiltinRoles(ctx, db, "tenant-1"); err != nil {
		t.Fatal(err)
	}

	// role_id 为空时回退到 enum → builtin role name
	db.Create(&entity.UserTenant{
		ID: "ut-1", UserID: "user-2", TenantID: "tenant-1",
		Role: "admin", RoleID: "", InvitedBy: "owner",
	})

	row, err := dao.ModulePermission(ctx, db, "tenant-1", "user-2", "member")
	if err != nil {
		t.Fatal(err)
	}
	if row == nil {
		t.Fatal("enum fallback should find the admin role")
	}
	// admin 的 member 是 manage
	if !row.CanManage {
		t.Fatal("部门管理员 member.CanManage should be true")
	}
}

func TestModulePermissionMembershipNotFound(t *testing.T) {
	db := setupRoleDB(t)
	dao := NewRoleDAO()

	row, err := dao.ModulePermission(context.Background(), db, "tenant-1", "ghost", "dataset")
	if err != nil {
		t.Fatal(err)
	}
	if row != nil {
		t.Fatal("membership 不存在应该返回 nil")
	}
}

func TestModulePermissionModuleRowMissing(t *testing.T) {
	db := setupRoleDB(t)
	dao := NewRoleDAO()
	ctx := context.Background()

	// 只建 role，不建权限行
	role := &entity.Role{ID: common.GenerateUUID(), TenantID: "tenant-1", Name: "孤儿角色"}
	db.Create(role)
	db.Create(&entity.UserTenant{
		ID: "ut-1", UserID: "user-1", TenantID: "tenant-1",
		Role: "normal", RoleID: role.ID, InvitedBy: "owner",
	})

	// 这个角色没 dataset 权限行 → 返回 nil（放行）
	row, err := dao.ModulePermission(ctx, db, "tenant-1", "user-1", "dataset")
	if err != nil {
		t.Fatal(err)
	}
	if row != nil {
		t.Fatal("missing module row should return nil (default-allow)")
	}
}

func TestModulePermissionBadRoleEnum(t *testing.T) {
	db := setupRoleDB(t)
	dao := NewRoleDAO()
	ctx := context.Background()

	// role_id 为空、enum 又不认识
	db.Create(&entity.UserTenant{
		ID: "ut-1", UserID: "user-1", TenantID: "tenant-1",
		Role: "ghost", RoleID: "", InvitedBy: "owner",
	})

	row, err := dao.ModulePermission(ctx, db, "tenant-1", "user-1", "dataset")
	if err != nil {
		t.Fatal(err)
	}
	if row != nil {
		t.Fatal("unknown enum should return nil")
	}
}
