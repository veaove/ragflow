package handler

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"ragflow/internal/common"
	"ragflow/internal/dao"
	"ragflow/internal/entity"
	"ragflow/internal/service"
)

// ConsoleHandler serves the tenant console: org tree, members, roles.
type ConsoleHandler struct {
	consoleService *service.ConsoleService
}

func NewConsoleHandler() *ConsoleHandler {
	return &ConsoleHandler{consoleService: service.NewConsoleService()}
}

// requireTenantAccess resolves the caller's membership in the target tenant.
//
// This is the only guard between a logged-in user and another tenant's org
// chart, so it must run before every console query. write=true additionally
// demands owner/admin — a normal member may read the tree but not reshape it.
//
// On top of that it enforces the role matrix, deriving module from the request
// path and action from the HTTP method. Deriving instead of passing them at each
// call site means a new console endpoint cannot silently skip the check.
func requireTenantAccess(c *gin.Context, userID, tenantID string, write bool) error {
	// 先看租户本身是否被平台停用：停用后连 owner 也进不来，
	// 所以这条必须在成员关系判断之前，且不受 write 参数影响。
	var tenant entity.Tenant
	if err := dao.DB.WithContext(c.Request.Context()).
		Select("id", "enabled").
		Where("id = ?", tenantID).
		Take(&tenant).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errors.New("租户不存在")
		}
		return err
	}
	if tenant.Enabled != nil && !*tenant.Enabled {
		return errors.New("该租户已被平台停用，请联系平台管理员")
	}

	var membership entity.UserTenant
	err := dao.DB.WithContext(c.Request.Context()).
		Where("tenant_id = ?", tenantID).
		Where("user_id = ?", userID).
		Take(&membership).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errors.New("无权访问该租户")
		}
		return err
	}
	if membership.Status != nil && *membership.Status != "1" {
		return errors.New("成员状态已停用")
	}
	if write && membership.Role != string(permissionRoleOwner) && membership.Role != string(permissionRoleAdmin) {
		return errors.New("仅租户管理员可执行该操作")
	}

	module, action := inferModuleAction(c.Request.URL.Path, c.Request.Method)
	if module == "" || action == "" {
		return nil
	}
	return checkModuleAction(c, userID, tenantID, module, action)
}

// Module keys of the role matrix that the console itself exposes.
const (
	moduleMember = "member"
	moduleRole   = "role"

	actionView   = "view"
	actionCreate = "create"
	actionEdit   = "edit"
	actionDelete = "delete"
	actionManage = "manage"
)

// moduleLabels are only used to build readable error messages.
var moduleLabels = map[string]string{
	moduleMember: "组织成员",
	moduleRole:   "角色管理",
	// 下列模块的拦截是后续按路由组接入的（ModulePermission 中间件），
	// 补上中文名只影响报错文案的可读性。
	"overview":     "总览",
	"dataset":      "知识库",
	"chat":         "知识问答",
	"search":       "知识搜索",
	"agent":        "智能体",
	"studio":       "工作室",
	"memory":       "记忆",
	"qc_rule":      "质检规则",
	"qc_realtime":  "实时质检",
	"qc_hit":       "命中记录",
	"qc_config":    "质检系统配置",
	"file":         "文件管理",
	"organization": "组织架构",
	"grant":        "资源授权",
	"model":        "模型配置",
	"datasource":   "数据源",
	"channel":      "聊天渠道",
	"mcp":          "MCP",
	"team":         "团队管理",
}

