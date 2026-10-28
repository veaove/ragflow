import {
  formatListTime,
  ListColumn,
  ListDataTable,
} from '@/components/list-view/list-data-table';
import { useNavigatePage } from '@/hooks/logic-hooks/navigate-hooks';
import { useTranslation } from 'react-i18next';
import { IMemory } from './interface';
import { memoryTypeLabelKey, storageTypeLabelKey } from './memory-labels';
import { MemoryRowActions } from './memory-row-actions';

/**
 * 记忆列表的表格视图。
 *
 * 列：名称 · 描述 · 记忆类型 · 存储类型 · Embedding 模型 · 大语言模型 ·
 *     创建者 · 创建时间 · 操作
 *
 * 这些列都来自 `GET /memories` 的列表响应体，不为表格单独加接口：卡片只
 * 显示名称和描述，表格的价值就是把「用什么模型、谁建的、什么时候建的」
 * 一次摊开，避免逐个点进去确认。
 */
export function MemoryTable({
  rows,
  showMemoryRenameModal,
}: {
  rows: IMemory[];
  showMemoryRenameModal: (memory: IMemory) => void;
}) {
  const { t } = useTranslation();
  const { navigateToMemory } = useNavigatePage();

  const columns: ListColumn<IMemory>[] = [
    {
      key: 'name',
      title: t('memories.name'),
      render: (row) => (
        <button
          type="button"
          className="text-left font-medium text-text-primary hover:text-accent-primary hover:underline"
          onClick={navigateToMemory(row.id)}
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
      key: 'memoryType',
      title: t('memories.memoryType'),
      render: (row) => {
        // memory_type 是位标记解出来的数组，可能同时是「原始 + 语义」。
        const labelKeys = (row.memory_type ?? [])
          .map((item) => memoryTypeLabelKey(item))
          .filter((key): key is string => Boolean(key));
        if (labelKeys.length === 0) {
          return <span className="text-text-secondary">-</span>;
        }
        return (
          <span className="flex flex-wrap gap-1">
            {labelKeys.map((key) => (
              <span
                key={key}
                className="rounded bg-bg-card px-1.5 py-0.5 text-xs text-text-secondary"
              >
                {t(key)}
              </span>
            ))}
          </span>
        );
      },
    },
    {
      key: 'storageType',
      title: t('memories.storageType'),
      render: (row) => {
        const labelKey = storageTypeLabelKey(row.storage_type);
        return (
          <span className="whitespace-nowrap text-text-secondary">
            {labelKey ? t(labelKey) : '-'}
          </span>
        );
      },
    },
    {
      key: 'embdId',
      title: t('memories.embeddingModel'),
      className: 'max-w-[200px]',
      render: (row) => (
        <span
          className="line-clamp-1 text-text-secondary"
          title={row.embd_id || undefined}
        >
          {row.embd_id || '-'}
        </span>
      ),
    },
    {
      key: 'llmId',
      title: t('memories.llm'),
      className: 'max-w-[200px]',
      render: (row) => (
        <span
          className="line-clamp-1 text-text-secondary"
          title={row.llm_id || undefined}
        >
          {row.llm_id || '-'}
        </span>
      ),
    },
    {
      key: 'owner',
      title: t('common.creator'),
      render: (row) => (
        <span className="whitespace-nowrap text-text-secondary">
          {row.owner_name || '-'}
        </span>
      ),
    },
    {
      key: 'createTime',
      title: t('common.createTime'),
      render: (row) => (
        <span className="whitespace-nowrap text-text-secondary">
          {formatListTime(row.create_time)}
        </span>
      ),
    },
    {
      key: 'action',
      title: t('common.action'),
      align: 'right',
      render: (row) => (
        <MemoryRowActions
          memory={row}
          showMemoryRenameModal={showMemoryRenameModal}
        />
      ),
    },
  ];

  return (
    <ListDataTable
      columns={columns}
      rows={rows}
      tableTestId="memories-table"
      rowTestId="memories-table-row"
    />
  );
}
