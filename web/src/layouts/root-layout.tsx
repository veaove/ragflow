import { useEffect, useMemo } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';

import { filterMenuItems, useConsolePermissions } from '@/hooks/use-console-permissions';
import { Routes } from '@/routes';

import { AppSidebar } from './components/app-sidebar';
import { Header } from './components/header';
import { sidebarMenuItems, type SidebarMenuItem } from './components/sidebar-nav';

/**
 * 从过滤后的菜单树里拿到第一个可见叶子节点的 path。
 * 如果分组被过滤空了（无 children），整个分组会被去掉，所以
 * 取到的第一个 path 一定是用户 can_view=true 的。
 */
function firstVisiblePath(items: SidebarMenuItem[]): string {
  for (const item of items) {
    if (item.children?.length) {
      const childFirst = firstVisiblePath(item.children);
      if (childFirst !== Routes.Root) return childFirst;
      continue;
    }
    if (item.path && item.path !== Routes.Root) return item.path;
  }
  return Routes.Root; // 兜底：owner 一定命中 overview
}

/**
 * 权限 redirect：
 * - 根路径 `/` 和 `/overview` 默认跳到总览页，但非 owner 可能没有 overview 权限 →
 *   等权限接口返回后，redirect 到第一个用户有权限的菜单。
 * - 直接敲 URL 进无权限页面（例如 `/console/members`）→ 也跳走，避免页面里
 *   一堆 403 toast 先刷出来再被 ConsoleGuard 挡住。
 *
 * owner 跳过所有检查，保持原有行为。
 */
function PermissionRedirect() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { perms, isOwner } = useConsolePermissions();

  const firstPath = useMemo(() => {
    if (isOwner || !perms) return null;
    const visible = filterMenuItems(sidebarMenuItems, perms, { isOwner: false });
    const p = firstVisiblePath(visible);
    // 归一化 "/console" → "/console/organization"
    if (p === 'console') return Routes.ConsoleOrganization;
    if (p === 'config-center') return `${Routes.UserSetting}${Routes.Model}`;
    return p;
  }, [perms, isOwner]);

  useEffect(() => {
    if (isOwner || !perms || !firstPath) return;

    const isOverview = pathname === '/' || pathname === '/overview';
    // 其他所有顶层菜单路径都在 sidebarMenuItems 里有对应 path（或 children），
    // 这里统一判断当前路径是否落在「用户无权访问」的区域。
    const menuPaths = collectPaths(sidebarMenuItems);
    const isInMenu = menuPaths.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`),
    );
    const allowedPaths = collectPaths(
      filterMenuItems(sidebarMenuItems, perms, { isOwner: false }),
    );
    const isAllowed = allowedPaths.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`),
    );

    if (isOverview || (isInMenu && !isAllowed)) {
      navigate(firstPath, { replace: true });
    }
  }, [pathname, perms, isOwner, firstPath, navigate]);

  return null;
}

/** 递归收集菜单树的所有 path 字符串。 */
function collectPaths(items: SidebarMenuItem[]): string[] {
  const out: string[] = [];
  for (const it of items) {
    if (it.path && it.path !== 'console' && it.path !== 'config-center') {
      out.push(it.path);
    }
    if (it.children?.length) out.push(...collectPaths(it.children));
  }
  return out;
}

/**
 * 应用外壳：左侧固定导航 + 顶栏 + 内容区。
 *
 * 侧栏用 flex 而非 grid：内容区需要「占满剩余宽度」，而侧栏在窄屏下要能
 * 完全收起。flex + `min-w-0` 才能让长内容正确收缩而不撑破布局。
 *
 * 侧栏只在 lg 以上展示；窄屏下由 Header 里的抽屉菜单接管导航。
 */
export function RootLayoutContainer({ children }: React.PropsWithChildren) {
  return (
    <div className="flex h-full min-w-0">
      <PermissionRedirect />
      <div className="hidden lg:flex">
        <AppSidebar />
      </div>

      <div className="flex size-full min-w-0 flex-1 flex-col">
        <Header className="shrink-0 px-5 py-4" />

        <main className="size-full min-w-0 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}

export default function RootLayout() {
  return (
    <RootLayoutContainer>
      <Outlet />
    </RootLayoutContainer>
  );
}
