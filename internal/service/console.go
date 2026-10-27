package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"

	"ragflow/internal/common"
	"ragflow/internal/dao"
	"ragflow/internal/entity"
)

// ConsoleService backs the tenant console (org tree, members, roles).
//
// Every method takes an explicit tenantID that the HTTP layer has already
// validated against the caller's membership, so none of the queries here can
// leak across tenants.
type ConsoleService struct{}

func NewConsoleService() *ConsoleService {
	return &ConsoleService{}
}

// DepartmentNode is one node of the rendered tree.
type DepartmentNode struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	ParentID    string            `json:"parent_id"`
	MemberCount int64             `json:"member_count"`
	Children    []*DepartmentNode `json:"children,omitempty"`
}

// ConsoleMember is a member row of the console list.
type ConsoleMember struct {
	ID             string `json:"id"`
	Nickname       string `json:"nickname"`
	Email          string `json:"email"`
	DepartmentID   string `json:"department_id"`
	DepartmentName string `json:"department_name"`
	Position       string `json:"position"`
	RoleID         string `json:"role_id"`
	RoleName       string `json:"role_name"`
	// 字段名带 Enum 是为了和 RoleName（角色显示名）区分，但 SQL 列名是 role，
	// 必须显式声明 column，否则 GORM 会按 role_enum 去找而不存在 → 永远空。
	RoleEnum   string `gorm:"column:role" json:"role"`
	Status     string `json:"status"`
	CreateTime int64  `json:"create_time"`
	// CreateDate carries the raw datetime so the conversion to millis works on
	// both MySQL and the sqlite used by tests (no UNIX_TIMESTAMP there).
	CreateDate *time.Time `gorm:"column:create_date" json:"-"`
}

// MemberFilter narrows a member list query.
type MemberFilter struct {
	Keywords     string
	DepartmentID string
	RoleID       string
	Status       string
}

// DepartmentTree returns the tenant's tree with per-node member counts.
func (s *ConsoleService) DepartmentTree(ctx context.Context, tenantID string) ([]*DepartmentNode, error) {
	rows, err := dao.NewDepartmentDAO().ListByTenant(ctx, dao.DB, tenantID)
	if err != nil {
		return nil, err
	}
	counts, err := dao.NewDepartmentDAO().MemberCounts(ctx, dao.DB, tenantID)
	if err != nil {
		return nil, err
	}

	// Ownership rule: a department's badge counts its own members, not the
	// subtree — the console shows subtree totals only in the header.
	byParent := make(map[string][]*entity.Department, len(rows))
	nodes := make(map[string]*DepartmentNode, len(rows))
	for _, row := range rows {
		if row.Status != "1" {
			continue
		}
		nodes[row.ID] = &DepartmentNode{
			ID:          row.ID,
			Name:        row.Name,
			ParentID:    row.ParentID,
			MemberCount: counts[row.ID],
		}
		byParent[row.ParentID] = append(byParent[row.ParentID], row)
	}

	var build func(parentID string) []*DepartmentNode
	build = func(parentID string) []*DepartmentNode {
		children := byParent[parentID]
		out := make([]*DepartmentNode, 0, len(children))
		for _, child := range children {
			node := nodes[child.ID]
			if node == nil {
				continue
			}
			node.Children = build(child.ID)
			out = append(out, node)
		}
		return out
	}

	return build(""), nil
}

// CreateDepartment appends a node under parentID (empty = root).
func (s *ConsoleService) CreateDepartment(ctx context.Context, tenantID, name, parentID string, sort int) (*entity.Department, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("部门名称不能为空")
	}
	if parentID != "" {
		if _, err := dao.NewDepartmentDAO().Get(ctx, dao.DB, tenantID, parentID); err != nil {
			return nil, errors.New("上级部门不存在")
		}
	}

	now := time.Now().UnixMilli()
	row := &entity.Department{
		ID:        common.GenerateUUID(),
		TenantID:  tenantID,
		ParentID:  parentID,
		Name:      name,
		Sort:      sort,
		Status:    "1",
		BaseModel: entity.BaseModel{CreateTime: &now, UpdateTime: &now},
	}
	if err := dao.NewDepartmentDAO().Create(ctx, dao.DB, row); err != nil {
		return nil, err
	}
	return row, nil
}

