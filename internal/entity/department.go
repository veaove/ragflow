package entity

// Department is one node of a tenant's organisation tree.
//
// ParentID is empty for a root department. The tree is stored adjacency-list
// style and assembled in the service layer — tenant org charts are shallow
// (usually ≤3 levels), so recursive SQL buys nothing.
type Department struct {
	ID       string `gorm:"column:id;primaryKey;size:32" json:"id"`
	TenantID string `gorm:"column:tenant_id;size:32;not null;index" json:"tenant_id"`
	ParentID string `gorm:"column:parent_id;size:32;index" json:"parent_id"`
	Name     string `gorm:"column:name;size:128;not null" json:"name"`
	Sort     int    `gorm:"column:sort;not null;default:0" json:"sort"`
	// Status mirrors the platform-wide soft-delete convention: "1" active,
	// "0" disabled. Disabled departments keep their members but vanish from
	// the tree, so removing a department never silently orphans users.
	Status string `gorm:"column:status;size:1;not null;default:'1'" json:"status"`
	BaseModel
}

// TableName specify table name
func (Department) TableName() string {
	return "department"
}

// Role is a tenant-scoped role with a module × action permission matrix.
//
// This is separate from `user_tenant.role`, which is a fixed enum
// (owner/admin/normal/invite) that the permission engine reads directly. A
// member is linked to a custom role through `user_tenant.role_id`; when that is
// empty the engine falls back to the enum, so existing rows keep working.
type Role struct {
	ID          string `gorm:"column:id;primaryKey;size:32" json:"id"`
	TenantID    string `gorm:"column:tenant_id;size:32;not null;index" json:"tenant_id"`
	Name        string `gorm:"column:name;size:64;not null" json:"name"`
	Description string `gorm:"column:description;size:255" json:"description"`
	// IsBuiltin marks the three seeded roles (租户管理员 / 部门管理员 /
	// 普通成员). Their permissions are fixed and the API refuses edits.
	IsBuiltin bool `gorm:"column:is_builtin;not null" json:"is_builtin"`
	BaseModel
}

// TableName specify table name
func (Role) TableName() string {
	return "role"
}

// RolePermission is one row of a role's permission matrix: a module plus the
// actions allowed on it.
//
// Booleans carry no `default:` tag on purpose — GORM omits zero-value fields
// that have a default, which would silently turn "revoked" into "unchanged"
// when a matrix row is updated to all-false.
type RolePermission struct {
	ID     string `gorm:"column:id;primaryKey;size:32" json:"id"`
	RoleID string `gorm:"column:role_id;size:32;not null;index" json:"role_id"`
	// Module is a stable key shared with the frontend matrix:
	// dataset / agent / memory / file / chat / model / member / role /
	// apikey / quota / audit / security
	Module    string `gorm:"column:module;size:32;not null" json:"module"`
	CanView   bool   `gorm:"column:can_view;not null" json:"can_view"`
	CanCreate bool   `gorm:"column:can_create;not null" json:"can_create"`
	CanEdit   bool   `gorm:"column:can_edit;not null" json:"can_edit"`
	CanDelete bool   `gorm:"column:can_delete;not null" json:"can_delete"`
	CanManage bool   `gorm:"column:can_manage;not null" json:"can_manage"`
}

// TableName specify table name
func (RolePermission) TableName() string {
	return "role_permission"
}
