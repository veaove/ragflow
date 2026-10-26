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
	// Same read-time enrichment as the list path, so the detail dialog shows
	// the session name instead of the bare ID.
	one := []entity.QcHit{hit}
	dao.fillSessionNames(ctx, db, one)
	return &one[0], nil
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
	dao.fillAppNames(ctx, db, hits)
	dao.fillSessionNames(ctx, db, hits)
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
	dao.fillAppNames(ctx, db, hits)
	dao.fillSessionNames(ctx, db, hits)
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

// fillAppNames resolves the display name of the app that produced each hit.
//
// The hit log stores only app_type + app_id, and the two chains resolve names
// from different tables (chat -> dialog, canvas -> user_canvas). Without this
// the hit list cannot tell an operator which app a record belongs to, which
// makes cross-app debugging guesswork.
func (dao *QcHitDAO) fillAppNames(ctx context.Context, db *gorm.DB, hits []entity.QcHit) {
	if len(hits) == 0 {
		return
	}
	chatIDs := make([]string, 0, len(hits))
	canvasIDs := make([]string, 0, len(hits))
	seenChat := map[string]bool{}
	seenCanvas := map[string]bool{}
	for _, h := range hits {
		if h.AppID == "" {
			continue
		}
		if h.AppType == "canvas" {
			if !seenCanvas[h.AppID] {
				seenCanvas[h.AppID] = true
				canvasIDs = append(canvasIDs, h.AppID)
			}
			continue
		}
		if !seenChat[h.AppID] {
			seenChat[h.AppID] = true
			chatIDs = append(chatIDs, h.AppID)
		}
	}

	type nameRow struct {
		ID   string
		Name string
	}
	names := map[string]string{}

	if len(chatIDs) > 0 {
		var rows []nameRow
		if err := db.WithContext(ctx).Table("dialog").
			Select("id, COALESCE(name, '') AS name").
			Where("id IN ?", chatIDs).Scan(&rows).Error; err == nil {
			for _, r := range rows {
				names[r.ID] = r.Name
			}
		}
	}
	if len(canvasIDs) > 0 {
		var rows []nameRow
		if err := db.WithContext(ctx).Table("user_canvas").
			Select("id, COALESCE(title, '') AS name").
			Where("id IN ?", canvasIDs).Scan(&rows).Error; err == nil {
			for _, r := range rows {
				names[r.ID] = r.Name
			}
		}
	}

	for i := range hits {
		hits[i].AppName = names[hits[i].AppID]
	}
}

// fillSessionNames resolves the display name of the conversation behind each
// hit.
//
// Hits only store session_id, and the two runtimes keep their sessions in
// different tables (chat -> conversation, canvas -> api_4_conversation), so
// both are queried. A name may legitimately be missing (session deleted, or
// never renamed); that leaves the field empty and the UI renders a dash, but
// the hit itself must still be listed.
func (dao *QcHitDAO) fillSessionNames(ctx context.Context, db *gorm.DB, hits []entity.QcHit) {
	if len(hits) == 0 {
		return
	}
	ids := make([]string, 0, len(hits))
	seen := map[string]bool{}
	for _, h := range hits {
		if h.SessionID == "" || seen[h.SessionID] {
			continue
		}
		seen[h.SessionID] = true
		ids = append(ids, h.SessionID)
	}
	if len(ids) == 0 {
		return
	}

	type nameRow struct {
		ID   string
		Name string
	}
	names := map[string]string{}
	for _, table := range []string{"conversation", "api_4_conversation"} {
		var rows []nameRow
		if err := db.WithContext(ctx).Table(table).
			Select("id, COALESCE(name, '') AS name").
			Where("id IN ?", ids).Scan(&rows).Error; err == nil {
			for _, r := range rows {
				if r.Name != "" {
					names[r.ID] = r.Name
				}
			}
		}
	}

	for i := range hits {
		hits[i].SessionName = names[hits[i].SessionID]
	}
}
