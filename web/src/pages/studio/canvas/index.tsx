import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ReactFlowProvider } from '@xyflow/react';
import {
  ChevronLeft,
  CirclePlay,
  FlaskConical,
  History,
  SlidersHorizontal,
  Square,
} from 'lucide-react';
import { Button, ButtonLoading } from '@/components/ui/button';
import { AgentCategory } from '@/constants/agent';
import AgentCanvas from '@/pages/agent/canvas';
import { DropdownProvider } from '@/pages/agent/canvas/context';
import { NodePanel } from '@/pages/agent/components/node-panel';
import { PublishConfirmDialog } from '@/pages/agent/components/publish-confirm-dialog';
import {
  ChatflowOperatorList,
  WorkflowOperatorList,
} from '@/pages/agent/constant';
import { OwnerTenantIdContext } from '@/pages/agent/context';
import { GlobalParamSheet } from '@/pages/agent/gobal-variable-sheet';
import { useCanvasChecklist } from '@/pages/agent/hooks/use-canvas-checklist';
import { useFetchDataOnMount } from '@/pages/agent/hooks/use-fetch-data';
import { useSaveGraph } from '@/pages/agent/hooks/use-save-graph';
import { useSetModalState } from '@/hooks/common-hooks';
import { VersionDialog } from '@/pages/agent/version-dialog';
import { Routes } from '@/routes';
import api from '@/utils/api';
import request from '@/utils/request';

/**
 * 工作室画布（对话流 / 工作流），对齐原型：
 * 顶部工具栏（变量/版本/试运行/校验/发布）+ 左侧节点面板 + 底部运行面板。
 *
 * 页面与智能体完全隔离（独立路由 /studio/:id），共享底层画布与节点实现。
 * 已知边界：`POST /workflows/:id/run` 用应用级密钥鉴权（PUB-08 尚未实现），
 * 所以试运行目前会返回 401 —— 链路先接通，密钥落地后无需再改前端。
 */
type RunTab = 'result' | 'vars' | 'tracing';

