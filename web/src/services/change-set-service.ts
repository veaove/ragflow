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

export const listChangeSets = (datasetId: string) =>
  request.get(`${restAPIv1}/datasets/${datasetId}/change-sets`);

export const createChangeSet = (datasetId: string) =>
  request.post(`${restAPIv1}/datasets/${datasetId}/change-sets`, { data: {} });

/**
 * 获取当前用户在该知识库的开放变更集，没有则新建。
 * 后端 ListChangeSets 只返回 open/tested 状态的变更集，取当前用户的第一个。
 */
export const getOrCreateChangeSet = async (datasetId: string): Promise<string> => {
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

export const publishChangeSet = (datasetId: string, changeSetId: string) =>
  request.post(
    `${restAPIv1}/datasets/${datasetId}/change-sets/publish`,
    { data: { change_set_id: changeSetId } },
  );

export const discardChangeSet = (datasetId: string, changeSetId: string) =>
  request.post(
    `${restAPIv1}/datasets/${datasetId}/change-sets/discard`,
    { data: { change_set_id: changeSetId } },
  );
