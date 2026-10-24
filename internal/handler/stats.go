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
	"time"

	"ragflow/internal/common"
	"ragflow/internal/service"

	"github.com/gin-gonic/gin"
)

type StatsHandler struct {
	statsService *service.StatsService
}

// NewStatsHandler create stats handler
func NewStatsHandler(statsService *service.StatsService) *StatsHandler {
	return &StatsHandler{
		statsService: statsService,
	}
}

// GetStats returns API conversation statistics for the current user's tenant.
// GetFeedbackStats GET /api/v1/system/feedback-stats
// @Summary 网页对话的点赞 / 点踩计数
// @Description 总览看板「交互满意度」卡片的数据源。只统计网页端对话
//
//	(conversation_message)，与 API 调用的统计分开。
func (h *StatsHandler) GetFeedbackStats(c *gin.Context) {
	user, errorCode, errorMessage := GetUser(c)
	if errorCode != common.CodeSuccess {
		common.ErrorWithCode(c, errorCode, errorMessage)
		return
	}
	stats, err := h.statsService.GetFeedbackStats(c.Request.Context(), user.ID)
	if err != nil {
		common.ResponseWithCodeData(c, common.CodeServerError, nil, err.Error())
		return
	}
	common.SuccessWithData(c, stats, "success")
}

// GetUserActivity GET /api/v1/system/user-activity
// @Summary 租户用户活跃度
// @Description 总览看板「用户活跃度」卡片的数据源：租户总用户数 + 近 N 日活跃用户数。
//
//	活跃 = 窗口内登录过，或在本租户发起过会话（两者取并集）。
func (h *StatsHandler) GetUserActivity(c *gin.Context) {
	user, errorCode, errorMessage := GetUser(c)
	if errorCode != common.CodeSuccess {
		common.ErrorWithCode(c, errorCode, errorMessage)
		return
	}
	days := 0
	if v := c.Query("days"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			days = n
		}
	}
	stats, err := h.statsService.GetUserActivity(c.Request.Context(), user.ID, days)
	if err != nil {
		common.ResponseWithCodeData(c, common.CodeServerError, nil, err.Error())
		return
	}
	common.SuccessWithData(c, stats, "success")
}

// GetHotQuestions GET /api/v1/system/hot-questions
// @Summary 知识搜索首页的热门问题
// @Description 取真实聊天记录里出现次数最多的用户提问，过滤寒暄短句。
func (h *StatsHandler) GetHotQuestions(c *gin.Context) {
	user, errorCode, errorMessage := GetUser(c)
	if errorCode != common.CodeSuccess {
		common.ErrorWithCode(c, errorCode, errorMessage)
		return
	}
	limit := 4
	if v := c.Query("size"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = n
		}
	}
	questions, err := h.statsService.HotQuestions(c.Request.Context(), user.ID, limit)
	if err != nil {
		common.ResponseWithCodeData(c, common.CodeServerError, nil, err.Error())
		return
	}
	common.SuccessWithData(c, questions, "success")
}

func (h *StatsHandler) GetStats(c *gin.Context) {
	user, errorCode, errorMessage := GetUser(c)
	if errorCode != common.CodeSuccess {
		common.ErrorWithCode(c, errorCode, errorMessage)
		return
	}

	now := time.Now()
	fromDate := c.DefaultQuery("from_date", now.AddDate(0, 0, -7).Format("2006-01-02 00:00:00"))
	toDate := c.DefaultQuery("to_date", now.Format("2006-01-02 15:04:05"))
	if len(toDate) == 10 {
		toDate += " 23:59:59"
	}

	var source *string
	if _, ok := c.GetQuery("canvas_id"); ok {
		agentSource := "agent"
		source = &agentSource
	}
	ctx := c.Request.Context()

	// Get stats
	stats, err := h.statsService.GetStats(ctx, user.ID, fromDate, toDate, source)
	if err != nil {
		code := common.CodeExceptionError
		if errors.Is(err, service.ErrTenantNotFound) {
			code = common.CodeDataError
		}
		common.ErrorWithCode(c, code, err.Error())
		return
	}

	common.SuccessWithData(c, stats, "success")
}
