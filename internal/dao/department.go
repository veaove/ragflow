package dao

import (
	"context"
	"errors"

	"gorm.io/gorm"

	"ragflow/internal/entity"
)

// ErrDepartmentNotEmpty blocks deleting a department that still has children or
// members; the console surfaces it as a hint to move them first.
var ErrDepartmentNotEmpty = errors.New("department still has children or members")

// ErrBuiltinRoleImmutable blocks editing the seeded roles.
var ErrBuiltinRoleImmutable = errors.New("builtin role cannot be modified")

// DepartmentDAO reads and writes the tenant organisation tree.
type DepartmentDAO struct{}

func NewDepartmentDAO() *DepartmentDAO {
	return &DepartmentDAO{}
}

// ListByTenant returns every department of a tenant ordered for tree assembly.
func (dao *DepartmentDAO) ListByTenant(ctx context.Context, db *gorm.DB, tenantID string) ([]*entity.Department, error) {
	rows := make([]*entity.Department, 0)
	err := db.WithContext(ctx).
		Where("tenant_id = ?", tenantID).
		Order("sort ASC, name ASC").
		Find(&rows).Error
	return rows, err
}

// Get loads one department scoped to its tenant (a mismatched tenant is a miss,
// not a permission error, so callers cannot probe other tenants' ids).
func (dao *DepartmentDAO) Get(ctx context.Context, db *gorm.DB, tenantID, id string) (*entity.Department, error) {
	var row entity.Department
	if err := db.WithContext(ctx).
		Where("tenant_id = ?", tenantID).
		Where("id = ?", id).
		Take(&row).Error; err != nil {
		return nil, err
	}
	return &row, nil
}

func (dao *DepartmentDAO) Create(ctx context.Context, db *gorm.DB, row *entity.Department) error {
	return db.WithContext(ctx).Create(row).Error
}

// Update writes only the editable columns; tenant_id is never trusted from input.
func (dao *DepartmentDAO) Update(ctx context.Context, db *gorm.DB, tenantID, id string, fields map[string]any) error {
	return db.WithContext(ctx).
		Model(&entity.Department{}).
		Where("tenant_id = ?", tenantID).
		Where("id = ?", id).
		Updates(fields).Error
}

// Delete removes a department node only when it has no children and no members,
// so the tree can never be left dangling.
func (dao *DepartmentDAO) Delete(ctx context.Context, db *gorm.DB, tenantID, id string) error {
	return db.Transaction(func(tx *gorm.DB) error {
		var childCount int64
		if err := tx.Model(&entity.Department{}).
			Where("tenant_id = ?", tenantID).
			Where("parent_id = ?", id).
			Where("status = ?", "1").
			Count(&childCount).Error; err != nil {
			return err
		}
		if childCount > 0 {
			return ErrDepartmentNotEmpty
		}

		// 只统计**仍在本租户在册**的成员。user.department_id 是单值列，成员被
		// 移出租户后该值不会自动清空（历史数据也可能残留），若按裸列统计，
		// 这些悬空引用会让部门永远删不掉。
		var memberCount int64
		if err := tx.Model(&entity.User{}).
			Joins("JOIN user_tenant ut ON ut.user_id = user.id AND ut.tenant_id = ?", tenantID).
			Where("user.department_id = ?", id).
			Where("ut.status = ?", "1").
			Count(&memberCount).Error; err != nil {
			return err
		}
		if memberCount > 0 {
			return ErrDepartmentNotEmpty
		}

		return tx.Where("tenant_id = ?", tenantID).
			Where("id = ?", id).
			Delete(&entity.Department{}).Error
	})
}

// MemberCounts returns member counts per department for one tenant.
func (dao *DepartmentDAO) MemberCounts(ctx context.Context, db *gorm.DB, tenantID string) (map[string]int64, error) {
	type row struct {
		DepartmentID string `gorm:"column:department_id"`
		Total        int64  `gorm:"column:total"`
	}
	rows := make([]row, 0)
	err := db.WithContext(ctx).
		Model(&entity.User{}).
		Select("department_id, COUNT(*) AS total").
		Where("department_id <> ''").
		Where("department_id IN (SELECT id FROM department WHERE tenant_id = ?)", tenantID).
		Group("department_id").
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	counts := make(map[string]int64, len(rows))
	for _, r := range rows {
		counts[r.DepartmentID] = r.Total
	}
	return counts, nil
}
