import { useTranslation } from 'react-i18next';
import { MoreButton } from '@/components/more-button';
import {
  ListDataTable,
  ListColumn,
  formatListTime,
} from '@/components/list-view/list-data-table';
import { ISearchAppProps } from './hooks';
import { SearchDropdown } from './search-dropdown';

/**
 * 知识搜索（Search）表格视图。
 *
 * 列：名称 · 描述 · 状态 · 创建者 · 创建时间 · 更新时间 · 操作
 *
 * 搜索应用的字段本来就少，所以把「创建者」也放上来——多人协作时，
 * 「这个搜索是谁建的」比「什么时候建的」更能帮到使用者。
 */
export function SearchTable({
  rows,
  onOpen,
  showSearchRenameModal,
}: {
  rows: ISearchAppProps[];
  onOpen: (id: string) => void;
  showSearchRenameModal: (data: ISearchAppProps) => void;
}) {
  const { t } = useTranslation();

  const columns: ListColumn<ISearchAppProps>[] = [
    {
      key: 'name',
      title: t('common.name'),
      render: (row) => (
        <button
          type="button"
          className="text-left font-medium text-text-primary hover:text-accent-primary"
          onClick={() => onOpen(row.id)}
        >
          {row.name || '-'}
        </button>
      ),
    },
    {
      key: 'description',
      title: t('common.description'),
      className: 'max-w-[280px]',
      render: (row) => (
        <span
          className="line-clamp-1 text-text-secondary"
          title={row.description || undefined}
        >
          {row.description || '-'}
        </span>
      ),
    },
    {
      key: 'status',
      title: t('common.status'),
      render: (row) => (
        <span className="text-text-secondary">{row.status || '-'}</span>
      ),
    },
    {
      key: 'owner',
      title: '创建者',
      render: (row) => (
        <span className="text-text-secondary">{row.nickname || '-'}</span>
      ),
    },
    {
      key: 'created',
      title: '创建时间',
      render: (row) => (
        <span className="whitespace-nowrap text-text-secondary">
          {formatListTime(row.create_time)}
        </span>
      ),
    },
    {
      key: 'updated',
      title: '更新时间',
      render: (row) => (
        <span className="whitespace-nowrap text-text-secondary">
          {formatListTime(row.update_time)}
        </span>
      ),
    },
    {
      key: 'action',
      title: t('common.action'),
      align: 'right',
      render: (row) => (
        <div className="flex justify-end">
          <SearchDropdown
            dataset={row}
            showSearchRenameModal={showSearchRenameModal}
          >
            <MoreButton />
          </SearchDropdown>
        </div>
      ),
    },
  ];

  return (
    <ListDataTable
      columns={columns}
      rows={rows}
      tableTestId="searches-table"
      rowTestId="searches-table-row"
    />
  );
}
