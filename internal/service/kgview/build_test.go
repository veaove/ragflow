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

package kgview

import (
	"testing"
)

func financeInput() Input {
	return Input{
		Entities: []RawEntity{
			{Name: "华夏基金", Type: "基金公司", MentionCount: 4, ChunkIDs: []string{"c1"}, DocIDs: []string{"d1"}},
			{Name: "华夏基金管理有限公司", Type: "company", Aliases: []string{"华夏"}, DocIDs: []string{"d1", "d2"}},
			{Name: "华夏成长混合", Type: "基金产品", ChunkIDs: []string{"c2"}, DocIDs: []string{"d1"}},
			{Name: "T+0 赎回", Type: "交易规则", ChunkIDs: []string{"c3"}},
		},
		Relations: []RawRelation{
			{From: "华夏基金", To: "华夏成长混合", Type: "发行", ChunkIDs: []string{"c1"}},
			// Alias endpoint + synonym type: must merge into the edge above.
			{From: "华夏", To: "华夏成长混合", Type: "发售", ChunkIDs: []string{"c1", "c3"}},
			{From: "华夏成长混合", To: "T+0 赎回", Type: "支持", ChunkIDs: []string{"c2"}},
			// Self loop is not a relation.
			{From: "华夏基金", To: "华夏基金管理有限公司", Type: "发行"},
			// Endpoint without its own entity row still has to be drawable.
			{From: "华夏成长混合", To: "快速取现", Type: "约束", ChunkIDs: []string{"c3"}},
		},
		Evidence: map[string]Evidence{
			"c1": {DocID: "d1", DocName: "华夏成长混合型证券投资基金合同", Page: 3, Snippet: "基金管理人为华夏基金管理有限公司"},
			"c2": {DocID: "d1", DocName: "华夏成长混合型证券投资基金合同", Page: 12},
			"c3": {DocID: "d2", DocName: "快速取现服务协议", Page: 1},
		},
		DocNames: map[string]string{"d1": "华夏成长混合型证券投资基金合同", "d2": "快速取现服务协议"},
	}
}

func TestBuildMergesAliasesAndSynonyms(t *testing.T) {
	payload := Build(financeInput(), Options{})

	// 华夏基金 / 华夏基金管理有限公司 collapse into one; 快速取现 is synthesized
	// because a relation endpoint without its own row must still be drawable.
	if payload.Stats.Entities != 4 {
		t.Fatalf("entities = %d, want 4: %+v", payload.Stats.Entities, nodeNames(payload))
	}
	// issue (merged from 发行+发售), supports, constrains. Self loop dropped.
	if payload.Stats.Relations != 3 {
		t.Fatalf("relations = %d, want 3: %+v", payload.Stats.Relations, payload.Graph.Edges)
	}

	var issue Edge
	for _, edge := range payload.Graph.Edges {
		if edge.Type == "issue" {
			issue = edge
		}
	}
	if issue.ID == "" {
		t.Fatal("missing normalized issue edge")
	}
	if issue.Support.Chunks != 2 {
		t.Errorf("issue support.chunks = %d, want 2 (发行+发售 corroborate each other)", issue.Support.Chunks)
	}
	if issue.Support.Docs != 2 {
		t.Errorf("issue support.docs = %d, want 2", issue.Support.Docs)
	}
	if issue.Confidence <= 0.5 || issue.Confidence >= 0.9 {
		t.Errorf("issue confidence = %v, want derived from 2 chunks", issue.Confidence)
	}
	if len(issue.Evidence) == 0 || issue.Evidence[0].DocName == "" || issue.Evidence[0].Page == 0 {
		t.Errorf("issue evidence = %+v, want doc name + page", issue.Evidence)
	}
	if issue.TypeLabel != "发行" {
		t.Errorf("issue label = %q, want 发行", issue.TypeLabel)
	}

	var fundNode *Node
	for i := range payload.Graph.Nodes {
		if payload.Graph.Nodes[i].Name == "华夏基金管理有限公司" {
			fundNode = &payload.Graph.Nodes[i]
		}
	}
	if fundNode == nil {
		t.Fatalf("merged node missing: %+v", nodeNames(payload))
	}
	if fundNode.Type != "fund_company" {
		t.Errorf("merged node type = %q, want fund_company", fundNode.Type)
	}
	if fundNode.Degree != 1 {
		t.Errorf("merged node degree = %d, want 1", fundNode.Degree)
	}
	if !containsString(fundNode.Aliases, "华夏基金") {
		t.Errorf("merged node aliases = %v, want 华夏基金 kept as an alias", fundNode.Aliases)
	}
	if len(fundNode.SourceDocs) != 2 {
		t.Errorf("merged node source docs = %+v, want both documents", fundNode.SourceDocs)
	}
}

