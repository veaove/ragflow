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

import { IReference, IReferenceChunk } from '@/interfaces/database/chat';
import { buildRetrievalSteps, EmptyReference } from './utils';

const chunk = (over: Partial<IReferenceChunk> = {}): IReferenceChunk => ({
  id: 'c1',
  content: '问题：基金怎么买\t回答：可通过官网、APP 购买。',
  document_id: 'doc-1',
  document_name: '基金FAQ.txt',
  dataset_id: 'kb-1',
  image_id: '',
  similarity: 0.83,
  vector_similarity: 0.8,
  term_similarity: 0.86,
  positions: [],
  ...over,
});

const reference = (chunks: IReferenceChunk[], total?: number): IReference => ({
  chunks,
  doc_aggs: [],
  total: total ?? chunks.length,
});

describe('buildRetrievalSteps', () => {
  it('把引用折叠成「检索」一步，并保留切片正文与相似度', () => {
    const steps = buildRetrievalSteps(reference([chunk()], 5), '你好');

    expect(steps).toHaveLength(2);
    const retrieval = steps[0];
    expect(retrieval.type).toBe('retrieval');
    expect(retrieval.status).toBe('done');
    // total 优先于实际条数：后端可能只回传前若干条，但命中数要显示总数
    expect(retrieval.chunkCount).toBe(5);
    expect(retrieval.chunks).toEqual([
      {
        id: 'c1',
        content: '问题：基金怎么买\t回答：可通过官网、APP 购买。',
        similarity: 0.83,
        documentId: 'doc-1',
        documentName: '基金FAQ.txt',
      },
    ]);
  });

  it('回答长度进入第二步，避免出现空白行', () => {
    const steps = buildRetrievalSteps(reference([chunk()]), '这是一段回答');

    expect(steps[1].type).toBe('agent');
    expect(steps[1].outputChars).toBe('这是一段回答'.length);
  });

  it('没有命中切片时只有「生成回答」一步', () => {
    const steps = buildRetrievalSteps(EmptyReference, '直接回答');

    expect(steps).toHaveLength(1);
    expect(steps[0].type).toBe('agent');
  });

  it('既没引用也没回答时返回空数组，面板不渲染', () => {
    expect(buildRetrievalSteps(EmptyReference, '')).toEqual([]);
  });

  it('content 为 null 的切片降级成空串，而不是让整行渲染失败', () => {
    const steps = buildRetrievalSteps(reference([chunk({ content: null })]), '答');

    expect(steps[0].chunks?.[0].content).toBe('');
  });

  it('不编造各步耗时——Chat 应用没有节点事件，界面上不该出现假的秒数', () => {
    const steps = buildRetrievalSteps(reference([chunk()]), '答');

    for (const step of steps) {
      expect(step.elapsed).toBeUndefined();
    }
  });
});
