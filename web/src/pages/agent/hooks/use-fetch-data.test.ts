import { act, renderHook } from '@testing-library/react';
import { useFetchDataOnMount } from './use-fetch-data';

const mockSetGraphInfo = jest.fn();
const mockRefetch = jest.fn();
const mockUseFetchAgent = jest.fn();
const mockUseParams = jest.fn();

jest.mock('@/hooks/use-agent-request', () => ({
  useFetchAgent: () => mockUseFetchAgent(),
}));

jest.mock('./use-set-graph', () => ({
  useSetGraphInfo: () => mockSetGraphInfo,
}));

jest.mock('react-router', () => ({
  useParams: () => mockUseParams(),
}));

jest.mock('../utils/dsl-bridge', () => ({
  dslToGraph: (dsl: { graph?: { nodes: unknown[]; edges: unknown[] } }) => ({
    nodes: dsl.graph?.nodes ?? [],
    edges: dsl.graph?.edges ?? [],
  }),
}));

describe('useFetchDataOnMount', () => {
  beforeEach(() => {
    mockSetGraphInfo.mockClear();
    mockRefetch.mockClear();
    mockUseParams.mockReturnValue({});
  });

  it('does not apply an empty graph while agent detail has no dsl', () => {
    mockUseFetchAgent.mockReturnValue({
      loading: true,
      data: {},
      refetch: mockRefetch,
    });

    renderHook(() => useFetchDataOnMount());

    expect(mockSetGraphInfo).not.toHaveBeenCalled();
  });

  it('applies the fetched dsl once it is present', () => {
    mockUseFetchAgent.mockReturnValue({
      loading: false,
      data: {
        id: 'agent-1',
        dsl: { graph: { nodes: [{ id: 'begin:0' }], edges: [] } },
      },
      refetch: mockRefetch,
    });

    renderHook(() => useFetchDataOnMount());

    expect(mockSetGraphInfo).toHaveBeenCalledWith({
      nodes: [{ id: 'begin:0' }],
      edges: [],
    });
  });

  it('does not clear a loaded canvas when later detail snapshots omit dsl', () => {
    mockUseFetchAgent.mockReturnValue({
      loading: false,
      data: {
        id: 'agent-1',
        dsl: { graph: { nodes: [{ id: 'begin:0' }], edges: [] } },
      },
      refetch: mockRefetch,
    });

    const { rerender } = renderHook(() => useFetchDataOnMount());

    mockUseFetchAgent.mockReturnValue({
      loading: false,
      data: {},
      refetch: mockRefetch,
    });

    act(() => {
      rerender();
    });

    expect(mockSetGraphInfo).toHaveBeenCalledTimes(1);
  });

  it('does not re-seed the graph when a refetch only re-tags message uuids', () => {
    mockUseParams.mockReturnValue({ id: 'agent-1' });
    const detail = (uuid: string) => ({
      id: 'agent-1',
      dsl: {
        graph: { nodes: [{ id: 'begin:0' }], edges: [] },
        messages: [{ id: 'm1', uuid, content: 'hi' }],
      },
    });
    mockUseFetchAgent.mockReturnValue({
      loading: false,
      data: detail('uuid-before'),
      refetch: mockRefetch,
    });

    const { rerender } = renderHook(() => useFetchDataOnMount());
    // One call clears the store for the incoming id, one seeds the graph.
    const seedCalls = mockSetGraphInfo.mock.calls.length;
    expect(seedCalls).toBeGreaterThan(0);

    // A save invalidates the detail query; the refetch keeps the same graph but
    // rebuilds every message uuid. Re-seeding here used to look like an edit to
    // the autosave watcher and wrote the canvas back, dropping a just-published
    // agent to draft.
    mockUseFetchAgent.mockReturnValue({
      loading: false,
      data: detail('uuid-after'),
      refetch: mockRefetch,
    });

    act(() => {
      rerender();
    });

    expect(mockSetGraphInfo).toHaveBeenCalledTimes(seedCalls);
  });

  it('re-seeds when the fetched graph itself changed', () => {
    mockUseParams.mockReturnValue({ id: 'agent-1' });
    mockUseFetchAgent.mockReturnValue({
      loading: false,
      data: {
        id: 'agent-1',
        dsl: { graph: { nodes: [{ id: 'begin:0' }], edges: [] } },
      },
      refetch: mockRefetch,
    });

    const { rerender } = renderHook(() => useFetchDataOnMount());
    const seedCalls = mockSetGraphInfo.mock.calls.length;

    mockUseFetchAgent.mockReturnValue({
      loading: false,
      data: {
        id: 'agent-1',
        dsl: {
          graph: {
            nodes: [{ id: 'begin:0' }, { id: 'llm:1' }],
            edges: [],
          },
        },
      },
      refetch: mockRefetch,
    });

    act(() => {
      rerender();
    });

    expect(mockSetGraphInfo).toHaveBeenCalledTimes(seedCalls + 1);
    expect(mockSetGraphInfo).toHaveBeenLastCalledWith({
      nodes: [{ id: 'begin:0' }, { id: 'llm:1' }],
      edges: [],
    });
  });

  it('clears the previous canvas before loading a different agent', () => {
    mockUseParams.mockReturnValue({ id: 'agent-1' });
    mockUseFetchAgent.mockReturnValue({
      loading: false,
      data: {
        id: 'agent-1',
        dsl: { graph: { nodes: [{ id: 'old' }], edges: [] } },
      },
      refetch: mockRefetch,
    });

    const { rerender } = renderHook(() => useFetchDataOnMount());

    mockUseParams.mockReturnValue({ id: 'agent-2' });
    mockUseFetchAgent.mockReturnValue({
      loading: true,
      data: {},
      refetch: mockRefetch,
    });
    rerender();

    expect(mockSetGraphInfo).toHaveBeenLastCalledWith({ nodes: [], edges: [] });
  });
});
