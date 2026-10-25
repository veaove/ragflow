// Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package handler

import (
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"ragflow/internal/common"
	"ragflow/internal/dao"
)

// OverviewHandler serves the dashboard's cross-module aggregates. It exists so
// the overview page can render "最近动态" from ONE request instead of fanning
// out to four list APIs and merging them client-side (which would also force
// the browser to download far more rows than it shows).
type OverviewHandler struct{}

// NewOverviewHandler builds the dashboard handler.
func NewOverviewHandler() *OverviewHandler {
	return &OverviewHandler{}
}

// recentActivity mirrors the UNION projection below.
type recentActivity struct {
	Kind  string `gorm:"column:kind" json:"kind"`
	Title string `gorm:"column:title" json:"title"`
	TS    int64  `gorm:"column:ts" json:"time"`
}

// GetRecentActivities handles GET /overview/activities.
//
// Four sources, one query: newly uploaded documents, newly created knowledge
// bases, recently touched canvases (agents / workflows), and blocked
// quality-inspection hits. They are unioned and sorted by time so the panel
// reads like an activity feed rather than four separate lists.
//
// Every branch is scoped to the caller's tenant. `document` has no tenant_id
// of its own, so it joins knowledgebase — uploading into someone else's KB
// must not leak into this feed.
func (h *OverviewHandler) GetRecentActivities(c *gin.Context) {
	_, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	// 用户与租户解耦后 user.ID ≠ tenant_id：新建用户不再自动生成同名租户，
	// 这里必须取用户实际所属的租户，否则活动流会是空的。
	tenantID := CurrentTenantID(c)

	// 两种调用方式：
	//   - 总览页：?limit=8          → 取前 8 条
	//   - 消息中心：?page=1&page_size=20 → 分页
	limit := 8
	offset := 0
	pageSize := 0 // >0 表示走分页模式
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 && parsed <= 50 {
			limit = parsed
		}
	} else if raw := strings.TrimSpace(c.Query("page_size")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 && parsed <= 50 {
			pageSize = parsed
			page := 1
			if p := strings.TrimSpace(c.Query("page")); p != "" {
				if parsedPage, err := strconv.Atoi(p); err == nil && parsedPage > 0 {
					page = parsedPage
				}
			}
			offset = (page - 1) * pageSize
			limit = offset + pageSize
		}
	}
	// Each branch takes a small slice before the final sort so the UNION does
	// not materialize whole tables just to discard most of them.
	perSource := limit

	const query = `
(SELECT 'document' AS kind, d.name AS title, d.create_time AS ts
   FROM document d
   JOIN knowledgebase kb ON kb.id = d.kb_id
  WHERE kb.tenant_id = ? AND d.create_time > 0
  ORDER BY d.create_time DESC LIMIT ?)
UNION ALL
(SELECT 'knowledgebase' AS kind, kb.name AS title, kb.create_time AS ts
   FROM knowledgebase kb
  WHERE kb.tenant_id = ? AND kb.create_time > 0
  ORDER BY kb.create_time DESC LIMIT ?)
UNION ALL
(SELECT 'canvas' AS kind, c.title AS title, c.update_time AS ts
   FROM user_canvas c
  WHERE c.user_id = ? AND c.update_time > 0
  ORDER BY c.update_time DESC LIMIT ?)
UNION ALL
(SELECT 'qc_block' AS kind, h.rule_name AS title, h.create_time AS ts
   FROM qc_hit h
  WHERE h.tenant_id = ? AND h.severity = 'block' AND h.create_time > 0
  ORDER BY h.create_time DESC LIMIT ?)
ORDER BY ts DESC
LIMIT ?`

	var rows []recentActivity
	err := dao.DB.WithContext(c.Request.Context()).Raw(
		query,
		tenantID, perSource,
		tenantID, perSource,
		tenantID, perSource,
		tenantID, perSource,
		limit,
	).Scan(&rows).Error
	if err != nil {
		common.ErrorWithCode(c, common.CodeServerError, err.Error())
		return
	}

	// 分页模式：把多取的（或前面的）裁掉，并给出 has_more
	result := rows
	hasMore := false
	if pageSize > 0 {
		if len(result) > offset+pageSize {
			hasMore = true
			result = result[offset : offset+pageSize]
		} else if len(result) > offset {
			result = result[offset:]
		} else {
			result = result[:0]
		}
	}

	common.SuccessWithData(c, map[string]interface{}{
		"activities": result,
		"has_more":   hasMore,
	}, "success")
}

