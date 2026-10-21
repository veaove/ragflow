import { Fragment, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';

import { HomeIcon } from '@/components/svg-icon';
import {
  Cpu,
  Database,
  KeyRound,
  LucideHouse,
  MessagesSquare,
  Plug,
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
  icon: React.ComponentType<{ className?: string; name?: string }>;
  icon_name?: string;
  /** Optional group id; a heading is rendered when it changes. */
  group?: string;
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
  // 配置中心：这 6 项原本藏在「用户设置」的二级菜单里，提到主菜单后
  // 由主菜单直接进入，页内不再显示设置侧边栏。
  {
    path: `${Routes.UserSetting}${Routes.Model}`,
    name: 'setting.model',
    icon: Cpu,
    group: 'config',
    'data-testid': 'nav-config-model',
  } as SidebarMenuItem,
  {
    path: `${Routes.UserSetting}${Routes.DataSource}`,
    name: 'setting.dataSources',
    icon: Database,
    group: 'config',
    'data-testid': 'nav-config-datasource',
  } as SidebarMenuItem,
  {
    path: `${Routes.UserSetting}${Routes.ChatChannel}`,
    name: 'setting.chatChannels',
    icon: MessagesSquare,
    group: 'config',
    'data-testid': 'nav-config-chatchannel',
  } as SidebarMenuItem,
  {
    path: `${Routes.UserSetting}${Routes.Mcp}`,
    name: 'setting.mcp',
    icon: Plug,
    group: 'config',
    'data-testid': 'nav-config-mcp',
  } as SidebarMenuItem,
  {
    path: `${Routes.UserSetting}${Routes.Api}`,
    name: 'setting.api',
    icon: KeyRound,
    group: 'config',
    'data-testid': 'nav-config-api',
  } as SidebarMenuItem,
  {
    path: `${Routes.UserSetting}${Routes.Team}`,
    name: 'setting.team',
    icon: Users,
    group: 'config',
    'data-testid': 'nav-config-team',
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

  return (
    <nav className={cn('py-2', className)}>
      <ul className="space-y-1">
        {sidebarMenuItems.map((item, index) => {
          const { path, name, icon: Icon, icon_name, group } = item;
          const isActive = path === activePath;
          const showGroupHeading =
            !!group && group !== sidebarMenuItems[index - 1]?.group;

          return (
            <Fragment key={path}>
              {showGroupHeading && (
                <li
                  className="px-3 pt-4 pb-1 text-xs text-text-disabled"
                  data-testid={`sidebar-group-${group}`}
                >
                  {t(`header.group.${group}`)}
                </li>
              )}
              <li>
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
                  <Icon className="size-5 stroke-[1.5]" name={icon_name} />
                </span>
                <span className="truncate">{t(name)}</span>
              </Link>
              </li>
            </Fragment>
          );
        })}
      </ul>
    </nav>
  );
}