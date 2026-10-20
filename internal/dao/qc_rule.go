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

// QcRuleDAO quality-inspection rule data access object.
type QcRuleDAO struct{}

// NewQcRuleDAO create QC rule DAO.
func NewQcRuleDAO() *QcRuleDAO {
	return &QcRuleDAO{}
}

// QcRuleListFilter holds the list query filters for QC rules.
type QcRuleListFilter struct {
	AppType  string
	AppID    string
	Keyword  string
	Scope    string
	Severity string
	Enabled  *bool
}

// Create inserts a QC rule.
func (dao *QcRuleDAO) Create(ctx context.Context, db *gorm.DB, rule *entity.QcRule) error {
	return db.WithContext(ctx).Create(rule).Error
}

// GetByID fetches a QC rule by ID.
func (dao *QcRuleDAO) GetByID(ctx context.Context, db *gorm.DB, id string) (*entity.QcRule, error) {
	var rule entity.QcRule
	err := db.WithContext(ctx).Take(&rule, "id = ?", id).Error
	if err != nil {
		return nil, err
	}
	return &rule, nil
}

// UpdateByID updates a QC rule by ID with the given column map.
func (dao *QcRuleDAO) UpdateByID(ctx context.Context, db *gorm.DB, id string, updates map[string]interface{}) error {
	if updates == nil {
		updates = make(map[string]interface{})
	}
	updates["update_time"] = time.Now().Local().UnixMilli()
	result := db.WithContext(ctx).Session(&gorm.Session{SkipHooks: true}).
		Model(&entity.QcRule{}).Where("id = ?", id).Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		var count int64
		if err := db.WithContext(ctx).Model(&entity.QcRule{}).Where("id = ?", id).Count(&count).Error; err != nil {
			return err
		}
		if count == 0 {
			return gorm.ErrRecordNotFound
		}
	}
	return nil
}

// DeleteByID deletes a QC rule by ID.
func (dao *QcRuleDAO) DeleteByID(ctx context.Context, db *gorm.DB, id string) error {
	result := db.WithContext(ctx).Where("id = ?", id).Delete(&entity.QcRule{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// List lists QC rules with filters and pagination.
func (dao *QcRuleDAO) List(ctx context.Context, db *gorm.DB, filter QcRuleListFilter, offset, limit int) ([]entity.QcRule, int64, error) {
	query := db.WithContext(ctx).Model(&entity.QcRule{})
	if filter.AppType != "" {
		query = query.Where("app_type = ?", filter.AppType)
	}
	if filter.AppID != "" {
		query = query.Where("app_id = ?", filter.AppID)
	}
	if filter.Keyword != "" {
		like := "%" + filter.Keyword + "%"
		query = query.Where("name LIKE ? OR JSON_SEARCH(keywords, 'one', ?) IS NOT NULL", like, filter.Keyword)
	}
	if filter.Scope != "" {
		query = query.Where("scope = ?", filter.Scope)
	}
	if filter.Severity != "" {
		query = query.Where("severity = ?", filter.Severity)
	}
	if filter.Enabled != nil {
		query = query.Where("enabled = ?", *filter.Enabled)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rules []entity.QcRule
	if err := query.Order("create_time DESC").Offset(offset).Limit(limit).Find(&rules).Error; err != nil {
		return nil, 0, err
	}
	return rules, total, nil
}

// ListEnabledByApp loads all enabled rules bound to an app, used at the start
// of a session to compile the matcher once.
func (dao *QcRuleDAO) ListEnabledByApp(ctx context.Context, db *gorm.DB, appType, appID string) ([]entity.QcRule, error) {
	var rules []entity.QcRule
	err := db.WithContext(ctx).
		Where("app_type = ? AND app_id = ? AND enabled = ?", appType, appID, true).
		Order("create_time ASC").
		Find(&rules).Error
	if err != nil {
		return nil, err
	}
	return rules, nil
}

// CountByTenant counts all rules (enabled + disabled) of a tenant.
func (dao *QcRuleDAO) CountByTenant(ctx context.Context, db *gorm.DB, tenantID string) (int64, error) {
	var count int64
	err := db.WithContext(ctx).Model(&entity.QcRule{}).Where("tenant_id = ?", tenantID).Count(&count).Error
	return count, err
}

// ExistsNameInApp checks whether a rule name is already taken within one app.
func (dao *QcRuleDAO) ExistsNameInApp(ctx context.Context, db *gorm.DB, appType, appID, name, excludeID string) (bool, error) {
	var count int64
	query := db.WithContext(ctx).Model(&entity.QcRule{}).
		Where("app_type = ? AND app_id = ? AND LOWER(name) = LOWER(?)", appType, appID, name)
	if excludeID != "" {
		query = query.Where("id <> ?", excludeID)
	}
	err := query.Count(&count).Error
	return count > 0, err
}
