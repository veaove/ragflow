package entity

// ResourceGrant is one "who can see this resource" rule.
//
// It generalises the legacy two-value `permission` column (me / team) into a
// subject list: a whole team, one department, or one user. When a resource has
// no rows here, the old column still decides — so existing resources keep their
// behaviour untouched and the two models never have to be migrated at once.
//
// ResourceKind reuses the values in internal/permission (dataset / canvas /
// memory / ...), keeping the grant table usable by every resource family
// without this package importing the permission package.
type ResourceGrant struct {
	ID string `gorm:"column:id;primaryKey;size:32" json:"id"`
	// TenantID scopes the grant so one tenant's rule can never match another's
	// resource, even if ids collide.
	TenantID     string `gorm:"column:tenant_id;size:32;not null;index" json:"tenant_id"`
	ResourceKind string `gorm:"column:resource_kind;size:32;not null;index" json:"resource_kind"`
	ResourceID   string `gorm:"column:resource_id;size:32;not null;index" json:"resource_id"`
	// SubjectKind is "team" | "department" | "user".
	SubjectKind string `gorm:"column:subject_kind;size:16;not null" json:"subject_kind"`
	// SubjectID is empty for "team" (the whole tenant).
	SubjectID string `gorm:"column:subject_id;size:32;index" json:"subject_id"`
	// Permission 是这条授权给到的操作级别：
	//   read —— 只能查看，内容不可编辑、不可删除
	//   edit —— 可以编辑、删除
	//
	// 默认 edit 是刻意的：这列出现之前，授权就等于"可编辑"（grant 命中后
	// 直接拿 TenantOperations，里面含 Update/Delete）。空值若按 read 处理，
	// 存量授权会在升级瞬间全部降级成只读，属于破坏性变更。
	Permission string `gorm:"column:permission;size:16;not null;default:'edit'" json:"permission"`
	BaseModel
}

// TableName specify table name
func (ResourceGrant) TableName() string {
	return "resource_grant"
}

// Grant subject kinds.
const (
	GrantSubjectTeam       = "team"
	GrantSubjectDepartment = "department"
	GrantSubjectUser       = "user"
)
