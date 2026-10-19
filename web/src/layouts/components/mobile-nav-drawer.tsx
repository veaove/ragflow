import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { LucideMenu } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { sidebarMenuItems, useActivePath } from './sidebar-nav';

/**
 * 移动端抽屉导航。lg 以上导航已移至左侧固定栏，本组件仅供窄屏使用。
 */
function MobileNavItem({
  label,
  icon: Icon,
  icon_name,
  isActive,
  onClick,
  ...linkProps
}: {
  label: string;
  icon: React.ComponentType<{ className?: string; name?: string }>;
  icon_name?: string;
  isActive?: boolean;
  onClick?: () => void;
  to: string;
}) {
  return (
    <Link
      {...linkProps}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3.5 px-4 py-3.5 text-base',
        'text-text-secondary transition-colors hover:bg-bg-card hover:text-text-primary',
        'focus-visible:bg-bg-card focus-visible:text-text-primary',
        isActive &&
          'border-l-2 border-text-primary bg-bg-card font-medium text-text-primary',
      )}
      aria-current={isActive ? 'page' : undefined}
    >
      <Icon className="size-5 shrink-0 stroke-[1.5]" name={icon_name} />
      <span className="truncate">{label}</span>
    </Link>
  );
}

type MobileNavbarProps = {
  renderFooter?: (close: () => void) => React.ReactNode;
};

export function MobileNavbar({ renderFooter }: MobileNavbarProps) {
  const { t } = useTranslation();
  const activePath = useActivePath();
  const [open, setOpen] = useState(false);

  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-9 shrink-0"
          aria-label="Menu"
        >
          <LucideMenu className="size-6 stroke-[1.75]" />
        </Button>
      </SheetTrigger>

      <SheetContent
        side="left"
        closeIcon={false}
        className="flex w-[min(85vw,18rem)] flex-col gap-0 p-0 sm:w-72"
      >
        <div className="flex shrink-0 justify-center py-5">
          <img src="/logo.svg" alt="和君纵达 logo" className="size-9" />
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto py-3">
          <ul className="space-y-1">
            {sidebarMenuItems.map(({ path, name, icon_name, icon }) => (
              <li key={path}>
                <MobileNavItem
                  to={path}
                  label={t(name)}
                  icon={icon}
                  icon_name={icon_name}
                  isActive={path === activePath}
                  onClick={close}
                />
              </li>
            ))}
          </ul>
        </nav>

        {renderFooter?.(close)}
      </SheetContent>
    </Sheet>
  );
}