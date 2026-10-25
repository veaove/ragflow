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
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"ragflow/internal/common"
	"ragflow/internal/dao"
)

// ArtifactHandler 汇总知识库的编译产物（wiki / tree / graph / mindmap / timeline）。
//
// 数据源说明（这点很容易搞错，第一版实现就踩了）：
//   - 产物「内容」不在 MySQL，存在检索引擎（Infinity/ES）的 chunk 字段里。
//   - MySQL 只有两份元数据：
//     1. knowledge_compile_docs —— 每个知识库的编译状态与完成时间
//     2. compilation_template   —— 该租户配置了哪些类型的编译模板（kind）
//   - knowledgebase 上那堆 wiki_task_id / graphrag_task_id 在现网全是空值，
//     不能拿来判断「有没有产物」。
//
// 所以这里用：编译完成的库 × 租户已配置的模板类型。
// 局限：只能表达「这个库编译过，而本租户配置了这些类型」，
// 精确到「这个库实际生成了哪几种」需要查检索引擎的字段统计。
type ArtifactHandler struct{}

func NewArtifactHandler() *ArtifactHandler {
	return &ArtifactHandler{}
}

type ArtifactItem struct {
	ID              string `json:"id"`
	KnowledgeBaseID string `json:"knowledge_base_id"`
	Name            string `json:"name"`
	Type            string `json:"type"`
	DocNum          int64  `json:"doc_num"`
	ChunkNum        int64  `json:"chunk_num"`
	State           string `json:"state"`
	CreatedAt       int64  `json:"created_at"`
	UpdatedAt       int64  `json:"updated_at"`
}

// kindLabel 把编译模板的 kind 归一到界面上的五个类型。
func kindLabel(kind string) string {
	switch kind {
	case "wiki", "artifacts":
		return "wiki"
	case "tree", "page_index":
		return "tree"
	case "knowledge_graph", "graph":
		return "graph"
	case "mind_map", "mindmap":
		return "mindmap"
	case "timeline":
		return "timeline"
	default:
		return ""
	}
}

// ListArtifacts GET /overview/artifacts
func (h *ArtifactHandler) ListArtifacts(c *gin.Context) {
	_, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	tenantID := CurrentTenantID(c)
	ctx := c.Request.Context()

	page, pageSize := 1, 12
	if v := strings.TrimSpace(c.Query("page")); v != "" {
		if p, err := strconv.Atoi(v); err == nil && p > 0 {
			page = p
		}
	}
	if v := strings.TrimSpace(c.Query("page_size")); v != "" {
		if p, err := strconv.Atoi(v); err == nil && p > 0 && p <= 100 {
			pageSize = p
		}
	}
	typeFilter := strings.TrimSpace(c.Query("type"))
	keyword := strings.TrimSpace(c.Query("keyword"))

	// 1) 该租户配置的编译模板类型
	var kinds []string
	if err := dao.DB.WithContext(ctx).
		Table("compilation_template").
		Where("tenant_id = ?", tenantID).
		Distinct("kind").
		Pluck("kind", &kinds).Error; err != nil {
		common.ErrorWithCode(c, common.CodeServerError, err.Error())
		return
	}
	typeSet := make(map[string]struct{}, len(kinds))
	for _, k := range kinds {
		if label := kindLabel(k); label != "" {
			typeSet[label] = struct{}{}
		}
	}
	if len(typeSet) == 0 {
		common.SuccessWithData(c, map[string]interface{}{
			"artifacts": []ArtifactItem{},
			"total":     0,
		}, "success")
		return
	}

	// 2) 编译完成的知识库
	type kbRow struct {
		ID              string
		Name            string
		DocNum          int64
		ChunkNum        int64
		State           string
		CreateDate      *time.Time
		LastCompletedAt *time.Time
	}
	q := dao.DB.WithContext(ctx).
		Table("knowledge_compile_docs AS d").
		Joins("JOIN knowledgebase kb ON kb.id = d.dataset_id").
		Select(`kb.id AS id, IFNULL(kb.name, '') AS name,
			IFNULL(kb.doc_num, 0) AS doc_num, IFNULL(kb.chunk_num, 0) AS chunk_num,
			d.state AS state, kb.create_date AS create_date,
			d.last_completed_at AS last_completed_at`).
		Where("kb.tenant_id = ? AND kb.status = '1'", tenantID)
	if keyword != "" {
		q = q.Where("kb.name LIKE ?", "%"+keyword+"%")
	}
	var kbs []kbRow
	if err := q.Scan(&kbs).Error; err != nil {
		common.ErrorWithCode(c, common.CodeServerError, err.Error())
		return
	}

	// 3) 库 × 类型展开（类型排序保证分页稳定）
	labels := make([]string, 0, len(typeSet))
	for label := range typeSet {
		labels = append(labels, label)
	}
	sort.Strings(labels)

	items := make([]ArtifactItem, 0, len(kbs)*len(labels))
	for _, kb := range kbs {
		createdAt := int64(0)
		if kb.CreateDate != nil {
			createdAt = kb.CreateDate.UnixMilli()
		}
		updatedAt := createdAt
		if kb.LastCompletedAt != nil {
			updatedAt = kb.LastCompletedAt.UnixMilli()
		}
		for _, label := range labels {
			if typeFilter != "" && typeFilter != label {
				continue
			}
			items = append(items, ArtifactItem{
				ID:              kb.ID + ":" + label,
				KnowledgeBaseID: kb.ID,
				Name:            kb.Name,
				Type:            label,
				DocNum:          kb.DocNum,
				ChunkNum:        kb.ChunkNum,
				State:           kb.State,
				CreatedAt:       createdAt,
				UpdatedAt:       updatedAt,
			})
		}
	}

	sort.SliceStable(items, func(i, j int) bool {
		return items[i].UpdatedAt > items[j].UpdatedAt
	})

	total := len(items)
	start := (page - 1) * pageSize
	if start > total {
		start = total
	}
	end := start + pageSize
	if end > total {
		end = total
	}

	common.SuccessWithData(c, map[string]interface{}{
		"artifacts": items[start:end],
		"total":     total,
	}, "success")
}
