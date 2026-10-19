import { useTranslation } from 'react-i18next';

function FooterLink({
  children,
  onClick,
  href,
  target,
  rel,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  href: string;
  target?: string;
  rel?: string;
}) {
  return (
    <a
      href={href}
      target={target}
      rel={rel}
      onClick={onClick}
      className="text-text-secondary transition-colors hover:text-text-primary"
    >
      {children}
    </a>
  );
}

type MobileMenuFooterProps = {
  onClose: () => void;
};

// 移动端菜单底部入口。现仅保留帮助中心：GitHub 与 Discord 社区入口
// 已按产品要求从导航中移除，去留只维护这一处。
export function MobileMenuFooter({ onClose }: MobileMenuFooterProps) {
  const { t } = useTranslation();

  return (
    <div className="shrink-0 border-t border-border-button px-4 py-4">
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm">
        <FooterLink
          href="https://ragflow.io/docs/dev/category/user-guides"
          target="_blank"
          rel="noreferrer noopener"
          onClick={onClose}
        >
          {t('header.help')}
        </FooterLink>
      </div>
    </div>
  );
}
