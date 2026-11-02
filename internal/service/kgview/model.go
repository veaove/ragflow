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

// Default and hard limits for one graph response. The page draws an SVG, so a
// dataset with tens of thousands of edges cannot be sent whole; the limits are
// reported back via Stats.Truncated instead of silently cutting the graph.
const (
	DefaultMaxNodes = 400
	DefaultMaxEdges = 800
	MaxNodesLimit   = 2000
	MaxEdgesLimit   = 4000
)

// RawEntity is one extracted entity row, already projected out of the
// document store. The builder never sees engine-specific field names.
type RawEntity struct {
	Name         string
	Type         string
	Description  string
	Aliases      []string
	MentionCount int
	ChunkIDs     []string
	DocIDs       []string
}

// RawRelation is one extracted relation row. Confidence is zero when the
// extractor stored none, in which case the builder derives it.
type RawRelation struct {
	From        string
	To          string
	Type        string
	Description string
	ChunkIDs    []string
	DocIDs      []string
	Confidence  float64
}

// Evidence is the traceable provenance the detail panel shows: which document,
// which page, and the snippet the triple was read from.
type Evidence struct {
	DocID   string `json:"doc_id,omitempty"`
	DocName string `json:"doc_name,omitempty"`
	Page    int    `json:"page,omitempty"`
	ChunkID string `json:"chunk_id,omitempty"`
	Snippet string `json:"snippet,omitempty"`
}

// SourceDoc names a document that contributed to an entity/relation.
type SourceDoc struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Input is everything the builder reads. Evidence is indexed by chunk id so the
// caller can batch-resolve provenance once per request; DocNames covers rows
// whose source chunks have already been deleted.
type Input struct {
	Entities  []RawEntity
	Relations []RawRelation
	Evidence  map[string]Evidence
	DocNames  map[string]string
}

// Options controls what one response contains.
type Options struct {
	MaxNodes int
	MaxEdges int
	// Keywords/Mode drive the three search entries (entity / relation /
	// natural language). Empty keywords means "browse the whole graph".
	Keywords string
	Mode     string
}

// Node is one entity in the response.
type Node struct {
	ID           string      `json:"id"`
	Name         string      `json:"name"`
	Type         string      `json:"type"`
	TypeLabel    string      `json:"type_label"`
	Color        string      `json:"color"`
	Icon         string      `json:"icon"`
	RawType      string      `json:"raw_type,omitempty"`
	Description  string      `json:"description,omitempty"`
	Aliases      []string    `json:"aliases,omitempty"`
	MentionCount int         `json:"mention_count"`
	Degree       int         `json:"degree"`
	SourceDocs   []SourceDoc `json:"source_docs,omitempty"`
	Evidence     []Evidence  `json:"evidence,omitempty"`
}

// Support counts how many distinct chunks/documents corroborate an edge.
type Support struct {
	Chunks int `json:"chunks"`
	Docs   int `json:"docs"`
}

// Edge is one directed, typed relation in the response.
type Edge struct {
	ID          string     `json:"id"`
	Source      string     `json:"source"`
	Target      string     `json:"target"`
	Type        string     `json:"type"`
	TypeLabel   string     `json:"type_label"`
	RawTypes    []string   `json:"raw_types,omitempty"`
	Normalized  bool       `json:"normalized"`
	Description string     `json:"description,omitempty"`
	Confidence  float64    `json:"confidence"`
	Support     Support    `json:"support"`
	Evidence    []Evidence `json:"evidence,omitempty"`
}

// Graph is the {nodes, edges} pair the canvas renders.
type Graph struct {
	Nodes []Node `json:"nodes"`
	Edges []Edge `json:"edges"`
}

// TypeCount is one legend/filter row.
type TypeCount struct {
	Type   string `json:"type"`
	Label  string `json:"label"`
	Color  string `json:"color,omitempty"`
	Icon   string `json:"icon,omitempty"`
	Domain string `json:"domain,omitempty"`
	Count  int    `json:"count"`
}

// Stats describes the graph before truncation so the page can say "showing
// 400 of 1w" instead of pretending the cut graph is complete.
type Stats struct {
	Entities          int    `json:"entities"`
	Relations         int    `json:"relations"`
	WithEvidence      int    `json:"with_evidence"`
	// UnnormalizedRelations counts edges whose type is outside the canonical
	// vocabulary. They stay visible (dropping them would hide extracted
	// knowledge) but the number is the queue size for extending the alias table.
	UnnormalizedRelations int    `json:"unnormalized_relations"`
	ReturnedEntities      int    `json:"returned_entities"`
	ReturnedRelations     int    `json:"returned_relations"`
	Truncated             bool   `json:"truncated"`
	Domain                string `json:"domain"`
}

// Intent is what the natural-language entry understood. It carries structure
// rather than a sentence so the client renders the "理解为查询" wording in the
// active locale.
type Intent struct {
	RelationTypes []string `json:"relation_types"`
	EntityIDs     []string `json:"entity_ids"`
}

// SearchResult names the subgraph a query hit; the UI dims everything else
// instead of deleting it so the match keeps its context.
type SearchResult struct {
	Mode           string   `json:"mode"`
	MatchedNodeIDs []string `json:"matched_node_ids"`
	MatchedEdgeIDs []string `json:"matched_edge_ids"`
	Intent         *Intent  `json:"intent,omitempty"`
}

// Payload is the whole response body of GET /datasets/:id/graph.
type Payload struct {
	Graph         Graph       `json:"graph"`
	Stats         Stats       `json:"stats"`
	EntityTypes   []TypeCount `json:"entity_types"`
	RelationTypes []TypeCount `json:"relation_types"`
	Search        *SearchResult `json:"search,omitempty"`
}