// inferModuleAction maps a console request onto one matrix cell.
//
// Returning empty strings means "not governed by the matrix" and the check is
// skipped. `/console/me/permissions` is explicitly exempt: the endpoint that
// reports your own permissions must never be blocked by them.
func inferModuleAction(path, method string) (string, string) {
	if strings.HasSuffix(path, "/console/me/permissions") {
		return "", ""
	}

	var module string
	switch {
	case strings.Contains(path, "/departments"):
		// 组织架构独立于「用户管理」，分开授权
		module = "organization"
	case strings.Contains(path, "/console/members"):
		module = moduleMember
	case strings.Contains(path, "/roles"):
		module = moduleRole
	case strings.Contains(path, "/grants"):
		// 资源授权是独立模块，和「角色管理」分开授权
		module = "grant"
	default:
		return "", ""
	}

	// 保存权限矩阵、保存资源授权属于「管理」级，比普通编辑更敏感。
	if method == http.MethodPut &&
		(strings.HasSuffix(path, "/permissions") || strings.Contains(path, "/grants/")) {
		return module, actionManage
	}

	switch method {
	case http.MethodGet:
		return module, actionView
	case http.MethodPost:
		return module, actionCreate
	case http.MethodPut, http.MethodPatch:
		return module, actionEdit
	case http.MethodDelete:
		return module, actionDelete
	}
	return "", ""
}

// checkModuleAction enforces one cell of the role matrix.
//
// **Default-permit**: when nothing constrains the module (no role, no role_id,
// no row) the DAO returns nil and the call is allowed. That is deliberate — an
// incomplete matrix, or one seeded before this check existed, must never lock an
// operator out. Only an explicit `false` denies. The tenant owner is exempt at
// the DAO level.
func checkModuleAction(c *gin.Context, userID, tenantID, module, action string) error {
	row, err := dao.NewRoleDAO().ModulePermission(c.Request.Context(), dao.DB, tenantID, userID, module)
	if err != nil {
		return err
	}
	if row == nil {
		return nil
	}

	var allowed bool
	switch action {
	case actionView:
		allowed = row.CanView
	case actionCreate:
		allowed = row.CanCreate
	case actionEdit:
		allowed = row.CanEdit
	case actionDelete:
		allowed = row.CanDelete
	case actionManage:
		allowed = row.CanManage
	default:
		return nil
	}
	if !allowed {
		label := moduleLabels[module]
		if label == "" {
			label = module
		}
		return fmt.Errorf("当前角色没有「%s」模块的该操作权限", label)
	}
	return nil
}

// permissionRole* mirror the enum stored in user_tenant.role.
const (
	permissionRoleOwner  = "owner"
	permissionRoleAdmin  = "admin"
	permissionRoleNormal = "normal"
)

func consoleTenantID(c *gin.Context) string {
	return c.Param("tenant_id")
}

// ─── 组织架构 ────────────────────────────────────────────────────────────────

// DepartmentTree handles GET /tenants/:tenant_id/departments.
func (h *ConsoleHandler) DepartmentTree(c *gin.Context) {
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	tenantID := consoleTenantID(c)
	if err := requireTenantAccess(c, user.ID, tenantID, false); err != nil {
		common.ResponseWithHttpCodeData(c, http.StatusForbidden, common.CodeForbidden, nil, err.Error())
		return
	}

	tree, err := h.consoleService.DepartmentTree(c.Request.Context(), tenantID)
	if err != nil {
		common.ResponseWithCodeData(c, common.CodeServerError, nil, err.Error())
		return
	}
	common.SuccessWithData(c, gin.H{"departments": tree}, "success")
}

