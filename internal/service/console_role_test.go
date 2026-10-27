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

package service

import (
	"context"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"ragflow/internal/dao"
	"ragflow/internal/entity"
)

// setupConsoleRoleDB 为 ConsoleService 的 Role/EffectivePermissions 测试建库。
func setupConsoleRoleDB(t *testing.T) *gorm.DB {
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

	orig := dao.DB
	dao.DB = db
	t.Cleanup(func() { dao.DB = orig })

	return db
}

// ─── ListRoles ───────────────────────────────────────────────────────────────

func TestListRolesSeedsBuiltin(t *testing.T) {
	setupConsoleRoleDB(t)
	svc := NewConsoleService()

	roles, err := svc.ListRoles(context.Background(), "tenant-1")
	if err != nil {
		t.Fatalf("ListRoles: %v", err)
	}
	if len(roles) != 3 {
		t.Fatalf("roles = %d, want 3 builtin", len(roles))
	}
	for _, r := range roles {
		if !r.IsBuiltin {
			t.Fatalf("role %q should be builtin", r.Name)
		}
		if len(r.Permissions) == 0 {
			t.Fatalf("role %q should have permission matrix", r.Name)
		}
	}
}

func TestListRolesIncludesCustomRole(t *testing.T) {
	db := setupConsoleRoleDB(t)
	svc := NewConsoleService()

	custom := &entity.Role{
		ID:       "role-custom",
		TenantID: "tenant-1",
		Name:     "自定义角色",
	}
	db.Create(custom)

	roles, err := svc.ListRoles(context.Background(), "tenant-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(roles) != 4 {
		t.Fatalf("roles = %d, want 3 builtin + 1 custom", len(roles))
	}
}

func TestListRolesIncludesMemberCount(t *testing.T) {
	db := setupConsoleRoleDB(t)
	svc := NewConsoleService()

	// 先 ensure builtin
	svc.ListRoles(context.Background(), "tenant-1")

	var normalRole entity.Role
	db.Where("tenant_id = ? AND name = ?", "tenant-1", "普通成员").Take(&normalRole)

	valid := string(entity.StatusValid)
	for i := 0; i < 3; i++ {
		db.Create(&entity.UserTenant{
			ID: "ut-mc-" + string(rune('0'+i)), UserID: "u-mc-" + string(rune('0'+i)),
			TenantID: "tenant-1", Role: "normal", RoleID: normalRole.ID,
			Status: &valid, InvitedBy: "owner",
		})
	}

	roles, err := svc.ListRoles(context.Background(), "tenant-1")
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range roles {
		if r.Name == "普通成员" && r.MemberCount != 3 {
			t.Fatalf("普通成员 MemberCount = %d, want 3", r.MemberCount)
		}
	}
}

// ─── CreateRole ──────────────────────────────────────────────────────────────

func TestCreateRoleSuccess(t *testing.T) {
	setupConsoleRoleDB(t)
	svc := NewConsoleService()

	role, err := svc.CreateRole(context.Background(), "tenant-1", "我的角色", "描述",
		map[string]string{"dataset": "all", "*": "view"})
	if err != nil {
		t.Fatalf("CreateRole: %v", err)
	}
	if role.ID == "" {
		t.Fatal("expected role ID")
	}
	if role.IsBuiltin {
		t.Fatal("custom role should not be builtin")
	}
}

func TestCreateRoleTrimsName(t *testing.T) {
	setupConsoleRoleDB(t)
	svc := NewConsoleService()

	role, err := svc.CreateRole(context.Background(), "tenant-1", "  带空格  ", "",
		map[string]string{"*": "view"})
	if err != nil {
		t.Fatal(err)
	}
	if role.Name != "带空格" {
		t.Fatalf("Name = %q, want trimmed", role.Name)
	}
}

func TestCreateRoleRejectsEmptyName(t *testing.T) {
	setupConsoleRoleDB(t)
	svc := NewConsoleService()

	_, err := svc.CreateRole(context.Background(), "tenant-1", "  ", "", nil)
	if err == nil {
		t.Fatal("expected empty name error")
	}
}

func TestCreateRoleRejectsDuplicateName(t *testing.T) {
	setupConsoleRoleDB(t)
	svc := NewConsoleService()

	if _, err := svc.CreateRole(context.Background(), "tenant-1", "重名角色", "", nil); err != nil {
		t.Fatal(err)
	}
	_, err := svc.CreateRole(context.Background(), "tenant-1", "重名角色", "", nil)
	if err == nil {
		t.Fatal("expected duplicate name error")
	}
}

