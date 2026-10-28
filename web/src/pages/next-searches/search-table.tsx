import { useTranslation } from 'react-i18next';
import {
  ListDataTable,
  ListColumn,
  formatListTime,
} from '@/components/list-view/list-data-table';
import {
  formatKnowledgeBaseCell,
  getKnowledgeBaseNames,
} from '@/utils/kb-labels';
import { ISearchAppProps } from './hooks';
import { SearchRowActions } from './search-row-actions';
import { searchStatusLabelKey } from './search-status';

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
      render: (row) => {
        const labelKey = searchStatusLabelKey(row.status);
        return (
          <span className="text-text-secondary">
            {labelKey ? t(labelKey) : '-'}
          </span>
        );
      },
    },
    {
      // 与知识问答列表同口径：最多平铺两个库名，其余收成「等 N 个」，
      // 完整列表放 title。格式化逻辑在 utils/kb-labels，三处列表共用。
      key: 'kb',
      title: t('common.knowledgeBase'),
      className: 'max-w-[240px]',
      render: (row) => {
        const { text, title } = formatKnowledgeBaseCell(
          getKnowledgeBaseNames(row),
        );
        return (
          <span
            className="line-clamp-1 text-text-secondary"
            title={title || undefined}
          >
            {text}
          </span>
        );
      },
    },
    {
      key: 'owner',
      title: t('common.creator'),
      render: (row) => (
        <span className="text-text-secondary">{row.nickname || '-'}</span>
      ),
    },
    {
      key: 'created',
      title: t('common.createTime'),
      render: (row) => (
        <span className="whitespace-nowrap text-text-secondary">
          {formatListTime(row.create_time)}
        </span>
      ),
    },
    {
      key: 'updated',
      title: t('common.updateTime'),
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
        <SearchRowActions
          search={row}
          showSearchRenameModal={showSearchRenameModal}
        />
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
