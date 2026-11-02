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
	"sort"
	"strings"
)

// Search modes. "auto" runs the entity and relation matches and, when the query
// reads like a question, also the natural-language intent path.
const (
	ModeAuto     = "auto"
	ModeEntity   = "entity"
	ModeRelation = "relation"
	ModeNL       = "nl"
)

// maxMatches bounds the id lists; the canvas only needs to know what to
// highlight, and an unbounded list would dwarf the graph payload.
const maxMatches = 500

// questionWords mark a query as a question rather than a keyword lookup.
var questionWords = []string{
	"哪些", "哪个", "什么", "谁", "如何", "怎么", "是否", "多少", "哪家", "哪款", "哪类", "吗", "？", "?",
}

// Search matches a query against the built graph and reports what to highlight.
//
// Three entries share one implementation because they only differ in which half
// of the result contributes: entities by name/attribute, relations by type or
// triple text, and natural language by translating the question into relation
// types plus entity mentions ("哪些基金支持 T+0" → relation=supports).
func Search(payload *Payload, keywords, mode string) *SearchResult {
	query := strings.TrimSpace(keywords)
	if query == "" || payload == nil {
		return nil
	}
	mode = normalizeSearchMode(mode)
	result := &SearchResult{Mode: mode}

	queryKey := NormalizeName(query)
	entityHits := matchNodes(payload, query, queryKey)
	relationHits := matchEdges(payload, query, queryKey)

	var intent *Intent
	if mode == ModeAuto || mode == ModeNL {
		intent = parseIntent(payload, queryKey)
	}
	result.Intent = intent

	nodes := newIDSet()
	edges := newIDSet()
	if mode == ModeEntity || mode == ModeAuto || mode == ModeNL {
		nodes.add(entityHits...)
	}
	if mode == ModeRelation || mode == ModeAuto || mode == ModeNL {
		edges.add(relationHits...)
		addEdgeEndpoints(payload, edges, nodes)
	}
	if intent != nil {
		nodes.add(intent.EntityIDs...)
		for _, edge := range payload.Graph.Edges {
			if !containsString(intent.RelationTypes, edge.Type) {
				continue
			}
			if len(intent.EntityIDs) > 0 && !containsString(intent.EntityIDs, edge.Source) && !containsString(intent.EntityIDs, edge.Target) {
				continue
			}
			edges.add(edge.ID)
			nodes.add(edge.Source, edge.Target)
		}
	}

	result.MatchedNodeIDs = nodes.sorted()
	result.MatchedEdgeIDs = edges.sorted()
	return result
}

func normalizeSearchMode(mode string) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case ModeEntity:
		return ModeEntity
	case ModeRelation:
		return ModeRelation
	case ModeNL:
		return ModeNL
	default:
		return ModeAuto
	}
}

func matchNodes(payload *Payload, query, queryKey string) []string {
	q := strings.ToLower(query)
	hits := make([]string, 0, 8)
	for _, node := range payload.Graph.Nodes {
		matched := strings.Contains(NormalizeName(node.Name), queryKey) ||
			strings.Contains(strings.ToLower(node.TypeLabel), q) ||
			strings.Contains(strings.ToLower(node.RawType), q)
		if !matched && len([]rune(queryKey)) >= 2 && strings.TrimSpace(node.Description) != "" {
			matched = strings.Contains(NormalizeName(node.Description), queryKey)
		}
		if !matched {
			for _, alias := range node.Aliases {
				if strings.Contains(NormalizeName(alias), queryKey) {
					matched = true
					break
				}
			}
		}
		if matched {
			hits = append(hits, node.ID)
		}
	}
	return hits
}

