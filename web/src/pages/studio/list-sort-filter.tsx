import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTranslation } from 'react-i18next';
import {
  LIST_SORT_OPTIONS,
  ListSortKey,
} from '@/hooks/use-list-sort-and-filter';

/**
 * 排序下拉。选项集合与后端 `sort` 参数一一对应（title / update_time
 * 都在 DAO 的可排序白名单里），所以不会发出服务端不认的列名。
 */
export function ListSortSelect({
  value,
  onChange,
}: {
  value: ListSortKey;
  onChange: (v: ListSortKey) => void;
}) {
  const { t } = useTranslation();

  return (
    <Select value={value} onValueChange={(v) => onChange(v as ListSortKey)}>
      <SelectTrigger className="w-fit" data-testid="list-sort-select">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LIST_SORT_OPTIONS.map((opt) => (
          <SelectItem key={opt.key} value={opt.key}>
            {t(opt.labelKey)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * 发布状态筛选：全部 / 已发布 / 草稿。三个选项互斥，用一个 Select
 * 表达比三个按钮更省横向空间。
 */
export function ReleaseFilterSelect({
  value,
  onChange,
}: {
  value: boolean | undefined;
  onChange: (v: boolean | undefined) => void;
}) {
  const { t } = useTranslation();

  const current = value === undefined ? 'all' : value ? 'published' : 'draft';

  return (
    <Select
      value={current}
      onValueChange={(v) =>
        onChange(v === 'all' ? undefined : v === 'published')
      }
    >
      <SelectTrigger className="w-fit" data-testid="release-filter-select">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{t('studio.statusAll')}</SelectItem>
        <SelectItem value="published">{t('studio.statusPublished')}</SelectItem>
        <SelectItem value="draft">{t('studio.statusDraft')}</SelectItem>
      </SelectContent>
    </Select>
  );
}

/**
 * 「重置筛选」按钮：任一筛选生效时才出现（产品文档 3.4）。
 * 清空搜索词、排序、状态筛选与页码。
 */
export function ResetFilterButton({
  onReset,
  className,
}: {
  onReset: () => void;
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onReset}
      className={className}
      data-testid="list-reset-filter"
    >
      {t('studio.resetFilters')}
    </Button>
  );
}
