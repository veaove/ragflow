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

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import {
  classifyDatasetAvailability,
  useDatasetAvailability,
  useFetchDatasetsByIds,
  useFetchKnowledgeList,
} from './use-knowledge-request';

const mockListDataset = jest.fn();
const mockListDatasetByIds = jest.fn();

jest.mock('@/services/knowledge-service', () => ({
  listDataset: (...args: unknown[]) => mockListDataset(...args),
  listDatasetByIds: (...args: unknown[]) => mockListDatasetByIds(...args),
}));

// route-hook (imported by the hook chain) pulls in the app shell — routes
// constructs a browser router at module scope, which jsdom cannot survive.
jest.mock('@/routes', () => ({ Routes: {} }));

const DatasetId = '0cb944c66320448aaae827ba8009ef68';
const OtherDatasetId = '1cb944c66320448aaae827ba8009ef69';

const makeDataset = (id: string, chunkCount: number) =>
  ({ id, chunk_count: chunkCount }) as any;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // `any` on purpose: files with jest.mock go through esbuild-jest's babel
  // pass, which cannot strip imported bindings used as type annotations.
  return function Wrapper({ children }: { children?: any }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('useFetchDatasetsByIds', () => {
  beforeEach(() => {
    mockListDatasetByIds.mockClear();
    mockListDatasetByIds.mockResolvedValue({ data: { data: [] } });
  });

  it('passes the canvas id through to the by-ids lookup', async () => {
    renderHook(() => useFetchDatasetsByIds([DatasetId], 'canvas-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(mockListDatasetByIds).toHaveBeenCalled());
    expect(mockListDatasetByIds).toHaveBeenCalledWith([DatasetId], 'canvas-1');
  });

  it('leaves the canvas id undefined for global lookups', async () => {
    renderHook(() => useFetchDatasetsByIds([DatasetId]), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(mockListDatasetByIds).toHaveBeenCalled());
    expect(mockListDatasetByIds).toHaveBeenCalledWith([DatasetId], undefined);
  });
});

describe('classifyDatasetAvailability', () => {
  it('reports nothing for ids that resolve with chunks', () => {
    const result = classifyDatasetAvailability(
      [DatasetId],
      [makeDataset(DatasetId, 3)],
      false,
    );

    expect(result.unavailableIds.size).toBe(0);
    expect(result.emptyIds.size).toBe(0);
  });

  it('separates ids that do not resolve from ids that resolve without chunks', () => {
    const result = classifyDatasetAvailability(
      [DatasetId, OtherDatasetId],
      [makeDataset(OtherDatasetId, 0)],
      false,
    );

    // The by-ids endpoint drops datasets the caller cannot read, so a missing
    // id reads as "unavailable" rather than "deleted".
    expect([...result.unavailableIds]).toEqual([DatasetId]);
    expect([...result.emptyIds]).toEqual([OtherDatasetId]);
  });

  it('reports nothing when the lookup failed', () => {
    const result = classifyDatasetAvailability(
      [DatasetId, OtherDatasetId],
      undefined,
      true,
    );

    expect(result.unavailableIds.size).toBe(0);
    expect(result.emptyIds.size).toBe(0);
  });
});

describe('useDatasetAvailability', () => {
  beforeEach(() => {
    mockListDatasetByIds.mockClear();
    mockListDatasetByIds.mockResolvedValue({ data: { data: [] } });
  });

  it('drops variable references from the lookup', async () => {
    renderHook(() => useDatasetAvailability(['sys.query', DatasetId]), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(mockListDatasetByIds).toHaveBeenCalled());
    expect(mockListDatasetByIds).toHaveBeenCalledWith([DatasetId], undefined);
  });

  it('flags an id the lookup did not resolve', async () => {
    mockListDatasetByIds.mockResolvedValue({
      data: { data: [makeDataset(DatasetId, 2)] },
    });

    const { result } = renderHook(
      () => useDatasetAvailability([DatasetId, OtherDatasetId]),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.settled).toBe(true));
    expect([...result.current.unavailableIds]).toEqual([OtherDatasetId]);
    expect(result.current.emptyIds.size).toBe(0);
  });

  it('reports nothing when the lookup request fails', async () => {
    mockListDatasetByIds.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useDatasetAvailability([DatasetId]), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.unavailableIds.size).toBe(0);
    expect(result.current.emptyIds.size).toBe(0);
  });
});

describe('useFetchKnowledgeList', () => {
  beforeEach(() => {
    mockListDataset.mockClear();
    mockListDataset.mockResolvedValue({
      data: { data: [], total_datasets: 0 },
    });
  });

  it('adds canvas_id to the list params when a canvas is given', async () => {
    renderHook(() => useFetchKnowledgeList(false, '', 30, 'canvas-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(mockListDataset).toHaveBeenCalled());
    expect(mockListDataset).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        page_size: 30,
        canvas_id: 'canvas-1',
      }),
    );
  });

  it('omits canvas_id without a canvas', async () => {
    renderHook(() => useFetchKnowledgeList(false, 'kw'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(mockListDataset).toHaveBeenCalled());
    const params = mockListDataset.mock.calls[0][0];
    expect(params).not.toHaveProperty('canvas_id');
    expect(params).toMatchObject({ page: 1, keywords: 'kw' });
  });
});
