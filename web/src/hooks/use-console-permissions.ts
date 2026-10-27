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
  const isOwner = tenantInfo?.role === 'owner';

  // eslint-disable-next-line no-console
  console.info('[perms] tenantInfo=', JSON.stringify(tenantInfo), '→ tenantId=', tenantId, 'role=', tenantInfo?.role, 'isOwner=', isOwner);

  const { data, status } = useQuery({
    queryKey: ['console/my-permissions', tenantId],
    enabled: !!tenantId && !isOwner,  // owner 不需要查权限接口
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetchMyPermissions(tenantId as string);
      // eslint-disable-next-line no-console
      console.info('[perms] fetchMyPermissions raw=', JSON.stringify(res));
      return res?.data ?? null;
    },
  });

  // eslint-disable-next-line no-console
  console.info('[perms] query status=', status, 'enabled=', !!tenantId && !isOwner, 'data=', JSON.stringify(data));

  // owner → 直接全显示
  if (isOwner) {
    return {
      perms: null as MyPermissions | null,
      tenantId,
      roleName: '',
      isOwner: true,
      canView: () => true,
      menuAllowed: () => true,
    };
  }

  // 非 owner：必须等权限接口返回
  const permsForFilter = status === 'success' && data ? data : null;
  const canView = (module: string): boolean => {
    if (!permsForFilter) return false;     // 没拿到数据 → 不显示
    const row = permsForFilter.modules?.[module];
    if (!row) return false;               // 模块不在矩阵 → 没权限
    return !!row.can_view;
  };
  const menuAllowed = (name: string): boolean => {
    const mod = MENU_MODULE[name];
    if (!mod) return false;
    return canView(mod);
  };

  return {
    perms: permsForFilter,
    tenantId,
    roleName: data?.role_name ?? '',
    isOwner: false,
    canView,
    menuAllowed,
  };
}

/**
 * 按权限过滤菜单树。
 *
 * owner 调用方直接传 null perms + isOwner=true → 返回全量。
 * 非 owner 调用方必须拿到权限数据，否则返回空数组。
 */
export function filterMenuItems<T extends { name: string; children?: T[] }>(
  items: T[],
  perms: MyPermissions | null,
  options?: { isOwner?: boolean },
): T[] {
  const isOwner = options?.isOwner ?? false;
  // eslint-disable-next-line no-console
  console.info('[filterMenuItems] perms=', !!perms, 'isOwner=', isOwner, 'items=', items.length);
  if (isOwner) { console.info('[filterMenuItems] OWNER → full items'); return items; }
  if (!perms) { console.info('[filterMenuItems] NO PERMS → empty'); return []; }

  const allowed = (name: string): boolean => {
    const module = MENU_MODULE[name];
    if (!module) { console.info('[filterMenuItems] HIDE (no mapping):', name); return false; }
    const row = perms.modules?.[module];
    if (!row) { console.info('[filterMenuItems] HIDE (no perm row):', name, 'module=', module); return false; }
    const result = !!row.can_view;
    console.info('[filterMenuItems]', result ? 'SHOW' : 'HIDE', 'item=', name, 'module=', module, 'can_view=', row.can_view);
    return result;
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