func TestCreateRoleAllowsDuplicateNameInDifferentTenant(t *testing.T) {
	setupConsoleRoleDB(t)
	svc := NewConsoleService()

	if _, err := svc.CreateRole(context.Background(), "tenant-1", "同名", "", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CreateRole(context.Background(), "tenant-2", "同名", "", nil); err != nil {
		t.Fatal(err)
	}
}

// ─── UpdateRole ──────────────────────────────────────────────────────────────

func TestUpdateRoleSuccess(t *testing.T) {
	db := setupConsoleRoleDB(t)
	svc := NewConsoleService()

	role := &entity.Role{ID: "r-1", TenantID: "tenant-1", Name: "旧名"}
	db.Create(role)

	err := svc.UpdateRole(context.Background(), "tenant-1", "r-1",
		map[string]any{"name": "  新名  ", "description": "新描述"})
	if err != nil {
		t.Fatal(err)
	}

	var stored entity.Role
	db.Where("id = ?", "r-1").Take(&stored)
	if stored.Name != "新名" {
		t.Fatalf("Name = %q, want 新名 (trimmed)", stored.Name)
	}
}

func TestUpdateRoleRejectsEmptyName(t *testing.T) {
	db := setupConsoleRoleDB(t)
	svc := NewConsoleService()

	role := &entity.Role{ID: "r-2", TenantID: "tenant-1", Name: "原名"}
	db.Create(role)

	err := svc.UpdateRole(context.Background(), "tenant-1", "r-2", map[string]any{"name": "   "})
	if err == nil {
		t.Fatal("expected empty name error")
	}
}

// ─── DeleteRole ──────────────────────────────────────────────────────────────

func TestDeleteRoleClearsMemberRoleID(t *testing.T) {
	db := setupConsoleRoleDB(t)
	svc := NewConsoleService()

	role := &entity.Role{ID: "r-del", TenantID: "tenant-1", Name: "待删"}
	db.Create(role)

	valid := string(entity.StatusValid)
	db.Create(&entity.UserTenant{
		ID: "ut-del", UserID: "u-del", TenantID: "tenant-1",
		Role: "normal", RoleID: "r-del", Status: &valid, InvitedBy: "owner",
	})

	if err := svc.DeleteRole(context.Background(), "tenant-1", "r-del"); err != nil {
		t.Fatalf("DeleteRole: %v", err)
	}

	var rc int64
	db.Model(&entity.Role{}).Where("id = ?", "r-del").Count(&rc)
	if rc != 0 {
		t.Fatal("role should be deleted")
	}

	var ut entity.UserTenant
	db.Where("id = ?", "ut-del").Take(&ut)
	if ut.RoleID != "" {
		t.Fatalf("member role_id should be cleared, got %q", ut.RoleID)
	}
}

// ─── SavePermissions ──────────────────────────────────────────────────────────

func TestSavePermissionsDropsUnknownModules(t *testing.T) {
	db := setupConsoleRoleDB(t)
	svc := NewConsoleService()

	role := &entity.Role{ID: "r-sp", TenantID: "tenant-1", Name: "权限测试"}
	db.Create(role)

	// 先给一个初始矩阵
	initial := []*entity.RolePermission{
		{RoleID: role.ID, Module: "dataset", CanView: true},
		{RoleID: role.ID, Module: "chat", CanView: true},
	}
	db.Create(&initial)

	// 构造 SavePermissions 输入 —— 包含合法和非法 module
	in := []*entity.RolePermission{
		{Module: "dataset", CanView: true, CanCreate: true},
		{Module: "chat", CanView: true},
		{Module: "not_a_module_xyz", CanView: true}, // 应被丢弃
	}
	if err := svc.SavePermissions(context.Background(), "tenant-1", role.ID, in); err != nil {
		t.Fatalf("SavePermissions: %v", err)
	}

	var stored []entity.RolePermission
	db.Where("role_id = ?", role.ID).Find(&stored)
	byMod := map[string]bool{}
	for _, p := range stored {
		byMod[p.Module] = true
	}
	if byMod["not_a_module_xyz"] {
		t.Fatal("unknown module should have been dropped")
	}
	if !byMod["dataset"] || !byMod["chat"] {
		t.Fatal("legitimate modules should be preserved")
	}
}

func TestSavePermissionsClearsMatrix(t *testing.T) {
	db := setupConsoleRoleDB(t)
	svc := NewConsoleService()

	role := &entity.Role{ID: "r-sp2", TenantID: "tenant-1", Name: "清空测试"}
	db.Create(role)
	db.Create(&[]*entity.RolePermission{
		{RoleID: role.ID, Module: "dataset", CanView: true},
	})

	// 空输入 → 清空全部
	if err := svc.SavePermissions(context.Background(), "tenant-1", role.ID, nil); err != nil {
		t.Fatal(err)
	}

	var count int64
	db.Model(&entity.RolePermission{}).Where("role_id = ?", role.ID).Count(&count)
	if count != 0 {
		t.Fatalf("empty SavePermissions should clear matrix, got %d rows", count)
	}
}

// ─── EffectivePermissions ────────────────────────────────────────────────────

func TestEffectivePermissionsOwnerAllModules(t *testing.T) {
	db := setupConsoleRoleDB(t)
	svc := NewConsoleService()

	valid := string(entity.StatusValid)
	db.Create(&entity.UserTenant{
		ID: "ut-owner", UserID: "u-owner", TenantID: "tenant-1",
		Role: "owner", Status: &valid, InvitedBy: "u-owner",
	})

	mp, err := svc.EffectivePermissions(context.Background(), "tenant-1", "u-owner")
	if err != nil {
		t.Fatalf("EffectivePermissions: %v", err)
	}
	if mp.RoleEnum != "owner" {
		t.Fatalf("RoleEnum = %q, want owner", mp.RoleEnum)
	}
	if len(mp.Modules) != len(dao.ConsoleModules) {
		t.Fatalf("modules = %d, want %d", len(mp.Modules), len(dao.ConsoleModules))
	}
	for mod, row := range mp.Modules {
		if !row.CanView || !row.CanCreate || !row.CanEdit || !row.CanDelete || !row.CanManage {
			t.Fatalf("owner module %q should have every permission true, got %+v", mod, row)
		}
	}
}

func TestEffectivePermissionsOwnerWithRoleID(t *testing.T) {
	db := setupConsoleRoleDB(t)
	svc := NewConsoleService()

	// 先 seed builtin
	svc.ListRoles(context.Background(), "tenant-1")

	var adminRole entity.Role
	db.Where("tenant_id = ? AND name = ?", "tenant-1", "租户管理员").Take(&adminRole)

	valid := string(entity.StatusValid)
	db.Create(&entity.UserTenant{
		ID: "ut-o2", UserID: "u-o2", TenantID: "tenant-1",
		Role: "owner", RoleID: adminRole.ID,
		Status: &valid, InvitedBy: "u-o2",
	})

	mp, err := svc.EffectivePermissions(context.Background(), "tenant-1", "u-o2")
	if err != nil {
		t.Fatal(err)
	}
	if mp.RoleID != adminRole.ID {
		t.Fatalf("RoleID = %q, want %q", mp.RoleID, adminRole.ID)
	}
	if mp.RoleName != "租户管理员" {
		t.Fatalf("RoleName = %q, want 租户管理员", mp.RoleName)
	}
}

func TestEffectivePermissionsExplicitRoleID(t *testing.T) {
	db := setupConsoleRoleDB(t)
	svc := NewConsoleService()

	// 自定义角色：dataset 全权限 + chat view
	role := &entity.Role{
		ID:       "r-custom",
		TenantID: "tenant-1",
		Name:     "数据专员",
	}
	db.Create(role)
	db.Create(&[]*entity.RolePermission{
		{RoleID: role.ID, Module: "dataset", CanView: true, CanCreate: true, CanEdit: true, CanDelete: true, CanManage: true},
		{RoleID: role.ID, Module: "chat", CanView: true},
	})

	valid := string(entity.StatusValid)
	db.Create(&entity.UserTenant{
		ID: "ut-explicit", UserID: "u-explicit", TenantID: "tenant-1",
		Role: "normal", RoleID: role.ID, Status: &valid, InvitedBy: "owner",
	})

	mp, err := svc.EffectivePermissions(context.Background(), "tenant-1", "u-explicit")
	if err != nil {
		t.Fatal(err)
	}
	if mp.RoleID != "r-custom" {
		t.Fatalf("RoleID = %q, want r-custom", mp.RoleID)
	}
	if mp.RoleName != "数据专员" {
		t.Fatalf("RoleName = %q, want 数据专员", mp.RoleName)
	}

	if ds, ok := mp.Modules["dataset"]; !ok || !ds.CanManage {
		t.Fatalf("dataset should be full-access, got %+v", ds)
	}
	if ch, ok := mp.Modules["chat"]; !ok || !ch.CanView || ch.CanCreate {
		t.Fatalf("chat should be view-only, got %+v", ch)
	}
}

func TestEffectivePermissionsEnumFallbackSeedsBuiltin(t *testing.T) {
	setupConsoleRoleDB(t)
	svc := NewConsoleService()

	// 不手动 seed — EffectivePermissions 应该自己 EnsureBuiltinRoles
	valid := string(entity.StatusValid)
	dao.DB.Create(&entity.UserTenant{
		ID: "ut-enum", UserID: "u-enum", TenantID: "tenant-1",
		Role: "admin", RoleID: "", Status: &valid, InvitedBy: "owner",
	})

	mp, err := svc.EffectivePermissions(context.Background(), "tenant-1", "u-enum")
	if err != nil {
		t.Fatal(err)
	}
	if mp.RoleName != "部门管理员" {
		t.Fatalf("RoleName = %q, want 部门管理员", mp.RoleName)
	}
	if mp.RoleID == "" {
		t.Fatal("RoleID should be resolved from enum fallback")
	}

	// 部门管理员的 member 应该有 manage
	if m, ok := mp.Modules["member"]; !ok || !m.CanManage {
		t.Fatalf("部门管理员 member.CanManage should be true, got %+v", m)
	}
}

func TestEffectivePermissionsUnknownEnumEmptyMatrix(t *testing.T) {
	db := setupConsoleRoleDB(t)
	svc := NewConsoleService()

	valid := string(entity.StatusValid)
	db.Create(&entity.UserTenant{
		ID: "ut-ghost", UserID: "u-ghost", TenantID: "tenant-1",
		Role: "ghost", RoleID: "", Status: &valid, InvitedBy: "owner",
	})

	mp, err := svc.EffectivePermissions(context.Background(), "tenant-1", "u-ghost")
	if err != nil {
		t.Fatal(err)
	}
	if len(mp.Modules) != 0 {
		t.Fatalf("unknown enum should give empty matrix, got %d modules", len(mp.Modules))
	}
}

func TestEffectivePermissionsMembershipNotFound(t *testing.T) {
	setupConsoleRoleDB(t)
	svc := NewConsoleService()

	_, err := svc.EffectivePermissions(context.Background(), "tenant-1", "no-such-user")
	if err == nil {
		t.Fatal("expected membership not found error")
	}
}

func TestEffectivePermissionsBrokenRoleID(t *testing.T) {
	db := setupConsoleRoleDB(t)
	svc := NewConsoleService()

	// role_id 指向一个不存在的角色 → 回退到 enum
	valid := string(entity.StatusValid)
	db.Create(&entity.UserTenant{
		ID: "ut-broken", UserID: "u-broken", TenantID: "tenant-1",
		Role: "normal", RoleID: "no-such-role", Status: &valid, InvitedBy: "owner",
	})

	mp, err := svc.EffectivePermissions(context.Background(), "tenant-1", "u-broken")
	if err != nil {
		t.Fatal(err)
	}
	// 回退到 "普通成员" builtin
	if mp.RoleName != "普通成员" {
		t.Fatalf("should fall back to 普通成员, got %q", mp.RoleName)
	}
}

// ─── 边界：effective 权限不影响别的租户 ──────────────────────────────────────

func TestEffectivePermissionsIsolatedPerTenant(t *testing.T) {
	db := setupConsoleRoleDB(t)
	svc := NewConsoleService()

	// tenant-1 有 u1 成员，tenant-2 没有任何成员关系
	valid := string(entity.StatusValid)
	db.Create(&entity.UserTenant{
		ID: "ut-t1", UserID: "u1", TenantID: "tenant-1",
		Role: "owner", Status: &valid, InvitedBy: "u1",
	})

	_, err := svc.EffectivePermissions(context.Background(), "tenant-2", "u1")
	if err == nil {
		t.Fatal("u1 不属于 tenant-2 → 应该报不是该租户成员")
	}
}
