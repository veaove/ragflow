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

// AgentRunListFilter carries the optional filters of the run-log list.
// A zero value means "no filter on this dimension".
type AgentRunListFilter struct {
	// CanvasID restricts the result to one canvas (exact match).
	CanvasID string
	// Status filters on the terminal status (exact match).
	Status string
	// TriggerType filters on how the run was started (exact match).
	TriggerType string
	// Keywords matches the run id or the canvas title (case-insensitive).
	Keywords string
	// Sort is one of the keys in agentRunSortableOrders; unknown values fall
	// back to the default (most recent first).
	Sort string
}

// agentRunSortableOrders is the closed allowlist of sort keys for the run
// log. The run-log page offers exactly these four (product doc 3.4):
// most recent start, longest duration, shortest duration, most tokens.
//
// The map values are pre-validated SQL fragments — the key never reaches the
// database unvalidated, so there is no injection surface.
var agentRunSortableOrders = map[string]string{
	"created_desc":   "agent_run.create_time DESC",
	"duration_desc":  "agent_run.duration_ms DESC",
	"duration_asc":   "agent_run.duration_ms ASC",
	"tokens_desc":    "(agent_run.prompt_tokens + agent_run.completion_tokens) DESC",
}

// ListWithFilter returns the run records matching filter, plus the total
// number of matching rows (the count is computed before pagination so the
// pager can render "1 / 12").
//
// Unlike List, the canvas filter is optional: the run-log page lists runs
// across every application, and narrows down only when the user picks one.
func (dao *AgentRunDAO) ListWithFilter(ctx context.Context, db *gorm.DB, filter AgentRunListFilter, limit, offset int) ([]*entity.AgentRun, int64, error) {
	runs := make([]*entity.AgentRun, 0)

	q := db.WithContext(ctx).Model(&entity.AgentRun{})
	if filter.CanvasID != "" {
		q = q.Where("agent_run.canvas_id = ?", filter.CanvasID)
	}
	if filter.Status != "" {
		q = q.Where("agent_run.status = ?", filter.Status)
	}
	if filter.TriggerType != "" {
		q = q.Where("agent_run.trigger_type = ?", filter.TriggerType)
	}
	if kw := strings.TrimSpace(filter.Keywords); kw != "" {
		// Match either the run id or the owning application's title, so a
		// user can paste a run id or type an app name (product doc 3.4).
		like := "%" + kw + "%"
		q = q.Where(
			"agent_run.id LIKE ? OR agent_run.canvas_id IN (SELECT id FROM user_canvas WHERE title LIKE ?)",
			like, like,
		)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	order, ok := agentRunSortableOrders[filter.Sort]
	if !ok {
		order = agentRunSortableOrders["created_desc"]
	}
	if limit <= 0 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	if err := q.Order(order).Limit(limit).Offset(offset).Find(&runs).Error; err != nil {
		return nil, 0, err
	}
	return runs, total, nil
}