// CreateDepartment handles POST /tenants/:tenant_id/departments.
func (h *ConsoleHandler) CreateDepartment(c *gin.Context) {
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	tenantID := consoleTenantID(c)
	if err := requireTenantAccess(c, user.ID, tenantID, true); err != nil {
		common.ResponseWithHttpCodeData(c, http.StatusForbidden, common.CodeForbidden, nil, err.Error())
		return
	}

	var req struct {
		Name     string `json:"name" binding:"required"`
		ParentID string `json:"parent_id"`
		Sort     int    `json:"sort"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ResponseWithHttpCodeData(c, http.StatusBadRequest, common.CodeBadRequest, nil, err.Error())
		return
	}

	row, err := h.consoleService.CreateDepartment(c.Request.Context(), tenantID, req.Name, req.ParentID, req.Sort)
	if err != nil {
		common.ResponseWithCodeData(c, common.CodeDataError, nil, err.Error())
		return
	}
	common.SuccessWithData(c, row, "success")
}

// UpdateDepartment handles PUT /tenants/:tenant_id/departments/:id.
func (h *ConsoleHandler) UpdateDepartment(c *gin.Context) {
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	tenantID := consoleTenantID(c)
	if err := requireTenantAccess(c, user.ID, tenantID, true); err != nil {
		common.ResponseWithHttpCodeData(c, http.StatusForbidden, common.CodeForbidden, nil, err.Error())
		return
	}

	var req struct {
		Name     *string `json:"name"`
		ParentID *string `json:"parent_id"`
		Sort     *int    `json:"sort"`
		Status   *string `json:"status"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ResponseWithHttpCodeData(c, http.StatusBadRequest, common.CodeBadRequest, nil, err.Error())
		return
	}

	fields := map[string]any{}
	if req.Name != nil {
		fields["name"] = *req.Name
	}
	if req.ParentID != nil {
		fields["parent_id"] = *req.ParentID
	}
	if req.Sort != nil {
		fields["sort"] = *req.Sort
	}
	if req.Status != nil {
		fields["status"] = *req.Status
	}

	if err := h.consoleService.UpdateDepartment(c.Request.Context(), tenantID, c.Param("id"), fields); err != nil {
		common.ResponseWithCodeData(c, common.CodeDataError, nil, err.Error())
		return
	}
	common.SuccessWithData(c, gin.H{"id": c.Param("id")}, "success")
}

// DeleteDepartment handles DELETE /tenants/:tenant_id/departments/:id.
func (h *ConsoleHandler) DeleteDepartment(c *gin.Context) {
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	tenantID := consoleTenantID(c)
	if err := requireTenantAccess(c, user.ID, tenantID, true); err != nil {
		common.ResponseWithHttpCodeData(c, http.StatusForbidden, common.CodeForbidden, nil, err.Error())
		return
	}

	if err := h.consoleService.DeleteDepartment(c.Request.Context(), tenantID, c.Param("id")); err != nil {
		common.ResponseWithCodeData(c, common.CodeDataError, nil, err.Error())
		return
	}
	common.SuccessWithData(c, gin.H{"id": c.Param("id")}, "success")
}

// ─── 成员管理 ────────────────────────────────────────────────────────────────

// ListConsoleMembers handles GET /tenants/:tenant_id/console/members.
func (h *ConsoleHandler) ListConsoleMembers(c *gin.Context) {
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	tenantID := consoleTenantID(c)
	if err := requireTenantAccess(c, user.ID, tenantID, false); err != nil {
		common.ResponseWithHttpCodeData(c, http.StatusForbidden, common.CodeForbidden, nil, err.Error())
		return
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 200 {
		size = 20
	}

	members, total, err := h.consoleService.ListMembers(
		c.Request.Context(), tenantID,
		service.MemberFilter{
			Keywords:     c.Query("keywords"),
			DepartmentID: c.Query("department_id"),
			RoleID:       c.Query("role_id"),
			Status:       c.Query("status"),
		},
		size, (page-1)*size,
	)
	if err != nil {
		common.ResponseWithCodeData(c, common.CodeServerError, nil, err.Error())
		return
	}
	common.SuccessWithData(c, gin.H{"members": members, "total": total}, "success")
}

// UpdateConsoleMember handles PUT /tenants/:tenant_id/console/members/:user_id.
func (h *ConsoleHandler) UpdateConsoleMember(c *gin.Context) {
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	tenantID := consoleTenantID(c)
	if err := requireTenantAccess(c, user.ID, tenantID, true); err != nil {
		common.ResponseWithHttpCodeData(c, http.StatusForbidden, common.CodeForbidden, nil, err.Error())
		return
	}

	var req service.MemberUpdate
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ResponseWithHttpCodeData(c, http.StatusBadRequest, common.CodeBadRequest, nil, err.Error())
		return
	}

	if err := h.consoleService.UpdateMember(c.Request.Context(), tenantID, c.Param("user_id"), req); err != nil {
		common.ResponseWithCodeData(c, common.CodeDataError, nil, err.Error())
		return
	}
	auditConsoleChange(c, user, tenantID, "update", "member", c.Param("user_id"), nil,
		entity.JSONMap{"role_id": req.RoleID, "department_id": req.DepartmentID, "status": req.Status})
	common.SuccessWithData(c, gin.H{"user_id": c.Param("user_id")}, "success")
}

