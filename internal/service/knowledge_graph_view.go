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

package service

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"go.uber.org/zap"

	"ragflow/internal/common"
	"ragflow/internal/dao"
	"ragflow/internal/engine"
	"ragflow/internal/engine/types"
	"ragflow/internal/service/kgview"
)

// Row/evidence limits for one graph request. The graph is a browsing surface,
// not an export: fetch enough rows to describe the dataset, then let kgview cut
// it down and report Stats.Truncated.
const (
	kgRowPageSize     = 1000
	kgRowCap          = 8000
	kgEvidenceCap     = 600
	kgEvidenceBatch   = 100
	kgDocNameCap      = 200
	kgEvidenceSnippet = 160
)

// knowledgeGraphSelectFields is exactly what the projection reads, because the
// list doubles as the engine's _source filter: a missing field comes back empty
// even though the row carries it.
var knowledgeGraphSelectFields = []string{
	"id", "content_with_weight",
	"type_kwd", "knowledge_graph_kwd", "name_kwd", "entity_type_kwd", "mention_count_int",
	"from_entity_kwd", "to_entity_kwd",
	"source_chunk_ids", "doc_id", "doc_ids_kwd", "source_doc_ids",
}

// KnowledgeGraphOptions is the request-level view options.
type KnowledgeGraphOptions struct {
	Keywords string
	Mode     string
	MaxNodes int
	MaxEdges int
}

// KnowledgeGraphService owns reading the compiled entity/relation rows of one
// dataset and turning them into the browseable graph. It replaces the legacy
// path that read a single pre-aggregated JSON blob: that blob carried no entity
// types, no relation types, no confidence and no provenance, and could only be
// served whole.
type KnowledgeGraphService struct{}

func NewKnowledgeGraphService() *KnowledgeGraphService {
	return &KnowledgeGraphService{}
}

// Load returns the graph of one dataset.
func (s *KnowledgeGraphService) Load(ctx context.Context, tenantID, datasetID string, opts KnowledgeGraphOptions) (*kgview.Payload, error) {
	if engine.Get() == nil {
		return nil, fmt.Errorf("document engine is not initialized")
	}

	entities, relations := s.loadGraphRows(ctx, tenantID, datasetID)
	evidence := s.loadEvidence(ctx, tenantID, datasetID, kgEvidenceCandidates(relations, entities))
	docNames := s.loadDocNames(ctx, tenantID, datasetID, kgDocIDCandidates(relations, entities, evidence))

	payload := kgview.Build(kgview.Input{
		Entities:  entities,
		Relations: relations,
		Evidence:  evidence,
		DocNames:  docNames,
	}, kgview.Options{
		Keywords: opts.Keywords,
		Mode:     opts.Mode,
		MaxNodes: opts.MaxNodes,
		MaxEdges: opts.MaxEdges,
	})
	return payload, nil
}

