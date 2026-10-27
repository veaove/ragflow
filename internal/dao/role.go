package dao

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"

	"ragflow/internal/common"
	"ragflow/internal/entity"
)

// ConsoleModules is the fixed module list of the permission matrix. It matches
// the console's rows one-to-one; unknown modules arriving from the client are
// dropped rather than persisted, so the matrix can never grow junk rows.
var ConsoleModules = []string{
	// 顺序与左侧菜单一致，方便对照
	"overview",     // 总览（报表统计 / 咨询日志 / artifacts）
	"dataset",      // 知识库
	"chat",         // 知识问答
	"search",       // 知识搜索
	"agent",        // 智能体
	"studio",       // 工作室
	"memory",       // 记忆
	"qc_rule",      // 会话质检 - 质检规则
	"qc_realtime",  // 会话质检 - 实时质检
	"qc_hit",       // 会话质检 - 命中记录
	"qc_config",    // 会话质检 - 系统配置
	"file",         // 文件管理
	"organization", // 租户中心 - 组织架构
	"member",       // 租户中心 - 用户管理
	"role",         // 租户中心 - 角色管理
	"grant",        // 租户中心 - 资源授权
	"model",        // 配置中心 - 模型配置
	"datasource",   // 配置中心 - 数据源
	"channel",      // 配置中心 - 聊天渠道
	"mcp",          // 配置中心 - MCP
	"apikey",       // 配置中心 - API
	"team",         // 配置中心 - 团队管理
	// 下面三个菜单上没有独立入口，但页面内仍在使用，保留矩阵行
	"quota",    // 配额用量
	"audit",    // 审计日志
	"security", // 安全设置
}

// builtinRoleSpec defines a seeded role and its default matrix.
type builtinRoleSpec struct {
	name        string
	description string
	// grant maps a module to its allowed actions. "all" grants every action.
	grant map[string]string
	// isSystem marks system-level roles (Owner) that are fully locked down.
	isSystem bool
}

// builtinRoles are created lazily per tenant on first read.
//
// Owner is marked isSystem=true: it represents the hardcoded user_tenant.role
// enum value, is fully locked (no rename, no permission tweaks, no delete),
// and exists so the role UI can show "Owner" next to owner-member rows.
// 租户管理员 / 部门管理员 / 普通成员 are the editable builtin roles that
// normal members are assigned to via user_tenant.role_id.
var builtinRoles = []builtinRoleSpec{
	{
		name:        "Owner",
		description: "租户所有者（全权限，不可编辑）",
		grant:       map[string]string{"*": "all"},
		isSystem:    true,
	},
	{
		name:        "租户管理员",
		description: "拥有租户内全部权限",
		grant:       map[string]string{"*": "all"},
	},
	{
		name:        "部门管理员",
		description: "管理本部门成员与资源",
		grant: map[string]string{
			"*":      "view",
			"member": "manage",
			"role":   "view",
		},
	},
	{
		name:        "普通成员",
		description: "基础使用权限",
		grant: map[string]string{
			"*": "view",
		},
	},
}

// RoleDAO reads and writes tenant-scoped roles and their matrices.
type RoleDAO struct{}

func NewRoleDAO() *RoleDAO {
	return &RoleDAO{}
}

