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

// ArtifactHandler 汇总各知识库的编译产物（wiki / tree / graph / mindmap / timeline）。
//
// 产物没有独立的内容表：它们的「有没有」「什么时候完成」记在 knowledgebase
// 的一堆 xxx_task_id / xxx_task_finish_at 字段上。这里把这些列展开成
// 「一行一个产物」，供独立的 Artifacts 列表页展示。
type ArtifactHandler struct{}

func NewArtifactHandler() *ArtifactHandler {
	return &ArtifactHandler{}
}

// ArtifactItem 是列表里的一行：一个知识库的某一种产物。
type ArtifactItem struct {
	ID              string `json:"id"`
	KnowledgeBaseID string `json:"knowledge_base_id"`
	Name            string `json:"name"`
	// Type 取值：wiki / tree / graph / mindmap / timeline
	Type      string `json:"type"`
	DocNum    int64  `json:"doc_num"`
	ChunkNum  int64  `json:"chunk_num"`
	TaskID    string `json:"task_id"`
	CreatedAt int64  `json:"created_at"`
	UpdatedAt int64  `json:"updated_at"`
}

// ListArtifacts GET /artifacts
//
// 查询参数：type / keyword / page / page_size
func (h *ArtifactHandler) ListArtifacts(c *gin.Context) {
	user, code, msg := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, msg)
		return
	}
	tenantID := CurrentTenantID(c)
	_ = user

	page, pageSize := 1, 20
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

	// 一个知识库可能同时有多个产物，所以先按库捞出来再在内存里展开。
	type kbRow struct {
		ID                           string
		Name                         string
		DocNum                       int64
		ChunkNum                     int64
		CreateDate                   *time.Time
		UpdateDate                   *time.Time
		WikiTaskID                   *string
		WikiTaskFinishAt             *time.Time
		RaptorTaskID                 *string
		RaptorTaskFinishAt           *time.Time
		GraphragTaskID               *string
		GraphragTaskFinishAt         *time.Time
		StructureGraphTaskID         *string
		StructureGraphTaskFinishAt   *time.Time
		MindmapTaskID                *string
		MindmapTaskFinishAt          *time.Time
		StructureMindmapTaskID       *string
		StructureMindmapTaskFinishAt *time.Time
		TimelineTaskID               *string
		TimelineTaskFinishAt         *time.Time
	}

	query := dao.DB.WithContext(c.Request.Context()).
		Model(&kbRow{}).
		Table("knowledgebase").
		Select(`id, IFNULL(name, '') AS name, IFNULL(doc_num, 0) AS doc_num,
			IFNULL(chunk_num, 0) AS chunk_num, create_date, update_date,
			wiki_task_id, wiki_task_finish_at,
			raptor_task_id, raptor_task_finish_at,
			graphrag_task_id, graphrag_task_finish_at,
			structure_graph_task_id, structure_graph_task_finish_at,
			mindmap_task_id, mindmap_task_finish_at,
			structure_mindmap_task_id, structure_mindmap_task_finish_at,
			timeline_task_id, timeline_task_finish_at`).
		Where("tenant_id = ? AND status = '1'", tenantID)
	if keyword != "" {
		query = query.Where("name LIKE ?", "%"+keyword+"%")
	}

	var kbs []kbRow
	if err := query.Scan(&kbs).Error; err != nil {
		common.ErrorWithCode(c, common.CodeServerError, err.Error())
		return
	}

	items := make([]ArtifactItem, 0, len(kbs)*2)
	for _, kb := range kbs {
		createdAt := int64(0)
		if kb.CreateDate != nil {
			createdAt = kb.CreateDate.UnixMilli()
		}
		fallbackUpdated := int64(0)
		if kb.UpdateDate != nil {
			fallbackUpdated = kb.UpdateDate.UnixMilli()
		}

		appendIf := func(kind string, taskID *string, finishedAt *time.Time) {
			if taskID == nil || strings.TrimSpace(*taskID) == "" {
				return
			}
			if typeFilter != "" && typeFilter != kind {
				return
			}
			updated := fallbackUpdated
			if finishedAt != nil {
				updated = finishedAt.UnixMilli()
			}
			items = append(items, ArtifactItem{
				ID:              kb.ID + ":" + kind,
				KnowledgeBaseID: kb.ID,
				Name:            kb.Name,
				Type:            kind,
				DocNum:          kb.DocNum,
				ChunkNum:        kb.ChunkNum,
				TaskID:          *taskID,
				CreatedAt:       createdAt,
				UpdatedAt:       updated,
			})
		}

		appendIf("wiki", kb.WikiTaskID, kb.WikiTaskFinishAt)
		// Tree/PageIndex 落的是 RAPTOR（递归摘要树）
		appendIf("tree", kb.RaptorTaskID, kb.RaptorTaskFinishAt)
		// 图有两种：旧的 graphrag，新的结构化 graph。优先用结构化，
		// 两者都有时不重复出两行（取结构化那行）。
		if kb.StructureGraphTaskID != nil && strings.TrimSpace(*kb.StructureGraphTaskID) != "" {
			appendIf("graph", kb.StructureGraphTaskID, kb.StructureGraphTaskFinishAt)
		} else {
			appendIf("graph", kb.GraphragTaskID, kb.GraphragTaskFinishAt)
		}
		if kb.StructureMindmapTaskID != nil && strings.TrimSpace(*kb.StructureMindmapTaskID) != "" {
			appendIf("mindmap", kb.StructureMindmapTaskID, kb.StructureMindmapTaskFinishAt)
		} else {
			appendIf("mindmap", kb.MindmapTaskID, kb.MindmapTaskFinishAt)
		}
		appendIf("timeline", kb.TimelineTaskID, kb.TimelineTaskFinishAt)
	}

	// 按更新时间倒序（没有更新时间的按创建时间）
	sort.SliceStable(items, func(i, j int) bool {
		return artifactTime(items[i]) > artifactTime(items[j])
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

func artifactTime(a ArtifactItem) int64 {
	if a.UpdatedAt != 0 {
		return a.UpdatedAt
	}
	return a.CreatedAt
}
