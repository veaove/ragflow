import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { StudioType } from './use-studio-type-filter';

export type StudioTypeCounts = {
  all?: number;
  workflow?: number;
  chatflow?: number;
};

/**
 * 工作室类型 Tab。计数只在「已加载过该类型」时出现，避免给用户一个永远
 * 不准的数字；搜索不影响 Tab 计数（它回答的是总量，产品文档 3.3）。
 */
export function StudioTypeTab({
  value,
  onChange,
  counts,
}: {
  value: StudioType;
  onChange: (v: StudioType) => void;
  counts: StudioTypeCounts;
}) {
  const { t } = useTranslation();

  const items: { key: StudioType; label: string; count?: number }[] = [
    { key: 'all', label: t('common.all'), count: counts.all },
    { key: 'workflow', label: t('flow.taskFlow'), count: counts.workflow },
    { key: 'chatflow', label: t('flow.chatflow'), count: counts.chatflow },
  ];

  return (
    <div className="mb-4 flex items-center gap-1 border-b border-border-default">
      {items.map((item) => {
        const active = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onChange(item.key)}
            className={cn(
              'relative -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors',
              active
                ? 'border-accent-primary font-medium text-text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary',
            )}
            data-testid={`studio-tab-${item.key}`}
            aria-current={active ? 'page' : undefined}
          >
            {item.label}
            {typeof item.count === 'number' && (
              <span className="rounded-full bg-bg-card px-1.5 py-0.5 text-[10px] leading-none text-text-secondary">
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
