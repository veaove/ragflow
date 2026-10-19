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
	"errors"
	"fmt"

	"ragflow/internal/agent/canvas"
	"ragflow/internal/dao"
	"ragflow/internal/entity"
)

// ErrAppModeMismatch is returned when a canvas is invoked through the wrong
// form-factor API (e.g. a workflow run against a chatflow canvas).
var ErrAppModeMismatch = errors.New("app mode mismatch")

// ErrResponseModeNotSupported is returned for async in V1.0 (async is V1.1).
var ErrResponseModeNotSupported = errors.New("response_mode not supported")

// AppRunRequest is the public Workflow/Chatflow run request.
type AppRunRequest struct {
	Inputs         map[string]any `json:"inputs"`
	Query          string         `json:"query"`
	ConversationID string         `json:"conversation_id"`
	Stream         bool           `json:"stream"`
	ResponseMode   string         `json:"response_mode"` // blocking | streaming
	MaxDurationMS  int            `json:"max_duration_ms"`
	IdempotencyKey string         `json:"-"`
	APIKeyID       string         `json:"-"`
}

// RunAgentAsApp runs a published canvas through the public API, bypassing the
// user-session permission chain (P0-1 / D6). It validates the API key against
// the canvas, loads the canvas directly (no CheckCanvasPermission), and runs
// with the canvas owner's identity as the runtime tenant.
//
// V1.0 supports blocking + streaming only; async returns ErrResponseModeNotSupported.
func (s *AgentService) RunAgentAsApp(ctx context.Context, canvasID, plainKey string, req AppRunRequest) (<-chan canvas.RunEvent, error) {
	// 1. Validate the key → canvas binding (active + ownership).
	key, err := NewAppKeyService().ResolveKey(ctx, plainKey, canvasID)
	if err != nil {
		return nil, err
	}
	req.APIKeyID = key.ID

	// 2. Load the canvas directly — NOT loadCanvasForUser (which would run
	// CheckCanvasPermission against a caller that has no user session).
	canvasRow, err := s.canvasDAO.GetByID(ctx, dao.DB, canvasID)
	if err != nil {
		if errors.Is(err, dao.ErrUserCanvasNotFound) {
			return nil, dao.ErrUserCanvasNotFound
		}
		return nil, err
	}

	// 3. Async is V1.1 — reject it loudly rather than faking it.
	if req.ResponseMode == "async" {
		return nil, ErrResponseModeNotSupported
	}

	// 4. Idempotency: same key + same canvas returns the first run (D8).
	if req.IdempotencyKey != "" && s.agentRunDAO != nil && dao.DB != nil {
		if existing, err := s.agentRunDAO.GetByIdempotencyKey(ctx, dao.DB, canvasID, req.IdempotencyKey); err == nil && existing != nil {
			return s.replayRun(ctx, existing)
		}
	}

	// 5. Run with the canvas owner's identity (canvasRow.UserID) as the runtime
	// tenant; RunAgent's loadCanvasForUser then passes for the owner.
	ownerUserID := canvasRow.UserID
	sessionID := req.ConversationID
	var userInput any = req.Query
	files := []map[string]interface{}{}

	// Workflow inputs are injected via user_input; a structured body is passed
	// through as the Begin node reads sys.query / inputs.
	if len(req.Inputs) > 0 && req.Query == "" {
		userInput = req.Inputs
	}

	return s.RunAgent(ctx, ownerUserID, canvasID, sessionID, "", userInput, files)
}

// replayRun synthesizes a terminal event stream for an already-completed run
// (idempotent replay), so a duplicate call returns the first run_id without
// re-executing.
func (s *AgentService) replayRun(ctx context.Context, run *entity.AgentRun) (<-chan canvas.RunEvent, error) {
	ch := make(chan canvas.RunEvent, 2)
	go func() {
		defer close(ch)
		select {
		case ch <- canvas.RunEvent{Type: "workflow_started", Data: fmt.Sprintf(`{"run_id":%q}`, run.ID)}:
		case <-ctx.Done():
		}
		select {
		case ch <- canvas.RunEvent{Type: "workflow_finished", Data: fmt.Sprintf(`{"run_id":%q,"status":%q}`, run.ID, run.Status)}:
		case <-ctx.Done():
		}
	}()
	return ch, nil
}