// EnsureBuiltinRoles seeds the three builtin roles for a tenant that has none.
// It is idempotent and cheap (one count query on the happy path).
func (dao *RoleDAO) EnsureBuiltinRoles(ctx context.Context, db *gorm.DB, tenantID string) error {
	var existing int64
	if err := db.WithContext(ctx).
		Model(&entity.Role{}).
		Where("tenant_id = ?", tenantID).
		Where("is_builtin = ?", true).
		Count(&existing).Error; err != nil {
		return err
	}
	if existing >= int64(len(builtinRoles)) {
		// Roles already created, but the permission matrix may be missing rows
		// for modules added after the tenant was seeded (e.g. qc_*). Fill them
		// in so ModulePermission middleware does not silently fall through to
		// "default allow" on a brand-new module.
		return dao.backfillBuiltinRolePermissions(ctx, db, tenantID)
	}

	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, spec := range builtinRoles {
			var found entity.Role
			err := tx.Where("tenant_id = ?", tenantID).
				Where("name = ?", spec.name).
				Take(&found).Error
			if err == nil {
				continue
			}
			if err != gorm.ErrRecordNotFound {
				return err
			}

			role := entity.Role{
				ID:          common.GenerateUUID(),
				TenantID:    tenantID,
				Name:        spec.name,
				Description: spec.description,
				IsBuiltin:   true,
				IsSystem:    spec.isSystem,
				BaseModel:   entity.BaseModel{CreateTime: ptrInt64(time.Now().UnixMilli())},
			}
			if err := tx.Create(&role).Error; err != nil {
				return err
			}

			rows := buildPermissionRows(role.ID, spec.grant)
			if len(rows) > 0 {
				if err := tx.Create(&rows).Error; err != nil {
					return err
				}
			}
		}
		return nil
	})
}

