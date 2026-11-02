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

package graph

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"

	"ragflow/internal/common"
	"ragflow/internal/dao"
	"ragflow/internal/engine"
	"ragflow/internal/engine/types"
	modelModule "ragflow/internal/entity/models"
	"ragflow/internal/permission"

	"go.uber.org/zap"
)

// Pipeline encapsulates the knowledge graph retrieval pipeline.
// Matches Python: rag/graphrag/search.py::KGSearch
type Pipeline struct {
	docEngine engine.DocEngine
	chatModel *modelModule.ChatModel
	embModel  *modelModule.EmbeddingModel
	kbIDs     []string
	idxnms    []string
	question  string

	// Configurable parameters (defaults match Python)
	entSimThreshold float64
	relSimThreshold float64
	denseTopK       int
	entTopN         int
	relTopN         int
	commTopN        int
	maxToken        int

	// userID 是检索发起人，用于文件级授权：KG 行是聚合产物，被拒绝的文件
	// 不能通过知识图谱把内容带回上下文。
	userID     string
	deniedDocs map[string]bool
}

// Option configures a Pipeline.
type Option func(*Pipeline)

// WithSimThreshold sets the similarity threshold for entity and relation search.
// Default: 0.3 (matches Python ent_sim_threshold, rel_sim_threshold).
func WithSimThreshold(v float64) Option {
	return func(p *Pipeline) { p.entSimThreshold = v; p.relSimThreshold = v }
}

// WithDenseTopK sets the TopK for dense vector search.
// Default: 1024 (matches Python get_vector topk).
func WithDenseTopK(v int) Option {
	return func(p *Pipeline) { p.denseTopK = v }
}

// NewPipeline creates a KG search pipeline with the given dependencies.
//
//	docEngine: search engine backend
//	kbIDs:     knowledge base IDs to search
//	tenantIDs: tenant IDs (converted to index names internally)
//	question:  user query string
//	opts:      optional configuration (WithSimThreshold, WithDenseTopK)
//
// chatModel and embModel should be set via WithChatModel/WithEmbModel setters
// or passed directly after construction.
func NewPipeline(
	docEngine engine.DocEngine,
	kbIDs []string,
	tenantIDs []string,
	question string,
	opts ...Option,
) *Pipeline {
	idxnms := make([]string, len(tenantIDs))
	for i, tid := range tenantIDs {
		idxnms[i] = indexName(tid)
	}
	p := &Pipeline{
		docEngine: docEngine,
		kbIDs:     kbIDs,
		idxnms:    idxnms,
		question:  question,

		entSimThreshold: defaultSimThreshold,
		relSimThreshold: defaultSimThreshold,
		denseTopK:       defaultDenseTopK,
		entTopN:         6,
		relTopN:         6,
		commTopN:        1,
		maxToken:        8196,
	}
	for _, opt := range opts {
		opt(p)
	}
	return p
}

// SetChatModel sets the chat model for LLM-based query rewrite.
func (p *Pipeline) SetChatModel(chatModel *modelModule.ChatModel) {
	p.chatModel = chatModel
}

// SetEmbModel sets the embedding model for dense/hybrid search.
func (p *Pipeline) SetEmbModel(embModel *modelModule.EmbeddingModel) {
	p.embModel = embModel
}

// SetUserID scopes the walk to one caller so file-level grants can remove the KG
// rows derived from documents they may not see.
func (p *Pipeline) SetUserID(userID string) {
	p.userID = userID
}