// ─── 角色权限 ────────────────────────────────────────────────────────────────

// ListConsoleRoles handles GET /tenants/:tenant_id/roles.
func (h *ConsoleHandler) ListConsoleRoles(c *gin.Context) {
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	tenantID := consoleTenantID(c)
	if err := requireTenantAccess(c, user.ID, tenantID, false); err != nil {
		common.ResponseWithHttpCodeData(c, http.StatusForbidden, common.CodeForbidden, nil, err.Error())
		return
	}

	roles, err := h.consoleService.ListRoles(c.Request.Context(), tenantID)
	if err != nil {
		common.ResponseWithCodeData(c, common.CodeServerError, nil, err.Error())
		return
	}
	common.SuccessWithData(c, gin.H{"roles": roles, "modules": dao.ConsoleModules}, "success")
}

// CreateConsoleRole handles POST /tenants/:tenant_id/roles.
func (h *ConsoleHandler) CreateConsoleRole(c *gin.Context) {
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	tenantID := consoleTenantID(c)
	if err := requireTenantAccess(c, user.ID, tenantID, true); err != nil {
		common.ResponseWithHttpCodeData(c, http.StatusForbidden, common.CodeForbidden, nil, err.Error())
		return
	}

	var req struct {
		Name        string            `json:"name" binding:"required"`
		Description string            `json:"description"`
		Grant       map[string]string `json:"grant"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ResponseWithHttpCodeData(c, http.StatusBadRequest, common.CodeBadRequest, nil, err.Error())
		return
	}

	role, err := h.consoleService.CreateRole(c.Request.Context(), tenantID, req.Name, req.Description, req.Grant)
	if err != nil {
		common.ResponseWithCodeData(c, common.CodeDataError, nil, err.Error())
		return
	}
	auditConsoleChange(c, user, tenantID, "create", "role", role.ID, nil,
		entity.JSONMap{"name": role.Name})
	common.SuccessWithData(c, role, "success")
}

// UpdateConsoleRole handles PUT /tenants/:tenant_id/roles/:id.
func (h *ConsoleHandler) UpdateConsoleRole(c *gin.Context) {
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	tenantID := consoleTenantID(c)
	if err := requireTenantAccess(c, user.ID, tenantID, true); err != nil {
		common.ResponseWithHttpCodeData(c, http.StatusForbidden, common.CodeForbidden, nil, err.Error())
		return
	}

	var req struct {
		Name        *string `json:"name"`
		Description *string `json:"description"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ResponseWithHttpCodeData(c, http.StatusBadRequest, common.CodeBadRequest, nil, err.Error())
		return
	}

	fields := map[string]any{}
	if req.Name != nil {
		fields["name"] = *req.Name
	}
	if req.Description != nil {
		fields["description"] = *req.Description
	}

	if err := h.consoleService.UpdateRole(c.Request.Context(), tenantID, c.Param("id"), fields); err != nil {
		common.ResponseWithCodeData(c, common.CodeDataError, nil, err.Error())
		return
	}
	auditConsoleChange(c, user, tenantID, "update", "role", c.Param("id"), nil, entity.JSONMap(fields))
	common.SuccessWithData(c, gin.H{"id": c.Param("id")}, "success")
}

// DeleteConsoleRole handles DELETE /tenants/:tenant_id/roles/:id.
func (h *ConsoleHandler) DeleteConsoleRole(c *gin.Context) {
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	tenantID := consoleTenantID(c)
	if err := requireTenantAccess(c, user.ID, tenantID, true); err != nil {
		common.ResponseWithHttpCodeData(c, http.StatusForbidden, common.CodeForbidden, nil, err.Error())
		return
	}

	if err := h.consoleService.DeleteRole(c.Request.Context(), tenantID, c.Param("id")); err != nil {
		common.ResponseWithCodeData(c, common.CodeDataError, nil, err.Error())
		return
	}
	auditConsoleChange(c, user, tenantID, "delete", "role", c.Param("id"), nil, nil)
	common.SuccessWithData(c, gin.H{"id": c.Param("id")}, "success")
}

