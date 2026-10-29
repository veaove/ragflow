import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import request from '@/utils/request';
import SearchHome from '../search-home';

jest.mock('@/utils/request', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

// The logo pulls in the embed modal → highlight-markdown → remark-* which are
// ESM-only packages that jest (CJS) cannot parse without a transform.
jest.mock('../ragflow-logo', () => ({ RAGFlowLogo: () => null }));

const mockedRequest = request as unknown as {
  get: jest.Mock;
  post: jest.Mock;
};

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'zh',
    fallbackLng: 'zh',
    resources: { zh: { translation: {} } },
  });
});

const chunkResponse = (question: string, similarity: number) => ({
  data: {
    data: {
      chunks: [
        {
          content: `问题：${question}\t回答：略`,
          similarity,
          document_name: '知识库',
        },
      ],
    },
  },
});

function renderHome(searchText: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const setSearchText = jest.fn();
  const utils = render(
    <QueryClientProvider client={client}>
      <SearchHome
        isSearching={false}
        setIsSearching={jest.fn()}
        searchText={searchText}
        setSearchText={setSearchText}
        kbIds={['kb-1']}
      />
    </QueryClientProvider>,
  );
  return { ...utils, client };
}

describe('SearchHome 相似问题', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockedRequest.get.mockResolvedValue({ data: { data: [] } });
    mockedRequest.post.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('debounces the retrieval to one request per typing pause', async () => {
    mockedRequest.post.mockResolvedValue(chunkResponse('基金怎么买', 0.909));
    renderHome('基金怎么买');

    // 250ms 之前不发请求：中间态每敲一个字都打一次检索是之前慢的主因。
    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(mockedRequest.post).not.toHaveBeenCalled();

    // 不等到 500ms 就要发出去；这里不能用 waitFor —— 它会把假时钟一路推过
    // 500ms，让这条断言永远成立。
    await act(async () => {
      jest.advanceTimersByTime(60);
    });
    expect(mockedRequest.post).toHaveBeenCalledTimes(1);
    expect(mockedRequest.post).toHaveBeenCalledWith(
      '/api/v1/retrieval',
      expect.objectContaining({
        data: expect.objectContaining({
          question: '基金怎么买',
          dataset_ids: ['kb-1'],
          page_size: 3,
        }),
      }),
    );
  });

  it('shows a searching hint instead of "未找到" while the request is in flight', async () => {
    let resolvePost: (value: unknown) => void = () => {};
    mockedRequest.post.mockReturnValue(
      new Promise((resolve) => {
        resolvePost = resolve;
      }),
    );

    renderHome('华夏基金的官方网站是什么');

    act(() => {
      jest.advanceTimersByTime(300);
    });

    // 请求还没回来时不能说「未找到相关问题」——那 300~550ms 里用户看到的就是这句。
    await screen.findByText('正在检索知识库…');
    expect(screen.queryByText('未找到相关问题，换个说法试试')).toBeNull();

    await act(async () => {
      resolvePost(chunkResponse('华夏基金的官方网站是什么？', 0.917));
      jest.advanceTimersByTime(0);
    });

    await screen.findByText('华夏基金的官方网站是什么？');
    expect(screen.getByText('91.7%')).toBeTruthy();
    expect(screen.queryByText('正在检索知识库…')).toBeNull();
  });

  it('keeps the previous matches on screen while the next query runs', async () => {
    mockedRequest.post.mockResolvedValue(chunkResponse('基金怎么买', 0.5));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const tree = (searchText: string) => (
      <QueryClientProvider client={client}>
        <SearchHome
          isSearching={false}
          setIsSearching={jest.fn()}
          searchText={searchText}
          setSearchText={jest.fn()}
          kbIds={['kb-1']}
        />
      </QueryClientProvider>
    );

    const { rerender } = render(tree('基金怎么买'));
    act(() => {
      jest.advanceTimersByTime(300);
    });
    await screen.findByText('基金怎么买');

    // 接着再敲一个字：新查询会挂住，上一轮结果必须留在原地（placeholderData），
    // 否则每次按键右侧都闪成空态，用户看到的就只是「一直没有结果」。
    mockedRequest.post.mockReturnValue(new Promise(() => {}));
    rerender(tree('基金怎么买呢'));
    act(() => {
      jest.advanceTimersByTime(300);
    });

    await screen.findByText('基金怎么买');
    expect(screen.queryByText('未找到相关问题，换个说法试试')).toBeNull();
  });
});
