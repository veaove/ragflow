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
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	tenantID := user.ID

	limit := 8
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 && parsed <= 50 {
			limit = parsed
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

	common.SuccessWithData(c, map[string]interface{}{
		"activities": rows,
	}, "success")
}