// backfillBuiltinRolePermissions inserts missing role_permission rows for a
// tenant's built-in roles. It catches the case where ConsoleModules grew after
// the roles were seeded (e.g. qc_* modules added mid-2026).
//
// It is deliberately permissive: if a builtin role cannot be matched to a
// builtinRoleSpec by name (admin may have renamed it via the console), we
// skip that role rather than overwriting a deliberate customisation.
func (dao *RoleDAO) backfillBuiltinRolePermissions(ctx context.Context, db *gorm.DB, tenantID string) error {
	var roles []*entity.Role
	if err := db.WithContext(ctx).
		Model(&entity.Role{}).
		Where("tenant_id = ?", tenantID).
		Where("is_builtin = ?", true).
		Find(&roles).Error; err != nil {
		return err
	}
	if len(roles) == 0 {
		return nil
	}

	for _, role := range roles {
		var spec *builtinRoleSpec
		for i := range builtinRoles {
			if builtinRoles[i].name == role.Name {
				spec = &builtinRoles[i]
				break
			}
		}
		if spec == nil {
			continue
		}

		var existingModules []string
		if err := db.WithContext(ctx).
			Model(&entity.RolePermission{}).
			Where("role_id = ?", role.ID).
			Pluck("module", &existingModules).Error; err != nil {
			return err
		}
		have := make(map[string]bool, len(existingModules))
		for _, m := range existingModules {
			have[m] = true
		}

		var missing []*entity.RolePermission
		for _, module := range ConsoleModules {
			if have[module] {
				continue
			}
			action, ok := spec.grant[module]
			if !ok {
				action = spec.grant["*"]
			}
			if action == "" {
				continue
			}
			row := &entity.RolePermission{
				ID:     common.GenerateUUID(),
				RoleID: role.ID,
				Module: module,
			}
			switch action {
			case "all":
				row.CanView, row.CanCreate, row.CanEdit, row.CanDelete, row.CanManage = true, true, true, true, true
			case "manage":
				row.CanView, row.CanManage = true, true
			case "view":
				row.CanView = true
			}
			missing = append(missing, row)
		}
		if len(missing) > 0 {
			if err := db.WithContext(ctx).Create(&missing).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

// buildPermissionRows expands a grant map into one row per module.
func buildPermissionRows(roleID string, grant map[string]string) []*entity.RolePermission {
	rows := make([]*entity.RolePermission, 0, len(ConsoleModules))
	for _, module := range ConsoleModules {
		action, ok := grant[module]
		if !ok {
			action = grant["*"]
		}
		row := &entity.RolePermission{
			ID:     common.GenerateUUID(),
			RoleID: roleID,
			Module: module,
		}
		switch action {
		case "all":
			row.CanView, row.CanCreate, row.CanEdit, row.CanDelete, row.CanManage = true, true, true, true, true
		case "manage":
			row.CanView, row.CanManage = true, true
		case "view":
			row.CanView = true
		}
		rows = append(rows, row)
	}
	return rows
}

// EnsureTenantAdminRole returns this tenant's 「租户管理员」builtin role,
// creating it (and its full-matrix rows) if it doesn't exist yet.
// Used by TransferTenantOwner to automatically downgrade the previous owner
// into a regular 租户管理员 member instead of a hardcoded owner.
func (dao *RoleDAO) EnsureTenantAdminRole(ctx context.Context, db *gorm.DB, tenantID string) (*entity.Role, error) {
	var role entity.Role
	err := db.WithContext(ctx).
		Where("tenant_id = ? AND name = ? AND is_builtin = true AND is_system = false", tenantID, "租户管理员").
		First(&role).Error
	if err == nil {
		return &role, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	// Lazy-create — mirror what EnsureBuiltinRoles does
	role = entity.Role{
		ID:          common.GenerateUUID(),
		TenantID:    tenantID,
		Name:        "租户管理员",
		Description: "拥有租户内全部权限",
		IsBuiltin:   true,
		IsSystem:    false,
	}
	if err := db.WithContext(ctx).Create(&role).Error; err != nil {
		return nil, err
	}
	rows := buildPermissionRows(role.ID, map[string]string{"*": "all"})
	for i := range rows {
		if err := db.WithContext(ctx).Create(&rows[i]).Error; err != nil {
			return nil, err
		}
	}
	return &role, nil
}

// ListByTenant returns roles plus their matrices.
func (dao *RoleDAO) ListByTenant(ctx context.Context, db *gorm.DB, tenantID string) ([]*entity.Role, map[string][]*entity.RolePermission, error) {
	roles := make([]*entity.Role, 0)
	if err := db.WithContext(ctx).
		Where("tenant_id = ?", tenantID).
		Order("is_builtin DESC, name ASC").
		Find(&roles).Error; err != nil {
		return nil, nil, err
	}
	if len(roles) == 0 {
		return roles, map[string][]*entity.RolePermission{}, nil
	}

	ids := make([]string, 0, len(roles))
	for _, role := range roles {
		ids = append(ids, role.ID)
	}
	perms := make([]*entity.RolePermission, 0)
	if err := db.WithContext(ctx).
		Where("role_id IN ?", ids).
		Find(&perms).Error; err != nil {
		return nil, nil, err
	}

	byRole := make(map[string][]*entity.RolePermission, len(roles))
	for _, p := range perms {
		byRole[p.RoleID] = append(byRole[p.RoleID], p)
	}
	return roles, byRole, nil
}

// Get loads one role scoped to its tenant.
func (dao *RoleDAO) Get(ctx context.Context, db *gorm.DB, tenantID, id string) (*entity.Role, error) {
	var role entity.Role
	if err := db.WithContext(ctx).
		Where("tenant_id = ?", tenantID).
		Where("id = ?", id).
		Take(&role).Error; err != nil {
		return nil, err
	}
	return &role, nil
}

func (dao *RoleDAO) Create(ctx context.Context, db *gorm.DB, role *entity.Role, grant map[string]string) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(role).Error; err != nil {
			return err
		}
		rows := buildPermissionRows(role.ID, grant)
		if len(rows) > 0 {
			return tx.Create(&rows).Error
		}
		return nil
	})
}

// Update allows builtin roles to be renamed/described. The permission matrix
// is updated via ReplacePermissions which has no builtin gate.
func (dao *RoleDAO) Update(ctx context.Context, db *gorm.DB, tenantID, id string, fields map[string]any) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		_, err := dao.Get(ctx, tx, tenantID, id)
		if err != nil {
			return err
		}
		return tx.Model(&entity.Role{}).
			Where("tenant_id = ?", tenantID).
			Where("id = ?", id).
			Updates(fields).Error
	})
}

