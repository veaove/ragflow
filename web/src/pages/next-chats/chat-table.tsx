import { useTranslation } from 'react-i18next';
import { MoreButton } from '@/components/more-button';
import {
  ListDataTable,
  ListColumn,
  formatListTime,
} from '@/components/list-view/list-data-table';
import { IDialog } from '@/interfaces/database/chat';
import { ChatDropdown } from './chat-dropdown';

/**
 * 知识问答（Chat）表格视图。
 *
 * 列的选择遵循「宁可多列不可少列」：使用者看列表时最想确认的是
 * 「这个问答用的是哪个模型、挂了哪些知识库、检索参数怎么设的」——
 * 这三项都要点进设置页才能看到，成本太高，所以直接上列表。
 *
 * 列：名称 · 描述 · 模型 · 关联知识库 · TopK/阈值 · 更新时间 · 操作
 */
export function ChatTable({
  rows,
  onOpen,
  showChatRenameModal,
}: {
  rows: IDialog[];
  onOpen: (id: string) => void;
  showChatRenameModal: (data: IDialog) => void;
}) {
  const { t } = useTranslation();

  const columns: ListColumn<IDialog>[] = [
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
      className: 'max-w-[240px]',
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
      key: 'llm',
      title: '模型',
      render: (row) => (
        <span className="text-text-secondary">{row.llm_id || '-'}</span>
      ),
    },
    {
      key: 'kb',
      title: t('common.knowledgeBase'),
      render: (row) => {
        const count = row.kb_names?.length ?? 0;
        return (
          <span
            className="text-text-secondary"
            title={count > 0 ? row.kb_names.join('、') : undefined}
          >
            {count > 0 ? `${count} 个` : '未关联'}
          </span>
        );
      },
    },
    {
      key: 'params',
      title: 'TopK / 阈值',
      render: (row) => (
        <span className="whitespace-nowrap font-mono text-xs text-text-secondary">
          {row.top_k ?? '-'} / {row.similarity_threshold ?? '-'}
        </span>
      ),
    },
    {
      key: 'rerank',
      title: '重排模型',
      render: (row) => (
        <span className="text-text-secondary">{row.rerank_id || '-'}</span>
      ),
    },
    {
      key: 'updated',
      title: '更新时间',
      render: (row) => (
        <span className="whitespace-nowrap text-text-secondary">
          {formatListTime(row.update_time || row.update_date)}
        </span>
      ),
    },
    {
      key: 'action',
      title: t('common.action'),
      align: 'right',
      render: (row) => (
        <div className="flex justify-end">
          <ChatDropdown chat={row} showChatRenameModal={showChatRenameModal}>
            <MoreButton />
          </ChatDropdown>
        </div>
      ),
    },
  ];

  return (
    <ListDataTable
      columns={columns}
      rows={rows}
      tableTestId="chats-table"
      rowTestId="chats-table-row"
    />
  );
}
