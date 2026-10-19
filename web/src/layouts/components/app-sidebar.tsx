import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { Routes } from '@/routes';
import { SidebarNav } from './sidebar-nav';

/**
 * 桌面端左侧固定导航栏。
 *
 * 固定（而非 sticky）是有意为之：内容区 `PageContainer` 自己持有滚动容器，
 * 侧栏作为它的兄弟节点本就不随内容滚动。若再叠加 sticky 会引入一层无意义的
 * 定位上下文，在 flex/grid 布局下反而可能造成抖动。
 *
 * 只负责品牌标识与主导航。语言、主题、通知、账号等全局操作统一放在顶栏右侧
 * （见 Header），不在侧栏底部重复一套入口。
 */
export function AppSidebar({ className }: { className?: string }) {
  const { t } = useTranslation();

  return (
    <aside
      className={cn(
        // h-screen + shrink-0：脱离内容滚动，始终贴左侧竖直铺满
        'flex h-screen w-64 shrink-0 flex-col',
        // 深色侧边栏：配色走 tailwind.css 的 --sidebar-* 专用 token，
        // 不随全局明暗主题翻转（内容区仍是浅色，形成双区对比）
        'bg-[var(--rail-bg)] text-[var(--rail-text)]',
        'border-r border-[var(--rail-border)]',
        className,
      )}
    >
      {/* 品牌区 */}
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--rail-border)] px-5 py-4">
        <Link
          to={Routes.Root}
          className="flex size-9 shrink-0 items-center justify-center"
          aria-label={t('header.home')}
        >
          {/* 深色底上改用反白 logo，避免彩色 logo 在深底上发闷 */}
          <img
            src="/logo-white.svg"
            alt="和君纵达 logo"
            className="size-9"
            onError={(e) => {
              // 反白版缺失时回退到彩色版，保证不会出现裂图
              e.currentTarget.src = '/logo.svg';
            }}
          />
        </Link>
        <span className="truncate text-[17px] font-semibold text-[var(--rail-text)]">
          {t('login.brandName')}
        </span>
      </div>

      {/* 主导航：占满剩余高度并自身滚动，条目过多时不会顶破侧栏 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3">
        <SidebarNav />
      </div>
    </aside>
  );
}
