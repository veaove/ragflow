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

package handler

import (
	"net/http"
	"testing"

	"gorm.io/gorm"

	"ragflow/internal/entity"
)

// setupConsoleAccessDB 在通用角色库之上补一张 tenant 表：requireTenantAccess
// 第一步就是查租户是否被平台停用，缺表会直接报错，测不到后面的闸门。
func setupConsoleAccessDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := setupHandlerRoleDB(t)

	if err := db.AutoMigrate(&entity.Tenant{}); err != nil {
		t.Fatalf("migrate tenant: %v", err)
	}
	enabled := true
	name := "测试租户"
	if err := db.Create(&entity.Tenant{ID: "tenant-1", Name: &name, Enabled: &enabled}).Error; err != nil {
		t.Fatalf("seed tenant: %v", err)
	}
	return db
}

func seedMembership(t *testing.T, db *gorm.DB, role, roleID string) {
	t.Helper()
	valid := "1"
	if err := db.Create(&entity.UserTenant{
		ID: "ut-" + role + roleID, UserID: "user-1", TenantID: "tenant-1",
		Role: role, RoleID: roleID, Status: &valid,
	}).Error; err != nil {
		t.Fatalf("seed membership: %v", err)
	}
}

func builtinTenantAdminRoleID(t *testing.T, db *gorm.DB) string {
	t.Helper()
	var role entity.Role
	if err := db.Where("tenant_id = ? AND is_builtin = ? AND name = ?",
		"tenant-1", true, "租户管理员").Take(&role).Error; err != nil {
		t.Fatalf("load builtin tenant admin role: %v", err)
	}
	return role.ID
}

// 控制台编辑成员只写 role_id、枚举留在 normal。被分配成内置「租户管理员」的人
// 必须能过写操作闸门 —— 否则移交 Owner 之后，原 owner 立刻什么都改不了。
func TestRequireTenantAccessAcceptsBuiltinTenantAdminRoleID(t *testing.T) {
	db := setupConsoleAccessDB(t)
	seedMembership(t, db, "normal", builtinTenantAdminRoleID(t, db))

	c, _ := makeTestContext(t, http.MethodPut, "/tenants/tenant-1/console/members/user-1", "tenant-1")
	if err := requireTenantAccess(c, "user-1", "tenant-1", true); err != nil {
		t.Fatalf("内置租户管理员应通过写闸门，got %v", err)
	}
}

// 普通成员（枚举 normal、没有角色）不能写。
func TestRequireTenantAccessRejectsPlainMember(t *testing.T) {
	db := setupConsoleAccessDB(t)
	seedMembership(t, db, "normal", "")

	c, _ := makeTestContext(t, http.MethodPut, "/tenants/tenant-1/console/members/user-1", "tenant-1")
	if err := requireTenantAccess(c, "user-1", "tenant-1", true); err == nil {
		t.Fatal("普通成员不应通过写闸门")
	}
}

// 自定义角色不是租户管理员：role_id 非空不代表放行，只认内置那一个。
func TestRequireTenantAccessRejectsCustomRoleID(t *testing.T) {
	db := setupConsoleAccessDB(t)
	if err := db.Create(&entity.Role{
		ID: "role-custom", TenantID: "tenant-1", Name: "普通用户", IsBuiltin: false,
	}).Error; err != nil {
		t.Fatalf("seed custom role: %v", err)
	}
	seedMembership(t, db, "normal", "role-custom")

	c, _ := makeTestContext(t, http.MethodPut, "/tenants/tenant-1/console/members/user-1", "tenant-1")
	if err := requireTenantAccess(c, "user-1", "tenant-1", true); err == nil {
		t.Fatal("自定义角色不应通过写闸门")
	}
}

// 读操作不受这条闸门影响：普通成员照样能看成员列表。
func TestRequireTenantAccessAllowsPlainMemberToRead(t *testing.T) {
	db := setupConsoleAccessDB(t)
	seedMembership(t, db, "normal", "")

	c, _ := makeTestContext(t, http.MethodGet, "/tenants/tenant-1/console/members", "tenant-1")
	if err := requireTenantAccess(c, "user-1", "tenant-1", false); err != nil {
		t.Fatalf("普通成员读成员列表应放行，got %v", err)
	}
}
