import { useContext, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useNavigate } from 'react-router';

import { useMutation, useQuery } from '@tanstack/react-query';

import {
  LucideBoxes,
  LucideBuilding2,
  LucideLanguages,
  LucideLayoutDashboard,
  LucideMonitor,
  LucideScrollText,
  LucideServerCrash,
  LucideShieldCheck,
  LucideSquareUserRound,
  LucideUserCog,
  LucideUserStar,
  LucideZap,
} from 'lucide-react';

import { RAGFlowAvatar } from '@/components/ragflow-avatar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import ThemeButton from '@/layouts/components/theme-button';
import { cn } from '@/lib/utils';
import { changeLanguageAsync, headerLanguages } from '@/locales/config';
import { Routes } from '@/routes';
import { getSystemVersion, logout } from '@/services/admin-service';

import authorizationUtil from '@/utils/authorization-util';

import { IS_ENTERPRISE } from '../utils';
import { CurrentUserInfoContext } from './root-layout';

/**
 * 管理后台外壳：左侧固定导航 + 顶栏 + 内容区，与租户端 `RootLayout` 同构。
 *
 * 与租户端的差异（有意为之，用于区分「平台管理」与「租户工作台」）：
 * 1. 侧栏用登录页同一套石墨蓝底（#12233F）+ 浅色文字，站内是浅色 `bg-bg-base`；
 * 2. 侧栏底部保留运行时版本号（平台运维排查需要，租户端不需要）；
 * 3. 头像菜单里的「个人中心」只做只读账号信息（管理端没有可编辑的个人资料）。
 *
 * 主题、语言、账号三个操作统一放顶栏右侧——这是租户端已经收敛的规范，
 * 原实现把主题开关和退出按钮塞在侧栏底部，与站内习惯不一致。
 *
 * 窄屏（< lg）侧栏收成 64px 图标栏而不是抽屉：管理端页面以宽表格为主，
 * 抽屉会盖住内容，图标栏则始终可点，且省掉一套移动端菜单状态。
 */