// Retrieval runs the full KG retrieval pipeline and returns a synthetic chunk.
func (p *Pipeline) Retrieval(ctx context.Context) (map[string]interface{}, error) {
	// 文件级授权：先把被排除的文件装成集合，后面每一条 KG 行都要过它。
	p.loadDeniedDocuments(ctx)

	// 1. Query rewrite via LLM, or fall back to raw question
	ty2entsJSON := ""
	if p.chatModel != nil {
		typeSamples, err := p.searchTypeSamples(ctx)
		if err != nil {
			common.Warn("KG type samples search failed", zap.String("kbIDs", fmt.Sprint(p.kbIDs)))
		}
		if typeSamples == nil {
			typeSamples = make(map[string][]string)
		}
		data, _ := json.Marshal(typeSamples)
		ty2entsJSON = string(data)
	}
	typeKeywords, entities := queryRewrite(ctx, p.chatModel, p.question, ty2entsJSON)

	// 2-4. Search entities, types, and relations in parallel (mutually independent)
	var (
		entsFromQuery map[string]*KGEntity
		entsFromTypes map[string]struct{}
		relsFromText  map[Edge]*KGRelation
		entsErr       error
	)
	var wg sync.WaitGroup
	wg.Add(3)
	go func() {
		defer wg.Done()
		entsFromQuery, entsErr = p.searchEntities(ctx, entities)
	}()
	go func() {
		defer wg.Done()
		entsFromTypes = p.searchEntityTypes(ctx, typeKeywords)
	}()
	go func() {
		defer wg.Done()
		relsFromText = p.searchRelations(ctx, entities)
	}()
	wg.Wait()
	if entsErr != nil {
		return nil, entsErr
	} // 5. N-hop analysis + score fusion
	nhopPathes := AnalyzeNHopPaths(entsFromQuery)
	DoubleHitBoost(entsFromQuery, entsFromTypes)
	FuseRelationScores(relsFromText, entsFromTypes, nhopPathes)

	// 6. Sort and trim
	scoredEnts := SortAndTrimEntities(entsFromQuery, p.entTopN)
	scoredRels := SortAndTrimRelations(relsFromText, p.relTopN)

	// 7. Build KG content with token budget
	entsRelsContent := BuildContent(scoredEnts, scoredRels, p.maxToken)
	used := NumTokensFromString(entsRelsContent)
	remaining := p.maxToken - used
	// 8. Search community reports with remaining token budget
	communityContent := p.searchCommunityContent(ctx, scoredEnts, p.commTopN, &remaining)

	// 9. Build synthetic chunk
	return map[string]interface{}{
		"chunk_id":            "",
		"content_ltks":        "",
		"content_with_weight": entsRelsContent + communityContent,
		"doc_id":              "",
		"docnm_kwd":           "Related content in Knowledge Graph",
		"kb_id":               p.kbIDs,
		"important_kwd":       []string{},
		"image_id":            "",
		"similarity":          1.0,
		"vector_similarity":   1.0,
		"term_similarity":     0,
		"vector":              []float64{},
		"positions":           []interface{}{},
	}, nil
}

// searchEntities searches KG entities by keyword text and optional dense vector.
func (p *Pipeline) searchEntities(ctx context.Context, entities []string) (map[string]*KGEntity, error) {
	entsReq := &types.SearchRequest{
		IndexNames:   p.idxnms,
		KbIDs:        p.kbIDs,
		SelectFields: []string{"entity_kwd", "entity_type_kwd", "rank_flt", "content_with_weight", "n_hop_with_weight", "doc_id", "source_doc_ids"},
		Limit:        50,
		Filter:       map[string]interface{}{"knowledge_graph_kwd": "entity"},
	}
	if len(entities) > 0 {
		entsReq.MatchExprs = buildSearchExprs(ctx, p.embModel, &types.MatchTextExpr{
			Fields:       []string{"entity_kwd^10", "content_ltks^2"},
			MatchingText: strings.Join(entities, " "),
			TopN:         50,
		}, p.entSimThreshold, p.denseTopK)
	}
	entsResult, err := p.docEngine.Search(ctx, entsReq)
	if err != nil {
		return nil, fmt.Errorf("KG entity search failed: %w", err)
	}
	result := make(map[string]*KGEntity)
	for _, chunk := range FilterChunksByScore(p.visibleKGRows(entsResult.Chunks), p.entSimThreshold) {
		name, _ := chunk["entity_kwd"].(string)
		if name == "" {
			continue
		}
		e := entityFromChunk(name, chunk)
		result[name] = &e
	}
	return result, nil
}

// searchEntityTypes searches KG entities by type keywords.
func (p *Pipeline) searchEntityTypes(ctx context.Context, typeKeywords []string) map[string]struct{} {
	typesReq := &types.SearchRequest{
		IndexNames:   p.idxnms,
		KbIDs:        p.kbIDs,
		SelectFields: []string{"entity_kwd", "entity_type_kwd", "doc_id", "source_doc_ids"},
		Limit:        10000,
		Filter:       map[string]interface{}{"knowledge_graph_kwd": "entity"},
	}
	if len(typeKeywords) > 0 {
		typeFilters := make([]interface{}, len(typeKeywords))
		for i, t := range typeKeywords {
			typeFilters[i] = t
		}
		typesReq.Filter["entity_type_kwd"] = typeFilters
	}
	typesResult, err := p.docEngine.Search(ctx, typesReq)
	result := make(map[string]struct{})
	if err != nil {
		common.Warn("KG types search failed", zap.String("kbIDs", fmt.Sprint(p.kbIDs)))
	} else {
		for _, chunk := range p.visibleKGRows(typesResult.Chunks) {
			if name, ok := chunk["entity_kwd"].(string); ok {
				result[name] = struct{}{}
			}
		}
	}
	return result
}

