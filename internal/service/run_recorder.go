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

package service

import (
	"context"
	"encoding/json"
	"time"

	"ragflow/internal/agent/canvas"
	"ragflow/internal/common"
	"ragflow/internal/dao"
	"ragflow/internal/entity"
)

// RunRecorder consumes canvas.RunEvents and persists node-level execution
// traces plus the run terminal state (LOG-01/02/03). It is invoked from the
// event-forwarding goroutine so persistence never blocks SSE delivery; writes
// are best-effort (a recording outage must not fail the run itself).
type RunRecorder struct {
	runDAO *dao.AgentRunDAO
}

// NewRunRecorder builds a recorder backed by the shared DB.
func NewRunRecorder() *RunRecorder {
	return &RunRecorder{runDAO: dao.NewAgentRunDAO()}
}

// RecordRunStart creates the initial agent_run row (status=running).
func (r *RunRecorder) RecordRunStart(ctx context.Context, run *entity.AgentRun) error {
	if r.runDAO == nil || dao.DB == nil {
		return nil
	}
	return r.runDAO.Create(ctx, dao.DB, run)
}

// HandleEvent persists the subset of events that carry durable state:
// node_finished → agent_node_execution; workflow_finished/error → run terminal.
// All other events (node_started, message, message_end) are ignored here.
func (r *RunRecorder) HandleEvent(ctx context.Context, canvasID, tenantID, runID string, ev canvas.RunEvent) {
	if r.runDAO == nil || dao.DB == nil {
		return
	}
	switch ev.Type {
	case "node_finished":
		r.recordNodeFinished(ctx, canvasID, runID, ev)
	case "workflow_finished":
		_ = r.runDAO.UpdateStatus(ctx, dao.DB, runID, entity.RunStatusSucceeded, map[string]any{
			"duration_ms": elapsedMillis(ev.CreatedAt),
		})
	case "error":
		_ = r.runDAO.UpdateStatus(ctx, dao.DB, runID, entity.RunStatusFailed, map[string]any{
			"error_message": ev.Data,
		})
	}
}

func (r *RunRecorder) recordNodeFinished(ctx context.Context, canvasID, runID string, ev canvas.RunEvent) {
	var data canvas.NodeFinishedData
	if err := json.Unmarshal([]byte(ev.Data), &data); err != nil {
		return
	}
	node := &entity.AgentNodeExecution{
		ID:         common.GenerateUUID(),
		RunID:      runID,
		CanvasID:   canvasID,
		NodeID:     data.ComponentID,
		NodeType:   data.ComponentName,
		Status:     nodeStatusFromError(data.Error),
		Inputs:     toJSONMap(MaskPIIMap(data.Inputs)),
		Outputs:    toJSONMap(MaskPIIMap(data.Outputs)),
		DurationMS: int(data.ElapsedTime * 1000),
		CreateTime: time.Now().UnixMilli(),
	}
	if errStr, ok := data.Error.(string); ok && errStr != "" {
		node.ErrorMessage = MaskPII(errStr)
	}
	_ = r.runDAO.BatchCreateNodes(ctx, dao.DB, []*entity.AgentNodeExecution{node})
}

func nodeStatusFromError(err any) string {
	if err == nil {
		return entity.NodeStatusSucceeded
	}
	if s, ok := err.(string); ok && s != "" {
		return entity.NodeStatusFailed
	}
	return entity.NodeStatusSucceeded
}

func elapsedMillis(createdAt int64) int {
	// createdAt is Unix seconds (float seconds when parsed); a coarse duration
	// is acceptable for the terminal record.
	return int(time.Now().UnixNano()/1e6 - createdAt*1000)
}

func toJSONMap(v any) entity.JSONMap {
	if v == nil {
		return entity.JSONMap{}
	}
	if m, ok := v.(map[string]any); ok {
		return entity.JSONMap(m)
	}
	if m, ok := v.(entity.JSONMap); ok {
		return m
	}
	b, err := json.Marshal(v)
	if err != nil {
		return entity.JSONMap{"_raw": json.RawMessage(nil)}
	}
	var out map[string]any
	if err := json.Unmarshal(b, &out); err != nil {
		return entity.JSONMap{}
	}
	return entity.JSONMap(out)
}
