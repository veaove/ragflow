package admin

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"ragflow/internal/common"
	"ragflow/internal/dao"
	"ragflow/internal/entity"
)

// adminPathPrefix is the mount point of the admin API.
const adminPathPrefix = "/api/v1/admin/"

// auditModuleOf maps the first path segment of an admin route to a module key.
// Unknown segments are passed through, so a new endpoint still records something
// meaningful before anyone adds a display label for it.
func auditModuleOf(fullPath string) string {
	rest := strings.TrimPrefix(fullPath, adminPathPrefix)
	if rest == fullPath || rest == "" {
		return "platform"
	}
	seg := strings.SplitN(rest, "/", 2)[0]
	switch seg {
	case "tenants":
		return "tenant"
	case "users":
		return "user"
	case "providers", "all-models":
		return "model"
	default:
		return seg
	}
}

// auditActionOf turns the HTTP verb into a business-agnostic action key.
// The console pairs (module, action) with Path to render a human label.
func auditActionOf(method string) string {
	switch method {
	case http.MethodPost:
		return "create"
	case http.MethodPut, http.MethodPatch:
		return "update"
	case http.MethodDelete:
		return "delete"
	default:
		return strings.ToLower(method)
	}
}

// lookupTenantName resolves a tenant id to its display name. Tenants are users
// in this schema (one tenant per owning user), so the name lives in user.nickname.
func lookupTenantName(ctx context.Context, tenantID string) string {
	if tenantID == "" || dao.DB == nil {
		return ""
	}
	var row struct {
		Nickname string `gorm:"column:nickname"`
		Email    string `gorm:"column:email"`
	}
	err := dao.DB.WithContext(ctx).
		Table("user").
		Select("nickname, email").
		Where("id = ?", tenantID).
		Take(&row).Error
	if err != nil {
		return ""
	}
	if row.Nickname != "" {
		return row.Nickname
	}
	return row.Email
}

// ListPlatformAudits handles GET /api/v1/admin/audits.
//
// Platform-wide by design: no tenant scope, so the console gets one stream of
// every tenant's mutations. Mounted behind AuthMiddleware, so only superusers
// reach it.
func (h *Handler) ListPlatformAudits(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 200 {
		size = 20
	}

	logs, total, err := dao.NewAuditLogDAO().ListPlatform(
		c.Request.Context(), dao.DB,
		dao.AuditFilter{
			Keywords: c.Query("keywords"),
			Module:   c.Query("module"),
			Result:   c.Query("result"),
		},
		size, (page-1)*size,
	)
	if err != nil {
		common.ResponseWithCodeData(c, common.CodeServerError, nil, err.Error())
		return
	}

	common.SuccessWithData(c, gin.H{"logs": logs, "total": total}, "success")
}

// AuditMiddleware records every state-changing admin request.
//
// It stores the technical fact (verb + route template + status + client IP)
// rather than a business phrase: one middleware has to cover every existing and
// future endpoint, and hand-written labels per handler would rot immediately.
// The console maps (module, action, path) back to a readable sentence.
//
// The write happens in a goroutine so a slow or failing audit insert can never
// delay or fail the actual request; the request values are copied out before
// jumping threads because gin recycles the context.
func (h *Handler) AuditMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		switch c.Request.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			c.Next()
			return
		}

		fullPath := c.FullPath()
		method := c.Request.Method
		clientIP := c.ClientIP()

		c.Next()

		status := c.Writer.Status()
		result := "success"
		if status >= http.StatusBadRequest {
			result = "failed"
		}

		// Tenant-scoped routes carry the tenant in :id; anything else leaves it
		// empty (the column is NOT NULL, so an empty string keeps MySQL happy).
		tenantID := c.Param("id")
		operator := c.GetString("email")

		entry := &entity.AuditLog{
			ID:         common.GenerateUUID(),
			TenantID:   tenantID,
			Action:     auditActionOf(method),
			ObjectType: auditModuleOf(fullPath),
			ObjectID:   tenantID,
			Operator:   operator,
			Result:     result,
			IPAddress:  clientIP,
			Method:     method,
			Path:       fullPath,
			CreateTime: time.Now().UnixMilli(),
		}

		go func() {
			if dao.DB == nil {
				return
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()

			entry.TenantName = lookupTenantName(ctx, tenantID)
			if err := dao.NewAuditLogDAO().Create(ctx, dao.DB, entry); err != nil {
				common.Warn("admin audit write failed",
					zap.String("path", entry.Path),
					zap.Error(err))
			}
		}()
	}
}
