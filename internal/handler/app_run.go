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
	"encoding/json"
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

	events, runID, err := h.agentService.RunAgentAsApp(c.Request.Context(), canvasID, key, body)
	if err != nil {
		respondAppRunError(c, err)
		return
	}

	if body.ResponseMode == "streaming" {
		streamAppEvents(c, events)
		return
	}
	// blocking: collect events and return the final payload.
	collectBlocking(c, events, runID)
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

	events, _, err := h.agentService.RunAgentAsApp(c.Request.Context(), canvasID, key, body)
	if err != nil {
		respondAppRunError(c, err)
		return
	}
	streamAppEvents(c, events)
}

// DebugRun handles POST /apps/:canvas_id/debug-run — 编辑器内「试运行」。
// 与 RunWorkflow 的区别：那个走应用密钥（app key），这个是编辑器内以当前
// 登录用户身份预览运行，无需先发布/创建密钥。
func (h *AppRunHandler) DebugRun(c *gin.Context) {
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	canvasID := c.Param("canvas_id")
	var body service.AppRunRequest
	_ = c.ShouldBindJSON(&body)
	if body.ResponseMode == "" {
		body.ResponseMode = "blocking"
	}

	events, runID, err := h.agentService.RunCanvasDebug(c.Request.Context(), user.ID, canvasID, body)
	if err != nil {
		respondAppRunError(c, err)
		return
	}
	collectBlocking(c, events, runID)
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

// collectBlocking drains events and returns a single JSON payload.
//
// The Workflow response body is the End node's declared output map, not the
// Agent-style assistant text: a workflow ends in an explicit `End` node whose
// `outputs` define the API contract (FR-03-01). The End node's outputs are
// carried by its `node_finished` event, so they are collected from there.
func collectBlocking(c *gin.Context, events <-chan canvas.RunEvent, runID string) {
	status := "succeeded"
	var outputs any
	var usage any
	var errMessage string

	for ev := range events {
		switch ev.Type {
		case "node_finished":
			var data canvas.NodeFinishedData
			if err := json.Unmarshal([]byte(ev.Data), &data); err == nil {
				if data.ComponentName == "End" && data.Outputs != nil {
					outputs = data.Outputs
				}
			}
		case "workflow_finished":
			var data map[string]any
			if err := json.Unmarshal([]byte(ev.Data), &data); err == nil {
				if u, ok := data["usage"]; ok {
					usage = u
				}
				// Fall back to the runner's outputs when no End node reported
				// (agent-style canvases driven through the same endpoint).
				if outputs == nil {
					if o, ok := data["outputs"]; ok {
						outputs = o
					}
				}
			}
		case "error":
			status = "failed"
			var data map[string]any
			if err := json.Unmarshal([]byte(ev.Data), &data); err == nil {
				if m, ok := data["message"].(string); ok {
					errMessage = m
				}
			}
		}
	}

	payload := gin.H{
		"run_id": runID,
		"status": status,
	}
	if outputs != nil {
		payload["outputs"] = outputs
	}
	if usage != nil {
		payload["usage"] = usage
	}
	if errMessage != "" {
		payload["error"] = errMessage
	}
	common.SuccessWithData(c, payload, "success")
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