func TestBuildCountsTypesOnTheFullGraph(t *testing.T) {
	payload := Build(financeInput(), Options{MaxNodes: 2, MaxEdges: 1})

	if !payload.Stats.Truncated {
		t.Fatal("Stats.Truncated = false, want true after cutting nodes/edges")
	}
	if payload.Stats.ReturnedEntities != 2 || payload.Stats.ReturnedRelations > 1 {
		t.Fatalf("returned = (%d, %d), want (2, <=1)", payload.Stats.ReturnedEntities, payload.Stats.ReturnedRelations)
	}
	if payload.Stats.Entities != 4 || payload.Stats.Relations != 3 {
		t.Fatalf("stats must describe the full graph, got %+v", payload.Stats)
	}
	// Legend counts stay honest even when the canvas is cut down.
	total := 0
	for _, tc := range payload.EntityTypes {
		total += tc.Count
	}
	if total != 4 {
		t.Errorf("entity type counts total = %d, want 4", total)
	}
	// No dangling edges may survive the node cut.
	known := map[string]struct{}{}
	for _, node := range payload.Graph.Nodes {
		known[node.ID] = struct{}{}
	}
	for _, edge := range payload.Graph.Edges {
		if _, ok := known[edge.Source]; !ok {
			t.Errorf("edge %s references a cut node", edge.ID)
		}
		if _, ok := known[edge.Target]; !ok {
			t.Errorf("edge %s references a cut node", edge.ID)
		}
	}
}

func TestBuildRejectsSelfLoopsAndBlankRows(t *testing.T) {
	payload := Build(Input{
		Entities: []RawEntity{
			{Name: "  ", Type: "公司"},
			{Name: "A", Type: "公司"},
		},
		Relations: []RawRelation{
			{From: "A", To: "A", Type: "相关"},
			{From: "A", To: "", Type: "相关"},
		},
	}, Options{})

	if payload.Stats.Entities != 1 {
		t.Fatalf("entities = %d, want 1", payload.Stats.Entities)
	}
	if payload.Stats.Relations != 0 {
		t.Fatalf("relations = %d, want 0", payload.Stats.Relations)
	}
}

func TestBuildUsesExplicitConfidenceWhenPresent(t *testing.T) {
	payload := Build(Input{
		Entities: []RawEntity{
			{Name: "宁德时代", Type: "供应商"},
			{Name: "电池包", Type: "零部件"},
		},
		Relations: []RawRelation{
			{From: "宁德时代", To: "电池包", Type: "供货", Confidence: 0.98, ChunkIDs: []string{"c1"}},
		},
	}, Options{})

	edge := payload.Graph.Edges[0]
	if edge.Confidence != 0.98 {
		t.Errorf("confidence = %v, want the extracted 0.98 to win over the derived value", edge.Confidence)
	}
	if payload.Stats.Domain != DomainAuto {
		t.Errorf("domain = %q, want auto for supplier/component", payload.Stats.Domain)
	}
	if payload.Stats.WithEvidence != 0 {
		t.Errorf("with_evidence = %d, want 0 when the chunk was not resolved", payload.Stats.WithEvidence)
	}
}

func nodeNames(payload *Payload) []string {
	names := make([]string, 0, len(payload.Graph.Nodes))
	for _, node := range payload.Graph.Nodes {
		names = append(names, node.Name)
	}
	return names
}
