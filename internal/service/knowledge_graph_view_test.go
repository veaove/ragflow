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
	"testing"

	"ragflow/internal/service/kgview"
)

func TestKGEntityFromRowPrefersPayload(t *testing.T) {
	row := map[string]interface{}{
		"content_with_weight": `{"name":"华夏基金","type":"基金公司","description":"华夏基金是公募基金管理人","aliases":["华夏"],"source_chunk_ids":["c1","c2"]}`,
		// Lower-cased engine columns must lose to the payload's original casing.
		"name_kwd":          "华夏基金",
		"entity_type_kwd":   "company",
		"mention_count_int": []interface{}{float64(7)},
		"doc_ids_kwd":       []interface{}{"d1", "d2"},
	}

	entity, ok := kgEntityFromRow(row, "kb-1")
	if !ok {
		t.Fatal("entity row rejected")
	}
	if entity.Name != "华夏基金" || entity.Type != "基金公司" {
		t.Fatalf("entity = %+v, want payload name/type", entity)
	}
	if entity.Description == "" {
		t.Error("description dropped")
	}
	if entity.MentionCount != 7 {
		t.Errorf("mention count = %d, want 7 from mention_count_int", entity.MentionCount)
	}
	if len(entity.ChunkIDs) != 2 || len(entity.DocIDs) != 2 {
		t.Errorf("sources = %v / %v, want 2 chunks and 2 docs", entity.ChunkIDs, entity.DocIDs)
	}
	if len(entity.Aliases) != 1 || entity.Aliases[0] != "华夏" {
		t.Errorf("aliases = %v, want [华夏]", entity.Aliases)
	}
}

func TestKGEntityFromRowFallsBackToColumnsAndRejectsSentinels(t *testing.T) {
	row := map[string]interface{}{
		"name_kwd":            "宁德时代",
		"entity_type_kwd":     "供应商",
		"content_with_weight": ``,
	}
	entity, ok := kgEntityFromRow(row, "kb-1")
	if !ok || entity.Name != "宁德时代" || entity.Type != "供应商" {
		t.Fatalf("fallback projection = %+v (ok=%v)", entity, ok)
	}
	if entity.MentionCount != 1 {
		t.Errorf("default mention count = %d, want 1", entity.MentionCount)
	}

	for _, sentinel := range []string{"", "  ", "unknown", "none"} {
		if _, ok := kgEntityFromRow(map[string]interface{}{"name_kwd": sentinel}, "kb-1"); ok {
			t.Errorf("row with sentinel name %q must be skipped", sentinel)
		}
	}
}

func TestKGRelationFromRowKeepsDescriptionSourcesAndConfidence(t *testing.T) {
	row := map[string]interface{}{
		"content_with_weight": `{"from":"宁德时代","to":"电池包","type":"供货","description":"宁德时代为电池包配套","confidence":0.93,"source_chunk_ids":["c9"]}`,
		"from_entity_kwd":     "宁德时代",
		"to_entity_kwd":       "电池包",
		"source_doc_ids":      []interface{}{"d1"},
	}

	relation, ok := kgRelationFromRow(row, "kb-1")
	if !ok {
		t.Fatal("relation row rejected")
	}
	if relation.From != "宁德时代" || relation.To != "电池包" || relation.Type != "供货" {
		t.Fatalf("relation = %+v, want the payload triple", relation)
	}
	if relation.Confidence != 0.93 {
		t.Errorf("confidence = %v, want 0.93", relation.Confidence)
	}
	if relation.Description == "" {
		t.Error("description dropped")
	}
	if len(relation.ChunkIDs) != 1 || len(relation.DocIDs) != 1 {
		t.Errorf("sources = %v / %v, want the chunk and the doc", relation.ChunkIDs, relation.DocIDs)
	}
}

func TestKGRelationFromRowRejectsUnusableTriples(t *testing.T) {
	cases := map[string]map[string]interface{}{
		"missing target": {"from_entity_kwd": "a"},
		"self loop":      {"from_entity_kwd": "a", "to_entity_kwd": "a"},
		"sentinel source": {
			"content_with_weight": `{"from":"unknown","to":"b"}`,
			"from_entity_kwd":     "unknown",
			"to_entity_kwd":       "b",
		},
	}
	for name, row := range cases {
		if _, ok := kgRelationFromRow(row, "kb-1"); ok {
			t.Errorf("%s: relation accepted, want skipped", name)
		}
	}

	// A sentinel payload value falls back to the keyword columns.
	relation, ok := kgRelationFromRow(map[string]interface{}{
		"content_with_weight": `{"from":"unknown","to":"电池包","type":"供货"}`,
		"from_entity_kwd":     "宁德时代",
		"to_entity_kwd":       "电池包",
	}, "kb-1")
	if !ok || relation.From != "宁德时代" {
		t.Fatalf("sentinel fallback = %+v (ok=%v), want 宁德时代", relation, ok)
	}
}

func TestKGRowDocIDs(t *testing.T) {
	row := map[string]interface{}{
		"doc_ids_kwd":    []interface{}{"d1", "d2", "d1"},
		"source_doc_ids": []interface{}{"d2", "d3"},
	}
	ids := kgRowDocIDs(row, "kb-1")
	want := []string{"d1", "d2", "d3"}
	if len(ids) != len(want) {
		t.Fatalf("doc ids = %v, want %v", ids, want)
	}
	for i := range want {
		if ids[i] != want[i] {
			t.Fatalf("doc ids = %v, want %v", ids, want)
		}
	}

	// Scalar doc_id is used only when the list columns are absent.
	if got := kgRowDocIDs(map[string]interface{}{"doc_id": "d9"}, "kb-1"); len(got) != 1 || got[0] != "d9" {
		t.Fatalf("scalar fallback = %v, want [d9]", got)
	}

	// Dataset-level rows carry the dataset id in doc_id; it is not a document.
	if got := kgRowDocIDs(map[string]interface{}{"doc_id": "kb-1"}, "kb-1"); len(got) != 0 {
		t.Fatalf("dataset-level doc_id = %v, want none", got)
	}
}

func TestKGEvidenceCandidatesPrefersRelations(t *testing.T) {
	relations := []kgview.RawRelation{
		{ChunkIDs: []string{"c1", "c2"}},
		{ChunkIDs: []string{"c2", "c3"}},
	}
	entities := []kgview.RawEntity{
		{ChunkIDs: []string{"c4", "c1"}},
	}

	got := kgEvidenceCandidates(relations, entities)
	want := []string{"c1", "c2", "c3", "c4"}
	if len(got) != len(want) {
		t.Fatalf("candidates = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("candidates = %v, want %v", got, want)
		}
	}

	many := make([]kgview.RawRelation, 0, kgEvidenceCap+10)
	for i := 0; i < kgEvidenceCap+10; i++ {
		many = append(many, kgview.RawRelation{ChunkIDs: []string{string(rune('a'+i%26)) + string(rune('0'+i%10)) + "-chunk"}})
	}
	if capped := kgEvidenceCandidates(many, nil); len(capped) > kgEvidenceCap {
		t.Errorf("candidates = %d, want at most %d", len(capped), kgEvidenceCap)
	}
}
