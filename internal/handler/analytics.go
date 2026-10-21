/*
 *  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

package handler

import (
	"encoding/csv"
	"fmt"
	"strconv"
	"time"

	"ragflow/internal/common"
	"ragflow/internal/service"

	"github.com/gin-gonic/gin"
)

// AnalyticsHandler serves the consultation log and report endpoints.
type AnalyticsHandler struct {
	service *service.AnalyticsService
}

// NewAnalyticsHandler builds the analytics handler.
func NewAnalyticsHandler() *AnalyticsHandler {
	return &AnalyticsHandler{service: service.NewAnalyticsService()}
}

func analyticsFilter(c *gin.Context) service.ConsultationFilter {
	from, to := service.DefaultRange(c.Query("from"), c.Query("to"))
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("size", "20"))
	return service.ConsultationFilter{
		From:       from,
		To:         to,
		AppID:      c.Query("app_id"),
		Rating:     c.Query("rating"),
		Keyword:    c.Query("keyword"),
		CustomerID: c.Query("customer_id"),
		Page:       page,
		Size:       size,
	}
}

// ListConsultations handles GET /analytics/consultations.
func (h *AnalyticsHandler) ListConsultations(c *gin.Context) {
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	filter := analyticsFilter(c)
	items, total, err := h.service.ListConsultations(c.Request.Context(), user.ID, filter)
	if err != nil {
		common.ErrorWithCode(c, common.CodeServerError, err.Error())
		return
	}
	common.SuccessWithDataAndTotal(c, gin.H{
		"from":  filter.From,
		"to":    filter.To,
		"items": items,
	}, total, "success")
}

// GetConsultation handles GET /analytics/consultations/:session_id.
func (h *AnalyticsHandler) GetConsultation(c *gin.Context) {
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	detail, err := h.service.GetDetail(c.Request.Context(), user.ID, c.Query("chain"), c.Param("session_id"))
	if err != nil {
		common.ErrorWithCode(c, common.CodeDataError, err.Error())
		return
	}
	common.SuccessWithData(c, detail, "success")
}

// GetStats handles GET /analytics/stats.
func (h *AnalyticsHandler) GetStats(c *gin.Context) {
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	from, to := service.DefaultRange(c.Query("from"), c.Query("to"))
	stats, err := h.service.Stats(c.Request.Context(), user.ID, from, to, c.Query("app_id"))
	if err != nil {
		common.ErrorWithCode(c, common.CodeServerError, err.Error())
		return
	}
	common.SuccessWithData(c, stats, "success")
}

// GetTrend handles GET /analytics/stats/trend.
func (h *AnalyticsHandler) GetTrend(c *gin.Context) {
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	from, to := service.DefaultRange(c.Query("from"), c.Query("to"))
	trend, err := h.service.Trend(c.Request.Context(), user.ID, from, to, c.Query("app_id"))
	if err != nil {
		common.ErrorWithCode(c, common.CodeServerError, err.Error())
		return
	}
	common.SuccessWithData(c, trend, "success")
}

// GetApps handles GET /analytics/stats/apps.
func (h *AnalyticsHandler) GetApps(c *gin.Context) {
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	from, to := service.DefaultRange(c.Query("from"), c.Query("to"))
	apps, err := h.service.Apps(c.Request.Context(), user.ID, from, to)
	if err != nil {
		common.ErrorWithCode(c, common.CodeServerError, err.Error())
		return
	}
	common.SuccessWithData(c, apps, "success")
}

// ExportConsultations handles GET /analytics/consultations/export.
//
// The export is capped at 10000 rows so a careless date range cannot stream an
// unbounded table through the API process.
func (h *AnalyticsHandler) ExportConsultations(c *gin.Context) {
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	filter := analyticsFilter(c)
	filter.Page = 1
	filter.Size = 10000
	items, _, err := h.service.ListConsultations(c.Request.Context(), user.ID, filter)
	if err != nil {
		common.ErrorWithCode(c, common.CodeServerError, err.Error())
		return
	}

	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="consultations-%s.csv"`,
		time.Now().Format("20060102-150405")))

	// A UTF-8 BOM keeps Excel from mangling the Chinese headers.
	_, _ = c.Writer.Write([]byte("\xEF\xBB\xBF"))
	w := csv.NewWriter(c.Writer)
	_ = w.Write([]string{"客户ID", "应用", "咨询时间", "轮次", "评价", "响应耗时(ms)", "首问"})
	for _, it := range items {
		rating := "未评价"
		switch it.Rating {
		case "good":
			rating = "好评"
		case "bad":
			rating = "差评"
		}
		_ = w.Write([]string{
			it.CustomerID,
			it.AppName,
			time.UnixMilli(it.StartTime).Format("2006-01-02 15:04:05"),
			strconv.Itoa(it.Rounds),
			rating,
			strconv.Itoa(it.DurationMS),
			it.FirstQuestion,
		})
	}
	w.Flush()
}
