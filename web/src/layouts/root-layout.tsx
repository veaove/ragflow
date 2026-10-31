import { useEffect, useMemo } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';

import { filterMenuItems, useConsolePermissions } from '@/hooks/use-console-permissions';
import { useSuperUserDenied } from '@/hooks/use-super-user-denied';
import { Routes } from '@/routes';

import { AppSidebar } from './components/app-sidebar';
import { Header } from './components/header';
import { sidebarMenuItems, type SidebarMenuItem } from './components/sidebar-nav';
import SuperUserNotice from './components/super-user-notice';

/**
 * 从过滤后的菜单树里拿到第一个可见叶子节点的 path。
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
  return Routes.Root;
}

/** 递归收集菜单树的所有叶子 path 字符串。 */
function collectLeafPaths(items: SidebarMenuItem[]): string[] {
  const out: string[] = [];
  for (const it of items) {
    if (it.path && it.path !== 'console' && it.path !== 'config-center') {
      out.push(it.path);
    }
    if (it.children?.length) out.push(...collectLeafPaths(it.children));
  }
  return out;
}

/** 把菜单树的「组」虚拟 path 映射到它的第一个子 path。 */
function resolveGroupPath(p: string): string {
  if (p === 'console') return Routes.ConsoleOrganization;
  if (p === 'config-center') return `${Routes.UserSetting}${Routes.Model}`;
  return p;
}

/**
 * 非 owner 的权限 redirect + 阻截组件。
 *
 * 核心设计：在权限接口返回前，**不渲染 Outlet**。
 * 如果 Outlet 先 render 了（例如 Overview 页面），它的 useEffect 会立刻
 * 触发一批 API 请求（/overview/statistic /overview/activity /team/department 等），
 * 等我们的 useEffect 反应过来 navigate 走的时候，403 toast 已经弹出来了。
 * 所以必须在根布局这一层就「挡住」Outlet，拿到权限矩阵之后再决定：
 *   - 当前路径无权限 → 立即 navigate 走，Outlet 永远不会 mount
 *   - 当前路径有权限 → return <Outlet /> 放行
 *
 * owner 直接放行，和原来的行为一致。
 *
 * 重要：所有 Hook 必须无条件放在组件顶层，不能在 if 分支里调用！
 */
function PermissionGate() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { perms, isOwner } = useConsolePermissions();

  // --- 所有 Hook 必须在任何条件 return 之前声明 ---
  // 计算是否需要 redirect（返回 null 表示不需要）
  const redirectTarget = useMemo<string | null>(() => {
    // owner 或权限未加载 → 不 redirect
    if (isOwner || !perms) return null;

    const allLeafPaths = collectLeafPaths(sidebarMenuItems);
    const allowedLeafPaths = collectLeafPaths(
      filterMenuItems(sidebarMenuItems, perms, { isOwner: false }),
    );

    const isOverview = pathname === '/' || pathname === '/overview';
    const inMenu = allLeafPaths.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`),
    );
    const hasPermissionHere = allowedLeafPaths.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`),
    );

    if (isOverview || (inMenu && !hasPermissionHere)) {
      const visible = filterMenuItems(sidebarMenuItems, perms, { isOwner: false });
      return resolveGroupPath(firstVisiblePath(visible));
    }
    return null;
  }, [pathname, perms, isOwner]);

  // 无条件 useEffect：只有当 redirectTarget 非空时才执行 navigate
  useEffect(() => {
    if (redirectTarget) {
      navigate(redirectTarget, { replace: true });
    }
  }, [redirectTarget, navigate]);

  // --- 条件 render ---
  if (isOwner) return <Outlet />;
  if (!perms) {
    return (
      <div className="flex size-full items-center justify-center text-text-secondary">
        <div className="flex flex-col items-center gap-2">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-border-default border-t-accent-primary" />
          <span className="text-sm">加载权限…</span>
        </div>
      </div>
    );
  }
  // redirect 进行中 → 不渲染 Outlet，避免旧页面短暂闪烁
  if (redirectTarget) return null;

  return <Outlet />;
}

/**
 * 应用外壳：左侧固定导航 + 顶栏 + 内容区。
 */
export function RootLayoutContainer({ children }: React.PropsWithChildren) {
  return (
    <div className="flex h-full min-w-0">
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
  const superUserDenied = useSuperUserDenied();

  // 平台超管：主站接口全被后端拒掉，硬渲染只会得到「侧栏空 + 永远转圈」。
  // 整页换成「请去控制台」的说明，连侧栏和顶栏一起不渲染 —— 它们各自的
  // 请求同样会 403，白白刷一串权限提示。
  if (superUserDenied) {
    return <SuperUserNotice />;
  }

  return (
    <RootLayoutContainer>
      <PermissionGate />
    </RootLayoutContainer>
  );
}
