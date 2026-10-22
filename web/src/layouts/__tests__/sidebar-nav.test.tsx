import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import { SidebarNav } from '../components/sidebar-nav';

/**
 * 「配置中心」这类分组菜单的折叠回归测试。
 *
 * 曾经的实现是 `open = childActive || !collapsed[path]`：只要停留在分组内的
 * 页面（比如数据源），childActive 恒为 true，折叠状态会被下一次渲染覆盖回去，
 * 点箭头完全没反应。这里用真实渲染锁住「能收起来」这个行为。
 *
 * 为什么要 mock `@/routes` 和 `react-i18next`：
 * - `routes.tsx` 在模块作用域就调 `createBrowserRouter()`，jsdom 没有 `Request`
 *   会直接抛 ReferenceError，而它同时把整个应用页面树拖进测试；
 *   这里只需要 Routes 常量，就地声明取值与 routes.tsx 的枚举保持一致。
 * - 组件用 `useTranslation`，没有 i18next 实例时会打一堆警告，
 *   折叠行为与文案无关，直接返回 key。
 */
jest.mock('@/routes', () => ({
  Routes: {
    Root: '/',
    Datasets: '/datasets',
    DatasetBase: '/dataset',
    Chats: '/chats',
    Chat: '/chat',
    Searches: '/searches',
    Search: '/search',
    Agents: '/agents',
    AgentTemplates: '/agent-templates',
    Studio: '/studio',
    Memories: '/memories',
    Memory: '/memory',
    MemoryMessage: '/memory-message',
    Qc: '/qc',
    Files: '/files',
    AnalyticsConsultations: '/analytics-consultations',
    AnalyticsStats: '/analytics-stats',
    UserSetting: '/user-setting',
    Model: '/model',
    DataSource: '/data-source',
    ChatChannel: '/chat-channel',
    Mcp: '/mcp',
    Api: '/api',
    Team: '/team',
  },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

/**
 * 用可变变量接管 useLocation，这样测试才能在同一个挂载实例上「切换路由」。
 * 只 mock useLocation，Link 仍走真实实现（MemoryRouter 提供 context）。
 */
let mockPathname = '/';
jest.mock('react-router', () => ({
  ...jest.requireActual('react-router'),
  useLocation: () => ({
    pathname: mockPathname,
    search: '',
    hash: '',
    state: null,
    key: 'test',
  }),
}));

const renderAt = (path: string) => {
  mockPathname = path;
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SidebarNav />
    </MemoryRouter>,
  );
};

const groupButton = () => screen.getByTestId('sidebar-group-config-center');
const subMenu = () => screen.queryByTestId('sidebar-sub-config-center');

describe('SidebarNav 分组折叠', () => {
  it('分组内页面上仍可收起，再点可展开', () => {
    renderAt('/user-setting/data-source');

    // 默认展开，能看到分组内的二级项。
    expect(subMenu()).not.toBeNull();
    expect(groupButton().getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(groupButton());
    expect(subMenu()).toBeNull();
    expect(groupButton().getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(groupButton());
    expect(subMenu()).not.toBeNull();
    expect(groupButton().getAttribute('aria-expanded')).toBe('true');
  });

  it('收起状态不会被当前路由「弹回」展开', () => {
    renderAt('/user-setting/data-source');
    fireEvent.click(groupButton());
    expect(subMenu()).toBeNull();

    // 再次渲染（触发一次渲染循环）后仍应保持收起。
    fireEvent.click(document.body);
    expect(subMenu()).toBeNull();
  });

  it('未手动折叠时默认展开', () => {
    renderAt('/user-setting/model');
    expect(subMenu()).not.toBeNull();
    expect(groupButton().getAttribute('aria-expanded')).toBe('true');
  });

  it('数据源详情页也把分组识别为当前所在', () => {
    renderAt('/user-setting/data-source/data-source-detail-page');
    // 分组保持展开（默认态），且「数据源」这一项被标为当前页。
    expect(subMenu()).not.toBeNull();
    expect(
      screen
        .getByTestId('sidebar-nav-user-setting/data-source')
        .getAttribute('aria-current'),
    ).toBe('page');
  });

  it('分组外的页面上，分组默认折叠', () => {
    renderAt('/datasets');
    // 配置中心不在当前路由分组内，默认应折叠。
    expect(subMenu()).toBeNull();
    expect(groupButton().getAttribute('aria-expanded')).toBe('false');
  });

  it('从分组内页面切到分组外页面，分组自动收起', () => {
    // 复现「点总览，配置中心却还开着」：useEffect 之前只展开命中的分组，
    // 从不收起刚离开的分组，于是配置中心会一直挂着展开状态。
    const { rerender } = renderAt('/user-setting/data-source');
    expect(subMenu()).not.toBeNull();
    expect(groupButton().getAttribute('aria-expanded')).toBe('true');

    // 路由切到分组外（总览）
    mockPathname = '/';
    rerender(
      <MemoryRouter initialEntries={['/user-setting/data-source']}>
        <SidebarNav />
      </MemoryRouter>,
    );

    expect(subMenu()).toBeNull();
    expect(groupButton().getAttribute('aria-expanded')).toBe('false');
  });

  it('用户手动收起后切换路由，不会被「弹回」展开', () => {
    const { rerender } = renderAt('/user-setting/data-source');

    // 用户主动收起
    fireEvent.click(groupButton());
    expect(subMenu()).toBeNull();

    // 切到分组外 → 保持收起（本来就是收起态，不做任何改动）
    mockPathname = '/';
    rerender(
      <MemoryRouter initialEntries={['/user-setting/data-source']}>
        <SidebarNav />
      </MemoryRouter>,
    );
    expect(subMenu()).toBeNull();

    // 再切回分组内 → 自动展开，方便继续操作
    mockPathname = '/user-setting/model';
    rerender(
      <MemoryRouter initialEntries={['/user-setting/data-source']}>
        <SidebarNav />
      </MemoryRouter>,
    );
    expect(subMenu()).not.toBeNull();
  });
});
