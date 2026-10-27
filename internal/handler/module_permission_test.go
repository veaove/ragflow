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
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"ragflow/internal/dao"
	"ragflow/internal/entity"
)

// setupHandlerRoleDB 为 handler 层中间件测试准备内存库 + 全局 dao.DB。
func setupHandlerRoleDB(t *testing.T) *gorm.DB {
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

	// 种子 builtin roles
	if err := dao.NewRoleDAO().EnsureBuiltinRoles(context.Background(), db, "tenant-1"); err != nil {
		t.Fatalf("EnsureBuiltinRoles: %v", err)
	}

	return db
}

// makeTestContext 构造一个带 user 的 gin.Context。
func makeTestContext(t *testing.T, method, targetPath, tenantHeader string) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	req := httptest.NewRequest(method, targetPath, nil)
	if tenantHeader != "" {
		req.Header.Set(TenantHeader, tenantHeader)
	}
	c.Request = req
	c.Set("user", &entity.User{ID: "user-1", Email: "test@qq.com"})
	return c, rec
}

// ─── actionFromMethod ────────────────────────────────────────────────────────

func TestActionFromMethod(t *testing.T) {
	cases := []struct {
		method string
		want   string
	}{
		{http.MethodGet, actionView},
		{http.MethodHead, actionView},
		{http.MethodPost, actionCreate},
		{http.MethodPut, actionEdit},
		{http.MethodPatch, actionEdit},
		{http.MethodDelete, actionDelete},
		{http.MethodOptions, ""},
		{"PURGE", ""},
		{"", ""},
	}
	for _, c := range cases {
		got := actionFromMethod(c.method)
		if got != c.want {
			t.Errorf("actionFromMethod(%q) = %q, want %q", c.method, got, c.want)
		}
	}
}

// ─── moduleLabelOr ───────────────────────────────────────────────────────────

func TestModuleLabelOr(t *testing.T) {
	cases := []struct {
		module string
		want   string
	}{
		{"member", "组织成员"},
		{"role", "角色管理"},
		{"dataset", "知识库"},
		{"qc_config", "质检系统配置"},
		{"mcp", "MCP"},
		{"nonexistent", "nonexistent"}, // 回退到模块名
	}
	for _, c := range cases {
		got := moduleLabelOr(c.module)
		if got != c.want {
			t.Errorf("moduleLabelOr(%q) = %q, want %q", c.module, got, c.want)
		}
	}
}

// ─── inferModuleAction ───────────────────────────────────────────────────────

func TestInferModuleActionExemptsSelfPermissions(t *testing.T) {
	module, action := inferModuleAction("/api/v1/console/me/permissions", http.MethodGet)
	if module != "" || action != "" {
		t.Fatalf("self-permissions endpoint should be exempt, got (%q, %q)", module, action)
	}
}

func TestInferModuleActionMembers(t *testing.T) {
	cases := []struct {
		path   string
		method string
		wantM  string
		wantA  string
	}{
		{"/api/v1/console/members", http.MethodGet, moduleMember, actionView},
		{"/api/v1/console/members", http.MethodPost, moduleMember, actionCreate},
		{"/api/v1/console/members/u-1", http.MethodPut, moduleMember, actionEdit},
		{"/api/v1/console/members/u-1", http.MethodDelete, moduleMember, actionDelete},
	}
	for _, c := range cases {
		m, a := inferModuleAction(c.path, c.method)
		if m != c.wantM || a != c.wantA {
			t.Errorf("infer(%q, %s) = (%q, %q), want (%q, %q)", c.path, c.method, m, a, c.wantM, c.wantA)
		}
	}
}

func TestInferModuleActionRoles(t *testing.T) {
	cases := []struct {
		path   string
		method string
		wantM  string
		wantA  string
	}{
		{"/api/v1/console/roles", http.MethodGet, moduleRole, actionView},
		{"/api/v1/console/roles/r-1/permissions", http.MethodPut, moduleRole, actionManage},
		{"/api/v1/console/roles/r-1", http.MethodPut, moduleRole, actionEdit},
	}
	for _, c := range cases {
		m, a := inferModuleAction(c.path, c.method)
		if m != c.wantM || a != c.wantA {
			t.Errorf("infer(%q, %s) = (%q, %q), want (%q, %q)", c.path, c.method, m, a, c.wantM, c.wantA)
		}
	}
}

