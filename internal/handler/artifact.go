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
	"context"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"ragflow/internal/common"
	"ragflow/internal/dao"
	"ragflow/internal/permission"
	permissionresponse "ragflow/internal/permission/response"
	"ragflow/internal/service"
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
// 「有哪些类型」分两步：先用 MySQL 得到候选（编译过的库 × 租户配置的模板类型），
// 再逐对向检索引擎确认这一对是否真有行（DatasetArtifactService.HasArtifact）。
// 少第二步就会出现「只编译了 graph 的库也列出 wiki/mindmap/timeline 卡片，
// 点进去四个空视图」。探测谓词与各视图的读取谓词一致，失败时按「存在」处理：
// 引擎抖动只该让列表退化到旧行为，不该把概览整页清空。
type ArtifactHandler struct {
	// presence 回答「这个库真的有这一种产物吗」。抽成接口是为了让单测能在
	// 不启动检索引擎的前提下覆盖空类型的过滤（见 artifact_test.go）。
	presence artifactPresence
}

// artifactPresence is the per-(dataset, type) existence probe.
type artifactPresence interface {
	HasArtifact(ctx context.Context, tenantID, datasetID, artifactType string) (bool, error)
}

// artifactProbeConcurrency 限制并发探测数：一个租户可能有几十个知识库，
// 每个最多五种类型，串行探测会让首屏多出几百毫秒。
const artifactProbeConcurrency = 8

func NewArtifactHandler() *ArtifactHandler {
	return &ArtifactHandler{presence: service.NewDatasetArtifactService()}
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
	user, code, msg := GetUser(c)
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

	// 2) 编译完成的知识库。
	//
	// 必须叠加知识库级读权限：同一租户里 permission=me 的库只对创建者、租户
	// 管理员和显式授权对象可见。只按 tenant_id 过滤会把别人的私库名字、文档数
	// 和产物类型一起汇总到这个跨库列表上——概览页因此成了越权信息的出口。
	scope, scopeErr := permission.NewDatabaseChecker(dao.DB).QueryScope(
		ctx,
		permission.Subject{UserID: user.ID, TenantID: tenantID},
		permission.ScopeQuery{
			Kind:      permission.ResourceKindDataset,
			Operation: permission.OperationRead,
		},
	)
	if scopeErr != nil {
		permissionCode, permissionErr := permissionresponse.Normalize(scopeErr)
		common.ErrorWithCode(c, permissionCode, permissionErr.Error())
		return
	}

	// 条件里的表名保持 `knowledgebase` 而不是别名：QueryScope 生成的谓词按
	// 正式表名引用列，起别名会让它和这里的 SELECT/WHERE 对不上。
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
		Joins("JOIN knowledgebase ON knowledgebase.id = d.dataset_id").
		Select(`knowledgebase.id AS id, IFNULL(knowledgebase.name, '') AS name,
			IFNULL(knowledgebase.doc_num, 0) AS doc_num, IFNULL(knowledgebase.chunk_num, 0) AS chunk_num,
			d.state AS state, knowledgebase.create_date AS create_date,
			d.last_completed_at AS last_completed_at`).
		Where("knowledgebase.tenant_id = ? AND knowledgebase.status = '1'", tenantID)
	// 零值 scope 会 fail closed（追加 1 = 0），不会退化成「什么都可见」。
	q = scope.Apply(q)
	if keyword != "" {
		q = q.Where("knowledgebase.name LIKE ?", "%"+keyword+"%")
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

	type candidate struct {
		kb    kbRow
		label string
	}
	candidates := make([]candidate, 0, len(kbs)*len(labels))
	for _, kb := range kbs {
		for _, label := range labels {
			if typeFilter != "" && typeFilter != label {
				continue
			}
			candidates = append(candidates, candidate{kb: kb, label: label})
		}
	}

	// 4) 逐对确认引擎里真有这一种产物，去掉「配置了但没生成」的空卡片。
	presence := h.presence
	if presence == nil {
		presence = service.NewDatasetArtifactService()
	}
	present := make([]bool, len(candidates))
	sem := make(chan struct{}, artifactProbeConcurrency)
	var wg sync.WaitGroup
	for i := range candidates {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			ok, err := presence.HasArtifact(ctx, tenantID, candidates[i].kb.ID, candidates[i].label)
			if err != nil {
				// 探测失败不能把整页清空：退回到「有配置即展示」的老行为，
				// 并在日志里留下原因。
				common.Warn("artifact presence probe failed; keeping the card",
					zap.String("dataset_id", candidates[i].kb.ID),
					zap.String("type", candidates[i].label),
					zap.Error(err))
				present[i] = true
				return
			}
			present[i] = ok
		}(i)
	}
	wg.Wait()

	items := make([]ArtifactItem, 0, len(candidates))
	for i, cand := range candidates {
		if !present[i] {
			continue
		}
		kb := cand.kb
		createdAt := int64(0)
		if kb.CreateDate != nil {
			createdAt = kb.CreateDate.UnixMilli()
		}
		updatedAt := createdAt
		if kb.LastCompletedAt != nil {
			updatedAt = kb.LastCompletedAt.UnixMilli()
		}
		items = append(items, ArtifactItem{
			ID:              kb.ID + ":" + cand.label,
			KnowledgeBaseID: kb.ID,
			Name:            kb.Name,
			Type:            cand.label,
			DocNum:          kb.DocNum,
			ChunkNum:        kb.ChunkNum,
			State:           kb.State,
			CreatedAt:       createdAt,
			UpdatedAt:       updatedAt,
		})
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
