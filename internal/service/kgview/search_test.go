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

import "testing"

func autoInput() Input {
	return Input{
		Entities: []RawEntity{
			{Name: "特斯拉", Type: "整车厂"},
			{Name: "Model Y", Type: "车型"},
			{Name: "电池包", Type: "零部件"},
			{Name: "宁德时代", Type: "供应商"},
		},
		Relations: []RawRelation{
			{From: "特斯拉", To: "Model Y", Type: "生产"},
			{From: "Model Y", To: "电池包", Type: "装配"},
			{From: "宁德时代", To: "电池包", Type: "供货"},
		},
	}
}

func TestSearchMatchesEntityNamesAttentionToAttributes(t *testing.T) {
	payload := Build(autoInput(), Options{})

	result := Search(payload, "宁德", ModeEntity)
	if len(result.MatchedNodeIDs) != 1 {
		t.Fatalf("matched nodes = %v, want the supplier only", result.MatchedNodeIDs)
	}
	if len(result.MatchedEdgeIDs) != 0 {
		t.Fatalf("entity mode matched edges = %v, want none", result.MatchedEdgeIDs)
	}
	if result.Intent != nil {
		t.Fatalf("entity mode produced an intent: %+v", result.Intent)
	}
}

func TestSearchMatchesRelationTypeThroughAliases(t *testing.T) {
	payload := Build(autoInput(), Options{})

	// "供货" is not the stored type label (供应), it is an alias for it.
	result := Search(payload, "供货", ModeRelation)
	if len(result.MatchedEdgeIDs) != 1 {
		t.Fatalf("matched edges = %v, want the supplies edge", result.MatchedEdgeIDs)
	}
	// Endpoints of a matched edge are highlighted with it.
	if len(result.MatchedNodeIDs) != 2 {
		t.Fatalf("matched nodes = %v, want both endpoints", result.MatchedNodeIDs)
	}
}

func TestSearchNaturalLanguageInfersRelationAndEntity(t *testing.T) {
	payload := Build(autoInput(), Options{})

	result := Search(payload, "宁德时代供货的车型有哪些", ModeNL)
	if result.Intent == nil {
		t.Fatal("expected an intent for the question")
	}
	if !containsString(result.Intent.RelationTypes, "supplies") {
		t.Fatalf("intent relation types = %v, want supplies", result.Intent.RelationTypes)
	}
	if len(result.Intent.EntityIDs) == 0 {
		t.Fatal("intent did not recognize any entity mention")
	}
	// The question is about the supplier, so its edge must be highlighted.
	if len(result.MatchedEdgeIDs) == 0 {
		t.Fatalf("no edges matched: %+v", result)
	}
}

func TestSearchAutoFallsBackToKeywordMatching(t *testing.T) {
	payload := Build(autoInput(), Options{})

	result := Search(payload, "Model Y", ModeAuto)
	if len(result.MatchedNodeIDs) == 0 {
		t.Fatalf("auto mode matched no node for a plain keyword: %+v", result)
	}
}

func TestSearchReportsNoIntentForPlainKeyword(t *testing.T) {
	payload := Build(autoInput(), Options{})

	result := Search(payload, "电池包", ModeAuto)
	if result.Intent != nil {
		t.Fatalf("plain keyword produced an intent: %+v", result.Intent)
	}
}

func TestBuildAttachesSearchOnlyWhenAsked(t *testing.T) {
	if payload := Build(autoInput(), Options{}); payload.Search != nil {
		t.Fatal("search must stay nil without keywords")
	}
	payload := Build(autoInput(), Options{Keywords: "供货", Mode: ModeRelation})
	if payload.Search == nil || payload.Search.Mode != ModeRelation {
		t.Fatalf("search = %+v, want relation mode", payload.Search)
	}
}
