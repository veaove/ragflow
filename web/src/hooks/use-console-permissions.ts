import { useQuery } from '@tanstack/react-query';

import userService from '@/services/user-service';
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

export function useConsolePermissions() {
  // 自己拿 tenantInfo，不依赖 external hook
  const { data: tenantInfo } = useQuery({
    queryKey: ['console/tenant-info'],
    queryFn: async () => {
      const { data: axiosRes } = await userService.getTenantInfo();
      // 4xx（含超管的 403）时拿到的是原始 response，没有业务信封；
      // 不判空会抛 TypeError，让下面的权限查询永远停在 pending，
      // PermissionGate 就一直显示「加载权限…」。
      return (axiosRes?.code === 0 ? axiosRes.data : {}) as {
        tenant_id?: string;
        role?: string;
      };
    },
    staleTime: 60_000,
  });

  const tenantId = tenantInfo?.tenant_id as string | undefined;
  const isOwner = tenantInfo?.role === 'owner';

  const { data: perms, status } = useQuery({
    queryKey: ['console/my-permissions', tenantId],
    enabled: !!tenantId && !isOwner,
    staleTime: 60_000,
    queryFn: async () => {
      // request 库返回三层: { data: { code, data, message }, response }
      const { data: envelope } = await fetchMyPermissions(tenantId as string);
      // envelope = { code:0, data: MyPermissions, message:"success" }
      return envelope?.data ?? null;
    },
  });

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
  const permsForFilter = status === 'success' && perms ? perms : null;
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
    roleName: perms?.role_name ?? '',
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
  if (isOwner) return items;
  if (!perms) return [];

  const allowed = (name: string): boolean => {
    const module = MENU_MODULE[name];
    if (!module) return false;
    const row = perms.modules?.[module];
    if (!row) return false;
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