const AdminNavigationLayout = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [currentUserInfo, setCurrentUserInfo] = useContext(
    CurrentUserInfoContext,
  );
  const [profileOpen, setProfileOpen] = useState(false);

  const { data: version } = useQuery({
    queryKey: ['admin/version'],
    queryFn: async () => (await getSystemVersion())?.data?.data?.version,
  });

  const navItems = useMemo(
    () => [
      {
        path: Routes.AdminOverview,
        name: t('admin.overview.title'),
        icon: <LucideLayoutDashboard className="size-[1em]" />,
      },
      {
        path: Routes.AdminServices,
        name: t('admin.serviceStatus'),
        icon: <LucideServerCrash className="size-[1em]" />,
      },
      {
        path: Routes.AdminUserManagement,
        name: t('admin.userManagement'),
        icon: <LucideUserCog className="size-[1em]" />,
      },
      {
        path: Routes.AdminTenants,
        name: t('admin.tenantManagement'),
        icon: <LucideBuilding2 className="size-[1em]" />,
      },
      {
        path: Routes.AdminModels,
        name: t('admin.modelManagement'),
        icon: <LucideBoxes className="size-[1em]" />,
      },
      {
        path: Routes.AdminAudits,
        name: t('admin.platformAudit'),
        icon: <LucideScrollText className="size-[1em]" />,
      },
      {
        path: Routes.AdminSecurity,
        name: t('admin.securitySettings'),
        icon: <LucideShieldCheck className="size-[1em]" />,
      },
      {
        path: Routes.AdminSandboxSettings,
        name: t('admin.sandboxSettings'),
        icon: <LucideZap className="size-[1em]" />,
      },
      ...(IS_ENTERPRISE
        ? [
            {
              path: Routes.AdminWhitelist,
              name: t('admin.registrationWhitelist'),
              icon: <LucideUserStar className="size-[1em]" />,
            },
            {
              path: Routes.AdminRoles,
              name: t('admin.roles'),
              icon: <LucideSquareUserRound className="size-[1em]" />,
            },
            {
              path: Routes.AdminMonitoring,
              name: t('admin.monitoring'),
              icon: <LucideMonitor className="size-[1em]" />,
            },
          ]
        : []),
    ],
    [t],
  );

  /**
   * 账号展示信息。三种来源（服务端登录态 / localStorage 持久化 / 空）字段不同，
   * 统一按 Record 取值，避免在这里铺一层类型收窄。
   */
  const account = useMemo(() => {
    const info = (currentUserInfo.userInfo ?? {}) as Record<string, unknown>;
    const readString = (key: string) => {
      const value = info[key];
      return typeof value === 'string' ? value : '';
    };

    const email = readString('email');

    return {
      email,
      nickname: readString('nickname') || readString('name') || email,
      avatar: readString('avatar') || undefined,
      lastLoginTime: readString('last_login_time'),
      createDate: readString('create_date'),
      isSuperuser: info.is_superuser === true,
    };
  }, [currentUserInfo]);

  // 取不到语言时回落到列表首项，避免按钮显示空白。
  const currentLanguage =
    headerLanguages.find((x) => x.code === i18n.language) ?? headerLanguages[0];

  const logoutMutation = useMutation({
    mutationKey: ['adminLogout'],
    mutationFn: async () => {
      await logout();
      authorizationUtil.removeAll();
      navigate(Routes.Admin);
      setCurrentUserInfo({
        userInfo: null,
        source: null,
      });
    },
    retry: false,
  });

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <aside className="flex w-16 shrink-0 flex-col border-r border-white/10 bg-[#12233F] lg:w-60">
        {/* 品牌区：窄屏只留 logo */}
        <div className="flex shrink-0 items-center gap-3 px-3 py-4 lg:px-5">
          <img className="size-9 shrink-0" src="/logo.svg" alt="logo" />
          <span className="hidden truncate text-[17px] font-bold text-white lg:inline">
            {t('admin.navBrand')}
          </span>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-2 lg:px-3">
          <ul className="space-y-1">
            {navItems.map((it) => (
              <li key={it.path}>
                <NavLink
                  to={it.path}
                  title={it.name}
                  className={({ isActive }) =>
                    cn(
                      'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px]',
                      'transition-colors outline-none',
                      'focus-visible:ring-2 focus-visible:ring-white/40',
                      isActive
                        ? 'bg-white/10 font-medium text-white'
                        : 'text-white/60 hover:bg-white/5 hover:text-white',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {/* 选中态色条：与租户端侧栏同一视觉语言，深底上用亮蓝保证可见 */}
                      <span
                        aria-hidden
                        className={cn(
                          'absolute top-1/2 left-0 h-5 w-0.5 -translate-y-1/2 rounded-full bg-[#5B9BF3] transition-opacity',
                          isActive ? 'opacity-100' : 'opacity-0',
                        )}
                      />
                      <span className="flex size-5 shrink-0 items-center justify-center">
                        {it.icon}
                      </span>
                      <span className="hidden truncate lg:inline">
                        {it.name}
                      </span>
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        {/* 左下角不放任何东西：主题/语言/账号在顶栏右侧，版本号在「个人中心」里 */}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b border-border-button bg-bg-base px-3 py-3 sm:px-5">
          <span className="truncate text-base font-bold text-text-primary lg:hidden">
            {t('admin.navBrand')}
          </span>

          <div className="flex-1" aria-hidden />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="size-9 shrink-0 gap-1 px-0 lg:size-auto lg:px-3"
                aria-label={currentLanguage?.displayName}
                data-testid="admin-language-trigger"
              >
                <LucideLanguages className="size-5" />
                <span className="hidden text-sm lg:inline">
                  {currentLanguage?.displayName}
                </span>
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end">
              {headerLanguages.map((x) => (
                <DropdownMenuItem
                  key={x.code}
                  // 管理端不写库：admin token 调不了租户的 setting 接口，
                  // changeLanguageAsync 自己会把选择落到 localStorage。
                  onClick={() => changeLanguageAsync(x.code)}
                  data-testid={`admin-language-${x.code}`}
                >
                  {x.displayName}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <ThemeButton className="!size-9" />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="ms-1 flex size-9 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/40"
                data-testid="admin-avatar-menu-trigger"
                aria-label={t('admin.profile')}
              >
                <RAGFlowAvatar
                  name={account.nickname}
                  avatar={account.avatar}
                  isPerson
                  className="size-8"
                />
              </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-56">
              <div className="flex items-center gap-2.5 px-2 py-2">
                <RAGFlowAvatar
                  name={account.nickname}
                  avatar={account.avatar}
                  isPerson
                  className="size-8"
                />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-text-primary">
                    {account.nickname || '-'}
                  </div>
                  <div className="truncate text-xs text-text-secondary">
                    {account.email || '-'}
                  </div>
                </div>
              </div>

              <DropdownMenuSeparator />

              <DropdownMenuItem
                className="cursor-pointer"
                onSelect={() => setProfileOpen(true)}
                data-testid="admin-menu-profile"
              >
                {t('admin.profile')}
              </DropdownMenuItem>

              <DropdownMenuItem
                className="cursor-pointer text-state-error"
                onSelect={() => logoutMutation.mutate()}
                data-testid="admin-menu-logout"
              >
                {t('admin.logout')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="size-full min-w-0 overflow-hidden">
          <Outlet />
        </main>
      </div>

      {/* 个人中心：管理端没有可编辑的资料，这里只做账号信息只读展示 */}
      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('admin.profile')}</DialogTitle>
            <DialogDescription className="sr-only">
              {t('admin.profile')}
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-3">
            <RAGFlowAvatar
              name={account.nickname}
              avatar={account.avatar}
              isPerson
              className="size-12"
            />
            <div className="min-w-0">
              <div className="truncate text-base font-medium text-text-primary">
                {account.nickname || '-'}
              </div>
              <div className="truncate text-sm text-text-secondary">
                {account.email || '-'}
              </div>
            </div>
          </div>

          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
            <dt className="text-text-secondary">{t('admin.role')}</dt>
            <dd className="text-text-primary">
              {account.isSuperuser
                ? t('admin.superuser')
                : t('admin.normalUser')}
            </dd>

            <dt className="text-text-secondary">{t('admin.lastLoginTime')}</dt>
            <dd className="text-text-primary">
              {account.lastLoginTime || '-'}
            </dd>

            <dt className="text-text-secondary">{t('admin.createDate')}</dt>
            <dd className="text-text-primary">{account.createDate || '-'}</dd>

            <dt className="text-text-secondary">{t('admin.version')}</dt>
            <dd className="truncate text-text-primary" title={version}>
              {version || '-'}
            </dd>
          </dl>

          <DialogFooter>
            <Button
              variant="outline"
              className="h-10 px-4"
              onClick={() => setProfileOpen(false)}
            >
              {t('admin.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminNavigationLayout;
