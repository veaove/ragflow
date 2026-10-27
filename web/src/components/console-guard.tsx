import { useTranslation } from 'react-i18next';

import { useConsolePermissions } from '@/hooks/use-console-permissions';

/**
 * 控制台页面的权限闸。
 *
 * 侧边栏已经按 `can_view` 隐藏了入口，但直接敲 URL 仍能进入 —— 这一层补上。
 * `perms` 未加载时放行，与菜单过滤保持一致：接口抖动不该让页面变成 403。
 */
export function ConsoleGuard({
  module,
  children,
}: {
  module: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { isOwner, canView } = useConsolePermissions();

  if (!isOwner && !canView(module)) {
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
