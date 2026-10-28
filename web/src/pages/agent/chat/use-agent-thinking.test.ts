jest.mock('@/hooks/use-send-message', () => ({
  // Mirrors the real enum. The real module cannot be requireActual'd here
  // because it pulls in eventsource-parser's TransformStream, which jsdom
  // does not provide.
  MessageEventType: {
    WorkflowStarted: 'workflow_started',
    NodeStarted: 'node_started',
    NodeFinished: 'node_finished',
    Message: 'message',
    MessageEnd: 'message_end',
    WorkflowFinished: 'workflow_finished',
    UserInputs: 'user_inputs',
    WaitingForUser: 'waiting_for_user',
    NodeLogs: 'node_logs',
  },
}));

import { buildThinkingSteps, totalElapsed } from './use-agent-thinking';

const started = (componentId: string, type: string, name?: string) => ({
  event: 'node_started',
  message_id: 'm1',
  data: {
    component_id: componentId,
    component_name: name ?? componentId,
    component_type: type,
    inputs: {},
    outputs: {},
    error: null,
    elapsed_time: 0,
  },
});

const finished = (
  componentId: string,
  type: string,
  patch: Record<string, any> = {},
) => ({
  event: 'node_finished',
  message_id: 'm1',
  data: {
    component_id: componentId,
    component_name: componentId,
    component_type: type,
    inputs: {},
    outputs: {},
    error: null,
    elapsed_time: 0.5,
    ...patch,
  },
});

const chunk = (id: string, similarity: number, content = `body-${id}`) => ({
  chunk_id: id,
  content,
  similarity,
  document_id: `doc-${id}`,
  document_name: `name-${id}`,
});

describe('buildThinkingSteps', () => {
  it('returns an empty list when there is nothing to show', () => {
    expect(buildThinkingSteps(undefined)).toEqual([]);
    expect(buildThinkingSteps([])).toEqual([]);
  });

  it('drops the begin node, which only echoes the question', () => {
    const steps = buildThinkingSteps([
      started('begin', 'Begin'),
      finished('begin', 'Begin'),
      started('Categorize:DocRouter', 'Categorize'),
      finished('Categorize:DocRouter', 'Categorize'),
    ] as any);

    expect(steps.map((s) => s.id)).toEqual(['Categorize:DocRouter']);
  });

  it('keeps a node that has started but not finished as running', () => {
    const steps = buildThinkingSteps([
      started('Retrieval:Policy', 'Retrieval', 'Policy'),
    ] as any);

    expect(steps).toHaveLength(1);
    expect(steps[0].status).toBe('running');
    expect(steps[0].elapsed).toBeUndefined();
    expect(steps[0].type).toBe('Retrieval');
    expect(steps[0].name).toBe('Policy');
  });

  it('marks a finished node done and carries its elapsed time', () => {
    const steps = buildThinkingSteps([
      started('Agent:Policy', 'Agent'),
      finished('Agent:Policy', 'Agent', {
        elapsed_time: 3.97,
        outputs: { content: '一二三四五' },
      }),
    ] as any);

    expect(steps[0].status).toBe('done');
    expect(steps[0].elapsed).toBeCloseTo(3.97);
    expect(steps[0].outputChars).toBe(5);
  });

  it('surfaces a node error instead of pretending success', () => {
    const steps = buildThinkingSteps([
      started('Retrieval:Policy', 'Retrieval'),
      finished('Retrieval:Policy', 'Retrieval', { error: 'index not found' }),
    ] as any);

    expect(steps[0].status).toBe('error');
    expect(steps[0].error).toBe('index not found');
  });

  it('does not duplicate a node that reports started more than once', () => {
    const steps = buildThinkingSteps([
      started('Retrieval:Policy', 'Retrieval'),
      started('Retrieval:Policy', 'Retrieval'),
      finished('Retrieval:Policy', 'Retrieval'),
    ] as any);

    expect(steps).toHaveLength(1);
    expect(steps[0].status).toBe('done');
  });

  it('orders chunks by similarity and keeps the full hit count', () => {
    const chunks = [
      chunk('a', 0.4),
      chunk('b', 0.9),
      chunk('c', 0.6),
      chunk('d', 0.1),
      chunk('e', 0.3),
      chunk('f', 0.2),
    ];
    const steps = buildThinkingSteps([
      started('Retrieval:Policy', 'Retrieval'),
      finished('Retrieval:Policy', 'Retrieval', { outputs: { chunks } }),
    ] as any);

    expect(steps[0].chunks?.map((c) => c.id)).toEqual([
      'b',
      'c',
      'a',
      'e',
      'f',
    ]);
    expect(steps[0].chunkCount).toBe(6);
  });

  it('drops chunks without text, which would render as blank rows', () => {
    const steps = buildThinkingSteps([
      started('Retrieval:Policy', 'Retrieval'),
      finished('Retrieval:Policy', 'Retrieval', {
        outputs: { chunks: [chunk('a', 0.8), { chunk_id: 'b', content: '' }] },
      }),
    ] as any);

    expect(steps[0].chunks?.map((c) => c.id)).toEqual(['a']);
    expect(steps[0].chunkCount).toBe(2);
  });

  it('carries the branch a categorizer settled on', () => {
    const steps = buildThinkingSteps([
      started('Categorize:DocRouter', 'Categorize'),
      finished('Categorize:DocRouter', 'Categorize', {
        outputs: { category: '国家监管政策查询' },
      }),
    ] as any);

    expect(steps[0].category).toBe('国家监管政策查询');
  });

  it('sums elapsed time across steps', () => {
    const steps = buildThinkingSteps([
      started('a', 'Categorize'),
      finished('a', 'Categorize', { elapsed_time: 0.45 }),
      started('b', 'Retrieval'),
      finished('b', 'Retrieval', { elapsed_time: 0.28 }),
    ] as any);

    expect(totalElapsed(steps)).toBeCloseTo(0.73);
  });
});
