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
	"strings"
	"time"

	"ragflow/internal/common"
	"ragflow/internal/entity"

	"gorm.io/gorm"
)

// EnvironmentVariableDAO persists app-level read-only environment variables.
// version_seq=0 is the draft; >0 are immutable published snapshots.
type EnvironmentVariableDAO struct{}

func NewEnvironmentVariableDAO() *EnvironmentVariableDAO {
	return &EnvironmentVariableDAO{}
}

// LoadByCanvas returns the draft (version_seq=0) environment variables of a
// canvas keyed by name.
func (dao *EnvironmentVariableDAO) LoadByCanvas(ctx context.Context, db *gorm.DB, canvasID string) (map[string]*entity.EnvironmentVariable, error) {
	rows := make([]*entity.EnvironmentVariable, 0)
	if err := db.WithContext(ctx).Model(&entity.EnvironmentVariable{}).
		Where("canvas_id = ?", canvasID).
		Where("version_seq = 0").
		Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make(map[string]*entity.EnvironmentVariable, len(rows))
	for _, r := range rows {
		out[r.Name] = r
	}
	return out, nil
}

// Upsert writes a draft environment variable (insert or update).
func (dao *EnvironmentVariableDAO) Upsert(ctx context.Context, db *gorm.DB, canvasID, name, value, valueType string) error {
	now := time.Now().UnixMilli()
	row := &entity.EnvironmentVariable{
		ID:         common.GenerateUUID(),
		CanvasID:   canvasID,
		Name:       name,
		Value:      value,
		ValueType:  valueType,
		VersionSeq: 0,
		CreateTime: now,
		UpdateTime: now,
	}
	return db.WithContext(ctx).
		Where(entity.EnvironmentVariable{CanvasID: canvasID, Name: name, VersionSeq: 0}).
		Assign(map[string]any{"value": value, "value_type": valueType, "update_time": now}).
		FirstOrCreate(row).Error
}

// Delete removes a draft environment variable.
func (dao *EnvironmentVariableDAO) Delete(ctx context.Context, db *gorm.DB, canvasID, name string) error {
	return db.WithContext(ctx).
		Where("canvas_id = ?", canvasID).
		Where("name = ?", name).
		Where("version_seq = 0").
		Delete(&entity.EnvironmentVariable{}).Error
}

// SnapshotVersionTx copies the draft environment variables into a published
// version snapshot (version_seq = N), preserving immutability. It runs inside
// the caller's publish transaction.
func (dao *EnvironmentVariableDAO) SnapshotVersionTx(ctx context.Context, tx *gorm.DB, canvasID string, versionSeq int) error {
	if versionSeq <= 0 {
		return nil
	}
	drafts, err := dao.LoadByCanvas(ctx, tx, canvasID)
	if err != nil {
		return err
	}
	now := time.Now().UnixMilli()
	for _, d := range drafts {
		snap := &entity.EnvironmentVariable{
			ID:         common.GenerateUUID(),
			CanvasID:   canvasID,
			Name:       d.Name,
			Value:      d.Value,
			ValueType:  d.ValueType,
			VersionSeq: versionSeq,
			CreateTime: now,
			UpdateTime: now,
		}
		if err := tx.WithContext(ctx).Create(snap).Error; err != nil {
			return err
		}
	}
	return nil
}

// AppAPIKeyDAO persists per-app API keys. Only hashes are stored.
type AppAPIKeyDAO struct{}

func NewAppAPIKeyDAO() *AppAPIKeyDAO {
	return &AppAPIKeyDAO{}
}

// Create inserts a new key row.
func (dao *AppAPIKeyDAO) Create(ctx context.Context, db *gorm.DB, key *entity.AppAPIKey) error {
	return db.WithContext(ctx).Create(key).Error
}

// GetByHash returns a key by its SHA-256 hash.
func (dao *AppAPIKeyDAO) GetByHash(ctx context.Context, db *gorm.DB, keyHash string) (*entity.AppAPIKey, error) {
	var key entity.AppAPIKey
	if err := db.WithContext(ctx).
		Where("key_hash = ?", keyHash).
		Take(&key).Error; err != nil {
		return nil, err
	}
	return &key, nil
}

