package dao

import (
	"context"

	"gorm.io/gorm"

	"ragflow/internal/common"
	"ragflow/internal/entity"
)

// ResourceGrantDAO reads and writes visibility rules for any resource family.
type ResourceGrantDAO struct{}

func NewResourceGrantDAO() *ResourceGrantDAO {
	return &ResourceGrantDAO{}
}

// ListByResource returns the grants of one resource.
func (dao *ResourceGrantDAO) ListByResource(ctx context.Context, db *gorm.DB, tenantID, kind, resourceID string) ([]*entity.ResourceGrant, error) {
	rows := make([]*entity.ResourceGrant, 0)
	err := db.WithContext(ctx).
		Where("tenant_id = ?", tenantID).
		Where("resource_kind = ?", kind).
		Where("resource_id = ?", resourceID).
		Find(&rows).Error
	return rows, err
}

// ListByResources batches the lookup for a page of resources.
func (dao *ResourceGrantDAO) ListByResources(ctx context.Context, db *gorm.DB, tenantID, kind string, resourceIDs []string) (map[string][]*entity.ResourceGrant, error) {
	out := make(map[string][]*entity.ResourceGrant, len(resourceIDs))
	if len(resourceIDs) == 0 {
		return out, nil
	}
	rows := make([]*entity.ResourceGrant, 0)
	err := db.WithContext(ctx).
		Where("tenant_id = ?", tenantID).
		Where("resource_kind = ?", kind).
		Where("resource_id IN ?", resourceIDs).
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		out[row.ResourceID] = append(out[row.ResourceID], row)
	}
	return out, nil
}

// Replace swaps a resource's whole rule set.
//
// Full replace rather than diff: the console's save button means "this list is
// the truth", and a partial update makes "removed an entry" indistinguishable
// from "never sent it".
func (dao *ResourceGrantDAO) Replace(ctx context.Context, db *gorm.DB, tenantID, kind, resourceID string, rows []*entity.ResourceGrant) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("tenant_id = ?", tenantID).
			Where("resource_kind = ?", kind).
			Where("resource_id = ?", resourceID).
			Delete(&entity.ResourceGrant{}).Error; err != nil {
			return err
		}
		if len(rows) == 0 {
			return nil
		}
		for _, row := range rows {
			row.ID = common.GenerateUUID()
			row.TenantID = tenantID
			row.ResourceKind = kind
			row.ResourceID = resourceID
		}
		return tx.Create(&rows).Error
	})
}

// DeleteBySubject drops every grant held by a department or user, called when
// the subject itself is deleted so no rule outlives its owner.
func (dao *ResourceGrantDAO) DeleteBySubject(ctx context.Context, db *gorm.DB, tenantID, subjectKind, subjectID string) error {
	return db.WithContext(ctx).
		Where("tenant_id = ?", tenantID).
		Where("subject_kind = ?", subjectKind).
		Where("subject_id = ?", subjectID).
		Delete(&entity.ResourceGrant{}).Error
}
