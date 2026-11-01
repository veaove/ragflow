import { filterMenuItems } from '@/hooks/use-console-permissions';
import type { MyPermissions } from '@/services/console-service';
import type { SidebarMenuItem } from './components/sidebar-nav';

/** 总览页的另一个可达 path（路由表里同时存在 `/` 与 `/overview`）。 */
const OVERVIEW_ALIAS = '/overview';

/** 只有分组、没有独立落地页的虚拟 path。 */
const GROUP_ONLY_PATHS = new Set(['console', 'config-center']);

/** 递归收集菜单树的所有叶子 path 字符串。 */
export function collectLeafPaths(items: SidebarMenuItem[]): string[] {
  const out: string[] = [];
  for (const it of items) {
    if (it.path && !GROUP_ONLY_PATHS.has(it.path)) {
      out.push(it.path);
    }
    if (it.children?.length) out.push(...collectLeafPaths(it.children));
  }
  return out;
}

/** 从过滤后的菜单树里拿到第一个可见叶子节点的 path。 */
export function firstVisiblePath(
  items: SidebarMenuItem[],
  overviewPath = '/',
): string {
  for (const item of items) {
    if (item.children?.length) {
      const childFirst = firstVisiblePath(item.children, overviewPath);
      if (childFirst !== overviewPath) return childFirst;
      continue;
    }
    if (item.path && item.path !== overviewPath) return item.path;
  }
  return overviewPath;
}

export interface PermissionRedirectInput {
  pathname: string;
  perms: MyPermissions | null;
  isOwner: boolean;
  menuItems: SidebarMenuItem[];
  /** 总览在菜单里的 path，默认 `/`。 */
  overviewPath?: string;
  /** 菜单「组」虚拟 path 映射到它的第一个子 path。 */
  resolveGroupPath?: (path: string) => string;
}

/**
 * 决定非 owner 当前路径是否要被弹走，返回目标 path；`null` 表示放行。
 *
 * 总览不是「默认页」，而是一个受控模块：菜单按 `overview.can_view` 显示了入口，
 * 这里就必须用同一份判定放行。曾经的实现无条件把 `/` 重定向到第一个可见页，
 * 于是「菜单里看得见总览、点进去被弹回知识库」——有权限也进不去。
 */
export function resolvePermissionRedirect({
  pathname,
  perms,
  isOwner,
  menuItems,
  overviewPath = '/',
  resolveGroupPath = (path) => path,
}: PermissionRedirectInput): string | null {
  if (isOwner || !perms) return null;

  const allLeafPaths = collectLeafPaths(menuItems);
  const visible = filterMenuItems(menuItems, perms, { isOwner: false });
  const allowedLeafPaths = collectLeafPaths(visible);

  const onOverview = pathname === overviewPath || pathname === OVERVIEW_ALIAS;
  const overviewAllowed = allowedLeafPaths.includes(overviewPath);

  const inMenu = allLeafPaths.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  const hasPermissionHere = allowedLeafPaths.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if ((onOverview && !overviewAllowed) || (inMenu && !hasPermissionHere)) {
    return resolveGroupPath(firstVisiblePath(visible, overviewPath));
  }

  return null;
}
