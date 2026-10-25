package handler

import (
	"errors"
	"net/http"
	"strconv"

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
func requireTenantAccess(c *gin.Context, userID, tenantID string, write bool) error {
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
	common.SuccessWithData(c, gin.H{"resource_id": c.Param("resource_id")}, "success")
}
