import { fireEvent, render, screen } from '@testing-library/react';
import { ThinkingPanel } from './thinking-panel';

// lucide-react ships ESM and jest does not transform node_modules, so the icons
// are stubbed. The panel only needs them to render, never to assert.
jest.mock('lucide-react', () => ({
  Check: () => <span data-testid="icon-check" />,
  ChevronDown: () => <span data-testid="icon-chevron-down" />,
  ChevronUp: () => <span data-testid="icon-chevron-up" />,
  Loader2: () => <span data-testid="icon-loading" />,
  TriangleAlert: () => <span data-testid="icon-alert" />,
}));

// The panel only needs the translate function; rendering the real i18n stack
// would drag in the locale bundles for no benefit, so keys are echoed back with
// their interpolation params to keep assertions exact.
jest.mock('@/hooks/common-hooks', () => ({
  useTranslate: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}|${JSON.stringify(options)}` : key,
  }),
}));

// No type annotation here on purpose: this file calls jest.mock, which routes it
// through esbuild-jest's babel pass. That pass has no preset-typescript, and
// @babel/plugin-transform-modules-commonjs throws on an imported type used in an
// annotation ("Cannot transform the imported binding ...").
const steps = [
  {
    id: 'Categorize:DocRouter',
    type: 'Categorize',
    name: 'DocRouter',
    status: 'done' as const,
    elapsed: 0.45,
    category: '国家监管政策查询',
  },
  {
    id: 'Retrieval:Policy',
    type: 'Retrieval',
    name: 'Policy',
    status: 'done' as const,
    elapsed: 0.28,
    chunkCount: 4,
    chunks: [
      {
        id: 'c1',
        content: '第二条 本条例所称营商环境……',
        similarity: 0.82,
      },
    ],
  },
];

// Same trail while the retrieval step is still in flight: the panel keys off a
// `running` step rather than a page-level loading flag.
const inFlight = [
  steps[0],
  { ...steps[1], status: 'running' as const, elapsed: undefined },
];

describe('ThinkingPanel', () => {
  it('renders nothing when the run produced no steps', () => {
    const { container } = render(<ThinkingPanel steps={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('stays collapsed after every step finished', () => {
    render(<ThinkingPanel steps={steps} />);

    expect(screen.getByText(/thinkingSteps\.done/)).toBeInTheDocument();
    // Step labels and retrieval hits stay out of the DOM until expanded.
    expect(screen.queryByText(/thinkingSteps\.type\.categorize/)).toBeNull();
    expect(screen.queryByText(/本条例所称营商环境/)).toBeNull();
  });

  it('expands on its own while a step is still running', () => {
    render(<ThinkingPanel steps={inFlight} />);

    expect(screen.getByText(/thinkingSteps\.running/)).toBeInTheDocument();
    expect(screen.getByText(/thinkingSteps\.type\.categorize/)).toBeInTheDocument();
    // The running step is named in the summary line and again as its own row.
    expect(screen.getAllByText(/thinkingSteps\.type\.retrieval/)).toHaveLength(2);
  });

  it('opens the step list when the summary line is clicked', () => {
    render(<ThinkingPanel steps={steps} />);

    fireEvent.click(screen.getByText(/thinkingSteps\.done/));

    expect(screen.getByText(/thinkingSteps\.type\.retrieval/)).toBeInTheDocument();
  });

  it('clamps a hit to one line until 查看原文 is clicked', () => {
    render(<ThinkingPanel steps={inFlight} />);

    // The snippet is always in the DOM; folding is CSS-only so the text stays
    // selectable and copyable.
    const collapsed = screen.getByText(/本条例所称营商环境/);
    expect(collapsed.className).toContain('line-clamp-1');

    fireEvent.click(screen.getByText('thinkingSteps.viewSource'));

    const expanded = screen.getByText(/本条例所称营商环境/);
    expect(expanded.className).toContain('whitespace-pre-wrap');
    expect(screen.getByText('thinkingSteps.hideSource')).toBeInTheDocument();
  });
});
