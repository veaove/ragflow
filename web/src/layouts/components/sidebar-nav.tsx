import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';

import { HomeIcon } from '@/components/svg-icon';
import {
  ChevronDown,
  LucideHouse,
  Settings,
  ShieldCheck,
  Users,
  Workflow,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Routes } from '@/routes';

/**
 * 左侧固定导航的菜单定义与激活态判定。
 *
 * 移动端抽屉（mobile-nav-drawer）与本组件共用同一份 PathMap、菜单项与匹配
 * 规则，避免两处各自维护路由表而逐渐漂移。
 */
const PathMap = {
  [Routes.Datasets]: [Routes.Datasets, Routes.DatasetBase],
  [Routes.Chats]: [Routes.Chats, Routes.Chat],
  [Routes.Searches]: [Routes.Searches, Routes.Search],
  [Routes.Agents]: [Routes.Agents, Routes.AgentTemplates],
  [Routes.Memories]: [Routes.Memories, Routes.Memory, Routes.MemoryMessage],
  [Routes.Files]: [Routes.Files],
  [Routes.AnalyticsConsultations]: [Routes.AnalyticsConsultations],
  [Routes.AnalyticsStats]: [Routes.AnalyticsStats],
} as const;

// Match on path-segment boundaries, not a loose substring, so e.g.
// "/user-setting/chat-channel" does not match the "/chat" tab.
export const matchesPath = (pathname: string, candidate: string) =>
  pathname === candidate || pathname.startsWith(`${candidate}/`);

// Wrapper so dataset icon shares the same ComponentType<{ className? }>
// shape as Lucide icons in menuItems (avoids Element-vs-component union).
export const MenuItemsIcon = ({
  className,
  name,
}: {
  className?: string;
  name?: string;
}) => <HomeIcon imgClass={className} name={name || 'datasets'} width={20} />;

export type SidebarMenuItem = {
  path: string;
  name: string;
  /** Parents and flat entries carry an icon; sub-items are rendered with an indent instead. */
  icon?: React.ComponentType<{ className?: string; name?: string }>;
  icon_name?: string;
  /** Present on a first-level entry that owns a collapsible sub-menu. */
  children?: SidebarMenuItem[];
};

export const sidebarMenuItems: SidebarMenuItem[] = [
  { path: Routes.Root, name: 'header.home', icon: LucideHouse },
  {
    path: Routes.Datasets,
    name: 'header.dataset',
    icon: MenuItemsIcon,
    icon_name: 'datasets',
  },
  {
    path: Routes.Chats,
    name: 'header.chat',
    icon: MenuItemsIcon,
    icon_name: 'chats',
    'data-testid': 'nav-chat',
  } as SidebarMenuItem,
  {
    path: Routes.Searches,
    name: 'header.knowledgeSearch',
    icon: MenuItemsIcon,
    icon_name: 'searches',
    'data-testid': 'nav-search',
  } as SidebarMenuItem,
  {
    path: Routes.Agents,
    name: 'header.flow',
    icon: MenuItemsIcon,
    icon_name: 'agents',
    'data-testid': 'nav-agent',
  } as SidebarMenuItem,
  {
    path: Routes.Studio,
    name: 'header.studio',
    icon: Workflow,
    'data-testid': 'nav-studio',
  } as SidebarMenuItem,
  {
    path: Routes.Memories,
    name: 'header.memories',
    icon: MenuItemsIcon,
    icon_name: 'memory',
  },
  {
    path: Routes.Qc,
    name: 'header.qc',
    icon: ShieldCheck,
    'data-testid': 'nav-qc',
  } as SidebarMenuItem,
  {
    path: Routes.Files,
    name: 'header.fileManager',
    icon: MenuItemsIcon,
    icon_name: 'file',
  },
  // 租户控制台：与「文件管理」平级的下拉入口（两者无隶属关系），
  // 三个子页共用 /console/* 前缀。
  {
    path: 'console',
    name: 'header.tenantConsole',
    icon: Users,
    children: [
      {
        path: Routes.ConsoleOrganization,
        name: 'console.organization',
        'data-testid': 'nav-console-organization',
      } as SidebarMenuItem,
      {
        path: Routes.ConsoleMembers,
        name: 'console.members',
        'data-testid': 'nav-console-members',
      } as SidebarMenuItem,
      {
        path: Routes.ConsoleRoles,
        name: 'console.roles',
        'data-testid': 'nav-console-roles',
      } as SidebarMenuItem,
      {
        path: Routes.ConsoleGrants,
        name: 'console.grants',
        'data-testid': 'nav-console-grants',
      } as SidebarMenuItem,
    ],
  },
  // 配置中心：一级菜单 + 6 个二级菜单。子项复用原有 /user-setting/* 页面，
  // 页面组件没有改动，只是入口从「用户设置」的二级导航挪到了这里。
  {
    path: 'config-center',
    name: 'header.configCenter',
    icon: Settings,
    children: [
      {
        path: `${Routes.UserSetting}${Routes.Model}`,
        name: 'setting.model',
        'data-testid': 'nav-config-model',
      } as SidebarMenuItem,
      {
        path: `${Routes.UserSetting}${Routes.DataSource}`,
        name: 'setting.dataSources',
        'data-testid': 'nav-config-datasource',
      } as SidebarMenuItem,
      {
        path: `${Routes.UserSetting}${Routes.ChatChannel}`,
        name: 'setting.chatChannels',
        'data-testid': 'nav-config-chatchannel',
      } as SidebarMenuItem,
      {
        path: `${Routes.UserSetting}${Routes.Mcp}`,
        name: 'setting.mcp',
        'data-testid': 'nav-config-mcp',
      } as SidebarMenuItem,
      {
        path: `${Routes.UserSetting}${Routes.Api}`,
        name: 'setting.api',
        'data-testid': 'nav-config-api',
      } as SidebarMenuItem,
      {
        path: `${Routes.UserSetting}${Routes.Team}`,
        name: 'setting.team',
        'data-testid': 'nav-config-team',
      } as SidebarMenuItem,
    ],
  } as SidebarMenuItem,
];

