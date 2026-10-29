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

import Vocab from '../index';

// The page reads the knowledge base id off the route.
jest.mock('react-router', () => ({
  __esModule: true,
  useParams: () => ({ id: 'kb-1' }),
}));

jest.mock('sonner', () => ({
  __esModule: true,
  toast: { success: jest.fn(), error: jest.fn() },
}));

jest.mock('@/services/synonym-service', () => ({
  __esModule: true,
  listSynonymGroups: jest.fn(),
  getSynonymGroup: jest.fn(),
  createSynonymGroup: jest.fn(),
  updateSynonymGroup: jest.fn(),
  deleteSynonymGroup: jest.fn(),
  importSynonymGroups: jest.fn(),
}));

jest.mock('@/services/change-set-service', () => ({
  __esModule: true,
  getOrCreateChangeSet: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const synonymService = require('@/services/synonym-service');

const supersededGroup = {
  id: 'group-old',
  dataset_id: 'kb-1',
  name: '退款',
  domain: 'fund' as const,
  scope: 'kb' as const,
  group_type: 'synonym' as const,
  // 被后续发布替换下来的历史版本：状态位是「已替换」，但用户仍然要能改它。
  status: 'disabled' as const,
  word_count: 2,
  words: [{ word: '退款', is_primary: true }, { word: '退钱' }],
};

const listResult = (groups: unknown[]) => ({
  data: { code: 0, message: 'success', data: groups },
});

describe('词表管理 · 已替换的历史版本', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    synonymService.listSynonymGroups.mockResolvedValue(
      listResult([supersededGroup]),
    );
    synonymService.getSynonymGroup.mockResolvedValue(
      listResult(supersededGroup),
    );
  });

  it('keeps the edit entry for a superseded group', async () => {
    render(<Vocab />);

    // 状态照旧标成「已替换」，只是不再把编辑入口藏起来。
    expect(await screen.findByText('已替换')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '编辑' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除' })).toBeInTheDocument();
  });

  it('opens the editor with a notice about the staged version', async () => {
    render(<Vocab />);

    fireEvent.click(await screen.findByRole('button', { name: '编辑' }));

    await waitFor(() =>
      expect(synonymService.getSynonymGroup).toHaveBeenCalledWith('group-old'),
    );
    expect(await screen.findByText('编辑词组')).toBeInTheDocument();
    expect(
      screen.getByText(/这是已被新版本替换下来的历史词组/),
    ).toBeInTheDocument();
  });
});
