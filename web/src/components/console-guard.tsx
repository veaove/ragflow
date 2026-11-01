import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { useConsolePermissions } from '@/hooks/use-console-permissions';
import { sidebarMenuItems } from '@/layouts/components/sidebar-nav';
import { modulesForPath } from '@/layouts/permission-redirect';

/**
 * 页面级权限闸。
 *
 * 侧边栏已经按 `can_view` 隐藏了入口，根布局也会把无权限的路径弹走 —— 这一层
 * 兜住页面自身需要独立判定模块的场景，并保证与菜单用**同一个**模块来源。
 *
 * 模块名由 pathname 反查菜单得到，不再由调用方手写：手写曾让组织架构页按
 * 「用户管理」判定、资源授权页按「角色管理」判定，于是只授了本页权限的角色
 * 菜单能进、页面里却显示「无访问权限」。
 *
 * `perms` 未加载时放行，与菜单过滤保持一致：接口抖动不该让页面变成 403，
 * 无权限的路径本来就由根布局挡住。
 */
export function ConsoleGuard({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { isOwner, perms, canView } = useConsolePermissions();

  const modules = modulesForPath(pathname, sidebarMenuItems);

  if (isOwner || !perms || modules.length === 0) {
    return <>{children}</>;
  }

  if (!modules.some(canView)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium text-text-primary">
          {t('console.noPermission', '无访问权限')}
        </h2>
        <p className="text-sm text-text-secondary">
          当前角色未被授予该功能的查看权限，请联系租户管理员在「角色权限」中调整。
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