// ListByCanvas returns a canvas's keys (hash never exposed; prefix only).
func (dao *AppAPIKeyDAO) ListByCanvas(ctx context.Context, db *gorm.DB, canvasID string) ([]*entity.AppAPIKey, error) {
	keys := make([]*entity.AppAPIKey, 0)
	err := db.WithContext(ctx).Model(&entity.AppAPIKey{}).
		Where("canvas_id = ?", canvasID).
		Order("create_time DESC").
		Find(&keys).Error
	return keys, err
}

// Disable flips a key to disabled.
func (dao *AppAPIKeyDAO) Disable(ctx context.Context, db *gorm.DB, canvasID, keyID string) error {
	return db.WithContext(ctx).Model(&entity.AppAPIKey{}).
		Where("id = ?", keyID).
		Where("canvas_id = ?", canvasID).
		Update("status", "disabled").Error
}

// AuditLogDAO persists the ≥180-day audit trail.
type AuditLogDAO struct{}

func NewAuditLogDAO() *AuditLogDAO {
	return &AuditLogDAO{}
}

// Create inserts one audit entry.
func (dao *AuditLogDAO) Create(ctx context.Context, db *gorm.DB, log *entity.AuditLog) error {
	return db.WithContext(ctx).Create(log).Error
}

// List returns audit entries of a canvas (or all of a tenant), newest first.
func (dao *AuditLogDAO) List(ctx context.Context, db *gorm.DB, tenantID, canvasID, action string, limit, offset int) ([]*entity.AuditLog, error) {
	logs := make([]*entity.AuditLog, 0)
	q := db.WithContext(ctx).Model(&entity.AuditLog{}).Where("tenant_id = ?", tenantID)
	if canvasID != "" {
		q = q.Where("canvas_id = ?", canvasID)
	}
	if action != "" {
		q = q.Where("action = ?", action)
	}
	if limit <= 0 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	err := q.Order("create_time DESC").Limit(limit).Offset(offset).Find(&logs).Error
	return logs, err
}

// AuditFilter narrows a platform-wide audit query. Empty fields are ignored.
type AuditFilter struct {
	Keywords string // matches operator / tenant_name / path / action
	Module   string // object_type
	Result   string // success | failed
	// ActorIDs are operator / tenant ids that already matched Keywords on a name
	// lookup. Rows written by the agent service store raw user ids in operator
	// (see agent_version.go writeAudit), so a name search would never find them
	// without OR-ing the resolved ids in.
	ActorIDs []string
}

// ListPlatform returns audit entries across ALL tenants, newest first.
//
// Unlike List it has no tenant scope on purpose: the platform console needs one
// stream of every tenant's mutations. Callers must gate it behind superuser auth.
func (dao *AuditLogDAO) ListPlatform(ctx context.Context, db *gorm.DB, f AuditFilter, limit, offset int) ([]*entity.AuditLog, int64, error) {
	logs := make([]*entity.AuditLog, 0)
	q := db.WithContext(ctx).Model(&entity.AuditLog{})

	if kw := strings.TrimSpace(f.Keywords); kw != "" {
		like := "%" + kw + "%"
		cond := "operator LIKE ? OR tenant_name LIKE ? OR path LIKE ? OR action LIKE ?"
		args := []any{like, like, like, like}
		if len(f.ActorIDs) > 0 {
			cond += " OR operator IN ? OR tenant_id IN ?"
			args = append(args, f.ActorIDs, f.ActorIDs)
		}
		q = q.Where(cond, args...)
	}
	if f.Module != "" {
		q = q.Where("object_type = ?", f.Module)
	}
	if f.Result != "" {
		q = q.Where("result = ?", f.Result)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if limit <= 0 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	err := q.Order("create_time DESC").Limit(limit).Offset(offset).Find(&logs).Error
	return logs, total, err
}

// PurgeBefore deletes audit entries older than the given millis timestamp.
func (dao *AuditLogDAO) PurgeBefore(ctx context.Context, db *gorm.DB, beforeMillis int64) (int64, error) {
	res := db.WithContext(ctx).
		Where("create_time < ?", beforeMillis).
		Delete(&entity.AuditLog{})
	return res.RowsAffected, res.Error
}
