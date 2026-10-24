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

	"ragflow/internal/entity"

	"gorm.io/gorm"
)

// AgentRunDAO persists workflow/chatflow run records and their per-node
// execution traces. All tenant-scoped reads require the owner's tenant id so a
// cross-tenant guess is indistinguishable from a missing row.
type AgentRunDAO struct{}

func NewAgentRunDAO() *AgentRunDAO {
	return &AgentRunDAO{}
}

// Create inserts a new run. Callers supply the id and initial fields.
//
// An empty idempotency key is stored as NULL so the unique key
// (canvas_id, idempotency_key) does not collide across ordinary runs of the
// same canvas.
func (dao *AgentRunDAO) Create(ctx context.Context, db *gorm.DB, run *entity.AgentRun) error {
	if run.IdempotencyKey != nil && strings.TrimSpace(*run.IdempotencyKey) == "" {
		run.IdempotencyKey = nil
	}
	return db.WithContext(ctx).Create(run).Error
}

// GetByIdempotencyKey returns the run created for a given idempotency key, or
// gorm.ErrRecordNotFound. The unique index (canvas_id, idempotency_key) also
// guards against a concurrent duplicate insert at the DB level.
func (dao *AgentRunDAO) GetByIdempotencyKey(ctx context.Context, db *gorm.DB, canvasID, key string) (*entity.AgentRun, error) {
	var run entity.AgentRun
	if err := db.WithContext(ctx).
		Where("canvas_id = ?", canvasID).
		Where("idempotency_key = ?", key).
		Take(&run).Error; err != nil {
		return nil, err
	}
	return &run, nil
}

// Get returns one run by id, scoped to the tenant.
func (dao *AgentRunDAO) Get(ctx context.Context, db *gorm.DB, tenantID, runID string) (*entity.AgentRun, error) {
	var run entity.AgentRun
	// Join the owning canvas so the detail view can show its title. The WHERE
	// columns must be qualified: both tables have an `id`.
	if err := db.WithContext(ctx).
		// COALESCE keeps a deleted canvas from failing the scan with a NULL.
		Select("agent_run.*, COALESCE(user_canvas.title, '') AS canvas_title").
		Joins("LEFT JOIN user_canvas ON user_canvas.id = agent_run.canvas_id").
		Where("agent_run.tenant_id = ?", tenantID).
		Where("agent_run.id = ?", runID).
		Take(&run).Error; err != nil {
		return nil, err
	}
	return &run, nil
}

// UpdateStatus flips a run's terminal/transient status plus error fields.
func (dao *AgentRunDAO) UpdateStatus(ctx context.Context, db *gorm.DB, runID string, status string, updates map[string]any) error {
	u := map[string]any{"status": status}
	for k, v := range updates {
		u[k] = v
	}
	return db.WithContext(ctx).Model(&entity.AgentRun{}).
		Where("id = ?", runID).
		Updates(u).Error
}

// List returns runs of a canvas, newest first, optionally filtered by status.
func (dao *AgentRunDAO) List(ctx context.Context, db *gorm.DB, canvasID string, status string, limit, offset int) ([]*entity.AgentRun, error) {
	runs := make([]*entity.AgentRun, 0)
	q := db.WithContext(ctx).Model(&entity.AgentRun{}).Where("canvas_id = ?", canvasID)
	if status != "" {
		q = q.Where("status = ?", status)
	}
	if limit <= 0 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	err := q.Order("create_time DESC").Limit(limit).Offset(offset).Find(&runs).Error
	return runs, err
}

// BatchCreateNodes bulk-inserts per-node execution rows.
func (dao *AgentRunDAO) BatchCreateNodes(ctx context.Context, db *gorm.DB, nodes []*entity.AgentNodeExecution) error {
	if len(nodes) == 0 {
		return nil
	}
	return db.WithContext(ctx).CreateInBatches(&nodes, 100).Error
}

// ListNodes returns the node executions of a run, in creation order.
func (dao *AgentRunDAO) ListNodes(ctx context.Context, db *gorm.DB, runID string) ([]*entity.AgentNodeExecution, error) {
	nodes := make([]*entity.AgentNodeExecution, 0)
	err := db.WithContext(ctx).Model(&entity.AgentNodeExecution{}).
		Where("run_id = ?", runID).
		Order("create_time ASC").
		Find(&nodes).Error
	return nodes, err
}