// UpdateDepartment renames / re-parents / sorts a node.
func (s *ConsoleService) UpdateDepartment(ctx context.Context, tenantID, id string, fields map[string]any) error {
	if name, ok := fields["name"].(string); ok {
		name = strings.TrimSpace(name)
		if name == "" {
			return errors.New("部门名称不能为空")
		}
		fields["name"] = name
	}
	// Re-parenting must not create a cycle: walking up from the new parent has
	// to terminate before reaching this node.
	if parentID, ok := fields["parent_id"].(string); ok && parentID != "" {
		if parentID == id {
			return errors.New("不能把部门移动到自身下面")
		}
		seen := 0
		cursor := parentID
		for cursor != "" && seen < 32 {
			if cursor == id {
				return errors.New("不能把部门移动到自己的子部门下")
			}
			parent, err := dao.NewDepartmentDAO().Get(ctx, dao.DB, tenantID, cursor)
			if err != nil {
				return errors.New("上级部门不存在")
			}
			cursor = parent.ParentID
			seen++
		}
	}
	fields["update_time"] = time.Now().UnixMilli()
	return dao.NewDepartmentDAO().Update(ctx, dao.DB, tenantID, id, fields)
}

// DeleteDepartment removes a leaf node that has no members.
func (s *ConsoleService) DeleteDepartment(ctx context.Context, tenantID, id string) error {
	return dao.NewDepartmentDAO().Delete(ctx, dao.DB, tenantID, id)
}

// ListMembers returns paginated members with department and role resolved.
func (s *ConsoleService) ListMembers(ctx context.Context, tenantID string, f MemberFilter, limit, offset int) ([]*ConsoleMember, int64, error) {
	base := dao.DB.WithContext(ctx).
		Table("user").
		Joins("JOIN user_tenant ut ON ut.user_id = user.id AND ut.tenant_id = ?", tenantID)

	if kw := strings.TrimSpace(f.Keywords); kw != "" {
		like := "%" + kw + "%"
		base = base.Where("user.nickname LIKE ? OR user.email LIKE ?", like, like)
	}
	if f.DepartmentID != "" {
		base = base.Where("user.department_id = ?", f.DepartmentID)
	}
	if f.RoleID != "" {
		base = base.Where("ut.role_id = ?", f.RoleID)
	}
	if f.Status != "" {
		base = base.Where("user.is_active = ?", f.Status)
	}

	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if limit <= 0 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}

	rows := make([]*ConsoleMember, 0)
	err := base.
		Select(`user.id, user.nickname, user.email,
			COALESCE(user.department_id, '') AS department_id,
			COALESCE(d.name, '') AS department_name,
			COALESCE(user.position, '') AS position,
			COALESCE(ut.role_id, '') AS role_id,
			COALESCE(r.name, '') AS role_name,
			ut.role AS role,
			user.is_active AS status,
			user.create_date AS create_date`).
		Joins("LEFT JOIN department d ON d.id = user.department_id").
		Joins("LEFT JOIN role r ON r.id = ut.role_id").
		Order("user.create_date DESC").
		Limit(limit).Offset(offset).
		Scan(&rows).Error
	if err != nil {
		return nil, 0, err
	}

	// create_date is a datetime; the console wants millis.
	for _, row := range rows {
		if row.CreateDate != nil {
			row.CreateTime = row.CreateDate.UnixMilli()
		}
	}
	return rows, total, nil
}

// MemberUpdate is the editable subset of a member record.
type MemberUpdate struct {
	DepartmentID *string `json:"department_id"`
	Position     *string `json:"position"`
	RoleID       *string `json:"role_id"`
	Status       *string `json:"status"`
	// Nickname 是账号昵称（user.nickname），不是租户内别名。
	// 允许传空串表示清空，此时列表回落到邮箱显示。
	Nickname *string `json:"nickname"`
}

