import { CardContainer } from '@/components/card-container';
import { AgentCategory } from '@/constants/agent';
import {
  LIST_MAX_DISPLAYED_PAGES,
  LIST_PAGE_SIZE_OPTIONS,
} from '@/constants/list-pagination';
import ListFilterBar from '@/components/list-filter-bar';
import { EmptyAppCard } from '@/components/empty/empty';
import { EmptyCardType } from '@/components/empty/constant';
import { Button } from '@/components/ui/button';
import { RAGFlowPagination } from '@/components/ui/ragflow-pagination';
import {
  useFetchAgentFilters,
  useFetchAgentListByPage,
} from '@/hooks/use-agent-request';
import { MessageSquareText, Play, Upload, Workflow } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { AgentCard } from '../agents/agent-card';
import { CreateStudioDialog } from './create-studio-dialog';
import { useStudioTypeFilter } from './use-studio-type-filter';
import { StudioTypeTab } from './studio-type-tab';
import { StudioTable } from './studio-table';
import { ViewToggle } from './view-toggle';
import { useListViewPreference } from '@/hooks/use-list-view-preference';
import { useRenameAgent } from '../agents/use-rename-agent';

/**
 * 工作室 —— Chatflow / Workflow 的独立入口。
 *
 * 与「智能体」的关系（产品文档《交互调整说明》第二节归属规则）：
 *   - 智能体：多轮对话、工具调用、子智能体（agent_canvas）+ 数据管道（dataflow_canvas）
 *   - 工作室：面向用户的对话式应用（chatflow_canvas）与面向系统的数据加工（workflow_canvas）
 *
 * 智能体列表已迁回只放 Agent 与模板，所以这里显式按 canvas_category 过滤，
 * 不依赖服务端默认分类，避免两类应用互相串味。
 */
export default function Studio() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [createType, setCreateType] = useState<'chatflow' | 'workflow' | null>(
    null,
  );

  const { type, setType, canvasCategoryIds } = useStudioTypeFilter();
  const { mode: viewMode, setMode: setViewMode } = useListViewPreference();
  const { data: agentFilters } = useFetchAgentFilters();

  const {
    data,
    loading: listLoading,
    pagination,
    setPagination,
    handleInputChange,
    debouncedSearchString,
  } = useFetchAgentListByPage({
    canvasCategoryIds,
    defaultPageSize: 12,
  });

  const apps = data ?? [];
  const total = pagination.total ?? 0;
  const { showAgentRenameModal } = useRenameAgent();

  // Tab 计数回答「我有多少个」，与「我现在看到几个」是两件事（产品文档 3.3）。
  // 数据源用 filter 接口的分类计数：它是独立请求、不带搜索词，所以数字不会
  // 跟着搜索变；「全部」= 两类之和，避免为此多发两次列表请求。
  const counts = useMemo(() => {
    const find = (id: string) =>
      agentFilters?.canvas_category.find((c) => c.id === id)?.count ?? 0;
    const workflow = find(AgentCategory.WorkflowCanvas);
    const chatflow = find(AgentCategory.ChatflowCanvas);
    return { all: workflow + chatflow, workflow, chatflow };
  }, [agentFilters]);

  const handleCreate = useCallback((kind: 'chatflow' | 'workflow') => {
    // 类型卡片即创建入口：点哪张建哪种，并预选类型（产品文档第三节）。
    setCreateType(kind);
  }, []);

  return (
    <section className="p-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('header.studio')}</h1>
          <p className="mt-1 text-sm text-text-secondary">
            {t('studio.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle mode={viewMode} onChange={setViewMode} />
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/agents')}
          >
            <Upload className="size-4" />
            {t('flow.importJsonFile')}
          </Button>
          <Button size="sm" onClick={() => setCreateType('chatflow')}>
            <Play className="size-4" />
            {t('studio.createApp')}
          </Button>
        </div>
      </header>

      {/* 搜索：只匹配名称（产品文档 3.3）。类型由下面的 Tab 承担，
          所以这里不传 filters——筛选栏会退化成纯搜索框。 */}
      <ListFilterBar
        searchString={debouncedSearchString}
        onSearchChange={handleInputChange}
        showFilter={false}
        filters={[]}
        className="mb-4"
      />

      {/* 类型说明卡：两张卡本身就是创建入口（产品文档 3.1 工作室侧做法）。 */}
      <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-2">
        <button
          type="button"
          onClick={() => handleCreate('chatflow')}
          className="group rounded-xl border border-border-default bg-bg-card p-5 text-left transition-colors hover:border-accent-primary"
          data-testid="studio-type-card-chatflow"
        >
          <div className="flex items-center gap-2 text-text-primary">
            <MessageSquareText className="size-5" />
            <span className="font-medium">{t('flow.chatflow')}</span>
          </div>
          <p className="mt-2 text-sm text-text-secondary">
            {t('studio.chatflowDesc')}
          </p>
          <p className="mt-1 text-xs text-text-secondary">
            {t('studio.chatflowShape')}
          </p>
          <span className="mt-3 inline-block text-sm text-accent-primary opacity-0 transition-opacity group-hover:opacity-100">
            {t('studio.createChatflow')} →
          </span>
        </button>

        <button
          type="button"
          onClick={() => handleCreate('workflow')}
          className="group rounded-xl border border-border-default bg-bg-card p-5 text-left transition-colors hover:border-accent-primary"
          data-testid="studio-type-card-workflow"
        >
          <div className="flex items-center gap-2 text-text-primary">
            <Workflow className="size-5" />
            <span className="font-medium">{t('flow.taskFlow')}</span>
          </div>
          <p className="mt-2 text-sm text-text-secondary">
            {t('studio.workflowDesc')}
          </p>
          <p className="mt-1 text-xs text-text-secondary">
            {t('studio.workflowShape')}
          </p>
          <span className="mt-3 inline-block text-sm text-accent-primary opacity-0 transition-opacity group-hover:opacity-100">
            {t('studio.createWorkflow')} →
          </span>
        </button>
      </div>

      <StudioTypeTab value={type} onChange={setType} counts={counts} />

      {viewMode === 'card' ? (
        <CardContainer>
          {apps.map((app) => (
            <AgentCard
              key={app.id}
              data={app as any}
              showAgentRenameModal={showAgentRenameModal}
            />
          ))}
          {!listLoading && apps.length === 0 && (
            <div className="col-span-full">
              <EmptyAppCard
                type={EmptyCardType.Agent}
                onClick={() => setCreateType('chatflow')}
              />
              {debouncedSearchString && (
                <p className="mt-2 text-center text-sm text-text-secondary">
                  {t('studio.noMatch', { keyword: debouncedSearchString })}
                </p>
              )}
            </div>
          )}
        </CardContainer>
      ) : (
        <StudioTable
          apps={apps as any}
          loading={listLoading}
          onOpen={(id) => navigate(`/agent/${id}`)}
          onCreate={() => setCreateType('chatflow')}
        />
      )}

      {total > 0 && (
        <div className="mt-4 flex justify-end">
          <RAGFlowPagination
            {...pagination}
            total={total}
            pageSizeOptions={LIST_PAGE_SIZE_OPTIONS}
            maxDisplayedPages={LIST_MAX_DISPLAYED_PAGES}
            onChange={(page: number, pageSize?: number) =>
              setPagination({ page, pageSize })
            }
          />
        </div>
      )}

      {createType && (
        <CreateStudioDialog
          initialType={createType}
          hideModal={() => setCreateType(null)}
        />
      )}
    </section>
  );
}
