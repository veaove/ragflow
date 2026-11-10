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

import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { isEditPermissionDenied } from '../edit-permission';
import ChangeCenter from '../index';

jest.mock('react-router', () => ({
  __esModule: true,
  useParams: () => ({ id: 'kb-1' }),
}));

jest.mock('sonner', () => ({
  __esModule: true,
  toast: { success: jest.fn(), error: jest.fn() },
}));

jest.mock('@/services/change-set-service', () => ({
  __esModule: true,
  listChangeSets: jest.fn(),
  getChangeSetDiff: jest.fn(),
  publishChangeSet: jest.fn(),
  discardChangeSet: jest.fn(),
  retrievalCompare: jest.fn(),
}));

// 详情里的能力位决定「点下去立刻弹框」还是「先发请求」，两种都要覆盖。
let mockKnowledgeBase: Record<string, unknown> = {};

jest.mock('../../contexts/knowledge-base-context', () => ({
  __esModule: true,
  useKnowledgeBaseContext: () => ({
    knowledgeBase: mockKnowledgeBase,
    loading: false,
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const changeSetService = require('@/services/change-set-service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { toast } = require('sonner');

const diffResult = () => ({
  data: {
    code: 0,
    data: {
      change_set_id: 'cs-1',
      similar_questions: [
        {
          chunk_id: 'c-1',
          document_id: 'd-1',
          question: '申购费率是多少',
          before: [],
          after: ['申购费率是多少'],
        },
      ],
      synonyms: [],
    },
  },
});

const listResult = () => ({
  data: { code: 0, data: [{ id: 'cs-1', status: 'open' }] },
});

describe('only-read member on the change center', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockKnowledgeBase = {};
    changeSetService.listChangeSets.mockResolvedValue(listResult());
    changeSetService.getChangeSetDiff.mockResolvedValue(diffResult());
    changeSetService.discardChangeSet.mockResolvedValue({
      data: { code: 0 },
    });
    jest.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('opens a dialog instead of a doomed request when the base is read-only', async () => {
    mockKnowledgeBase = { id: 'kb-1', capabilities: { update: false } };
    render(<ChangeCenter />);

    const publishAll = await screen.findByRole('button', { name: '发布全部' });
    await waitFor(() => expect(publishAll).toBeEnabled());
    fireEvent.click(publishAll);

    expect(await screen.findByText('无法发布变更')).toBeInTheDocument();
    // 关键点：不发注定被 403 的请求，页面上也不会冒出「发布成功」。
    expect(changeSetService.publishChangeSet).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('turns a backend 403 into the same dialog and never reports success', async () => {
    mockKnowledgeBase = { id: 'kb-1', capabilities: { update: true } };
    // HTTP 403 由请求层原样交回 Response，不会抛异常。
    changeSetService.publishChangeSet.mockResolvedValue({ status: 403 });
    render(<ChangeCenter />);

    const publishAll = await screen.findByRole('button', { name: '发布全部' });
    await waitFor(() => expect(publishAll).toBeEnabled());
    fireEvent.click(publishAll);

    expect(await screen.findByText('无法发布变更')).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('still publishes when the caller may edit', async () => {
    mockKnowledgeBase = { id: 'kb-1', capabilities: { update: true } };
    changeSetService.publishChangeSet.mockResolvedValue({
      data: { code: 0, message: 'success' },
    });
    render(<ChangeCenter />);

    const publishAll = await screen.findByRole('button', { name: '发布全部' });
    await waitFor(() => expect(publishAll).toBeEnabled());
    fireEvent.click(publishAll);

    await waitFor(() =>
      expect(changeSetService.publishChangeSet).toHaveBeenCalledWith('kb-1', 'cs-1'),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('发布成功'));
  });
});

describe('isEditPermissionDenied', () => {
  it('recognises the shapes the request layer produces', () => {
    // HTTP 403：errorHandler 返回原始 Response。
    expect(isEditPermissionDenied({ status: 403 })).toBe(true);
    // 业务码拒绝。
    expect(isEditPermissionDenied({ data: { code: 403 } })).toBe(true);
    expect(isEditPermissionDenied({ data: { code: 108 } })).toBe(true);
    // 抛出的错误对象。
    expect(isEditPermissionDenied({ response: { status: 403 } })).toBe(true);
    // 通用错误码 + 权限文案。
    expect(
      isEditPermissionDenied({
        data: { code: 103, message: 'dataset is read-only for this user' },
      }),
    ).toBe(true);
  });

  it('does not treat ordinary failures as permission problems', () => {
    expect(isEditPermissionDenied({ data: { code: 0 } })).toBe(false);
    expect(isEditPermissionDenied({ data: { code: 500, message: '数据库连接失败' } })).toBe(
      false,
    );
    expect(isEditPermissionDenied(undefined)).toBe(false);
  });
});
