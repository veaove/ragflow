import { useQuery } from '@tanstack/react-query';

import { useFetchTenantInfo } from '@/hooks/use-user-setting-request';
import { MyPermissions, fetchMyPermissions } from '@/services/console-service';

/**
 * 菜单项 → 权限模块。
 *
 * 未列出的菜单（首页、配置中心等）不参与过滤 —— 它们不属于租户可配置的
 * 功能范围。
 */
const MENU_MODULE: Record<string, string> = {
  'header.home': 'overview',
  'header.dataset': 'dataset',
  'header.chat': 'chat',
  'header.knowledgeSearch': 'search',
  'header.flow': 'agent',
  'header.memories': 'memory',
  'header.qc': 'qc_rule',
  'header.fileManager': 'file',
  'console.organization': 'organization',
  'console.members': 'member',
  'console.roles': 'role',
  'console.grants': 'grant',
};

/**
 * 当前用户在租户内的有效权限。
 *
 * 三处「放行」默认值都是刻意的：权限接口未返回、某模块未配置、请求失败时一律
 * 视为可见。反过来（默认拒绝）会让一次接口抖动把所有菜单清空，比越权更伤可用性；
 * 真正的数据访问仍然由后端权限引擎把关。
 */
export function useConsolePermissions() {
  const { data: tenantInfo } = useFetchTenantInfo();
  const tenantId = tenantInfo?.tenant_id as string | undefined;

  const { data } = useQuery({
    queryKey: ['console/my-permissions', tenantId],
    enabled: !!tenantId,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetchMyPermissions(tenantId as string);
      return res?.data ?? null;
    },
  });

  const canView = (module: string): boolean => {
    if (!data) return true;
    const row = data.modules?.[module];
    if (!row) return true;
    return !!row.can_view;
  };

  const menuAllowed = (name: string): boolean => {
    const mod = MENU_MODULE[name];
    if (!mod) return true;
    return canView(mod);
  };

  return {
    perms: data ?? null,
    tenantId,
    roleName: data?.role_name ?? '',
    canView,
    menuAllowed,
  };
}

/**
 * 按权限过滤菜单树。
 *
 * 泛型约束刻意只要求 `{ name, children }`，而不是 import `SidebarMenuItem` ——
 * 后者会形成 sidebar-nav ↔ hook 的循环依赖。
 */
export function filterMenuItems<T extends { name: string; children?: T[] }>(
  items: T[],
  perms: MyPermissions | null,
): T[] {
  if (!perms) return items;

  const allowed = (name: string) => {
    const module = MENU_MODULE[name];
    if (!module) return true;
    const row = perms.modules?.[module];
    return row ? !!row.can_view : true;
  };

  const out: T[] = [];
  for (const item of items) {
    // 分组本身没有独立页面（config-center / console），子项全被挡住就整组隐藏。
    if (item.children?.length) {
      const children = item.children.filter((child) => allowed(child.name));
      if (children.length === 0) continue;
      out.push({ ...item, children });
      continue;
    }
    if (allowed(item.name)) out.push(item);
  }
  return out;
}
