import { MessageType } from '@/constants/chat';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useAgentAutoRead } from './use-auto-read';

jest.mock('@/constants/authorization', () => ({ Authorization: 'Authorization' }));
jest.mock('@/utils/authorization-util', () => ({
  getAuthorization: () => 'token',
}));
jest.mock('@/utils/api', () => ({
  __esModule: true,
  default: { chatsTts: '/api/v1/chat/audio/speech' },
}));

const playMock = jest.fn().mockResolvedValue(undefined);
const pauseMock = jest.fn();

class MockAudio {
  onended: (() => void) | null = null;
  play = playMock;
  pause = pauseMock;
  constructor(public src: string) {}
}

const fetchMock = jest.fn(async () => ({
  ok: true,
  blob: async () => new Blob(['wav']),
}));

beforeAll(() => {
  (global as any).Audio = MockAudio;
  (global as any).fetch = fetchMock;
  (URL as any).createObjectURL = jest.fn(() => 'blob:mock');
  (URL as any).revokeObjectURL = jest.fn();
});

beforeEach(() => {
  fetchMock.mockClear();
  playMock.mockClear();
  localStorage.clear();
});

const prologue = [
  {
    id: 'prologue',
    role: MessageType.Assistant,
    content: '您好，欢迎致电华夏基金客户服务中心，请按 1 咨询客服电话。',
  },
];

describe('useAgentAutoRead', () => {
  it('开关关闭时不合成、不播放', async () => {
    localStorage.setItem('agent_auto_read', '0');
    renderHook(() => useAgentAutoRead(prologue, false));
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(playMock).not.toHaveBeenCalled();
  });

  it('打开后开场白自动念一次，且不重复念', async () => {
    localStorage.setItem('agent_auto_read', '1');
    const { rerender } = renderHook(
      ({ messages }) => useAgentAutoRead(messages, false),
      { initialProps: { messages: prologue } },
    );

    await waitFor(() => expect(playMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 同一条消息再触发几次渲染，不应该重播
    rerender({ messages: [...prologue] });
    rerender({ messages: [...prologue] });
    await act(async () => {
      await Promise.resolve();
    });
    expect(playMock).toHaveBeenCalledTimes(1);
  });

  it('每轮回答跑完后自动念新的那条', async () => {
    localStorage.setItem('agent_auto_read', '1');
    const { rerender } = renderHook(
      ({ messages, loading }) => useAgentAutoRead(messages, loading),
      { initialProps: { messages: prologue, loading: false } },
    );
    await waitFor(() => expect(playMock).toHaveBeenCalledTimes(1));

    // 用户提问 → 流式输出中（loading=true）时不应该念
    rerender({
      messages: [
        ...prologue,
        { id: 'u1', role: MessageType.User, content: '1' },
        { id: 'a1', role: MessageType.Assistant, content: '' },
      ],
      loading: true,
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(playMock).toHaveBeenCalledTimes(1);

    // 跑完 → 念第二条
    rerender({
      messages: [
        ...prologue,
        { id: 'u1', role: MessageType.User, content: '1' },
        { id: 'a1', role: MessageType.Assistant, content: '客服热线 400-818-6666。' },
      ],
      loading: false,
    });
    await waitFor(() => expect(playMock).toHaveBeenCalledTimes(2));
  });
});
