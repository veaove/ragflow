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

package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"ragflow/internal/agent/canvas"
	"ragflow/internal/common"
	"ragflow/internal/service"
)

// AppRunHandler serves the public Workflow / Chatflow run APIs and per-app
// API key management.
type AppRunHandler struct {
	agentService *service.AgentService
	keyService   *service.AppKeyService
}

func NewAppRunHandler() *AppRunHandler {
	return &AppRunHandler{
		agentService: service.NewAgentService(),
		keyService:   service.NewAppKeyService(),
	}
}

// bearerKey extracts the plaintext key from Authorization: Bearer <key>.
func bearerKey(c *gin.Context) string {
	h := c.GetHeader("Authorization")
	const prefix = "Bearer "
	if len(h) > len(prefix) && h[:len(prefix)] == prefix {
		return h[len(prefix):]
	}
	return ""
}

// RunWorkflow handles POST /workflows/:canvas_id/run (blocking + streaming).
func (h *AppRunHandler) RunWorkflow(c *gin.Context) {
	canvasID := c.Param("canvas_id")
	key := bearerKey(c)
	if key == "" {
		common.ResponseWithHttpCodeData(c, http.StatusUnauthorized, common.CodeUnauthorized, nil, "missing API key")
		return
	}
	var body service.AppRunRequest
	_ = c.ShouldBindJSON(&body)
	body.IdempotencyKey = c.GetHeader("Idempotency-Key")
	if body.ResponseMode == "" {
		body.ResponseMode = "blocking"
	}

	events, err := h.agentService.RunAgentAsApp(c.Request.Context(), canvasID, key, body)
	if err != nil {
		respondAppRunError(c, err)
		return
	}

	if body.ResponseMode == "streaming" {
		streamAppEvents(c, events)
		return
	}
	// blocking: collect events and return the final payload.
	collectBlocking(c, events)
}

// ChatFlow handles POST /chatflows/:canvas_id/chat (SSE).
func (h *AppRunHandler) ChatFlow(c *gin.Context) {
	canvasID := c.Param("canvas_id")
	key := bearerKey(c)
	if key == "" {
		common.ResponseWithHttpCodeData(c, http.StatusUnauthorized, common.CodeUnauthorized, nil, "missing API key")
		return
	}
	var body service.AppRunRequest
	_ = c.ShouldBindJSON(&body)
	body.IdempotencyKey = c.GetHeader("Idempotency-Key")
	body.ResponseMode = "streaming"

	events, err := h.agentService.RunAgentAsApp(c.Request.Context(), canvasID, key, body)
	if err != nil {
		respondAppRunError(c, err)
		return
	}
	streamAppEvents(c, events)
}

// ListKeys handles GET /apps/:canvas_id/api-keys.
func (h *AppRunHandler) ListKeys(c *gin.Context) {
	_, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	keys, err := h.keyService.ListKeys(c.Request.Context(), c.Param("canvas_id"))
	if err != nil {
		common.ResponseWithCodeData(c, common.CodeServerError, nil, err.Error())
		return
	}
	common.SuccessWithData(c, keys, "success")
}

// createKeyRequest is the body of a key creation.
type createKeyRequest struct {
	CanvasID string `json:"canvas_id"`
}

// CreateKey handles POST /apps/:canvas_id/api-keys.
func (h *AppRunHandler) CreateKey(c *gin.Context) {
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	// The owner of the canvas is the runtime tenant (D6).
	canvasID := c.Param("canvas_id")
	plaintext, _, err := h.keyService.CreateKey(c.Request.Context(), canvasID, user.ID, user.ID)
	if err != nil {
		common.ResponseWithCodeData(c, common.CodeServerError, nil, err.Error())
		return
	}
	// Plaintext is returned exactly once.
	common.SuccessWithData(c, gin.H{"key": plaintext}, "success")
}

// DisableKey handles POST /apps/:canvas_id/api-keys/:id/disable.
func (h *AppRunHandler) DisableKey(c *gin.Context) {
	_, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	if err := h.keyService.DisableKey(c.Request.Context(), c.Param("canvas_id"), c.Param("id")); err != nil {
		common.ResponseWithCodeData(c, common.CodeServerError, nil, err.Error())
		return
	}
	common.SuccessWithData(c, nil, "success")
}

// streamAppEvents forwards canvas events as SSE.
func streamAppEvents(c *gin.Context, events <-chan canvas.RunEvent) {
	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.WriteHeader(http.StatusOK)
	doneSent := false
	for ev := range events {
		if ev.Type == "done" {
			doneSent = true
		}
		if err := service.WriteChatbotRunEvent(c.Writer, ev); err != nil {
			return
		}
		c.Writer.Flush()
	}
	if !doneSent {
		_ = service.WriteChatbotRunEvent(c.Writer, canvas.RunEvent{Type: "done"})
	}
}

// collectBlocking drains events and returns a single JSON payload with the
// final workflow outputs.
func collectBlocking(c *gin.Context, events <-chan canvas.RunEvent) {
	var runID, status string
	var outputs any
	for ev := range events {
		switch ev.Type {
		case "workflow_started":
			// run_id is inside data JSON; best-effort parse skipped for MVP —
			// the client can still correlate via the streaming path.
			_ = ev
		case "workflow_finished":
			status = "succeeded"
			outputs = ev.Data
		case "error":
			status = "failed"
		}
	}
	if status == "" {
		status = "succeeded"
	}
	common.SuccessWithData(c, gin.H{
		"run_id":  runID,
		"status":  status,
		"outputs": outputs,
	}, "success")
}

// respondAppRunError maps public-API service errors to the HTTP status codes
// from the tech design's error table (11.8). These are external integration
// surfaces, so a standard HTTP status matters: a caller (or gateway) must be
// able to tell "unauthorized" from "bad request" without parsing the body.
// Internal endpoints keep the HTTP-200 + body-code convention of the api
// service; the public run APIs do not.
func respondAppRunError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrAppKeyForbidden):
		common.ResponseWithHttpCodeData(c, http.StatusUnauthorized, common.CodeUnauthorized, nil, "APP_KEY_INVALID")
	case errors.Is(err, service.ErrAppModeMismatch):
		common.ResponseWithHttpCodeData(c, http.StatusBadRequest, common.CodeArgumentError, nil, "APP_MODE_MISMATCH")
	case errors.Is(err, service.ErrResponseModeNotSupported):
		common.ResponseWithHttpCodeData(c, http.StatusBadRequest, common.CodeArgumentError, nil, "RESPONSE_MODE_NOT_SUPPORTED")
	default:
		common.ResponseWithHttpCodeData(c, http.StatusInternalServerError, common.CodeServerError, nil, err.Error())
	}
}
