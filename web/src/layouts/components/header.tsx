import { RAGFlowAvatar } from '@/components/ragflow-avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useChangeLanguage } from '@/hooks/logic-hooks';
import {
  useFetchUserInfo,
  useListTenant,
} from '@/hooks/use-user-setting-request';
import { cn } from '@/lib/utils';
import { headerLanguages } from '@/locales/config';
import { TenantRole } from '@/pages/user-setting/constants';
import { Routes } from '@/routes';
import { BellButton } from './bell-button';
import { MobileMenuFooter } from './mobile-menu-footer';
import { MobileNavbar } from './mobile-nav-drawer';
import ThemeButton from './theme-button';
import { LucideLanguages } from 'lucide-react';
import React, { useMemo } from 'react';
import { Link } from 'react-router';

/**
 * 顶栏。左右两端分别是品牌入口与账号/偏好操作。
 *
 * 移动端额外渲染汉堡按钮打开抽屉导航；lg 以上导航已迁至左侧固定栏
 * （见 AppSidebar），此处的汉堡自动隐藏。
 *
 * 历史背景：导航从顶栏胶囊迁移到左侧固定栏时，曾把本组件拆成「移动端专用」
 * 并把语言/主题/头像塞进侧栏底部。那两个位置不符合常规后台的使用习惯，
 * 现统一回到顶栏右侧。
 */
export function Header({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  const changeLanguage = useChangeLanguage();

  const {
    data: { language = 'en', avatar, nickname },
  } = useFetchUserInfo();

  const { data: tenantData } = useListTenant();
  const hasNotification = useMemo(
    () => tenantData?.some((x) => x.role === TenantRole.Invite),
    [tenantData],
  );

  // Falls back to the first offered language so a stored preference outside
  // the switcher's subset still shows a valid label instead of a blank button.
  const currentLanguage =
    headerLanguages.find((x) => x.code === language) ?? headerLanguages[0];

  return (
    <header
      key="app-navbar"
      className={cn(
        'flex w-full min-w-0 items-center gap-2 sm:gap-4',
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 items-center gap-2">
        {/* 窄屏才需要汉堡：宽屏导航在左侧固定栏 */}
        <div className="lg:hidden">
          <MobileNavbar
            renderFooter={(close) => <MobileMenuFooter onClose={close} />}
          />
        </div>
      </div>

      <div className="flex-1" aria-hidden />

      <div
        className="flex shrink-0 items-center justify-end gap-0.5 text-text-badge sm:gap-1"
        data-testid="auth-status"
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className={cn(
                'size-9 shrink-0 px-0',
                'lg:size-auto lg:gap-1 lg:px-3',
              )}
              aria-label={currentLanguage?.displayName}
            >
              <LucideLanguages className="size-5" />
              {/* 宽屏显示语言名，窄屏只留图标节省空间 */}
              <span className="hidden text-sm lg:inline">
                {currentLanguage?.displayName}
              </span>
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end">
            {headerLanguages.map((x) => (
              <DropdownMenuItem
                key={x.code}
                onClick={() => changeLanguage(x.code)}
              >
                {x.displayName}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {hasNotification && <BellButton className="!size-9" />}

        <ThemeButton className="!size-9" />

        <Link
          to={Routes.UserSetting}
          className="relative flex size-9 shrink-0 items-center justify-center ms-1"
          data-testid="settings-entrypoint"
        >
          <RAGFlowAvatar
            name={nickname}
            avatar={avatar}
            isPerson
            className="size-8"
          />
        </Link>
      </div>
    </header>
  );
}