func TestInferModuleActionDepartments(t *testing.T) {
	cases := []struct {
		path   string
		method string
		wantM  string
		wantA  string
	}{
		{"/api/v1/tenants/tenant-1/departments", http.MethodGet, "organization", actionView},
		{"/api/v1/tenants/tenant-1/departments", http.MethodPost, "organization", actionCreate},
	}
	for _, c := range cases {
		m, a := inferModuleAction(c.path, c.method)
		if m != c.wantM || a != c.wantA {
			t.Errorf("infer(%q, %s) = (%q, %q), want (%q, %q)", c.path, c.method, m, a, c.wantM, c.wantA)
		}
	}
}

func TestInferModuleActionGrants(t *testing.T) {
	// /grants/xxx PUT 属于 actionManage
	m, a := inferModuleAction("/api/v1/console/grants/grant-1", http.MethodPut)
	if m != "grant" || a != actionManage {
		t.Errorf("grants PUT = (%q, %q), want (grant, manage)", m, a)
	}
}

func TestInferModuleActionUnrelatedPath(t *testing.T) {
	m, a := inferModuleAction("/api/v1/datasets", http.MethodGet)
	if m != "" || a != "" {
		t.Errorf("unrelated path should return empty, got (%q, %q)", m, a)
	}
}

// ─── ModulePermission middleware ────────────────────────────────────────────

func TestModulePermissionOwnerAllowsEverything(t *testing.T) {
	setupHandlerRoleDB(t)

	// user-1 是 tenant-1 的 owner
	valid := string(entity.StatusValid)
	db := dao.DB
	db.Create(&entity.UserTenant{
		ID: "ut-1", UserID: "user-1", TenantID: "tenant-1",
		Role: "owner", Status: &valid, InvitedBy: "user-1",
	})

	c, rec := makeTestContext(t, http.MethodGet, "/api/v1/datasets", "tenant-1")

	mw := ModulePermission("dataset")
	mw(c)

	// owner 应放行 —— 不 abort
	if c.IsAborted() {
		t.Fatalf("owner should be allowed, got abort status %d", rec.Code)
	}
}

