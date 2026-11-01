jest.mock('eventsource-parser/stream', () => ({}));

// logic-hooks 经 route-hook 间接导入 @/routes，而 routes.tsx 在模块作用域就
// 调 createBrowserRouter()，jsdom 没有 Request 会直接抛 ReferenceError。
// 本测试只用滚动的几何逻辑，Routes 的取值无所谓，按名字兜底即可。
jest.mock('@/routes', () => ({
  Routes: new Proxy(
    {},
    { get: (_target, key) => (typeof key === 'string' ? key : undefined) },
  ),
}));

import { act, renderHook } from '@testing-library/react';
import { useScrollToBottom } from '../logic-hooks';

function createMockContainer({ atBottom = true } = {}) {
  const scrollTop = atBottom ? 100 : 0;
  const clientHeight = 100;
  const scrollHeight = 200;
  const listeners: Record<string, () => void> = {};
  return {
    current: {
      scrollTop,
      clientHeight,
      scrollHeight,
      // 实现里会把容器的 overflowAnchor 关掉（避免 Firefox 滚动锚定抢滚动），
      // 假容器缺 style 会让那句赋值抛 TypeError。
      style: {},
      // 滚到底走的是 container.scrollTo({ top, behavior })，jsdom 不实现它。
      scrollTo: jest.fn(),
      addEventListener: jest.fn((event, cb) => {
        listeners[event] = cb;
      }),
      removeEventListener: jest.fn(),
    },
    listeners,
  } as any;
}

// Helper to flush all timers and microtasks
async function flushAll() {
  jest.runAllTimers();
  // Flush microtasks
  await Promise.resolve();
  // Sometimes, effects queue more timers, so run again
  jest.runAllTimers();
  await Promise.resolve();
}

describe('useScrollToBottom', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('should set isAtBottom true when user is at bottom', () => {
    const containerRef = createMockContainer({ atBottom: true });
    const { result } = renderHook(() => useScrollToBottom([], containerRef));
    expect(result.current.isAtBottom).toBe(true);
  });

  it('should set isAtBottom false when user is not at bottom', () => {
    const containerRef = createMockContainer({ atBottom: false });
    const { result } = renderHook(() => useScrollToBottom([], containerRef));
    expect(result.current.isAtBottom).toBe(false);
  });

  it('should scroll to bottom when isAtBottom is true and messages change', async () => {
    const containerRef = createMockContainer({ atBottom: true });

    const { rerender } = renderHook(
      ({ messages }) => useScrollToBottom(messages, containerRef),
      { initialProps: { messages: [] as string[] } },
    );

    rerender({ messages: ['msg1'] });
    await flushAll();

    // 滚到底走的是容器自身的 scrollTo（overshoot 到 scrollHeight 交给浏览器裁剪），
    // 不再经过 scrollRef.scrollIntoView。
    expect(containerRef.current.scrollTo).toHaveBeenCalledWith({
      top: containerRef.current.scrollHeight,
      behavior: 'auto',
    });
  });

  it('should NOT scroll to bottom when isAtBottom is false and messages change', async () => {
    const containerRef = createMockContainer({ atBottom: false });

    const { rerender } = renderHook(
      ({ messages }) => useScrollToBottom(messages, containerRef),
      { initialProps: { messages: [] as string[] } },
    );

    // Simulate user scrolls up before messages change
    await act(async () => {
      containerRef.current.scrollTop = 0;
      containerRef.current.addEventListener.mock.calls[0][1]();
      await flushAll();
      // Advance fake timers by 10ms instead of real setTimeout
      jest.advanceTimersByTime(10);
    });

    rerender({ messages: ['msg1'] });
    await flushAll();

    expect(containerRef.current.scrollTo).not.toHaveBeenCalled();

    // Optionally, flush again after the assertion to see if it gets called late
    await flushAll();
  });

  it('should indicate button should appear when user is not at bottom', () => {
    const containerRef = createMockContainer({ atBottom: false });
    const { result } = renderHook(() => useScrollToBottom([], containerRef));
    // The button should appear in the UI when isAtBottom is false
    expect(result.current.isAtBottom).toBe(false);
  });
});

const originalRAF = global.requestAnimationFrame;
beforeAll(() => {
  global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
});
afterAll(() => {
  global.requestAnimationFrame = originalRAF;
});
