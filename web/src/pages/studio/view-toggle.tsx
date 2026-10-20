import { LayoutGrid, Table2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Segmented } from '@/components/ui/segmented';
import { ListViewMode } from '@/hooks/use-list-view-preference';

/**
 * 卡片 / 表格视图分段开关。偏好由 useListViewPreference 持久化，
 * 两个列表页共用（产品文档 3.2）。
 */
export function ViewToggle({
  mode,
  onChange,
}: {
  mode: ListViewMode;
  onChange: (m: ListViewMode) => void;
}) {
  const { t } = useTranslation();

  const options = [
    {
      value: 'card' as ListViewMode,
      label: (
        <span className="flex items-center gap-1" title={t('studio.viewCard')}>
          <LayoutGrid className="size-3.5" />
          {t('studio.viewCard')}
        </span>
      ),
    },
    {
      value: 'table' as ListViewMode,
      label: (
        <span className="flex items-center gap-1" title={t('studio.viewTable')}>
          <Table2 className="size-3.5" />
          {t('studio.viewTable')}
        </span>
      ),
    },
  ];

  return (
    <Segmented
      sizeType="sm"
      value={mode}
      options={options}
      onChange={(v) => onChange(v as ListViewMode)}
      data-testid="list-view-toggle"
    />
  );
}