func TestModulePermissionBlocksNonOwnerWithoutView(t *testing.T) {
	setupHandlerRoleDB(t)

	// 把「普通成员」角色的 dataset 设成不可见
	var normalRole entity.Role
	dao.DB.Where("tenant_id = ? AND name = ?", "tenant-1", "普通成员").Take(&normalRole)
	dao.DB.Model(&entity.RolePermission{}).
		Where("role_id = ? AND module = ?", normalRole.ID, "dataset").
		Updates(map[string]any{
			"can_view":   false,
			"can_create": false,
			"can_edit":   false,
			"can_delete": false,
			"can_manage": false,
		})

	valid := string(entity.StatusValid)
	dao.DB.Create(&entity.UserTenant{
		ID: "ut-2", UserID: "user-2", TenantID: "tenant-1",
		Role: "normal", RoleID: normalRole.ID, Status: &valid, InvitedBy: "owner",
	})

	c, rec := makeTestContext(t, http.MethodGet, "/api/v1/datasets", "tenant-1")
	c.Set("user", &entity.User{ID: "user-2", Email: "member@qq.com"})

	mw := ModulePermission("dataset")
	mw(c)

	if !c.IsAborted() {
		t.Fatal("普通成员 dataset 无 view 权限 → 应该被拦截")
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
}

func TestModulePermissionDefaultAllowWhenModuleRowMissing(t *testing.T) {
	setupHandlerRoleDB(t)

	var normalRole entity.Role
	dao.DB.Where("tenant_id = ? AND name = ?", "tenant-1", "普通成员").Take(&normalRole)
	// 删掉 normal 角色 overview 行，模拟 ConsoleModules 增长但 builtin 种子没更新的边缘场景
	dao.DB.Where("role_id = ? AND module = ?", normalRole.ID, "overview").Delete(&entity.RolePermission{})

	valid := string(entity.StatusValid)
	dao.DB.Create(&entity.UserTenant{
		ID: "ut-3", UserID: "user-3", TenantID: "tenant-1",
		Role: "normal", RoleID: normalRole.ID, Status: &valid, InvitedBy: "owner",
	})

	c, _ := makeTestContext(t, http.MethodGet, "/api/v1/overview", "tenant-1")
	c.Set("user", &entity.User{ID: "user-3", Email: "m3@qq.com"})

	mw := ModulePermission("overview")
	mw(c)

	// 模块行缺失 → default-allow（不是 default-deny），避免老租户被锁死
	if c.IsAborted() {
		t.Fatal("missing module row 应该 default-allow")
	}
}

func TestModulePermissionOPTIONSAllowed(t *testing.T) {
	setupHandlerRoleDB(t)

	c, _ := makeTestContext(t, http.MethodOptions, "/api/v1/datasets", "tenant-1")
	mw := ModulePermission("dataset")
	mw(c)

	if c.IsAborted() {
		t.Fatal("OPTIONS 应该被跳过，不参与授权")
	}
}

func TestModulePermissionNoUser(t *testing.T) {
	setupHandlerRoleDB(t)

	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	// 不 Set("user", ...)

	mw := ModulePermission("dataset")
	mw(c)

	if !c.IsAborted() {
		t.Fatal("无 user 时应该被拦截")
	}
}

func TestCheckModuleActionDenialMessageUsesModuleLabel(t *testing.T) {
	setupHandlerRoleDB(t)

	// 把普通成员的 member 模块全部置 false
	var normalRole entity.Role
	dao.DB.Where("tenant_id = ? AND name = ?", "tenant-1", "普通成员").Take(&normalRole)
	dao.DB.Model(&entity.RolePermission{}).
		Where("role_id = ? AND module = ?", normalRole.ID, "member").
		Updates(map[string]any{
			"can_view":   false,
			"can_create": false,
			"can_edit":   false,
			"can_delete": false,
			"can_manage": false,
		})

	valid := string(entity.StatusValid)
	dao.DB.Create(&entity.UserTenant{
		ID: "ut-msg", UserID: "user-msg", TenantID: "tenant-1",
		Role: "normal", RoleID: normalRole.ID, Status: &valid, InvitedBy: "owner",
	})

	c, _ := makeTestContext(t, http.MethodGet, "/api/v1/console/members", "tenant-1")
	c.Set("user", &entity.User{ID: "user-msg", Email: "msg@qq.com"})

	err := checkModuleAction(c, "user-msg", "tenant-1", moduleMember, actionView)
	if err == nil {
		t.Fatal("expected permission denial")
	}
	if !strings.Contains(err.Error(), "组织成员") {
		t.Fatalf("error should contain module label 组织成员, got %q", err.Error())
	}
}

func TestCheckModuleActionUnknownActionAllowed(t *testing.T) {
	setupHandlerRoleDB(t)

	// non-owner + 有明确 role_id + dataset 权限行存在 → switch default 分支应放行
	var normalRole entity.Role
	dao.DB.Where("tenant_id = ? AND name = ?", "tenant-1", "普通成员").Take(&normalRole)

	valid := string(entity.StatusValid)
	dao.DB.Create(&entity.UserTenant{
		ID: "ut-unk", UserID: "user-unk", TenantID: "tenant-1",
		Role: "normal", RoleID: normalRole.ID, Status: &valid, InvitedBy: "owner",
	})

	c, _ := makeTestContext(t, http.MethodGet, "/", "tenant-1")
	c.Set("user", &entity.User{ID: "user-unk", Email: "unk@qq.com"})

	// action=bogus 不会匹配任何 switch case → default → return nil
	err := checkModuleAction(c, "user-unk", "tenant-1", "dataset", "bogus")
	if err != nil {
		t.Fatalf("unknown action on existing row should be allowed (switch default), got %v", err)
	}
}

func TestCheckModuleActionNilRowAllowed(t *testing.T) {
	setupHandlerRoleDB(t)
	// nil row (owner) → 放行
	c, _ := makeTestContext(t, http.MethodGet, "/", "tenant-1")
	c.Set("user", &entity.User{ID: "user-1", Email: "o@qq.com"})
	valid := string(entity.StatusValid)
	dao.DB.Create(&entity.UserTenant{
		ID: "ut-owner", UserID: "user-1", TenantID: "tenant-1",
		Role: "owner", Status: &valid, InvitedBy: "user-1",
	})

	err := checkModuleAction(c, "user-1", "tenant-1", "dataset", actionView)
	if err != nil {
		t.Fatalf("owner should be allowed, got %v", err)
	}
}
