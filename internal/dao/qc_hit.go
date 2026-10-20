//
//  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
//
//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.
//

package dao

import (
	"context"
	"time"

	"gorm.io/gorm"

	"ragflow/internal/entity"
)

// QcHitDAO quality-inspection hit record data access object.
type QcHitDAO struct{}

// NewQcHitDAO create QC hit DAO.
func NewQcHitDAO() *QcHitDAO {
	return &QcHitDAO{}
}

// QcHitListFilter holds the list query filters for QC hits.
type QcHitListFilter struct {
	TenantID  string
	From      int64 // inclusive, unix millis
	To        int64 // inclusive, unix millis
	RuleID    string
	Scope     string
	Severity  string
	SessionID string
	AppType   string
	AppID     string
}

// Create inserts a QC hit record.
func (dao *QcHitDAO) Create(ctx context.Context, db *gorm.DB, hit *entity.QcHit) error {
	return db.WithContext(ctx).Create(hit).Error
}

// GetByID fetches a QC hit record by ID.
func (dao *QcHitDAO) GetByID(ctx context.Context, db *gorm.DB, id string) (*entity.QcHit, error) {
	var hit entity.QcHit
	err := db.WithContext(ctx).Take(&hit, "id = ?", id).Error
	if err != nil {
		return nil, err
	}
	return &hit, nil
}

// List lists QC hit records with filters and pagination.
func (dao *QcHitDAO) List(ctx context.Context, db *gorm.DB, filter QcHitListFilter, offset, limit int) ([]entity.QcHit, int64, error) {
	query := db.WithContext(ctx).Model(&entity.QcHit{})
	if filter.TenantID != "" {
		query = query.Where("tenant_id = ?", filter.TenantID)
	}
	if filter.From > 0 {
		query = query.Where("create_time >= ?", filter.From)
	}
	if filter.To > 0 {
		query = query.Where("create_time <= ?", filter.To)
	}
	if filter.RuleID != "" {
		query = query.Where("rule_id = ?", filter.RuleID)
	}
	if filter.Scope != "" {
		query = query.Where("scope = ?", filter.Scope)
	}
	if filter.Severity != "" {
		query = query.Where("severity = ?", filter.Severity)
	}
	if filter.SessionID != "" {
		query = query.Where("session_id = ?", filter.SessionID)
	}
	if filter.AppType != "" {
		query = query.Where("app_type = ?", filter.AppType)
	}
	if filter.AppID != "" {
		query = query.Where("app_id = ?", filter.AppID)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var hits []entity.QcHit
	if err := query.Order("create_time DESC").Offset(offset).Limit(limit).Find(&hits).Error; err != nil {
		return nil, 0, err
	}
	return hits, total, nil
}

// ListAll lists all QC hit records matching the filter (no pagination),
// used by the CSV export path.
func (dao *QcHitDAO) ListAll(ctx context.Context, db *gorm.DB, filter QcHitListFilter) ([]entity.QcHit, error) {
	query := db.WithContext(ctx).Model(&entity.QcHit{})
	if filter.TenantID != "" {
		query = query.Where("tenant_id = ?", filter.TenantID)
	}
	if filter.From > 0 {
		query = query.Where("create_time >= ?", filter.From)
	}
	if filter.To > 0 {
		query = query.Where("create_time <= ?", filter.To)
	}
	if filter.RuleID != "" {
		query = query.Where("rule_id = ?", filter.RuleID)
	}
	if filter.Scope != "" {
		query = query.Where("scope = ?", filter.Scope)
	}
	if filter.Severity != "" {
		query = query.Where("severity = ?", filter.Severity)
	}
	if filter.SessionID != "" {
		query = query.Where("session_id = ?", filter.SessionID)
	}
	if filter.AppType != "" {
		query = query.Where("app_type = ?", filter.AppType)
	}
	if filter.AppID != "" {
		query = query.Where("app_id = ?", filter.AppID)
	}
	var hits []entity.QcHit
	if err := query.Order("create_time DESC").Find(&hits).Error; err != nil {
		return nil, err
	}
	return hits, nil
}

// DeleteBefore removes records older than the given unix-millis timestamp
// (retention cleanup).
func (dao *QcHitDAO) DeleteBefore(ctx context.Context, db *gorm.DB, tenantID string, beforeMs int64) (int64, error) {
	result := db.WithContext(ctx).
		Where("tenant_id = ? AND create_time < ?", tenantID, beforeMs).
		Delete(&entity.QcHit{})
	if result.Error != nil {
		return 0, result.Error
	}
	return result.RowsAffected, nil
}

// retentionThreshold returns the unix-millis boundary for the retention window.
func retentionThreshold(days int) int64 {
	return time.Now().AddDate(0, 0, -days).UnixMilli()
}
