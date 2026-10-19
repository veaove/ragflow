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

export type SynonymDomain = 'fund' | 'hx';

export interface ISynonymWord {
  id?: string;
  word: string;
  is_primary?: boolean;
}

export interface ISynonymGroup {
  id: string;
  dataset_id: string;
  name: string;
  domain: SynonymDomain;
  remark?: string;
  word_count: number;
  words?: ISynonymWord[];
  create_time?: number;
  update_time?: number;
}

export interface ISynonymImportRow {
  concept: string;
  aliases: string[];
  remark?: string;
}

// The backend answers with {code, message, data} and the alova client already
// exposes the parsed body, so callers read response.data.data.

export const listSynonymGroups = (datasetId: string, domain?: SynonymDomain) =>
  request.get(`${restAPIv1}/datasets/${datasetId}/synonym-groups`, {
    params: domain ? { domain } : undefined,
  });

export const getSynonymGroup = (groupId: string) =>
  request.get(`${restAPIv1}/synonym-groups/${groupId}`);

export const createSynonymGroup = (
  datasetId: string,
  data: {
    name: string;
    domain: SynonymDomain;
    remark?: string;
    words: ISynonymWord[];
  },
) =>
  request.post(`${restAPIv1}/datasets/${datasetId}/synonym-groups`, {
    data,
  });

export const updateSynonymGroup = (
  groupId: string,
  data: {
    name?: string;
    domain?: SynonymDomain;
    remark?: string;
    words?: ISynonymWord[];
  },
) =>
  request.put(`${restAPIv1}/synonym-groups/${groupId}`, { data });

export const deleteSynonymGroup = (groupId: string) =>
  request.delete(`${restAPIv1}/synonym-groups/${groupId}`);

export const importSynonymGroups = (
  datasetId: string,
  data: { domain: SynonymDomain; rows: ISynonymImportRow[] },
) =>
  request.post(
    `${restAPIv1}/datasets/${datasetId}/synonym-groups/import`,
    { data },
  );