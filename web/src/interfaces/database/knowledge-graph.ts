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

/** Canonical entity/relation type row (legend + filter). */
export interface IKGGraphType {
  type: string;
  label: string;
  color?: string;
  icon?: string;
  domain?: string;
  count: number;
}

/** One traceable source: document + page + the text the triple came from. */
export interface IKGEvidence {
  doc_id?: string;
  doc_name?: string;
  page?: number;
  chunk_id?: string;
  snippet?: string;
}

export interface IKGDocRef {
  id: string;
  name: string;
}

export interface IKGGraphNode {
  id: string;
  name: string;
  /** canonical type id, e.g. fund_company */
  type: string;
  type_label: string;
  color?: string;
  icon?: string;
  /** the type string the extractor emitted, kept for the detail panel */
  raw_type?: string;
  description?: string;
  aliases?: string[];
  mention_count: number;
  degree: number;
  source_docs?: IKGDocRef[];
  evidence?: IKGEvidence[];
}

export interface IKGGraphEdge {
  id: string;
  source: string;
  target: string;
  /** canonical relation type id, e.g. supplies */
  type: string;
  type_label: string;
  raw_types?: string[];
  /** false when the type is not in the normalized vocabulary */
  normalized: boolean;
  description?: string;
  /** 0..1, derived from corroborating chunks unless the extractor stored one */
  confidence: number;
  support: { chunks: number; docs: number };
  evidence?: IKGEvidence[];
}

export interface IKGGraphStats {
  entities: number;
  relations: number;
  with_evidence: number;
  /** relations whose type is outside the canonical vocabulary */
  unnormalized_relations: number;
  returned_entities: number;
  returned_relations: number;
  truncated: boolean;
  domain: string;
}

export interface IKGGraphIntent {
  relation_types: string[];
  entity_ids: string[];
}

export interface IKGGraphSearch {
  mode: 'auto' | 'entity' | 'relation' | 'nl';
  matched_node_ids: string[];
  matched_edge_ids: string[];
  intent?: IKGGraphIntent;
}

export interface IKnowledgeGraph {
  graph: { nodes: IKGGraphNode[]; edges: IKGGraphEdge[] };
  stats: IKGGraphStats;
  entity_types: IKGGraphType[];
  relation_types: IKGGraphType[];
  search?: IKGGraphSearch;
}