// UpdateMember edits org placement, role and nickname.
//
// 昵称可以在这里改（它是展示名，改它不影响任何人登录）；email 仍然不行 ——
// 邮箱是登录标识，改动会让用户下次登不进来，必须走专门的换绑流程。
func (s *ConsoleService) UpdateMember(ctx context.Context, tenantID, userID string, in MemberUpdate) error {
	if in.DepartmentID != nil && *in.DepartmentID != "" {
		if _, err := dao.NewDepartmentDAO().Get(ctx, dao.DB, tenantID, *in.DepartmentID); err != nil {
			return errors.New("部门不存在")
		}
	}
	if in.RoleID != nil && *in.RoleID != "" {
		if _, err := dao.NewRoleDAO().Get(ctx, dao.DB, tenantID, *in.RoleID); err != nil {
			return errors.New("角色不存在")
		}
	}
	// 昵称按字符数算：user.nickname 是 varchar(100)，100 个汉字占 300 字节，
	// 按字节判会误拒中文名。空串是合法的（表示清空昵称，列表回落邮箱）。
	var nickname string
	if in.Nickname != nil {
		nickname = strings.TrimSpace(*in.Nickname)
		if len([]rune(nickname)) > 100 {
			return errors.New("姓名不能超过 100 个字符")
		}
	}

	var membership entity.UserTenant
	if err := dao.DB.WithContext(ctx).
		Where("tenant_id = ?", tenantID).
		Where("user_id = ?", userID).
		Take(&membership).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errors.New("成员不存在")
		}
		return err
	}

	return dao.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		userFields := map[string]any{}
		if in.DepartmentID != nil {
			userFields["department_id"] = *in.DepartmentID
		}
		if in.Position != nil {
			userFields["position"] = *in.Position
		}
		if in.Status != nil && *in.Status != "" {
			userFields["is_active"] = *in.Status
		}
		if in.Nickname != nil {
			userFields["nickname"] = nickname
		}
		if len(userFields) > 0 {
			if err := tx.Model(&entity.User{}).
				Where("id = ?", userID).
				Updates(userFields).Error; err != nil {
				return err
			}
		}

		if in.RoleID != nil {
			if err := tx.Model(&entity.UserTenant{}).
				Where("id = ?", membership.ID).
				Update("role_id", *in.RoleID).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// RoleView is a role plus its rendered matrix.
type RoleView struct {
	ID          string                   `json:"id"`
	Name        string                   `json:"name"`
	Description string                   `json:"description"`
	IsBuiltin   bool                     `json:"is_builtin"`
	MemberCount int64                    `json:"member_count"`
	Permissions []*entity.RolePermission `json:"permissions"`
}

// ListRoles seeds the builtin roles on first access, then returns every role.
func (s *ConsoleService) ListRoles(ctx context.Context, tenantID string) ([]*RoleView, error) {
	if err := dao.NewRoleDAO().EnsureBuiltinRoles(ctx, dao.DB, tenantID); err != nil {
		return nil, err
	}
	roles, matrix, err := dao.NewRoleDAO().ListByTenant(ctx, dao.DB, tenantID)
	if err != nil {
		return nil, err
	}

	// Member counts per role, so the console can show "12 人" next to a role.
	counts := map[string]int64{}
	type countRow struct {
		RoleID string `gorm:"column:role_id"`
		Total  int64  `gorm:"column:total"`
	}
	rows := make([]countRow, 0)
	if err := dao.DB.WithContext(ctx).
		Model(&entity.UserTenant{}).
		Select("role_id, COUNT(*) AS total").
		Where("tenant_id = ?", tenantID).
		Where("role_id <> ''").
		Group("role_id").
		Find(&rows).Error; err == nil {
		for _, r := range rows {
			counts[r.RoleID] = r.Total
		}
	}

	out := make([]*RoleView, 0, len(roles))
	for _, role := range roles {
		perms := matrix[role.ID]
		if perms == nil {
			perms = make([]*entity.RolePermission, 0)
		}
		out = append(out, &RoleView{
			ID:          role.ID,
			Name:        role.Name,
			Description: role.Description,
			IsBuiltin:   role.IsBuiltin,
			MemberCount: counts[role.ID],
			Permissions: perms,
		})
	}
	return out, nil
}

// CreateRole adds a custom role with an initial matrix.
func (s *ConsoleService) CreateRole(ctx context.Context, tenantID, name, description string, grant map[string]string) (*entity.Role, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("角色名称不能为空")
	}

	var existing int64
	if err := dao.DB.WithContext(ctx).Model(&entity.Role{}).
		Where("tenant_id = ?", tenantID).
		Where("name = ?", name).
		Count(&existing).Error; err != nil {
		return nil, err
	}
	if existing > 0 {
		return nil, errors.New("同名角色已存在")
	}

	now := time.Now().UnixMilli()
	role := &entity.Role{
		ID:          common.GenerateUUID(),
		TenantID:    tenantID,
		Name:        name,
		Description: description,
		IsBuiltin:   false,
		BaseModel:   entity.BaseModel{CreateTime: &now, UpdateTime: &now},
	}
	if err := dao.NewRoleDAO().Create(ctx, dao.DB, role, grant); err != nil {
		return nil, err
	}
	return role, nil
}

