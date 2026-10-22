import { useTranslation } from 'react-i18next';
import {
  ListDataTable,
  ListColumn,
  formatListTime,
} from '@/components/list-view/list-data-table';
import { AgentListItemType, IFlow } from '@/interfaces/database/agent';
import { CanvasCategoryToFlowType, FlowType } from './constant';
import { AgentRowActions } from './agent-row-actions';

/**
 * 列表数据是两种实体的联合：普通智能体（IFlow，标题字段叫 title）
 * 与编译模板组（ICompilationTemplateGroup，标题字段叫 name）。
 * 用一个做了字段并集的行类型统一处理——模板组上不适用的列（版本、
 * 最近运行、关联知识库）显示 "-"，而不是硬编一个假值。
 */
// 注意：这里不能用 IFlow & Partial<ICompilationTemplateGroup> 做交叉 ——
// IFlow.description 的类型是 null，与模板组的 string 交叉后整个类型会塌成
// never，运行没问题但所有字段访问都报错。直接声明需要的并集字段更稳。
type AgentRow = IFlow & {
  type?: AgentListItemType;
  /** 仅编译模板组有：标题字段叫 name 而不是 title。 */
  name?: string;
  /** 仅编译模板组有：包含的模板数量。 */
  templates?: unknown[];
};

/**
 * 智能体列表的表格视图（与工作室表格同源实体 IFlow，但列更全）。
 *
 * 列：名称 · 类型 · 状态 · 版本 · 最近运行 · 关联知识库 · 标签 · 创建者 ·
 *     更新时间 · 操作
 *
 * 与工作室表格的差别只有一处：这里的数据源会混入「编译模板组」和
 * 「内置流水线」，两者是只读资源（非数据库记录），不能改名/删除，
 * 所以操作列按 type 收敛，而不是无脑挂一个下拉。
 */
export function AgentListTable({
  rows,
  onOpen,
  showAgentRenameModal,
}: {
  rows: AgentRow[];
  onOpen: (id: string) => void;
  showAgentRenameModal: (data: IFlow) => Promise<void>;
}) {
  const { t } = useTranslation();

  const typeLabel = (row: AgentRow) => {
    if (row.type === AgentListItemType.BuiltinPipeline) {
      return '内置流水线';
    }
    if (row.type === AgentListItemType.CompilationTemplateGroup) {
      return '编译模板';
    }
    const flowType = CanvasCategoryToFlowType[row.canvas_category ?? ''];
    if (flowType === FlowType.Workflow) return t('flow.taskFlow');
    if (flowType === FlowType.Chatflow) return t('flow.chatflow');
    return row.canvas_category || '智能体';
  };

  const columns: ListColumn<AgentRow>[] = [
    {
      key: 'name',
      title: t('common.name'),
      render: (row) => (
        <button
          type="button"
          className="text-left font-medium text-text-primary hover:text-accent-primary hover:underline"
          onClick={() => onOpen(row.id)}
        >
          {row.title || row.name || '-'}
        </button>
      ),
    },
    {
      key: 'type',
      title: t('studio.colType'),
      render: (row) => (
        <span className="whitespace-nowrap text-text-secondary">
          {typeLabel(row)}
        </span>
      ),
    },
    {
      key: 'status',
      title: t('studio.colStatus'),
      render: (row) => (
        <span
          className={
            row.release
              ? 'text-state-success'
              : 'text-text-secondary'
          }
        >
          {row.release ? '已发布' : '草稿'}
        </span>
      ),
    },
    {
      key: 'version',
      title: t('studio.colVersion'),
      render: (row) => (
        <span className="whitespace-nowrap text-text-secondary">
          {row.latest_version_seq ? `v${row.latest_version_seq}` : '-'}
        </span>
      ),
    },
    {
      key: 'lastRun',
      title: t('studio.colLastRun'),
      render: (row) => (
        <span className="whitespace-nowrap text-text-secondary">
          {formatListTime(row.last_run_time)}
        </span>
      ),
    },
    {
      key: 'kb',
      title: t('common.knowledgeBase'),
      render: (row) => {
        const count = row.datasets?.length ?? 0;
        return (
          <span
            className="whitespace-nowrap text-text-secondary"
            title={
              count > 0
                ? row.datasets!.map((d) => d.name).join('、')
                : undefined
            }
          >
            {count > 0 ? `${count} 个` : '未关联'}
          </span>
        );
      },
    },
    {
      key: 'tags',
      title: '标签',
      className: 'max-w-[180px]',
      render: (row) => {
        const tags = (row.tags ?? '')
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean);
        if (tags.length === 0) {
          return <span className="text-text-secondary">-</span>;
        }
        return (
          <span className="flex flex-wrap gap-1">
            {tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded bg-bg-card px-1.5 py-0.5 text-xs text-text-secondary"
              >
                {tag}
              </span>
            ))}
            {tags.length > 3 && (
              <span className="text-xs text-text-secondary">
                +{tags.length - 3}
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: 'owner',
      title: '创建者',
      render: (row) => (
        <span className="text-text-secondary">{row.nickname || '-'}</span>
      ),
    },
    {
      key: 'updated',
      title: '更新时间',
      render: (row) => (
        <span className="whitespace-nowrap text-text-secondary">
          {formatListTime(row.update_date || row.update_time)}
        </span>
      ),
    },
    {
      key: 'action',
      title: t('common.action'),
      align: 'right',
      render: (row) => {
        // 模板组与内置流水线是只读资源，没有改名/删除入口。
        const readOnly =
          row.type === AgentListItemType.CompilationTemplateGroup ||
          row.type === AgentListItemType.BuiltinPipeline;
        if (readOnly) {
          return <span className="text-xs text-text-secondary">只读</span>;
        }
        return (
          <AgentRowActions
            agent={row}
            showAgentRenameModal={showAgentRenameModal}
          />
        );
      },
    },
  ];

  return (
    <ListDataTable
      columns={columns}
      rows={rows}
      tableTestId="agents-table"
      rowTestId="agents-table-row"
    />
  );
}
