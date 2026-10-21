import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { ReactFlowProvider } from '@xyflow/react';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { ButtonLoading } from '@/components/ui/button';
import { AgentCategory } from '@/constants/agent';
import AgentCanvas from '@/pages/agent/canvas';
import { DropdownProvider } from '@/pages/agent/canvas/context';
import { NodePanel } from '@/pages/agent/components/node-panel';
import {
  ChatflowOperatorList,
  WorkflowOperatorList,
} from '@/pages/agent/constant';
import { OwnerTenantIdContext } from '@/pages/agent/context';
import { useCanvasChecklist } from '@/pages/agent/hooks/use-canvas-checklist';
import { useFetchDataOnMount } from '@/pages/agent/hooks/use-fetch-data';
import { useSaveGraph } from '@/pages/agent/hooks/use-save-graph';
import { Routes } from '@/routes';

/**
 * 工作室画布（对话流 / 工作流）。
 *
 * 为什么不复用 `pages/agent/index.tsx`：那是智能体专属的页面（含对话抽屉、
 * 探索、嵌入、webhook 测试等能力），形态语义完全不同。之前两者共用同一页面
 * 和同一个 `/agent/:id` 路由，只能靠 `canvas_category` 在运行时猜，结果就是
 * 面包屑会错标成「智能体」、节点面板要不要显示要靠判断、改一边容易伤到另一边。
 *
 * 这里独立成页：
 * - 路由独立：/workflow/:id、/chatflow/:id
 * - 工具栏独立：只有保存 / 运行 / 发布 / 检查清单（智能体的探索、嵌入不在这里）
 * - 节点面板由本页按形态提供，通过 AgentCanvas 的 sidebar 插槽塞进去，
 *   共享的画布组件本身不带任何形态判断（智能体不传就什么都不渲染）
 *
 * 底层仍然是同一套：ReactFlow 容器、节点组件、store、表单都复用 agent 的实现，
 * 只有「页面壳 + 形态策略」是工作室自己的。这样既不互相影响，也不用维护两套画布。
 */
export default function StudioCanvas() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();

  const { flowDetail, loading } = useFetchDataOnMount();
  const { saveGraph, loading: saving } = useSaveGraph();
  const { issues } = useCanvasChecklist({ canvasID: id });

  const isWorkflow = flowDetail?.canvas_category === AgentCategory.WorkflowCanvas;

  // 形态决定节点目录：任务流只给 End，对话流只给 Answer，两者互斥。
  const operators = useMemo(
    () => (isWorkflow ? WorkflowOperatorList : ChatflowOperatorList),
    [isWorkflow],
  );

  const handleSave = useCallback(() => {
    saveGraph();
  }, [saveGraph]);

  return (
    <div className="flex size-full flex-col bg-bg-base">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border-default px-5 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink
                  className="cursor-pointer"
                  onClick={() => navigate(Routes.Studio)}
                >
                  {t('header.studio')}
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{flowDetail?.title || '-'}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <span className="rounded bg-bg-card px-1.5 py-0.5 text-xs text-text-secondary">
            {flowDetail?.release ? '已发布' : '草稿'}
          </span>
          <span
            className="rounded bg-bg-card px-1.5 py-0.5 text-xs text-text-secondary"
            data-testid="studio-canvas-kind"
          >
            {isWorkflow ? '任务流' : '对话流'}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <ButtonLoading
            variant="secondary"
            loading={saving}
            onClick={handleSave}
            data-testid="studio-canvas-save"
          >
            {t('flow.save')}
          </ButtonLoading>
          <span className="text-xs text-text-secondary">
            {issues.length > 0 ? `检查清单 ${issues.length} 项` : '检查通过'}
          </span>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        <OwnerTenantIdContext.Provider value={flowDetail?.tenant_id}>
          <ReactFlowProvider>
            <DropdownProvider>
              <AgentCanvas
                sidebar={loading ? null : <NodePanel operators={operators} />}
              />
            </DropdownProvider>
          </ReactFlowProvider>
        </OwnerTenantIdContext.Provider>
      </div>
    </div>
  );
}
