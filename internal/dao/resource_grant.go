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

// ListByTenant returns every rule of one tenant.
//
// 控制台的资源授权页要一次画出整棵树（哪些子项有例外、每层有几个主体），
// 逐节点查询会变成 N 次往返。规则表只存「例外」，量级远小于资源表，整表
// 取回后在内存里归并反而是最省的。
func (dao *ResourceGrantDAO) ListByTenant(ctx context.Context, db *gorm.DB, tenantID string) ([]*entity.ResourceGrant, error) {
	rows := make([]*entity.ResourceGrant, 0)
	err := db.WithContext(ctx).
		Where("tenant_id = ?", tenantID).
		Find(&rows).Error
	return rows, err
}

// ListBySubject returns the rules held by one subject.
//
// 「按成员」视角回答的是「他能看到什么」，必须能反查：直接授予这个人的、
// 他所在部门的、以及全团队的三类来源要分开返回，否则「我没给过他为什么他
// 能看」这类问题永远查不出来。
func (dao *ResourceGrantDAO) ListBySubject(ctx context.Context, db *gorm.DB, tenantID, subjectKind, subjectID string) ([]*entity.ResourceGrant, error) {
	rows := make([]*entity.ResourceGrant, 0)
	q := db.WithContext(ctx).
		Where("tenant_id = ?", tenantID).
		Where("subject_kind = ?", subjectKind)
	// 团队授权不记 subject_id（就是「本租户全体成员」），带 id 会查不到。
	if subjectKind != entity.GrantSubjectTeam {
		q = q.Where("subject_id = ?", subjectID)
	}
	err := q.Find(&rows).Error
	return rows, err
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
