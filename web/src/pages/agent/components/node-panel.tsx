import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, Search } from 'lucide-react';
import { Panel } from '@xyflow/react';
import { Operator } from '@/constants/agent';
import { OperatorItemList } from '../canvas/node/dropdown/operator-item-list';
import { cn } from '@/lib/utils';

/**
 * 画布左侧节点面板（对齐 docs/prototypes/Dify_Chatflow_Workflow_原型.html
 * 的 `.node-panel`：224px、顶部搜索、按「入口出口 / 模型 / 知识 / 逻辑 / 数据」
 * 分组）。
 *
 * 为什么要有这个面板：原来加节点只能从已连节点的 Handle 拖出下拉，
 * 空图上无处可拖，新用户第一次进画布根本不知道能加什么节点（原型设计
 * 也是这么要求的，功能清单 CV-02）。
 *
 * 节点集由调用方按应用形态传入（Workflow 用 End、Chatflow 用 Answer），
 * 面板只负责展示和过滤，不自己判断形态。
 */
// 分组与命名严格对齐原型 docs/prototypes/Dify_Chatflow_Workflow_原型.html
// 的 `.node-panel`：入口/出口 · 模型 · 知识 · 逻辑 · 数据 · 集成 · 人机协同。
const GROUP_DEFS: { title: string; ops: Operator[] }[] = [
  { title: '入口 / 出口', ops: [Operator.Begin, Operator.End, Operator.Answer] },
  {
    title: '模型',
    ops: [
      Operator.LLM,
      Operator.Agent,
      Operator.ParameterExtractor,
      Operator.Categorize,
    ],
  },
  { title: '知识', ops: [Operator.Retrieval] },
  {
    title: '逻辑',
    ops: [
      Operator.Switch,
      Operator.Iteration,
      Operator.Loop,
      Operator.VariableAggregator,
      Operator.VariableAssigner,
      Operator.ListOperations,
    ],
  },
  {
    title: '数据',
    ops: [
      Operator.Code,
      Operator.TemplateTransform,
      Operator.Invoke,
      Operator.StringTransform,
      Operator.DataOperations,
    ],
  },
  { title: '集成', ops: [Operator.Tool] },
  { title: '人机协同', ops: [Operator.UserFillUp] },
];

/**
 * 工作室的节点叫法（对齐原型）。
 *
 * 这几条在智能体那边是另一套文案（大语言模型 / 条件 / 代码 / 变量赋值器），
 * 直接改 i18n 会连着改掉智能体，所以在这里局部覆盖 —— 只影响工作室面板。
 */
const STUDIO_LABELS: Partial<Record<Operator, string>> = {
  [Operator.LLM]: '大模型',
  [Operator.Switch]: '条件分支',
  [Operator.Code]: '代码执行',
  [Operator.VariableAssigner]: '变量赋值',
  [Operator.End]: '结束',
  [Operator.Answer]: '回答',
  [Operator.TemplateTransform]: '模板转换',
  [Operator.ParameterExtractor]: '参数提取',
};

export function NodePanel({ operators }: { operators: Operator[] }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState(false);

  // 只保留当前形态允许的节点；分组里没有的（Begin 之外的历史节点）归到「其他」，
  // 避免以后加节点忘了登记分组就消失。
  const groups = useMemo(() => {
    const allowed = new Set(operators);
    const grouped = GROUP_DEFS.map((g) => ({
      title: g.title,
      ops: g.ops.filter((op) => allowed.has(op)),
    })).filter((g) => g.ops.length > 0);

    const registered = new Set(GROUP_DEFS.flatMap((g) => g.ops));
    const rest = operators.filter((op) => !registered.has(op));
    if (rest.length > 0) {
      grouped.push({ title: '其他', ops: rest });
    }
    return grouped;
  }, [operators]);

  const keyword = query.trim().toLowerCase();
  // 搜索必须匹配「用户看到的名字」（大模型 / 条件分支），不是枚举值，
  // 否则搜「大模型」找不到 LLM。
  const label = (op: Operator) =>
    STUDIO_LABELS[op] ?? t(`flow.${op.charAt(0).toLowerCase()}${op.slice(1)}`);

  const visibleGroups = useMemo(() => {
    if (!keyword) {
      return groups;
    }
    return groups
      .map((g) => ({
        title: g.title,
        // 节点名来自 i18n，搜索必须匹配译名而不是内部枚举值，
        // 否则用户搜「大模型」找不到 LLM。
        ops: g.ops.filter((op) => label(op).toLowerCase().includes(keyword)),
      }))
      .filter((g) => g.ops.length > 0);
  }, [groups, keyword, t]);

  if (collapsed) {
    return (
      <Panel position="top-left" className="!m-3">
        <button
          type="button"
          className="flex items-center gap-1 rounded-md border border-border-default bg-bg-base px-2 py-1.5 text-xs text-text-secondary shadow-sm hover:text-text-primary"
          onClick={() => setCollapsed(false)}
          data-testid="node-panel-expand"
        >
          节点
          <ChevronLeft className="size-3 rotate-180" />
        </button>
      </Panel>
    );
  }

  return (
    <Panel
      position="top-left"
      className="!m-3 flex max-h-[calc(100%-24px)] w-56 flex-col overflow-hidden rounded-lg border border-border-default bg-bg-base shadow-sm"
    >
      <div className="flex items-center gap-1 border-b border-border-default px-2 py-1.5">
        <Search className="size-3.5 shrink-0 text-text-secondary" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索节点"
          className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-text-secondary"
          data-testid="node-panel-search"
        />
        <button
          type="button"
          className="shrink-0 text-text-secondary hover:text-text-primary"
          onClick={() => setCollapsed(true)}
          title="收起"
        >
          <ChevronLeft className="size-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {visibleGroups.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-text-secondary">
            没有匹配的节点
          </div>
        ) : (
          visibleGroups.map((group) => (
            <div key={group.title} className="mb-2 last:mb-0">
              <div className="px-1.5 pb-1 text-[11px] font-medium text-text-secondary">
                {group.title}
              </div>
              <ul className={cn('space-y-0.5')}>
                <OperatorItemList
                  operators={group.ops}
                  isCustomDropdown
                  labelMap={STUDIO_LABELS}
                />
              </ul>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}
