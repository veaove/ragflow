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

import { fireEvent, render, screen } from '@testing-library/react';

import KnowledgeGraph from '../index';

jest.mock('react-router', () => ({
  __esModule: true,
  useParams: () => ({ id: 'kb-1' }),
}));

jest.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/hooks/logic-hooks/navigate-hooks', () => ({
  __esModule: true,
  useNavigatePage: () => ({ navigateToDataset: () => jest.fn() }),
}));

const mockRemoveKnowledgeGraph = jest.fn();

jest.mock('@/hooks/use-knowledge-request', () => ({
  __esModule: true,
  useFetchKnowledgeGraph: () => ({ data: undefined, loading: false }),
  useRemoveKnowledgeGraph: () => ({
    removeKnowledgeGraph: mockRemoveKnowledgeGraph,
    loading: false,
  }),
}));

let mockKnowledgeBase: Record<string, unknown> = {};

jest.mock('../../contexts/knowledge-base-context', () => ({
  __esModule: true,
  useKnowledgeBaseContext: () => ({
    knowledgeBase: mockKnowledgeBase,
    loading: false,
  }),
}));

/**
 * 删整库知识图谱按 delete_content 判定。只读授权与部门管理员都能看这张图，
 * 但删不得——否则「只允许查看」的成员一点就能把整库图谱删掉。
 */
describe('knowledge graph deletion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockKnowledgeBase = {};
    mockRemoveKnowledgeGraph.mockResolvedValue(0);
  });

  it('explains instead of deleting when the member may only view', () => {
    mockKnowledgeBase = { id: 'kb-1', capabilities: { delete_content: false } };
    render(<KnowledgeGraph />);

    fireEvent.click(screen.getByTestId('knowledge-graph-delete'));

    expect(screen.getByText('无法删除知识图谱')).toBeInTheDocument();
    // 连「确认删除」都不给，更不会发请求。
    expect(screen.queryByTestId('confirm-delete-dialog')).not.toBeInTheDocument();
    expect(mockRemoveKnowledgeGraph).not.toHaveBeenCalled();
  });

  it('keeps the confirm step for members who may edit', () => {
    mockKnowledgeBase = { id: 'kb-1', capabilities: { delete_content: true } };
    render(<KnowledgeGraph />);

    fireEvent.click(screen.getByTestId('knowledge-graph-delete'));

    expect(screen.getByTestId('confirm-delete-dialog')).toBeInTheDocument();
    expect(screen.queryByText('无法删除知识图谱')).not.toBeInTheDocument();
  });
});
