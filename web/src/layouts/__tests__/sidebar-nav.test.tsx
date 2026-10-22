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

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <SidebarNav />
    </MemoryRouter>,
  );

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
});
