import { act, renderHook } from '@testing-library/react';
import {
  isSameCanvasContent,
  shouldAutosaveCanvas,
  useWatchAgentChange,
} from './use-save-graph';

const mockNodes: { current: any[] } = { current: [] };
const mockEdges: { current: any[] } = { current: [] };
const mockFlowDetail: { current: any } = { current: undefined };
const mockBuildDslData = jest.fn();
const mockSetAgent = jest.fn();

// Cutting the request/router chain: importing it drags the app shell into
// jsdom (`createBrowserRouter` needs a global `Request`, which jsdom lacks), so
// without these mocks the whole suite dies on import and never reaches the
// helpers under test.
jest.mock('@/hooks/use-agent-request', () => ({
  useFetchAgent: () => ({ data: mockFlowDetail.current }),
  useResetAgent: () => ({ resetAgent: jest.fn() }),
  useSetAgent: () => ({ loading: false, setAgent: mockSetAgent }),
}));

jest.mock('react-router', () => ({
  useParams: () => ({ id: 'agent-1' }),
}));

jest.mock('../store', () => ({
  __esModule: true,
  default: (selector: (state: unknown) => unknown) =>
    selector({ nodes: mockNodes.current, edges: mockEdges.current }),
}));

jest.mock('./use-build-dsl', () => ({
  useBuildDslData: () => ({ buildDslData: () => mockBuildDslData() }),
}));

describe('shouldAutosaveCanvas', () => {
  const ready = {
    chatDrawerVisible: false,
    agentId: 'agent-1',
    agentLoaded: true,
    nodeCount: 2,
    edgeCount: 1,
  };

  it('autosaves a loaded canvas with nodes', () => {
    expect(shouldAutosaveCanvas(ready)).toBe(true);
  });

  it('skips while the chat drawer is open', () => {
    expect(shouldAutosaveCanvas({ ...ready, chatDrawerVisible: true })).toBe(
      false,
    );
  });

  it('skips before the agent id is on the route', () => {
    expect(shouldAutosaveCanvas({ ...ready, agentId: undefined })).toBe(false);
  });

  it('skips before the agent detail has loaded', () => {
    expect(shouldAutosaveCanvas({ ...ready, agentLoaded: false })).toBe(false);
  });

  it('skips an empty nodes/edges store so autosave cannot wipe a pipeline', () => {
    expect(shouldAutosaveCanvas({ ...ready, nodeCount: 0, edgeCount: 0 })).toBe(
      false,
    );
  });

  it('still autosaves when there are nodes but no edges', () => {
    expect(shouldAutosaveCanvas({ ...ready, edgeCount: 0 })).toBe(true);
  });
});

describe('isSameCanvasContent', () => {
  const dsl = () => ({
    graph: {
      nodes: [
        {
          id: 'begin:0',
          data: { label: 'Begin', form: { mode: 'conversational' } },
        },
      ],
      edges: [] as { id: string }[],
    },
    components: { 'begin:0': { obj: { component_name: 'Begin' } } },
    messages: [{ id: 'm1', uuid: 'uuid-before' }],
  });

  it('treats a refetch that only re-tags message uuids as unchanged', () => {
    expect(
      isSameCanvasContent(dsl(), {
        ...dsl(),
        messages: [{ id: 'm1', uuid: 'uuid-after' }],
      }),
    ).toBe(true);
  });

  it('ignores a rebuilt components block because it is derived from the graph', () => {
    expect(isSameCanvasContent(dsl(), { ...dsl(), components: {} })).toBe(true);
  });

  it('detects a node form edit', () => {
    const edited = dsl();
    edited.graph.nodes[0].data.form = { mode: 'task' };

    expect(isSameCanvasContent(dsl(), edited)).toBe(false);
  });

  it('detects an edge change', () => {
    const withEdge = dsl();
    withEdge.graph.edges = [{ id: 'begin:0-llm:1' }];

    expect(isSameCanvasContent(dsl(), withEdge)).toBe(false);
  });

  it('does not block the first save when the server has no dsl yet', () => {
    expect(isSameCanvasContent(undefined, dsl())).toBe(false);
  });
});

describe('useWatchAgentChange', () => {
  const serverDsl = () => ({
    graph: {
      nodes: [
        {
          id: 'begin:0',
          data: { label: 'Begin', form: { mode: 'conversational' } },
        },
      ],
      edges: [] as { id: string }[],
    },
    components: { 'begin:0': { obj: { component_name: 'Begin' } } },
    // Re-tagged on every fetch; must not count as a canvas change.
    messages: [{ id: 'm1', uuid: 'uuid-after' }],
  });

  const buildDslFromStore = () => ({
    ...serverDsl(),
    graph: { nodes: mockNodes.current, edges: mockEdges.current },
  });

  const flushAutosave = async () => {
    await act(async () => {
      jest.advanceTimersByTime(20000);
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    jest.useFakeTimers();
    mockSetAgent.mockReset();
    mockSetAgent.mockResolvedValue({
      code: 0,
      data: { update_time: 1700000000 },
    });
    mockBuildDslData.mockReset();
    mockBuildDslData.mockImplementation(buildDslFromStore);
    mockFlowDetail.current = {
      id: 'agent-1',
      update_time: 1700000000,
      dsl: serverDsl(),
    };
    // Same content as the server, brand-new object graph — exactly what a
    // refetch leaves in the store.
    mockNodes.current = JSON.parse(JSON.stringify(serverDsl().graph.nodes));
    mockEdges.current = [];
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not write back a canvas the server already holds', async () => {
    renderHook(() => useWatchAgentChange(false));

    await flushAutosave();

    expect(mockSetAgent).not.toHaveBeenCalled();
  });

  it('still writes when the user actually edited a node', async () => {
    mockNodes.current = [
      { id: 'begin:0', data: { label: 'Begin', form: { mode: 'task' } } },
    ];
    renderHook(() => useWatchAgentChange(false));

    await flushAutosave();

    expect(mockSetAgent).toHaveBeenCalledTimes(1);
  });
});