// Delete removes a role and its matrix, whether builtin or custom.
func (dao *RoleDAO) Delete(ctx context.Context, db *gorm.DB, tenantID, id string) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		_, err := dao.Get(ctx, tx, tenantID, id)
		if err != nil {
			return err
		}
		if err := tx.Where("role_id = ?", id).Delete(&entity.RolePermission{}).Error; err != nil {
			return err
		}
		return tx.Where("tenant_id = ?", tenantID).
			Where("id = ?", id).
			Delete(&entity.Role{}).Error
	})
}

// ReplacePermissions overwrites a role's whole matrix.
//
// Delete-then-insert rather than diffing: the matrix is 12 rows, and a full
// replace keeps "revoked to false" identical to "row absent", which is what the
// console's save button means.
func (dao *RoleDAO) ReplacePermissions(ctx context.Context, db *gorm.DB, tenantID, roleID string, rows []*entity.RolePermission) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		_, err := dao.Get(ctx, tx, tenantID, roleID)
		if err != nil {
			return err
		}
		// NOTE: builtin roles no longer block ReplacePermissions. Owners may
		// fine-tune the permission matrix of builtin roles (e.g. revoke overview
		// from "普通成员") without having to create a custom role first.
		// The role name/description remain protected elsewhere.
		if err := tx.Where("role_id = ?", roleID).Delete(&entity.RolePermission{}).Error; err != nil {
			return err
		}
		if len(rows) == 0 {
			return nil
		}
		for _, row := range rows {
			row.ID = common.GenerateUUID()
			row.RoleID = roleID
		}
		return tx.Create(&rows).Error
	})
}

func ptrInt64(v int64) *int64 {
	return &v
}

// ModulePermission returns the matrix row governing `module` for one member.
//
// Returns (nil, nil) when nothing constrains the module — no membership role, no
// role_id, or no row for that module. Callers treat nil as "allowed": the console
// defaults to permitting and only honours an explicit denial, so an incomplete
// matrix can never lock an operator out of the tenant console.
func (dao *RoleDAO) ModulePermission(ctx context.Context, db *gorm.DB, tenantID, userID, module string) (*entity.RolePermission, error) {
	var membership entity.UserTenant
	if err := db.WithContext(ctx).
		Where("tenant_id = ?", tenantID).
		Where("user_id = ?", userID).
		Take(&membership).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}

	// The tenant owner is never constrained: a misconfigured matrix must not be
	// able to lock the owner out of their own tenant.
	if membership.Role == roleEnumOwner {
		return nil, nil
	}

	roleID := membership.RoleID
	if roleID == "" {
		name, ok := builtinRoleNameForEnum(membership.Role)
		if !ok {
			return nil, nil
		}
		var role entity.Role
		if err := db.WithContext(ctx).
			Where("tenant_id = ?", tenantID).
			Where("name = ?", name).
			Take(&role).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				return nil, nil
			}
			return nil, err
		}
		roleID = role.ID
	}

	var row entity.RolePermission
	if err := db.WithContext(ctx).
		Where("role_id = ?", roleID).
		Where("module = ?", module).
		Take(&row).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &row, nil
}

// roleEnumOwner mirrors user_tenant.role = "owner".
//
// Defined locally rather than imported from the permission package: permission
// already imports dao, so referencing it here would create an import cycle.
const roleEnumOwner = "owner"

// builtinRoleNameForEnum maps the legacy role enum onto the seeded role name.
//
// Spelled out instead of indexing into builtinRoles so reordering that slice
// cannot silently remap roles.
func builtinRoleNameForEnum(roleEnum string) (string, bool) {
	switch roleEnum {
	case "owner":
		return "租户管理员", true
	case "admin":
		return "部门管理员", true
	case "normal":
		return "普通成员", true
	}
	return "", false
}
