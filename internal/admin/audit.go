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

// decorateAuditActors replaces id-shaped actors with readable names.
//
// audit_log has two writers that disagree on what the actor columns hold: the
// admin middleware stores the operator's e-mail plus a tenant_name snapshot,
// while the agent service (agent_version.go writeAudit) stores raw user ids and
// no snapshot at all. That second shape is what the console used to render as a
// row of hex — both 租户 and 操作人 were the same 32-char id.
//
// Resolving here rather than at write time also repairs the rows already in the
// table; changing the writers would only help entries created afterwards.
func decorateAuditActors(ctx context.Context, logs []*entity.AuditLog) {
	if len(logs) == 0 || dao.DB == nil {
		return
	}

	tenantIDs := make([]string, 0, len(logs))
	operatorIDs := make([]string, 0, len(logs))
	seenTenant := make(map[string]struct{}, len(logs))
	seenOperator := make(map[string]struct{}, len(logs))
	for _, l := range logs {
		if l.TenantID != "" && l.TenantName == "" {
			if _, ok := seenTenant[l.TenantID]; !ok {
				seenTenant[l.TenantID] = struct{}{}
				tenantIDs = append(tenantIDs, l.TenantID)
			}
		}
		if looksLikeHexID(l.Operator) {
			if _, ok := seenOperator[l.Operator]; !ok {
				seenOperator[l.Operator] = struct{}{}
				operatorIDs = append(operatorIDs, l.Operator)
			}
		}
	}
	if len(tenantIDs) == 0 && len(operatorIDs) == 0 {
		return
	}

	// 租户名优先用 tenant.name（用户在控制台看到的就是它），拿不到再回落到
	// owner 的昵称 / 邮箱——租户 id 本身就是 owner 的 user id。
	tenantNames := make(map[string]string, len(tenantIDs))
	if len(tenantIDs) > 0 {
		var rows []struct {
			ID   string
			Name string
		}
		if err := dao.DB.WithContext(ctx).
			Table("tenant").
			Select("id, IFNULL(name, '') AS name").
			Where("id IN ?", tenantIDs).
			Scan(&rows).Error; err == nil {
			for _, r := range rows {
				if r.Name != "" {
					tenantNames[r.ID] = r.Name
				}
			}
		}
	}

	userIDs := make([]string, 0, len(tenantIDs)+len(operatorIDs))
	userIDs = append(userIDs, tenantIDs...)
	userIDs = append(userIDs, operatorIDs...)
	userNames := make(map[string]string, len(userIDs))
	if len(userIDs) > 0 {
		var rows []struct {
			ID       string
			Nickname string
			Email    string
		}
		if err := dao.DB.WithContext(ctx).
			Table("user").
			Select("id, IFNULL(nickname, '') AS nickname, IFNULL(email, '') AS email").
			Where("id IN ?", userIDs).
			Scan(&rows).Error; err == nil {
			for _, r := range rows {
				if r.Nickname != "" {
					userNames[r.ID] = r.Nickname
					continue
				}
				if r.Email != "" {
					userNames[r.ID] = r.Email
				}
			}
		}
	}

	// 解析不出来（账号已删）就留空，让前端回落到原始 id——宁可显示一串 hex，
	// 也不要把历史记录改写成「未知用户」而丢掉追责线索。
	for _, l := range logs {
		if l.TenantName == "" && l.TenantID != "" {
			if name := tenantNames[l.TenantID]; name != "" {
				l.TenantName = name
			} else {
				l.TenantName = userNames[l.TenantID]
			}
		}
		if l.OperatorName == "" && looksLikeHexID(l.Operator) {
			l.OperatorName = userNames[l.Operator]
		}
	}
}

// matchActorIDs turns a keyword into the user / tenant ids it names.
//
// Part of audit_log stores raw ids in operator and tenant_id, so a plain LIKE on
// those columns can never match a person's name. Looking the keyword up in user
// and tenant first, then OR-ing the ids into the audit query, makes「搜索操作人」
// work for old rows as well as new ones.
//
// Best effort: a lookup failure just means the name search falls back to the
// columns that do hold names.
func matchActorIDs(ctx context.Context, keyword string) []string {
	kw := strings.TrimSpace(keyword)
	if kw == "" || dao.DB == nil {
		return nil
	}
	like := "%" + kw + "%"

	ids := make([]string, 0, 16)
	seen := make(map[string]struct{}, 16)
	collect := func(rows []struct{ ID string }) {
		for _, r := range rows {
			if r.ID == "" {
				continue
			}
			if _, ok := seen[r.ID]; ok {
				continue
			}
			seen[r.ID] = struct{}{}
			ids = append(ids, r.ID)
		}
	}

	// 上限 200：一个人名可能对应多个账号，但没有必要把 IN 列表撑到几千条。
	var users []struct{ ID string }
	if err := dao.DB.WithContext(ctx).
		Table("user").
		Select("id").
		Where("nickname LIKE ? OR email LIKE ?", like, like).
		Limit(200).
		Scan(&users).Error; err == nil {
		collect(users)
	}

	var tenants []struct{ ID string }
	if err := dao.DB.WithContext(ctx).
		Table("tenant").
		Select("id").
		Where("name LIKE ?", like).
		Limit(200).
		Scan(&tenants).Error; err == nil {
		collect(tenants)
	}

	return ids
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

	keywords := c.Query("keywords")
	logs, total, err := dao.NewAuditLogDAO().ListPlatform(
		c.Request.Context(), dao.DB,
		dao.AuditFilter{
			Keywords: keywords,
			Module:   c.Query("module"),
			Result:   c.Query("result"),
			ActorIDs: matchActorIDs(c.Request.Context(), keywords),
		},
		size, (page-1)*size,
	)
	if err != nil {
		common.ResponseWithCodeData(c, common.CodeServerError, nil, err.Error())
		return
	}

	decorateAuditActors(c.Request.Context(), logs)

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