func matchEdges(payload *Payload, query, queryKey string) []string {
	q := strings.ToLower(query)
	nameByID := make(map[string]string, len(payload.Graph.Nodes))
	for _, node := range payload.Graph.Nodes {
		nameByID[node.ID] = node.Name
	}
	hits := make([]string, 0, 8)
	for _, edge := range payload.Graph.Edges {
		matched := strings.Contains(NormalizeName(edge.TypeLabel), queryKey) ||
			strings.Contains(strings.ToLower(edge.Type), q)
		if !matched {
			for _, raw := range edge.RawTypes {
				if strings.Contains(NormalizeName(raw), queryKey) {
					matched = true
					break
				}
			}
		}
		if !matched && len([]rune(queryKey)) >= 2 {
			triple := NormalizeName(nameByID[edge.Source] + edge.TypeLabel + nameByID[edge.Target])
			matched = strings.Contains(triple, queryKey) ||
				strings.Contains(NormalizeName(edge.Description), queryKey)
		}
		if matched {
			hits = append(hits, edge.ID)
		}
	}
	return hits
}

// parseIntent translates a question into the graph query it implies: the
// relation types named (through the alias table, so "供货" also means 供应) and
// the entities it mentions.
func parseIntent(payload *Payload, queryKey string) *Intent {
	if queryKey == "" {
		return nil
	}
	intent := &Intent{}
	seenTypes := newIDSet()
	for alias, canonical := range relationTypeAliases {
		// Single-character aliases ("需", "造") fire on almost every sentence.
		if len([]rune(alias)) < 2 || !strings.Contains(queryKey, alias) {
			continue
		}
		seenTypes.add(canonical)
	}
	for _, edge := range payload.Graph.Edges {
		for _, raw := range edge.RawTypes {
			rawKey := NormalizeName(raw)
			if len([]rune(rawKey)) >= 2 && strings.Contains(queryKey, rawKey) {
				seenTypes.add(edge.Type)
			}
		}
	}

	type mention struct {
		id   string
		size int
	}
	mentions := make([]mention, 0, 4)
	for _, node := range payload.Graph.Nodes {
		nameKey := NormalizeName(node.Name)
		if len([]rune(nameKey)) < 2 || !strings.Contains(queryKey, nameKey) {
			continue
		}
		mentions = append(mentions, mention{id: node.ID, size: len([]rune(nameKey))})
	}
	sort.SliceStable(mentions, func(i, j int) bool { return mentions[i].size > mentions[j].size })
	entityIDs := newIDSet()
	for _, candidate := range mentions {
		entityIDs.add(candidate.id)
		if entityIDs.len() >= 3 {
			break
		}
	}

	isQuestion := false
	for _, word := range questionWords {
		// "？" normalizes to an empty string, which Contains() always matches.
		wordKey := NormalizeName(word)
		if wordKey == "" {
			continue
		}
		if strings.Contains(queryKey, wordKey) {
			isQuestion = true
			break
		}
	}
	if seenTypes.len() == 0 && !isQuestion {
		return nil
	}
	intent.RelationTypes = seenTypes.sorted()
	intent.EntityIDs = entityIDs.sorted()
	return intent
}

func addEdgeEndpoints(payload *Payload, edges, nodes *idSet) {
	if edges.len() == 0 {
		return
	}
	wanted := edges.set()
	for _, edge := range payload.Graph.Edges {
		if _, ok := wanted[edge.ID]; !ok {
			continue
		}
		nodes.add(edge.Source, edge.Target)
	}
}

func containsString(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

type idSet struct {
	items map[string]struct{}
}

func newIDSet() *idSet {
	return &idSet{items: map[string]struct{}{}}
}

func (s *idSet) add(ids ...string) {
	for _, id := range ids {
		if id != "" {
			s.items[id] = struct{}{}
		}
	}
}

func (s *idSet) len() int {
	return len(s.items)
}

func (s *idSet) set() map[string]struct{} {
	return s.items
}

func (s *idSet) sorted() []string {
	out := make([]string, 0, len(s.items))
	for id := range s.items {
		out = append(out, id)
	}
	sort.Strings(out)
	if len(out) > maxMatches {
		out = out[:maxMatches]
	}
	return out
}