// loadGraphRows pages through the entity/relation rows of the dataset. Both the
// dataset-level aggregate rows and the per-document rows are read: kgview merges
// them by identity, and support counts are chunk-id sets, so the same snippet
// backing both row shapes counts once.
//
// A failed page degrades to the rows already read instead of failing the whole
// request — a graph with fewer nodes is still useful, an error page is not.
func (s *KnowledgeGraphService) loadGraphRows(ctx context.Context, tenantID, datasetID string) ([]kgview.RawEntity, []kgview.RawRelation) {
	filter := map[string]interface{}{"knowledge_graph_kwd": []string{"entity", "relation"}}
	orderBy := (&types.OrderByExpr{}).Asc("id")

	entities := make([]kgview.RawEntity, 0, 256)
	relations := make([]kgview.RawRelation, 0, 512)
	for offset := 0; offset < kgRowCap; offset += kgRowPageSize {
		rows, total, err := graphRowSearch(ctx, tenantID, datasetID, knowledgeGraphSelectFields, filter, orderBy, offset, kgRowPageSize, nil)
		if err != nil {
			common.WarnCtx(ctx, "knowledge graph: row page failed, returning what was read", zap.Error(err))
			break
		}
		if len(rows) == 0 {
			break
		}
		ids := make([]string, 0, len(rows))
		for id := range rows {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		for _, id := range ids {
			row := rows[id]
			kind := firstStringValue(row["type_kwd"])
			if kind == "" {
				kind = firstStringValue(row["knowledge_graph_kwd"])
			}
			if kind == "relation" {
				if relation, ok := kgRelationFromRow(row); ok {
					relations = append(relations, relation)
				}
				continue
			}
			if entity, ok := kgEntityFromRow(row); ok {
				entities = append(entities, entity)
			}
		}
		if int64(offset+kgRowPageSize) >= total {
			break
		}
	}
	return entities, relations
}

// kgEntityFromRow projects one entity row. The payload JSON is authoritative
// (it keeps the original casing of the name); the *_kwd columns are only
// consulted when the payload is missing or predates a field.
func kgEntityFromRow(row map[string]interface{}) (kgview.RawEntity, bool) {
	payload := graphLoadPayload(row)
	name := kgPayloadString(payload, "name", "text", "term", "title")
	if name == "" {
		name = strings.TrimSpace(firstStringValue(row["name_kwd"]))
	}
	name = strings.TrimSpace(name)
	if name == "" || graphIsInvalidSentinel(name) {
		return kgview.RawEntity{}, false
	}
	typ := kgPayloadString(payload, "type")
	if typ == "" {
		typ = firstStringValue(row["entity_type_kwd"])
	}
	desc := kgPayloadString(payload, "description", "definition_excerpt")
	entity := kgview.RawEntity{
		Name:         name,
		Type:         typ,
		Description:  desc,
		Aliases:      kgPayloadStrings(payload, "aliases"),
		MentionCount: 1,
		ChunkIDs:     graphSourceChunkIDs(payload, row),
		DocIDs:       kgRowDocIDs(row),
	}
	if mention, ok := graphMentionCount(row); ok && mention > 0 {
		entity.MentionCount = mention
	}
	return entity, true
}

// kgRelationFromRow projects one relation row, keeping the description, the
// source chunks and any explicit confidence the extractor stored.
func kgRelationFromRow(row map[string]interface{}) (kgview.RawRelation, bool) {
	payload := graphLoadPayload(row)
	from := kgPayloadString(payload, "from", "source", "src")
	to := kgPayloadString(payload, "to", "target", "tgt")
	if graphIsInvalidSentinel(from) || graphIsInvalidSentinel(to) {
		from = strings.TrimSpace(firstStringValue(row["from_entity_kwd"]))
		to = strings.TrimSpace(firstStringValue(row["to_entity_kwd"]))
	}
	if from == "" || to == "" || graphIsInvalidSentinel(from) || graphIsInvalidSentinel(to) || from == to {
		return kgview.RawRelation{}, false
	}
	return kgview.RawRelation{
		From:        strings.TrimSpace(from),
		To:          strings.TrimSpace(to),
		Type:        kgPayloadString(payload, "type"),
		Description: kgPayloadString(payload, "description", "definition_excerpt"),
		ChunkIDs:    graphSourceChunkIDs(payload, row),
		DocIDs:      kgRowDocIDs(row),
		Confidence:  kgPayloadConfidence(payload),
	}, true
}

func kgPayloadString(payload map[string]interface{}, keys ...string) string {
	if payload == nil {
		return ""
	}
	for _, key := range keys {
		if value, ok := payload[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func kgPayloadStrings(payload map[string]interface{}, key string) []string {
	if payload == nil {
		return nil
	}
	switch value := payload[key].(type) {
	case string:
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return []string{trimmed}
		}
	case []string:
		return value
	case []interface{}:
		out := make([]string, 0, len(value))
		for _, item := range value {
			if s, ok := item.(string); ok && strings.TrimSpace(s) != "" {
				out = append(out, strings.TrimSpace(s))
			}
		}
		return out
	}
	return nil
}

func kgPayloadConfidence(payload map[string]interface{}) float64 {
	if payload == nil {
		return 0
	}
	for _, key := range []string{"confidence", "conf", "score"} {
		if value, ok := payload[key]; ok {
			if score, valid := floatValue(value); valid {
				return score
			}
		}
	}
	return 0
}

// kgRowDocIDs returns the documents a row came from. Dataset-level rows carry
// the dataset id in doc_id, which is not a document.
func kgRowDocIDs(row map[string]interface{}) []string {
	out := make([]string, 0, 4)
	seen := map[string]struct{}{}
	add := func(id string) {
		id = strings.TrimSpace(id)
		if id == "" {
			return
		}
		if _, ok := seen[id]; ok {
			return
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	for _, field := range []string{"doc_ids_kwd", "source_doc_ids"} {
		switch value := row[field].(type) {
		case []string:
			for _, id := range value {
				add(id)
			}
		case []interface{}:
			for _, item := range value {
				if id, ok := item.(string); ok {
					add(id)
				}
			}
		case string:
			add(value)
		}
	}
	if len(out) == 0 {
		add(firstStringValue(row["doc_id"]))
	}
	return out
}

// kgEvidenceCandidates prefers relation provenance: the edge is what users
// audit, and the page budget is finite.
func kgEvidenceCandidates(relations []kgview.RawRelation, entities []kgview.RawEntity) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, kgEvidenceCap)
	collect := func(ids []string) {
		for _, id := range ids {
			if len(out) >= kgEvidenceCap {
				return
			}
			if id == "" {
				return
			}
			if _, ok := seen[id]; ok {
				continue
			}
			seen[id] = struct{}{}
			out = append(out, id)
		}
	}
	for _, relation := range relations {
		collect(relation.ChunkIDs)
	}
	for _, entity := range entities {
		collect(entity.ChunkIDs)
	}
	return out
}

// loadEvidence resolves source chunk ids to document/page/snippet. Everything
// is best effort: a deleted chunk simply yields no evidence for that item.
func (s *KnowledgeGraphService) loadEvidence(ctx context.Context, tenantID, datasetID string, chunkIDs []string) map[string]kgview.Evidence {
	if len(chunkIDs) == 0 {
		return nil
	}
	evidence := make(map[string]kgview.Evidence, len(chunkIDs))
	for start := 0; start < len(chunkIDs); start += kgEvidenceBatch {
		end := min(start+kgEvidenceBatch, len(chunkIDs))
		rows := fetchChunksByIDs(ctx, tenantID, []string{datasetID}, chunkIDs[start:end])
		for _, row := range rows {
			id := firstStringValue(row["id"])
			if id == "" {
				continue
			}
			evidence[id] = kgview.Evidence{
				DocID:   firstStringValue(row["doc_id"]),
				DocName: firstStringValue(row["docnm_kwd"]),
				Page:    intValue(row["page_num_int"]),
				ChunkID: id,
				Snippet: kgview.Snippet(firstStringValue(row["content_with_weight"]), kgEvidenceSnippet),
			}
		}
	}
	return evidence
}

// loadDocNames fills display names for documents whose chunks were not resolved
// (already deleted, or not in the evidence budget).
func (s *KnowledgeGraphService) loadDocNames(ctx context.Context, tenantID, datasetID string, docIDs []string) map[string]string {
	names := make(map[string]string, len(docIDs))
	pending := make([]string, 0, len(docIDs))
	for _, id := range docIDs {
		if id == "" || id == datasetID {
			continue
		}
		pending = append(pending, id)
		if len(pending) >= kgDocNameCap {
			break
		}
	}
	if len(pending) == 0 {
		return names
	}
	documents, err := dao.NewDocumentDAO().GetByIDs(ctx, dao.DB, pending)
	if err != nil {
		common.WarnCtx(ctx, "knowledge graph: document name lookup failed", zap.Error(err))
		return names
	}
	for _, document := range documents {
		if document == nil || document.ID == "" {
			continue
		}
		if document.Name != nil && strings.TrimSpace(*document.Name) != "" {
			names[document.ID] = strings.TrimSpace(*document.Name)
		}
	}
	return names
}

func kgDocIDCandidates(relations []kgview.RawRelation, entities []kgview.RawEntity, evidence map[string]kgview.Evidence) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, 64)
	add := func(id string) {
		if id == "" || len(out) >= kgDocNameCap*2 {
			return
		}
		if _, ok := seen[id]; ok {
			return
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	for _, relation := range relations {
		for _, id := range relation.DocIDs {
			add(id)
		}
	}
	for _, entity := range entities {
		for _, id := range entity.DocIDs {
			add(id)
		}
	}
	for _, item := range evidence {
		add(item.DocID)
	}
	return out
}