export default function StudioCanvas() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { flowDetail, loading } = useFetchDataOnMount();
  const { saveGraph, loading: saving } = useSaveGraph();
  const { issues, getLatestIssues } = useCanvasChecklist({ canvasID: id });

  const {
    visible: versionVisible,
    hideModal: hideVersionDialog,
    showModal: showVersionDialog,
  } = useSetModalState();
  const {
    visible: globalVarVisible,
    hideModal: hideGlobalVarSheet,
    showModal: showGlobalVarSheet,
  } = useSetModalState();
  const { visible: publishVisible, showModal: showPublishDialog } =
    useSetModalState();

  const isWorkflow =
    flowDetail?.canvas_category === AgentCategory.WorkflowCanvas;

  const operators = useMemo(
    () => (isWorkflow ? WorkflowOperatorList : ChatflowOperatorList),
    [isWorkflow],
  );

  const hasBlockingIssues = useCallback(() => {
    return getLatestIssues().length > 0;
  }, [getLatestIssues]);

  // ── 运行面板 ──
  const [runPanelVisible, setRunPanelVisible] = useState(false);
  const [runTab, setRunTab] = useState<RunTab>('result');
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<{
    code: number;
    message?: string;
    data?: { id?: string };
  } | null>(null);
  const [traceNodes, setTraceNodes] = useState<
    {
      node_id: string;
      node_type: string;
      status: string;
      duration_ms: number;
      retry_count?: number;
      error_message?: string;
      inputs?: unknown;
      outputs?: unknown;
    }[]
  >([]);

  const handleSave = useCallback(() => {
    saveGraph();
  }, [saveGraph]);

  const handleRun = useCallback(async () => {
    if (hasBlockingIssues()) {
      return;
    }
    setRunning(true);
    setRunPanelVisible(true);
    setRunTab('result');
    try {
      await saveGraph();
      // 试运行走用户身份的 debug 接口（/apps/:id/debug-run），
      // 不是正式调用的 /workflows/:id/run（那个要应用密钥）。
      const { data } = await request.post(api.debugRun(id as string), {
        inputs: {},
      });
      setRunResult(data as { code: number; message?: string; data?: { id?: string } });
      // 跑完后拉节点级执行记录（LOG-03），供 Tracing 时间线展示。
      const runId = (data as { data?: { id?: string } })?.data?.id;
      if (runId) {
        const nodesResp = await request.get(api.getRunNodes(runId));
        setTraceNodes(
          ((nodesResp as { data?: unknown[] })?.data ?? []) as typeof traceNodes,
        );
        setRunTab('tracing');
      }
    } catch (e) {
      setRunResult({
        code: -1,
        message: (e as Error)?.message ?? '运行失败',
      });
    } finally {
      setRunning(false);
    }
  }, [hasBlockingIssues, id, saveGraph]);

  const runOk = runResult?.code === 0;

  return (
    <div className="flex size-full flex-col bg-bg-base">
      {/* ── 顶部工具栏 ── */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border-default px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => navigate(Routes.Studio)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="truncate text-sm font-semibold">
            {flowDetail?.title || '-'}
          </span>
          <span className="rounded bg-state-warning-bg px-1.5 py-0.5 text-xs text-state-warning">
            {flowDetail?.release ? '已发布' : '草稿'}
          </span>
          <span
            className="rounded bg-brand-weak px-1.5 py-0.5 text-xs text-brand"
            data-testid="studio-canvas-kind"
          >
            {isWorkflow ? '任务流' : '对话流'}
          </span>
          <span className="text-xs text-text-secondary">
            {flowDetail?.latest_version_seq
              ? `v${flowDetail.latest_version_seq}`
              : ''}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1"
            onClick={showGlobalVarSheet}
          >
            <SlidersHorizontal className="size-3.5" />
            变量
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1"
            onClick={showVersionDialog}
          >
            <History className="size-3.5" />
            版本
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="gap-1"
            disabled={running}
            onClick={handleRun}
            data-testid="studio-canvas-run"
          >
            <CirclePlay className="size-3.5" />
            试运行
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="gap-1"
            onClick={() => setRunPanelVisible(true)}
          >
            <FlaskConical className="size-3.5" />
            校验
            {issues.length > 0 && (
              <span className="text-state-warning">{issues.length}</span>
            )}
          </Button>
          <ButtonLoading
            size="sm"
            loading={saving}
            onClick={handleSave}
            data-testid="studio-canvas-save"
          >
            保存
          </ButtonLoading>
          <Button size="sm" onClick={showPublishDialog}>
            发布
          </Button>
        </div>
      </header>

      {/* ── 画布 ── */}
      <div className="relative min-h-0 flex-1">
        <OwnerTenantIdContext.Provider value={flowDetail?.tenant_id}>
          <ReactFlowProvider>
            <DropdownProvider>
              <AgentCanvas
                sidebar={loading ? null : <NodePanel operators={operators} />}
                enableContextMenu
              />
            </DropdownProvider>
          </ReactFlowProvider>
        </OwnerTenantIdContext.Provider>
      </div>

      {/* ── 底部运行面板 ── */}
      {runPanelVisible && (
        <footer className="flex h-[38%] shrink-0 flex-col border-t border-border-default bg-bg-base">
          <div className="flex items-center justify-between border-b border-border-default px-4 py-1.5">
            <div className="flex gap-1">
              {(['result', 'vars', 'tracing'] as RunTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={
                    'rounded px-2.5 py-1 text-xs ' +
                    (runTab === tab
                      ? 'bg-brand-weak font-medium text-brand'
                      : 'text-text-secondary hover:text-text-primary')
                  }
                  onClick={() => setRunTab(tab)}
                >
                  {tab === 'result'
                    ? '运行结果'
                    : tab === 'vars'
                      ? '变量'
                      : 'Tracing'}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 text-xs text-text-secondary">
              {runResult && <span>run_id: {runResult.data?.id ?? '-'}</span>}
              <Button variant="ghost" size="sm" disabled={!running}>
                <Square className="size-3" />
                停止
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRunPanelVisible(false)}
              >
                收起
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-4 text-sm">
            {runTab === 'result' &&
              (running ? (
                <div className="text-text-secondary">运行中…</div>
              ) : runResult ? (
                runOk ? (
                  <pre className="whitespace-pre-wrap font-mono text-xs">
                    {JSON.stringify(runResult.data, null, 2)}
                  </pre>
                ) : (
                  <div className="rounded bg-state-error-bg p-3 text-state-error">
                    运行失败（code {runResult.code}）：
                    {runResult.message ?? '未知错误。'}
                  </div>
                )
              ) : (
                <div className="text-text-secondary">
                  点击「试运行」后这里展示输出。
                </div>
              ))}

            {runTab === 'vars' && (
              <div className="text-text-secondary">
                变量面板依赖会话/环境变量双轨（VAR-02/03），待后端就绪。
              </div>
            )}

            {runTab === 'tracing' &&
              (traceNodes.length === 0 ? (
                <div className="text-text-secondary">
                  暂无节点执行记录。点击「试运行」后这里展示每个节点的耗时与输入输出。
                </div>
              ) : (
                <ol className="space-y-1.5">
                  {traceNodes.map((n, idx) => (
                    <li
                      key={n.node_id + idx}
                      className="flex items-center gap-3 rounded border border-border-default px-3 py-1.5"
                    >
                      <span className="flex size-6 shrink-0 items-center justify-center rounded bg-brand-weak text-xs text-brand">
                        {idx + 1}
                      </span>
                      <span className="w-28 shrink-0 truncate font-medium">
                        {n.node_type}
                      </span>
                      <span
                        className={
                          'shrink-0 text-xs ' +
                          (n.status === 'succeeded'
                            ? 'text-state-success'
                            : n.status === 'failed'
                              ? 'text-state-error'
                              : 'text-text-secondary')
                        }
                      >
                        {n.status}
                      </span>
                      <span className="shrink-0 text-xs text-text-secondary">
                        {n.duration_ms}ms
                      </span>
                      {n.retry_count ? (
                        <span className="shrink-0 text-xs text-text-secondary">
                          重试 {n.retry_count} 次
                        </span>
                      ) : null}
                      {n.error_message ? (
                        <span className="min-w-0 truncate text-xs text-state-error">
                          {n.error_message}
                        </span>
                      ) : null}
                      <details className="ml-auto text-xs text-text-secondary">
                        <summary className="cursor-pointer">输入/输出</summary>
                        <pre className="mt-1 whitespace-pre-wrap rounded bg-bg-card p-2 font-mono text-[11px]">
                          {JSON.stringify(
                            { inputs: n.inputs, outputs: n.outputs },
                            null,
                            2,
                          )}
                        </pre>
                      </details>
                    </li>
                  ))}
                </ol>
              ))}
          </div>
        </footer>
      )}

      {/* ── 弹窗 ── */}
      {versionVisible && (
        <VersionDialog hideModal={hideVersionDialog}></VersionDialog>
      )}
      {globalVarVisible && (
        <GlobalParamSheet data={{}} hideModal={hideGlobalVarSheet} />
      )}
      {publishVisible && (
        <PublishConfirmDialog
          autoOpen
          agentDetail={flowDetail}
          loading={saving}
          onPublish={(remark) => saveGraph(undefined, undefined, true, remark)}
          onBeforeOpen={hasBlockingIssues}
        />
      )}
    </div>
  );
}
