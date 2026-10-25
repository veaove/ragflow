import { RAGFlowAvatar } from '@/components/ragflow-avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useChangeLanguage } from '@/hooks/logic-hooks';
import { useFetchUserInfo } from '@/hooks/use-user-setting-request';
import { cn } from '@/lib/utils';
import { headerLanguages } from '@/locales/config';
import { Routes } from '@/routes';
import { BellButton } from './bell-button';
import { MobileMenuFooter } from './mobile-menu-footer';
import { MobileNavbar } from './mobile-nav-drawer';
import ThemeButton from './theme-button';
import { LucideLanguages } from 'lucide-react';
import React from 'react';
import { useNavigate } from 'react-router';

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
  const navigate = useNavigate();

  const {
    data: { language = 'en', avatar, nickname },
  } = useFetchUserInfo();


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

        <BellButton className="!size-9" />

        <ThemeButton className="!size-9" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="relative ms-1 flex size-9 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/40"
              data-testid="avatar-menu-trigger"
              aria-label="account menu"
            >
              <RAGFlowAvatar
                name={nickname}
                avatar={avatar}
                isPerson
                className="size-8"
              />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <div className="flex items-center gap-2.5 px-2 py-2">
              <RAGFlowAvatar
                name={nickname}
                avatar={avatar}
                isPerson
                className="size-8"
              />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-text-primary">
                  {nickname || '-'}
                </div>
              </div>
            </div>
            <DropdownMenuItem
              className="cursor-pointer"
              onSelect={() => navigate(`${Routes.UserSetting}/profile`)}
              data-testid="menu-profile"
            >
              个人中心
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer"
              onSelect={() => navigate(Routes.UserSetting)}
              data-testid="menu-config"
            >
              配置中心
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer text-state-error"
              onSelect={() => navigate(Routes.Logout)}
              data-testid="menu-logout"
            >
              退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
