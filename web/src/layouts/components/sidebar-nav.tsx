import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';

import { HomeIcon } from '@/components/svg-icon';
import { LucideHouse, LucideLayoutDashboard } from 'lucide-react';
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
};

export const sidebarMenuItems: SidebarMenuItem[] = [
  { path: Routes.Root, name: 'header.overview', icon: LucideLayoutDashboard },
  { path: Routes.Home, name: 'header.home', icon: LucideHouse },
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
    name: 'header.search',
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
    path: Routes.Memories,
    name: 'header.memories',
    icon: MenuItemsIcon,
    icon_name: 'memory',
  },
  {
    path: Routes.Files,
    name: 'header.fileManager',
    icon: MenuItemsIcon,
    icon_name: 'file',
  },
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
 * 左侧固定栏的竖排主导航。
 *
 * 深色侧边栏上的选中态：品牌蓝底 + 反白文字 + 左侧亮色条。
 */
export function SidebarNav({ className }: { className?: string }) {
  const { t } = useTranslation();
  const activePath = useActivePath();

  return (
    <nav className={cn('py-2', className)}>
      <ul className="space-y-1">
        {sidebarMenuItems.map(({ path, name, icon: Icon, icon_name }) => {
          const isActive = path === activePath;

          return (
            <li key={path}>
              <Link
                to={path}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px]',
                  'text-[var(--rail-text-muted)] transition-colors',
                  'hover:bg-[var(--rail-hover)] hover:text-[var(--rail-text)]',
                  'focus-visible:bg-[var(--rail-hover)] focus-visible:text-[var(--rail-text)]',
                  isActive &&
                    'bg-[var(--rail-active-bg)] font-medium text-white',
                )}
                aria-current={isActive ? 'page' : undefined}
                data-testid={`sidebar-nav-${path === Routes.Root ? 'root' : path.replace(/^\//, '')}`}
              >
                <span className="relative flex size-5 shrink-0 items-center justify-center">
                  {/* 选中态色条：贴在图标左侧。
                      用 bg-white 而非 bg-accent-primary —— 深色底上亮色条
                      对比度更高，且不与选中态的蓝底抢视觉。*/}
                  <span
                    aria-hidden
                    className={cn(
                      'absolute -left-3 h-6 w-0.5 rounded-full bg-white transition-opacity',
                      isActive ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <Icon className="size-5 stroke-[1.5]" name={icon_name} />
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