// UpdateRole renames a custom role.
func (s *ConsoleService) UpdateRole(ctx context.Context, tenantID, id string, fields map[string]any) error {
	if name, ok := fields["name"].(string); ok {
		name = strings.TrimSpace(name)
		if name == "" {
			return errors.New("角色名称不能为空")
		}
		fields["name"] = name
	}
	fields["update_time"] = time.Now().UnixMilli()
	return dao.NewRoleDAO().Update(ctx, dao.DB, tenantID, id, fields)
}

// DeleteRole removes a custom role and detaches its members back to the enum
// role, so nobody is left pointing at a missing role_id.
func (s *ConsoleService) DeleteRole(ctx context.Context, tenantID, id string) error {
	if err := dao.NewRoleDAO().Delete(ctx, dao.DB, tenantID, id); err != nil {
		return err
	}
	return dao.DB.WithContext(ctx).
		Model(&entity.UserTenant{}).
		Where("tenant_id = ?", tenantID).
		Where("role_id = ?", id).
		Update("role_id", "").Error
}

// SavePermissions replaces a role's matrix from the console's checkbox grid.
func (s *ConsoleService) SavePermissions(ctx context.Context, tenantID, roleID string, rows []*entity.RolePermission) error {
	// Drop unknown modules instead of persisting them.
	allowed := make(map[string]struct{}, len(dao.ConsoleModules))
	for _, m := range dao.ConsoleModules {
		allowed[m] = struct{}{}
	}
	clean := make([]*entity.RolePermission, 0, len(rows))
	for _, row := range rows {
		if _, ok := allowed[row.Module]; !ok {
			continue
		}
		clean = append(clean, &entity.RolePermission{
			Module:    row.Module,
			CanView:   row.CanView,
			CanCreate: row.CanCreate,
			CanEdit:   row.CanEdit,
			CanDelete: row.CanDelete,
			CanManage: row.CanManage,
		})
	}
	return dao.NewRoleDAO().ReplacePermissions(ctx, dao.DB, tenantID, roleID, clean)
}

// ResetMemberPassword sets a new password for a tenant member.
//
// The console encrypts with the same RSA key as the login form, so the payload
// is decrypted here before hashing. Reuses common.GenerateWerkzeugPasswordHash
// so the stored format stays identical to every other password write path.
func (s *ConsoleService) ResetMemberPassword(ctx context.Context, tenantID, userID, encryptedPassword string) error {
	if strings.TrimSpace(encryptedPassword) == "" {
		return errors.New("新密码不能为空")
	}

	// The target must be a member of this tenant — otherwise the endpoint would
	// be a way to reset any user's password by guessing an id.
	var membership entity.UserTenant
	if err := dao.DB.WithContext(ctx).
		Where("tenant_id = ?", tenantID).
		Where("user_id = ?", userID).
		Take(&membership).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errors.New("成员不存在")
		}
		return err
	}

	plain, err := common.DecryptPassword(encryptedPassword)
	if err != nil {
		return errors.New("密码解密失败")
	}
	if len(plain) < 6 {
		return errors.New("密码至少 6 位")
	}

	hashed, err := common.GenerateWerkzeugPasswordHash(plain)
	if err != nil {
		return err
	}
	return dao.DB.WithContext(ctx).
		Model(&entity.User{}).
		Where("id = ?", userID).
		Update("password", hashed).Error
}

// MyPermissions is the caller's effective permission matrix in one tenant.
type MyPermissions struct {
	RoleEnum string `json:"role"`
	RoleID   string `json:"role_id"`
	RoleName string `json:"role_name"`
	// Modules maps module key -> allowed actions.
	Modules map[string]*entity.RolePermission `json:"modules"`
}

// enumToBuiltinRole maps the legacy user_tenant.role enum onto the seeded role
// name, so members without an explicit role_id still get a usable matrix.
var enumToBuiltinRole = map[string]string{
	"owner":  "租户管理员",
	"admin":  "部门管理员",
	"normal": "普通成员",
}