// searchRelations searches KG relations by entity text and optional dense vector.
func (p *Pipeline) searchRelations(ctx context.Context, entities []string) map[Edge]*KGRelation {
	relsReq := &types.SearchRequest{
		IndexNames:   p.idxnms,
		KbIDs:        p.kbIDs,
		SelectFields: []string{"from_entity_kwd", "to_entity_kwd", "weight_int", "content_with_weight", "doc_id", "source_doc_ids"},
		Limit:        50,
		Filter:       map[string]interface{}{"knowledge_graph_kwd": "relation"},
	}
	if len(entities) > 0 {
		relsReq.MatchExprs = buildSearchExprs(ctx, p.embModel, &types.MatchTextExpr{
			Fields:       []string{"content_ltks", "from_entity_kwd", "to_entity_kwd"},
			MatchingText: strings.Join(entities, " "),
			TopN:         50,
		}, p.relSimThreshold, p.denseTopK)
	}
	relsResult, err := p.docEngine.Search(ctx, relsReq)
	result := make(map[Edge]*KGRelation)
	if err != nil {
		common.Warn("KG relations search failed", zap.String("kbIDs", fmt.Sprint(p.kbIDs)))
	} else {
		for _, chunk := range FilterChunksByScore(p.visibleKGRows(relsResult.Chunks), p.relSimThreshold) {
			edge, rel := relationFromChunk(chunk)
			if edge.From == "" || edge.To == "" {
				continue
			}
			result[edge] = &rel
		}
	}
	return result
}

// loadDeniedDocuments collects the documents the caller may not see so every KG
// row derived from them can be dropped.
func (p *Pipeline) loadDeniedDocuments(ctx context.Context) {
	p.deniedDocs = nil
	if p.userID == "" || len(p.kbIDs) == 0 || dao.DB == nil {
		return
	}
	hiddenByKB, err := permission.HiddenDocumentIDs(ctx, dao.DB,
		permission.Subject{UserID: p.userID}, p.kbIDs)
	if err != nil {
		// 判定失败不收紧：KG 检索已经按库过滤过，误删整段图谱比漏一条更糟。
		common.Warn("KG: resolve document-level grants failed", zap.Error(err))
		return
	}
	if len(hiddenByKB) == 0 {
		return
	}
	p.deniedDocs = make(map[string]bool, len(hiddenByKB))
	for _, ids := range hiddenByKB {
		for _, id := range ids {
			p.deniedDocs[id] = true
		}
	}
}

// kgRowVisible reports whether one KG row may be used for the caller.
//
// KG 行是聚合产物，没法从一条实体 / 关系 / 社区报告里剔掉"某个文档贡献的那
// 部分"，所以只要任一来源文档被文件级规则排除，整行都不给：
//   - 文档级行（scope_kwd=doc）看 doc_id；
//   - 数据集级合并行（doc_id 是库 id）看 source_doc_ids。
func (p *Pipeline) kgRowVisible(chunk map[string]interface{}) bool {
	if len(p.deniedDocs) == 0 {
		return true
	}
	if docID, _ := chunk["doc_id"].(string); docID != "" && p.deniedDocs[docID] {
		return false
	}
	for _, id := range kgStringList(chunk["source_doc_ids"]) {
		if p.deniedDocs[id] {
			return false
		}
	}
	return true
}

// visibleKGRows filters one engine page down to the rows the caller may see.
func (p *Pipeline) visibleKGRows(chunks []map[string]interface{}) []map[string]interface{} {
	if len(p.deniedDocs) == 0 || len(chunks) == 0 {
		return chunks
	}
	kept := make([]map[string]interface{}, 0, len(chunks))
	for _, chunk := range chunks {
		if p.kgRowVisible(chunk) {
			kept = append(kept, chunk)
		}
	}
	return kept
}

// kgStringList reads an engine-returned string array: ES/Infinity may hand back
// []interface{}, []string, or a comma-separated string.
func kgStringList(value interface{}) []string {
	switch v := value.(type) {
	case nil:
		return nil
	case []string:
		return v
	case []interface{}:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if s, ok := item.(string); ok && s != "" {
				out = append(out, s)
			}
		}
		return out
	case string:
		if v == "" {
			return nil
		}
		parts := strings.Split(v, ",")
		out := make([]string, 0, len(parts))
		for _, part := range parts {
			if s := strings.TrimSpace(part); s != "" {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}
