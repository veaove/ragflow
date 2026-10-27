import { useQuery } from '@tanstack/react-query';

import { useFetchTenantInfo } from '@/hooks/use-user-setting-request';
import { MyPermissions, fetchMyPermissions } from '@/services/console-service';

/**
 * 菜单项 → 权限模块。
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
  'setting.model': 'model',
  'setting.dataSources': 'datasource',
  'setting.chatChannels': 'channel',
  'setting.mcp': 'mcp',
  'setting.api': 'apikey',
  'setting.team': 'team',
};

/**
 * 当前用户在租户内的有效权限。
 *
 * 菜单过滤只在「成功拿到后端返回」时才生效。loading/error/disabled 一律
 * 显示完整菜单 —— 后端 ModulePermission 中间件会拦截真正的越权请求，
 * 前端只做视觉裁剪，不做安全闸。
 */
export function useConsolePermissions() {
  const { data: tenantInfo } = useFetchTenantInfo();
  const tenantId = tenantInfo?.tenant_id as string | undefined;

  const { data, status } = useQuery({
    queryKey: ['console/my-permissions', tenantId],
    enabled: !!tenantId,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetchMyPermissions(tenantId as string);
      return res?.data ?? null;
    },
  });

  // eslint-disable-next-line no-console
  console.info('[perms] status=', status, 'tenantId=', tenantId, 'data=', data);

  // 明确拿到权限数据时才过滤。其他状态（loading/error/disabled）返回 null → 不过滤
  const permsForFilter = status === 'success' && data ? data : null;

  const canView = (module: string): boolean => {
    if (!permsForFilter) return true;      // 没拿到数据 → 不做判断
    const row = permsForFilter.modules?.[module];
    if (!row) return true;                 // 模块不在矩阵里 → 不拦截
    return !!row.can_view;
  };

  const menuAllowed = (name: string): boolean => {
    const mod = MENU_MODULE[name];
    if (!mod) return true;
    return canView(mod);
  };

  return {
    perms: permsForFilter,
    tenantId,
    roleName: data?.role_name ?? '',
    canView,
    menuAllowed,
  };
}

/**
 * 按权限过滤菜单树。
 *
 * perms=null（loading/error/disabled）时返回完整 items —— 前端不做安全闸，
 * 真正的数据访问由后端 ModulePermission 中间件拦截。
 *
 * perms 存在但模块不在矩阵里 → 默认可见（新模块向后兼容）。
 * perms 存在且模块 can_view=0 → 隐藏。
 */
export function filterMenuItems<T extends { name: string; children?: T[] }>(
  items: T[],
  perms: MyPermissions | null,
): T[] {
  // eslint-disable-next-line no-console
  console.info('[filterMenuItems] perms=', perms, 'items=', items.map((i) => i.name));
  if (!perms) return items;  // 没拿到权限数据 → 显示全量（后端会拦）

  const allowed = (name: string) => {
    const module = MENU_MODULE[name];
    if (!module) return true;
    const row = perms.modules?.[module];
    if (!row) return true;  // 模块未配置 → 可见（向后兼容）
    return !!row.can_view;
  };

  const out: T[] = [];
  for (const item of items) {
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
