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

import { render, screen } from '@testing-library/react';

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

const group = (id: string, name: string, status: 'live' | 'pending') => ({
  id,
  dataset_id: 'kb-1',
  name,
  domain: 'fund' as const,
  scope: 'kb' as const,
  group_type: 'synonym' as const,
  status,
  word_count: 2,
  words: [{ word: name, is_primary: true }, { word: `${name}-别名` }],
});

const listResult = (groups: unknown[]) => ({
  data: { code: 0, message: 'success', data: groups },
});

/**
 * 词表管理的列表只有「已生效 / 待生效」两种行：被后续发布替换下来的旧版本
 * 后端不再返回（它和替换它的那条同名同概念，并排列出会看成两份），所以这里
 * 既不该出现「已替换」，也不该有被锁住编辑入口的行。
 */
describe('词表管理 · 状态与编辑入口', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    synonymService.listSynonymGroups.mockResolvedValue(
      listResult([
        group('g-live', '赎回基金', 'live'),
        group('g-stage', '购买基金', 'pending'),
      ]),
    );
  });

  it('renders 已生效 for the live version and 待生效 for the staged one', async () => {
    render(<Vocab />);

    expect(await screen.findByText('已生效')).toBeInTheDocument();
    expect(screen.getByText('待生效')).toBeInTheDocument();
    expect(screen.queryByText('已替换')).not.toBeInTheDocument();
  });

  it('keeps the edit entry on every row', async () => {
    render(<Vocab />);

    // 两行都能编辑：编辑入口不再依赖状态。
    expect(await screen.findAllByRole('button', { name: '编辑' })).toHaveLength(
      2,
    );
    expect(screen.getAllByRole('button', { name: '删除' })).toHaveLength(2);
  });
});