// SaveConsolePermissions handles PUT /tenants/:tenant_id/roles/:id/permissions.
func (h *ConsoleHandler) SaveConsolePermissions(c *gin.Context) {
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	tenantID := consoleTenantID(c)
	if err := requireTenantAccess(c, user.ID, tenantID, true); err != nil {
		common.ResponseWithHttpCodeData(c, http.StatusForbidden, common.CodeForbidden, nil, err.Error())
		return
	}

	var req struct {
		Permissions []*entity.RolePermission `json:"permissions"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ResponseWithHttpCodeData(c, http.StatusBadRequest, common.CodeBadRequest, nil, err.Error())
		return
	}

	if err := h.consoleService.SavePermissions(c.Request.Context(), tenantID, c.Param("id"), req.Permissions); err != nil {
		common.ResponseWithCodeData(c, common.CodeDataError, nil, err.Error())
		return
	}
	auditConsoleChange(c, user, tenantID, "update", "role_permission", c.Param("id"), nil,
		entity.JSONMap{"rows": len(req.Permissions)})
	common.SuccessWithData(c, gin.H{"id": c.Param("id")}, "success")
}

// ─── 资源授权 ────────────────────────────────────────────────────────────────

// ListResourceGrants handles GET /tenants/:tenant_id/grants?kind=dataset.
//
// Returns the resource rows plus their current rules so the console can render
// "可见范围" without a second round trip per row.
func (h *ConsoleHandler) ListResourceGrants(c *gin.Context) {
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	tenantID := consoleTenantID(c)
	if err := requireTenantAccess(c, user.ID, tenantID, false); err != nil {
		common.ResponseWithHttpCodeData(c, http.StatusForbidden, common.CodeForbidden, nil, err.Error())
		return
	}

	kind := c.DefaultQuery("kind", "dataset")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 200 {
		size = 20
	}

	rows, total, err := service.NewResourceGrantService().ListResources(
		c.Request.Context(), tenantID, kind,
		c.Query("keywords"), size, (page-1)*size,
	)
	if err != nil {
		common.ResponseWithCodeData(c, common.CodeServerError, nil, err.Error())
		return
	}
	common.SuccessWithData(c, gin.H{"resources": rows, "total": total}, "success")
}

// SetResourceGrants handles PUT /tenants/:tenant_id/grants/:kind/:resource_id.
//
// The body carries the complete rule set: {subjects:[{kind,id}]}. Sending an
// empty list revokes every explicit rule, leaving the legacy permission column
// in charge again.
func (h *ConsoleHandler) SetResourceGrants(c *gin.Context) {
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	tenantID := consoleTenantID(c)
	if err := requireTenantAccess(c, user.ID, tenantID, true); err != nil {
		common.ResponseWithHttpCodeData(c, http.StatusForbidden, common.CodeForbidden, nil, err.Error())
		return
	}

	var req struct {
		Subjects []service.GrantSubject `json:"subjects"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ResponseWithHttpCodeData(c, http.StatusBadRequest, common.CodeBadRequest, nil, err.Error())
		return
	}

	if err := service.NewResourceGrantService().SetGrants(
		c.Request.Context(), tenantID, c.Param("kind"), c.Param("resource_id"), req.Subjects,
	); err != nil {
		common.ResponseWithCodeData(c, common.CodeDataError, nil, err.Error())
		return
	}
	auditConsoleChange(c, user, tenantID, "update", "resource_grant", c.Param("resource_id"), nil,
		entity.JSONMap{"kind": c.Param("kind"), "subjects": len(req.Subjects)})
	common.SuccessWithData(c, gin.H{"resource_id": c.Param("resource_id")}, "success")
}

