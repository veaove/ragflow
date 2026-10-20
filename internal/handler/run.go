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
	"strconv"

	"github.com/gin-gonic/gin"

	"ragflow/internal/common"
	"ragflow/internal/dao"
	"ragflow/internal/service"

	"gorm.io/gorm"
)

// RunHandler serves run list / detail / node-execution queries (LOG-01/02/03).
type RunHandler struct {
	agentService *service.AgentService
}

func NewRunHandler() *RunHandler {
	return &RunHandler{agentService: service.NewAgentService()}
}

// ListRuns handles GET /runs?canvas_id=&status=&from=&to=.
func (h *RunHandler) ListRuns(c *gin.Context) {
	_, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	filter := dao.AgentRunListFilter{
		CanvasID:    c.Query("canvas_id"),
		Status:      c.Query("status"),
		TriggerType: c.Query("trigger_type"),
		Keywords:    c.Query("keywords"),
		Sort:        c.Query("sort"),
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if size < 1 {
		size = 20
	}
	offset := (page - 1) * size
	runs, total, err := dao.NewAgentRunDAO().ListWithFilter(c.Request.Context(), dao.DB, filter, size, offset)
	if err != nil {
		common.ResponseWithCodeData(c, common.CodeServerError, nil, err.Error())
		return
	}
	common.SuccessWithData(c, gin.H{
		"runs":  runs,
		"total": total,
	}, "success")
}

// GetRun handles GET /runs/:run_id.
func (h *RunHandler) GetRun(c *gin.Context) {
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	run, err := dao.NewAgentRunDAO().Get(c.Request.Context(), dao.DB, user.ID, c.Param("run_id"))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			common.ResponseWithCodeData(c, common.CodeDataError, nil, "RUN_NOT_FOUND")
			return
		}
		common.ResponseWithCodeData(c, common.CodeServerError, nil, err.Error())
		return
	}
	common.SuccessWithData(c, run, "success")
}

// ListRunNodes handles GET /runs/:run_id/nodes.
func (h *RunHandler) ListRunNodes(c *gin.Context) {
	_, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	nodes, err := dao.NewAgentRunDAO().ListNodes(c.Request.Context(), dao.DB, c.Param("run_id"))
	if err != nil {
		common.ResponseWithCodeData(c, common.CodeServerError, nil, err.Error())
		return
	}
	common.SuccessWithData(c, nodes, "success")
}

// AuditHandler serves audit-log queries (GOV-04).
type AuditHandler struct{}

func NewAuditHandler() *AuditHandler { return &AuditHandler{} }

// ListAudits handles GET /audits?canvas_id=&action=&from=&to=.
func (h *AuditHandler) ListAudits(c *gin.Context) {
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	canvasID := c.Query("canvas_id")
	action := c.Query("action")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("page_size", "50"))
	if page < 1 {
		page = 1
	}
	if size < 1 {
		size = 50
	}
	logs, err := dao.NewAuditLogDAO().List(c.Request.Context(), dao.DB, user.ID, canvasID, action, size, (page-1)*size)
	if err != nil {
		common.ResponseWithCodeData(c, common.CodeServerError, nil, err.Error())
		return
	}
	common.SuccessWithData(c, logs, "success")
}
