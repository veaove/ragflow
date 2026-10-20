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

	"ragflow/internal/common"
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

// ListEnabledByApp loads all enabled rules that apply to an app: the rules
// whose home app is this one, plus every rule another app created but this app
// selected in its settings. Called once at the start of a session to compile
// the matcher.
func (dao *QcRuleDAO) ListEnabledByApp(ctx context.Context, db *gorm.DB, appType, appID string) ([]entity.QcRule, error) {
	var rules []entity.QcRule
	err := db.WithContext(ctx).
		Table("qc_rule AS r").
		Select("r.*").
		Joins(
			"LEFT JOIN qc_rule_binding AS b ON b.rule_id = r.id AND b.app_type = ? AND b.app_id = ?",
			appType, appID,
		).
		Where("r.enabled = ?", true).
		Where("(r.app_type = ? AND r.app_id = ?) OR b.id IS NOT NULL", appType, appID).
		Order("r.create_time ASC").
		Find(&rules).Error
	if err != nil {
		return nil, err
	}
	return rules, nil
}

// ListSelectable lists every rule the tenant could apply to an app, together
// with the ids currently in effect for that app (home rules + bound rules).
// This is what the "选用规则" selector renders.
func (dao *QcRuleDAO) ListSelectable(ctx context.Context, db *gorm.DB, tenantID, appType, appID string) ([]QcRuleSelection, error) {
	var rules []entity.QcRule
	if err := db.WithContext(ctx).
		Where("tenant_id = ?", tenantID).
		Order("create_time DESC").
		Find(&rules).Error; err != nil {
		return nil, err
	}

	bound := make(map[string]bool)
	var ruleIDs []string
	if err := db.WithContext(ctx).
		Model(&entity.QcRuleBinding{}).
		Where("tenant_id = ? AND app_type = ? AND app_id = ?", tenantID, appType, appID).
		Pluck("rule_id", &ruleIDs).Error; err != nil {
		return nil, err
	}
	for _, id := range ruleIDs {
		bound[id] = true
	}

	out := make([]QcRuleSelection, 0, len(rules))
	for _, r := range rules {
		home := r.AppType == appType && r.AppID == appID
		out = append(out, QcRuleSelection{
			QcRule: r,
			// Home rules always apply and cannot be deselected; a bound rule is
			// selected explicitly in this app's settings.
			Selected: home || bound[r.ID],
			Home:     home,
		})
	}
	return out, nil
}

// ReplaceBindings makes want the complete set of rules this app references from
// other apps. Home rules are never stored as bindings (they apply implicitly)
// and unknown/foreign rule ids are ignored, so a stale selection can't attach
// another tenant's rule.
func (dao *QcRuleDAO) ReplaceBindings(ctx context.Context, db *gorm.DB, tenantID, appType, appID string, want []string) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("tenant_id = ? AND app_type = ? AND app_id = ?", tenantID, appType, appID).
			Delete(&entity.QcRuleBinding{}).Error; err != nil {
			return err
		}
		if len(want) == 0 {
			return nil
		}

		var owned []entity.QcRule
		if err := tx.Where("tenant_id = ? AND id IN ?", tenantID, want).Find(&owned).Error; err != nil {
			return err
		}
		now := time.Now().Local().UnixMilli()
		for _, r := range owned {
			if r.AppType == appType && r.AppID == appID {
				continue // home rule: applies without a binding row
			}
			if err := tx.Create(&entity.QcRuleBinding{
				ID:         common.GenerateToken(),
				TenantID:   tenantID,
				RuleID:     r.ID,
				AppType:    appType,
				AppID:      appID,
				CreateTime: now,
			}).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// DeleteBindingsByRule drops every reference to a rule; called when the rule
// itself is deleted so no dangling bindings keep it "selected".
func (dao *QcRuleDAO) DeleteBindingsByRule(ctx context.Context, db *gorm.DB, ruleID string) error {
	return db.WithContext(ctx).Where("rule_id = ?", ruleID).Delete(&entity.QcRuleBinding{}).Error
}

// QcRuleSelection is one row of the app-level rule selector.
type QcRuleSelection struct {
	entity.QcRule
	// Selected reports whether the rule is in effect for the queried app.
	Selected bool `json:"selected"`
	// Home reports whether this app created the rule. Home rules always apply
	// and the selector must not let them be unchecked.
	Home bool `json:"home"`
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
