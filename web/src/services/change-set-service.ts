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

import { restAPIv1 } from '@/utils/api';
import request from '@/utils/request';

export interface IChangeSet {
  id: string;
  kb_id: string;
  tenant_id: string;
  created_by: string;
  status: 'open' | 'tested' | 'published' | 'discarded';
  create_time?: number;
}

export interface ISimilarQuestionDiff {
  chunk_id: string;
  document_id: string;
  question?: string;
  before: string[];
  after: string[];
}

export interface ISynonymGroupDiff {
  group_id: string;
  name: string;
  group_type: 'synonym' | 'proper';
  scope: 'kb' | 'tenant';
  source_group_id?: string;
  before: string[];
  after: string[];
}

export interface IChangeSetDiff {
  change_set_id: string;
  similar_questions: ISimilarQuestionDiff[];
  synonyms: ISynonymGroupDiff[];
}

/**
 * Selection scope for a publish / discard / compare. Sent only when the user
 * has items selected in the change center list; both arrays are always present
 * (possibly empty) so the backend can tell "no similar questions selected"
 * apart from "no scope at all".
 */
export interface IChangeSetScope {
  chunk_ids: string[];
  group_ids: string[];
}

export interface IGenerateItem {
  chunk_id: string;
  document_id: string;
  question: string;
  answer: string;
}

export interface IGenerateCandidate {
  chunk_id: string;
  document_id: string;
  question: string;
  candidates: string[];
  error?: string;
}

/** One retrieved chunk in either comparison column. */
export interface ICompareHit {
  chunk_id: string;
  doc_keyword?: string;
  content?: string;
  similarity: number;
  /** 1-based, so the UI can render "#1" directly. */
  rank: number;
}

export interface ICompareSide {
  hits: ICompareHit[];
  took_ms: number;
  total: number;
}

export interface ICompareDiffItem {
  chunk_id: string;
  doc_keyword?: string;
  content?: string;
  similarity?: number;
  rank?: number;
  before_rank?: number;
  after_rank?: number;
  before_score?: number;
  after_score?: number;
  delta?: number;
  /** Only set on removed items. */
  reason?: 'pushed_out_of_topk' | 'not_recalled';
}

export interface ICompareDiffSummary {
  baseline_count: number;
  candidate_count: number;
  added_count: number;
  removed_count: number;
  reordered_count: number;
  displaced_count: number;
  score_changed_count: number;
  avg_delta_on_common: number;
  common_count: number;
}

export interface ICompareDiff {
  added: ICompareDiffItem[];
  removed: ICompareDiffItem[];
  reordered_common: ICompareDiffItem[];
  score_changed: ICompareDiffItem[];
  summary: ICompareDiffSummary;
}

export interface ICompareCapability {
  synonym_simulated: boolean;
  similar_q_simulated: boolean;
  unsolved_reasons: string[];
  affected_chunk_count: number;
  skipped_similar_count: number;
}

export interface IRetrievalCompareResult {
  baseline: ICompareSide;
  candidate: ICompareSide;
  diff: ICompareDiff;
  capability: ICompareCapability;
  /**
   * 新配置比原配置多出来的检索词 —— 即本次变更真正进入了检索的部分。
   * 用于回答「为什么显示无差异」：如果这些词在语料里不存在，
   * 字典再正确也不会产生新召回。
   */
  extra_query_terms?: string[];
  /** 问题被切成了哪些词（词典按 token 索引）。 */
  query_tokens?: string[];
  /** 变更集实际为哪些 token 供给了同义词。 */
  synonym_override_keys?: string[];
}

export const listChangeSets = (datasetId: string) =>
  request.get(`${restAPIv1}/datasets/${datasetId}/change-sets`);

export const createChangeSet = (datasetId: string) =>
  request.post(`${restAPIv1}/datasets/${datasetId}/change-sets`, { data: {} });

/**
 * 获取当前用户在该知识库的开放变更集，没有则新建。
 * 后端 ListChangeSets 只返回 open/tested 状态的变更集，取当前用户的第一个。
 */
export const getOrCreateChangeSet = async (
  datasetId: string,
): Promise<string> => {
  const res = await listChangeSets(datasetId);
  const sets: IChangeSet[] = res?.data?.data ?? [];
  if (sets.length > 0) {
    return sets[0].id;
  }
  const created = await createChangeSet(datasetId);
  return created?.data?.data?.id ?? '';
};

export const getChangeSetDiff = (datasetId: string, changeSetId: string) =>
  request.get(
    `${restAPIv1}/datasets/${datasetId}/change-sets/${changeSetId}/diff`,
  );

export const stageSimilarQuestions = (
  datasetId: string,
  data: {
    change_set_id?: string;
    document_id: string;
    chunk_id: string;
    questions: string[];
    origin?: 'manual' | 'llm' | 'imported';
  },
) =>
  request.post(
    `${restAPIv1}/datasets/${datasetId}/change-sets/similar-questions`,
    { data },
  );

export const generateSimilarQuestions = (
  datasetId: string,
  data: {
    items: IGenerateItem[];
    prompt?: string;
    count?: number;
    model_ref?: string;
  },
) =>
  request.post(
    `${restAPIv1}/datasets/${datasetId}/change-sets/generate-questions`,
    { data },
  );

export const publishChangeSet = (
  datasetId: string,
  changeSetId: string,
  scope?: IChangeSetScope,
) =>
  request.post(
    `${restAPIv1}/datasets/${datasetId}/change-sets/publish`,
    scope
      ? { data: { change_set_id: changeSetId, scope } }
      : { data: { change_set_id: changeSetId } },
  );

export const discardChangeSet = (
  datasetId: string,
  changeSetId: string,
  scope?: IChangeSetScope,
) =>
  request.post(
    `${restAPIv1}/datasets/${datasetId}/change-sets/discard`,
    scope
      ? { data: { change_set_id: changeSetId, scope } }
      : { data: { change_set_id: changeSetId } },
  );

/**
 * 影子检索对比：同一问题跑两遍（原配置 / 原配置+变更集），返回双栏结果与差异。
 *
 * 不重建索引：同义词通过 query 扩写精确模拟，相似问通过注入 chunk token 模拟
 * （仅 rerank 路径可模拟，能力由返回的 capability 告知）。
 */
export const retrievalCompare = (
  datasetId: string,
  changeSetId: string,
  data: {
    dataset_ids: string[];
    question: string;
    top_k?: number;
    similarity_threshold?: number;
    vector_similarity_weight?: number;
    page?: number;
    size?: number;
    doc_ids?: string[];
    shadow_similar_questions?: boolean;
    scope?: IChangeSetScope;
  },
) =>
  request.post(
    `${restAPIv1}/datasets/${datasetId}/change-sets/${changeSetId}/retrieval-compare`,
    { data },
  );