// EffectivePermissions resolves what the caller may do in a tenant.
//
// Resolution order: explicit role_id first, then the builtin role matching the
// legacy enum. Members with neither get an empty matrix — deny by default, so a
// half-configured tenant never accidentally grants everything.
func (s *ConsoleService) EffectivePermissions(ctx context.Context, tenantID, userID string) (*MyPermissions, error) {
	var membership entity.UserTenant
	if err := dao.DB.WithContext(ctx).
		Where("tenant_id = ?", tenantID).
		Where("user_id = ?", userID).
		Take(&membership).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("不是该租户成员")
		}
		return nil, err
	}

	out := &MyPermissions{
		RoleEnum: membership.Role,
		RoleID:   membership.RoleID,
		Modules:  map[string]*entity.RolePermission{},
	}

	// owner 永远全量权限，不依赖 role_permission 种子（老租户 builtin
	// owner 的 role_permission 行可能是早期错误种子，不能作为真相源）。
	if membership.Role == "owner" {
		for _, module := range dao.ConsoleModules {
			out.Modules[module] = &entity.RolePermission{
				Module:    module,
				CanView:   true,
				CanCreate: true,
				CanEdit:   true,
				CanDelete: true,
				CanManage: true,
			}
		}
		// 尝试拿 owner builtin 的名字（有就填，没有也不影响 modules）
		if membership.RoleID != "" {
			out.RoleID = membership.RoleID
			if role, err := dao.NewRoleDAO().Get(ctx, dao.DB, tenantID, membership.RoleID); err == nil {
				out.RoleName = role.Name
			}
		}
		return out, nil
	}

	roleDAO := dao.NewRoleDAO()
	var role *entity.Role
	if membership.RoleID != "" {
		if found, err := roleDAO.Get(ctx, dao.DB, tenantID, membership.RoleID); err == nil {
			role = found
		}
	}
	if role == nil {
		name, ok := enumToBuiltinRole[membership.Role]
		if !ok {
			return out, nil
		}
		// 内置角色可能还没生成（首次访问），先补齐再查。
		if err := roleDAO.EnsureBuiltinRoles(ctx, dao.DB, tenantID); err != nil {
			return nil, err
		}
		roles, _, err := roleDAO.ListByTenant(ctx, dao.DB, tenantID)
		if err != nil {
			return nil, err
		}
		for _, candidate := range roles {
			if candidate.Name == name {
				role = candidate
				break
			}
		}
	}
	if role == nil {
		return out, nil
	}

	out.RoleID = role.ID
	out.RoleName = role.Name
	_, matrix, err := roleDAO.ListByTenant(ctx, dao.DB, tenantID)
	if err != nil {
		return nil, err
	}
	for _, row := range matrix[role.ID] {
		copied := *row
		out.Modules[copied.Module] = &copied
	}
	return out, nil
}

// TransferTenantOwner lets this tenant's current owner hand ownership to
// another normal member of the same tenant. On success:
//   - caller (old owner) → role=normal + role_id=<租户管理员 builtin>
//   - target (new owner) → role=owner, role_id=""
// Only the current owner of this tenant may call.
func (s *ConsoleService) TransferTenantOwner(ctx context.Context, tenantID, callerUserID, targetUserID string) (map[string]any, error) {
	tenantID = strings.TrimSpace(tenantID)
	callerUserID = strings.TrimSpace(callerUserID)
	targetUserID = strings.TrimSpace(targetUserID)
	if tenantID == "" || callerUserID == "" || targetUserID == "" {
		return nil, errors.New("tenant_id, caller_user_id and target_user_id are required")
	}
	if callerUserID == targetUserID {
		return nil, errors.New("cannot transfer ownership to yourself")
	}

	var caller entity.UserTenant
	if err := dao.DB.WithContext(ctx).
		Where("tenant_id = ? AND user_id = ?", tenantID, callerUserID).
		First(&caller).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("caller is not a member of this tenant")
		}
		return nil, err
	}
	if caller.Role != "owner" {
		return nil, errors.New("only the current owner can transfer ownership")
	}

	var target entity.UserTenant
	if err := dao.DB.WithContext(ctx).
		Where("tenant_id = ? AND user_id = ?", tenantID, targetUserID).
		First(&target).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("target user is not a member of this tenant")
		}
		return nil, err
	}

	adminRole, err := dao.NewRoleDAO().EnsureTenantAdminRole(ctx, dao.DB, tenantID)
	if err != nil {
		return nil, err
	}

	err = dao.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&entity.UserTenant{}).Where("id = ?", caller.ID).
			Updates(map[string]any{
				"role":    "normal",
				"role_id": adminRole.ID,
				"status":  "1",
			}).Error; err != nil {
			return err
		}
		if err := tx.Model(&entity.UserTenant{}).Where("id = ?", target.ID).
			Updates(map[string]any{
				"role":    "owner",
				"role_id": "",
				"status":  "1",
			}).Error; err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"tenant_id":      tenantID,
		"new_owner_id":   targetUserID,
		"old_owner_id":   callerUserID,
		"old_owner_role": "tenant_admin",
	}, nil
}