// ResetConsoleMemberPassword handles PUT /tenants/:tenant_id/console/members/:user_id/password.
func (h *ConsoleHandler) ResetConsoleMemberPassword(c *gin.Context) {
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	tenantID := consoleTenantID(c)
	if err := requireTenantAccess(c, user.ID, tenantID, true); err != nil {
		common.ResponseWithHttpCodeData(c, http.StatusForbidden, common.CodeForbidden, nil, err.Error())
		return
	}

	var req struct {
		// Password is RSA-encrypted by the console (same key as the login form).
		Password string `json:"password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ResponseWithHttpCodeData(c, http.StatusBadRequest, common.CodeBadRequest, nil, err.Error())
		return
	}

	if err := service.NewConsoleService().ResetMemberPassword(
		c.Request.Context(), tenantID, c.Param("user_id"), req.Password,
	); err != nil {
		common.ResponseWithCodeData(c, common.CodeDataError, nil, err.Error())
		return
	}
	// 只记「谁重置了谁」，不落任何密码相关内容。
	auditConsoleChange(c, user, tenantID, "update", "member_password", c.Param("user_id"), nil, nil)
	common.SuccessWithData(c, gin.H{"user_id": c.Param("user_id")}, "success")
}

// MyConsolePermissions handles GET /tenants/:tenant_id/console/me/permissions.
//
// The console uses this to hide menu entries and guard routes. The backend still
// enforces its own checks — this endpoint only tells the UI what to render.
func (h *ConsoleHandler) MyConsolePermissions(c *gin.Context) {
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	tenantID := consoleTenantID(c)
	if err := requireTenantAccess(c, user.ID, tenantID, false); err != nil {
		common.ResponseWithHttpCodeData(c, http.StatusForbidden, common.CodeForbidden, nil, err.Error())
		return
	}

	perms, err := service.NewConsoleService().EffectivePermissions(
		c.Request.Context(), tenantID, user.ID,
	)
	if err != nil {
		common.ResponseWithCodeData(c, common.CodeDataError, nil, err.Error())
		return
	}
	common.SuccessWithData(c, perms, "success")
}

// auditConsoleChange records one permission-affecting console action.
//
// Operator stores a readable identity (nickname, else e-mail) rather than a raw
// id: this table has several writers that disagree on the column, and the console
// renders it directly without a join.
//
// Best-effort by design — the business operation has already committed, and
// failing the response because the audit row could not be written would lose the
// user's work. Failures are intentionally swallowed here and surface through the
// DB driver's own error log.
func auditConsoleChange(c *gin.Context, operator *entity.User, tenantID, action, objectType, objectID string, before, after entity.JSONMap) {
	if operator == nil {
		return
	}
	name := operator.Nickname
	if name == "" {
		name = operator.Email
	}
	entry := &entity.AuditLog{
		ID:         common.GenerateUUID(),
		TenantID:   tenantID,
		Action:     action,
		ObjectType: objectType,
		ObjectID:   objectID,
		Before:     before,
		After:      after,
		Operator:   name,
		Result:     "success",
		IPAddress:  c.ClientIP(),
		Method:     c.Request.Method,
		Path:       c.FullPath(),
		CreateTime: time.Now().UnixMilli(),
	}
	_ = dao.DB.WithContext(c.Request.Context()).Create(entry).Error
}

// TransferTenantOwner handles POST /tenants/:tenant_id/console/owner/transfer.
// Current owner transfers ownership to another member; caller becomes 租户管理员.
func (h *ConsoleHandler) TransferTenantOwner(c *gin.Context) {
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	tenantID := consoleTenantID(c)
	if err := requireTenantAccess(c, user.ID, tenantID, true); err != nil {
		common.ResponseWithHttpCodeData(c, http.StatusForbidden, common.CodeForbidden, nil, err.Error())
		return
	}

	var req struct {
		TargetUserID string json:"target_user_id" binding:"required"
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorWithCode(c, common.CodeBadRequest, err.Error())
		return
	}

	result, err := service.NewConsoleService().TransferTenantOwner(
		c.Request.Context(), tenantID, user.ID, req.TargetUserID,
	)
	if err != nil {
		common.ErrorWithCode(c, common.CodeDataError, err.Error())
		return
	}
	auditConsoleChange(c, user, tenantID, "transfer", "owner", req.TargetUserID, nil, nil)
	common.SuccessWithData(c, result, "success")
}
