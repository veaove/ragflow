import { useQuery } from '@tanstack/react-query';

import userService from '@/services/user-service';
import { MyPermissions, fetchMyPermissions } from '@/services/console-service';

/**
 * 菜单项 → 权限模块。
 *
 * 这是「菜单能不能显示」与「页面能不能进」的唯一事实来源：
 * 侧边栏过滤、路由重定向、页面守卫（ConsoleGuard）都必须从这里取模块名，
 * 不要再让调用方手写模块字符串 —— 手写就会写错（组织架构曾被写成 member）。
 */
export const MENU_MODULE: Record<string, string | string[]> = {
  'header.home': 'overview',
  'header.dataset': 'dataset',
  'header.chat': 'chat',
  'header.knowledgeSearch': 'search',
  'header.flow': 'agent',
  'header.memoryCenter': 'memory',
  // 会话质检是聚合页：规则 / 实时 / 命中 / 配置是四个独立模块，
  // 只授其中任何一个都应该能进这个菜单（否则授了权却没有入口）。
  'header.qc': ['qc_rule', 'qc_realtime', 'qc_hit', 'qc_config'],
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

/** 菜单项对应的模块集合（单模块也统一成数组，调用方只处理一种形态）。 */
export function moduleListFor(menuName: string): string[] {
  const value = MENU_MODULE[menuName];
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

/** 矩阵里的写动作；查看单独用 `canView`。 */
export type PermissionAction = 'create' | 'edit' | 'delete' | 'manage';

/**
 * 矩阵动作判定（纯函数）：没有权限数据、或矩阵里没有该模块的行，都按「无权限」
 * 处理。注意后端中间件对缺失行是默认放行（避免老租户被锁死），前端这里更严格 ——
 * 界面上宁可不给按钮，也不要在点了之后弹 403。
 */
export function canAction(
  perms: MyPermissions | null,
  module: string,
  action: PermissionAction,
): boolean {
  if (!perms) return false;
  const row = perms.modules?.[module];
  if (!row) return false;
  return !!row[`can_${action}` as keyof typeof row];
}

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
      can: () => true,
    };
  }

  // 非 owner：必须等权限接口返回
  const permsForFilter = status === 'success' && perms ? perms : null;
  const canView = (module: string): boolean => {
    if (!permsForFilter) return false; // 没拿到数据 → 不显示
    const row = permsForFilter.modules?.[module];
    if (!row) return false; // 模块不在矩阵 → 没权限
    return !!row.can_view;
  };
  /**
   * 写动作判定，用于按钮显隐。与后端 `ModulePermission` 同源同一份矩阵：
   * 前端隐藏只是避免「点了才报 403」，真正的闸在后端。
   */
  const can = (module: string, action: PermissionAction): boolean =>
    canAction(permsForFilter, module, action);
  return {
    perms: permsForFilter,
    tenantId,
    roleName: perms?.role_name ?? '',
    isOwner: false,
    canView,
    can,
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
    const modules = moduleListFor(name);
    if (!modules.length) return false;
    return modules.some((module) => !!perms.modules?.[module]?.can_view);
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
