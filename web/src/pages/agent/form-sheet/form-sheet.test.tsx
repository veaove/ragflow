import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AgentInstanceContext } from '../context';
import { Operator } from '../constant';
import useGraphStore from '../store';
import FormSheet from './next';

// The single-debug sheet drags the markdown renderer (ESM-only remark plugins)
// into jsdom; it never renders when singleDebugDrawerVisible is false.
jest.mock('./single-debug-sheet', () => ({
  __esModule: true,
  default: () => null,
}));

// routes.tsx evaluates createBrowserRouter at module scope, which needs a
// global Request that jsdom does not provide. Nothing here navigates.
jest.mock('@/routes', () => ({
  routers: {},
  Routes: new Proxy({}, { get: (_target, key) => String(key) }),
}));

const noop = () => {};

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

// Provided by the canvas page in the real app; the Agent tools panel calls it
// only to build an onClick handler.
const agentInstance = { addCanvasNode: () => () => {} } as any;

const renderWithProviders = (node: any) =>
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TooltipProvider>
          <AgentInstanceContext.Provider value={agentInstance}>
            <FormSheet
              visible
              node={node}
              singleDebugDrawerVisible={false}
              chatVisible={false}
              hideModal={noop}
              hideSingleDebugDrawer={noop}
              showSingleDebugDrawer={noop}
            />
          </AgentInstanceContext.Provider>
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

// An Agent node as produced by a hand-built DSL (scripts/build_ivr_agent.py):
// its form carries no `tools` key, whereas the canvas UI always writes
// `tools: []` (initialAgentValues). useIsMcp resolves the clicked tool on every
// render, so a missing `tools` used to crash the whole canvas on any node click.
const agentNodeWithoutTools = {
  id: 'Agent:Rewrite',
  type: 'agentNode',
  position: { x: 0, y: 0 },
  data: {
    label: Operator.Agent,
    name: 'Rewrite',
    form: {
      llm_id: 'llm:1',
      sys_prompt: '',
      prompts: [{ role: 'user', content: '{sys.query}' }],
      outputs: { content: { type: 'string', value: '' } },
    },
  },
};

const messageNode = {
  id: 'Message:Menu',
  type: 'messageNode',
  position: { x: 0, y: 0 },
  data: {
    label: Operator.Message,
    name: 'Menu',
    form: { content: ['hello'], user_id: '{sys.user_id}' },
  },
};

describe('FormSheet', () => {
  beforeEach(() => {
    useGraphStore.setState({
      nodes: [agentNodeWithoutTools, messageNode] as any,
      edges: [],
      clickedNodeId: '',
      clickedToolId: '',
    });
  });

  it('opens the Agent form on an Agent node whose form has no tools key', () => {
    expect(() => renderWithProviders(agentNodeWithoutTools)).not.toThrow();

    expect(screen.getByText('Rewrite')).toBeInTheDocument();
  });

  it('opens the Message form on a Message node', () => {
    expect(() => renderWithProviders(messageNode)).not.toThrow();

    expect(screen.getByText('Menu')).toBeInTheDocument();
  });

  it('does not leak undefined into the canvas tool list', () => {
    const { getAllAgentTools, getAgentToolById } = useGraphStore.getState();

    expect(getAllAgentTools()).toEqual([]);
    expect(getAgentToolById(undefined as any)).toBeUndefined();
  });
});