export function useActivePath() {
  const { pathname } = useLocation();

  return useMemo(() => {
    return (
      Object.keys(PathMap).find((x: string) =>
        PathMap[x as keyof typeof PathMap].some((y: string) =>
          matchesPath(pathname, y),
        ),
      ) || pathname
    );
  }, [pathname]);
}

/**
 * 左侧固定栏的竖排主导航。选中态用左侧色条 + 浅色底，与
 * admin 后台的导航保持同一视觉语言。
 */
export function SidebarNav({ className }: { className?: string }) {
  const { t } = useTranslation();
  const activePath = useActivePath();
  // 默认只展开「包含当前路由子项」的分组，其余分组折叠。
  // 进入分组内页面时 useEffect 会把它展开，折叠/展开之后完全由用户手动控制。
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const item of sidebarMenuItems) {
      if (!item.children?.length) continue;
      const inThisGroup = item.children.some((c) =>
        matchesPath(activePath, c.path),
      );
      if (!inThisGroup) init[item.path] = true;
    }
    return init;
  });

  /**
   * 进入某个分组下的页面时，自动展开该分组一次；之后完全交给用户手动控制。
   *
   * 这里的「先展开、再尊重手动操作」必须用副作用实现，不能在渲染期直接写
   * `open = childActive || !collapsed[path]`——那样只要停留在分组内的页面上，
   * childActive 就恒为 true，点折叠箭头会被下一次渲染立刻覆盖回去，
   * 表现为「点击没反应、配置中心收不回去」。
   *
   * 另外必须记住「上一次由路由命中的分组」：路由从分组内页面切到分组外页面
   * （比如从「模型配置」点「总览」）时，上面的逻辑只会展开新命中的分组，
   * 不会把刚离开的分组收回去，于是配置中心会一直挂着展开状态。
   * 离开时把上一个分组收起来，才符合「导航跟随当前页面」的直觉。
   */
  const activeGroupRef = useRef<string | null>(null);

  useEffect(() => {
    const parent = sidebarMenuItems.find((item) =>
      item.children?.some((child) => matchesPath(activePath, child.path)),
    );

    const nextGroup = parent?.path ?? null;
    const prevGroup = activeGroupRef.current;
    activeGroupRef.current = nextGroup;

    setCollapsed((prev) => {
      const next = { ...prev };
      let changed = false;

      // 离开了上一个分组 → 收回去。只在它当前是展开态时改；
      // 用户手动收起过的分组保持收起，不再打扰。
      if (prevGroup && prevGroup !== nextGroup && next[prevGroup] === false) {
        next[prevGroup] = true;
        changed = true;
      }

      // 进入新分组 → 展开。
      if (nextGroup && next[nextGroup] !== false) {
        next[nextGroup] = false;
        changed = true;
      }

      return changed ? next : prev;
    });
  }, [activePath]);

  return (
    <nav className={cn('py-2', className)}>
      <ul className="space-y-1">
        {sidebarMenuItems.map((item) => {
          const { path, name, icon: Icon, icon_name, children } = item;

          if (children?.length) {
            const childActive = children.some((c) =>
              matchesPath(activePath, c.path),
            );
            const open = !collapsed[path];

            return (
              <li key={path}>
                <button
                  type="button"
                  onClick={() =>
                    setCollapsed((prev) => ({ ...prev, [path]: !prev[path] }))
                  }
                  aria-expanded={open}
                  data-testid={`sidebar-group-${path}`}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[15px]',
                    'transition-colors hover:bg-bg-card hover:text-text-primary',
                    'focus-visible:bg-bg-card focus-visible:text-text-primary',
                    childActive
                      ? 'font-medium text-text-primary'
                      : 'text-text-secondary',
                  )}
                >
                  <span className="relative flex size-5 shrink-0 items-center justify-center">
                    {Icon && (
                      <Icon className="size-5 stroke-[1.5]" name={icon_name} />
                    )}
                  </span>
                  <span className="truncate">{t(name)}</span>
                  <ChevronDown
                    className={cn(
                      'ml-auto size-4 shrink-0 transition-transform',
                      open ? 'rotate-0' : '-rotate-90',
                    )}
                  />
                </button>

                {open && (
                  <ul
                    className="mt-0.5 space-y-0.5"
                    data-testid={`sidebar-sub-${path}`}
                  >
                    {children.map((child) => {
                      // 前缀匹配：数据源详情页 /user-setting/data-source/...
                      // 也要把「数据源」这一项标成选中，否则进入详情后导航里
                      // 看不出自己在哪。
                      const childIsActive = matchesPath(activePath, child.path);

                      return (
                        <li key={child.path}>
                          <Link
                            to={child.path}
                            className={cn(
                              'flex items-center rounded-lg py-2 pr-3 pl-11 text-sm',
                              'transition-colors hover:bg-bg-card hover:text-text-primary',
                              'focus-visible:bg-bg-card focus-visible:text-text-primary',
                              childIsActive
                                ? 'bg-bg-card font-medium text-text-primary'
                                : 'text-text-secondary',
                            )}
                            aria-current={childIsActive ? 'page' : undefined}
                            data-testid={`sidebar-nav-${child.path.replace(/^\//, '')}`}
                          >
                            <span className="truncate">{t(child.name)}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          }

          const isActive = path === activePath;

          return (
            <li key={path}>
              <Link
                to={path}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px]',
                  'text-text-secondary transition-colors',
                  'hover:bg-bg-card hover:text-text-primary',
                  'focus-visible:bg-bg-card focus-visible:text-text-primary',
                  isActive && 'bg-bg-card font-medium text-text-primary',
                )}
                aria-current={isActive ? 'page' : undefined}
                data-testid={`sidebar-nav-${path === Routes.Root ? 'root' : path.replace(/^\//, '')}`}
              >
                <span className="relative flex size-5 shrink-0 items-center justify-center">
                  {/* 选中态色条：贴在图标左侧，与 admin 导航一致。
                      注意用 bg-accent-primary（背景色）；裸 accent-primary
                      编译出的是 accent-color，只对表单复选框生效。*/}
                  <span
                    aria-hidden
                    className={cn(
                      'absolute -left-3 h-6 w-0.5 rounded-full bg-accent-primary transition-opacity',
                      isActive ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  {Icon && (
                    <Icon className="size-5 stroke-[1.5]" name={icon_name} />
                  )}
                </span>
                <span className="truncate">{t(name)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
