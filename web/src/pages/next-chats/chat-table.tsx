import { useTranslation } from 'react-i18next';
import {
  ListDataTable,
  ListColumn,
  formatListTime,
} from '@/components/list-view/list-data-table';
import { IDialog } from '@/interfaces/database/chat';
import {
  formatKnowledgeBaseCell,
  getKnowledgeBaseNames,
} from '@/utils/kb-labels';
import { ChatRowActions } from './chat-row-actions';
import { useModelNameResolver } from './use-model-name-resolver';

/**
 * 知识问答（Chat）表格视图。
 *
 * 列的选择遵循「宁可多列不可少列」：使用者看列表时最想确认的是
 * 「这个问答用的是哪个模型、挂了哪些知识库、检索参数怎么设的」——
 * 这三项都要点进设置页才能看到，成本太高，所以直接上列表。
 *
 * 列：名称 · 描述 · 模型 · 知识库 · 重排模型 · TopK/阈值 · 更新时间 · 操作
 *
 * 模型 / 知识库 / 重排模型三列展示的必须是**名称**：库里存的是 id，
 * 用户看不懂也没法据此判断「这个问答到底配了什么」，映射规则集中在
 * `utils/kb-labels.ts`，卡片视图复用同一套。
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
  const resolveModelName = useModelNameResolver();

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
      title: t('common.model'),
      render: (row) => {
        const name = resolveModelName(row.llm_id);
        return (
          <span className="whitespace-nowrap text-text-secondary" title={name}>
            {name}
          </span>
        );
      },
    },
    {
      key: 'kb',
      title: t('common.knowledgeBase'),
      className: 'max-w-[240px]',
      render: (row) => {
        const { text, title } = formatKnowledgeBaseCell(
          getKnowledgeBaseNames(row),
        );
        return (
          <span className="line-clamp-1 text-text-secondary" title={title}>
            {text}
          </span>
        );
      },
    },
    {
      key: 'rerank',
      title: t('common.rerankModel'),
      render: (row) => {
        const name = resolveModelName(row.rerank_id);
        return (
          <span className="whitespace-nowrap text-text-secondary" title={name}>
            {name}
          </span>
        );
      },
    },
    {
      key: 'params',
      title: t('common.topKThreshold'),
      render: (row) => (
        <span className="whitespace-nowrap font-mono text-xs text-text-secondary">
          {row.top_k ?? '-'} / {row.similarity_threshold ?? '-'}
        </span>
      ),
    },
    {
      key: 'updated',
      title: t('common.updateTime'),
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
        <ChatRowActions chat={row} showChatRenameModal={showChatRenameModal} />
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
