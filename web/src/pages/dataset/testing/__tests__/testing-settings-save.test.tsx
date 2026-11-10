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

import { act, fireEvent, render, screen } from '@testing-library/react';

import TestingForm from '../testing-form';

jest.mock('react-router', () => ({
  __esModule: true,
  useParams: () => ({ id: 'kb-1' }),
}));

jest.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('sonner', () => ({
  __esModule: true,
  toast: { success: jest.fn(), error: jest.fn() },
}));

// 只保留会改表单的那个控件：rerank 选择器就是「换 rerank 模型」的入口。
jest.mock('@/components/rerank', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useFormContext } = require('react-hook-form');
  return {
    __esModule: true,
    rerankFormSchema: {},
    RerankFormFields: () => {
      // 真实控件会 register 这个字段；不 register 的话 useWatch 看不到 setValue，
      // 快照不变，保存也就不会触发。
      const { register, setValue } = useFormContext();
      return (
        <>
          <input data-testid="rerank-field" {...register('rerank_id')} />
          <button
            type="button"
            onClick={() =>
              setValue('rerank_id', 'qwen3-rerank@default@tongyi', {
                shouldDirty: true,
                shouldTouch: true,
              })
            }
          >
            pick-rerank
          </button>
        </>
      );
    },
  };
});

jest.mock('@/components/similarity-slider', () => ({
  __esModule: true,
  similarityThresholdSchema: {},
  keywordsSimilarityWeightSchema: {},
  initialSimilarityThresholdValue: { similarity_threshold: 0.2 },
  initialKeywordsSimilarityWeightValue: { keywords_similarity_weight: 0.3 },
  SimilaritySliderFormField: () => null,
}));

jest.mock('@/components/cross-language-form-field', () => ({
  __esModule: true,
  CrossLanguageFormField: () => null,
}));

jest.mock('@/components/metadata-filter', () => ({
  __esModule: true,
  MetadataFilterSchema: {},
  MetadataFilter: () => null,
}));

jest.mock('@/components/rerank-candidates-count-item', () => ({
  __esModule: true,
  rerankCandidatesCountSchema: {},
  RerankCandidatesCountFormField: () => null,
}));

jest.mock('@/components/top-select', () => ({
  __esModule: true,
  TopSelectFormItem: () => null,
}));

jest.mock('@/hooks/use-knowledge-request', () => ({
  __esModule: true,
  useFetchKnowledgeBaseConfiguration: () => ({
    data: { id: 'kb-1' },
    loading: false,
  }),
  useTestRetrieval: () => ({ loading: false, refetch: jest.fn() }),
}));

jest.mock('@/services/knowledge-service', () => ({
  __esModule: true,
  updateKb: jest.fn(),
}));

let mockKnowledgeBase: Record<string, unknown> = {};

jest.mock('../../contexts/knowledge-base-context', () => ({
  __esModule: true,
  useOwnerTenantId: () => 'tenant-1',
  useKnowledgeBaseContext: () => ({
    knowledgeBase: mockKnowledgeBase,
    loading: false,
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const knowledgeService = require('@/services/knowledge-service');

/**
 * 检索测试面板会把设置写回知识库（rerank 模型、阈值、权重）。只读成员读得到
 * 知识库、也跑得了检索测试，但保存会被资源层拒绝并收敛成 404，报障时前端弹的
 * 就是「错误 : 404 Resource not found」——所以这里锁两件事：不发那次注定失败的
 * 请求，以及改成弹框说清楚。
 */
describe('retrieval testing settings persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockKnowledgeBase = {};
    // 面板会把设置存进 localStorage 作为基线；不清掉，上一条用例写进去的
    // rerank 会让下一条的「改动」变成无改动，用例就测不到保存。
    window.localStorage.clear();
    knowledgeService.updateKb.mockResolvedValue({ data: { code: 0 } });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const changeRerankAndFlush = async () => {
    render(
      <TestingForm loading={false} refetch={jest.fn()} setValues={jest.fn()} />,
    );
    fireEvent.click(screen.getByText('pick-rerank'));
    // 先确认这次点击真的改了表单：没改的话下面的断言测的是「什么都没发生」。
    expect(screen.getByTestId('rerank-field')).toHaveValue(
      'qwen3-rerank@default@tongyi',
    );
    // 保存是 600ms 防抖，滑一次就落一次盘。
    await act(async () => {
      jest.advanceTimersByTime(700);
    });
  };

  it('does not send the doomed save for a read-only member and explains why', async () => {
    mockKnowledgeBase = { id: 'kb-1', capabilities: { update: false } };

    await changeRerankAndFlush();

    expect(knowledgeService.updateKb).not.toHaveBeenCalled();
    expect(screen.getByText('测试设置未能保存')).toBeInTheDocument();
  });

  it('saves the rerank model when the caller may edit', async () => {
    mockKnowledgeBase = { id: 'kb-1', capabilities: { update: true } };

    await changeRerankAndFlush();

    expect(knowledgeService.updateKb).toHaveBeenCalledWith(
      'kb-1',
      expect.objectContaining({ rerank_id: 'qwen3-rerank@default@tongyi' }),
      // 权限拒绝由弹框解释，不让请求层再弹「错误 : 404」。
      { skipErrorCodes: [404] },
    );
  });

  it('turns a backend 404 (hidden permission) into the dialog', async () => {
    mockKnowledgeBase = { id: 'kb-1' }; // 能力位未知：照常发请求，交给后端判定
    knowledgeService.updateKb.mockResolvedValue({
      data: { code: 404, message: 'Resource not found' },
    });

    await changeRerankAndFlush();

    expect(screen.getByText('测试设置未能保存')).toBeInTheDocument();
  });
});
