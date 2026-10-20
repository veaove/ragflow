import EmbedDialog, {
  defaultWidgetSettings,
  type WidgetSettings,
} from '@/components/embed-dialog';
import { useShowEmbedModal } from '@/components/embed-dialog/use-show-embed-dialog';
import { PageHeader } from '@/components/page-header';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Button, ButtonLoading } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import message from '@/components/ui/message';
import { AgentCategory } from '@/constants/agent';
import { SharedFrom } from '@/constants/chat';
import { DomainHostname } from '@/constants/common';
import { useSetModalState } from '@/hooks/common-hooks';
import { useNavigatePage } from '@/hooks/logic-hooks/navigate-hooks';
import { useSetAgent } from '@/hooks/use-agent-request';
import { ReactFlowProvider } from '@xyflow/react';
import {
  ChevronDown,
  CirclePlay,
  Compass,
  History,
  LaptopMinimalCheck,
  Logs,
  MessageSquareCode,
  ScreenShare,
  Settings,
  Upload,
} from 'lucide-react';
import {
  ComponentPropsWithoutRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router';
import AgentCanvas from './canvas';
import { DropdownProvider } from './canvas/context';
import { CanvasChecklist } from './components/canvas-checklist';
import { PublishConfirmDialog } from './components/publish-confirm-dialog';
import { Operator } from './constant';
import { OwnerTenantIdContext } from './context';
import { GlobalParamSheet } from './gobal-variable-sheet';
import { useBuildDslData } from './hooks/use-build-dsl';
import { useCancelCurrentDataflow } from './hooks/use-cancel-dataflow';
import { useCanvasChecklist } from './hooks/use-canvas-checklist';
import { useHandleExportJsonFile } from './hooks/use-export-json';
import { useFetchDataOnMount } from './hooks/use-fetch-data';
import { useFetchPipelineLog } from './hooks/use-fetch-pipeline-log';
import { useIsPipeline } from './hooks/use-is-pipeline';
import {
  useIsConversationMode,
  useIsWebhookMode,
} from './hooks/use-is-webhook';
import { useRunDataflow } from './hooks/use-run-dataflow';
import {
  useSaveGraph,
  useSaveGraphBeforeOpeningDebugDrawer,
  useWatchAgentChange,
} from './hooks/use-save-graph';
import { PipelineLogSheet } from './pipeline-log-sheet';
import PipelineRunSheet from './pipeline-run-sheet';
import { SettingDialog } from './setting-dialog';
import useGraphStore from './store';
import { useAgentHistoryManager } from './use-agent-history-manager';
import { VersionDialog } from './version-dialog';
import WebhookSheet from './webhook-sheet';
import { RunTooltip } from './flow-tooltip';
import { debugRunLimitsTooltipKey } from './utils/debug-run-limits';

/**
 * Standardizes dropdown menu item styling for agent management actions.
 */
function AgentDropdownMenuItem({
  children,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuItem>) {
  return (
    <DropdownMenuItem className="justify-start" {...props}>
      {children}
    </DropdownMenuItem>
  );
}

const AgentWidgetSettingsGlobalKey = 'sys.widget_settings';

/**
 * Displays the agent editor and persists agent-scoped widget defaults in DSL globals.
 */
export default function Agent() {
  const { id } = useParams();
  const isPipeline = useIsPipeline();
  const { navigateToAgents, navigateToStudio } = useNavigatePage();
  const {
    visible: chatDrawerVisible,
    hideModal: hideChatDrawer,
    showModal: showChatDrawer,
  } = useSetModalState();
  const { t } = useTranslation();
  useAgentHistoryManager();
  // Resolves the i18n key for the canvas "Run" tooltip describing the
  // debug preview limits. It is shown ONLY for a dataflow (ingestion pipeline)
  // canvas — an agent canvas runs the agent, not an ingestion debug preview.
  const runTooltipKey = debugRunLimitsTooltipKey(isPipeline);
  // The ingestion (dataflow) canvas hides the Run/test-run entry entirely;
  // the agent canvas keeps its Run button.
  const showRunButton = !isPipeline;

  const { handleExportJson } = useHandleExportJsonFile();
  const { saveGraph, loading } = useSaveGraph();
  // Saving is always allowed — the canvas checklist flags issues and gates
  // only the publish/run/embed/explore entry points.
  const handleSave = useCallback(() => {
    saveGraph();
  }, [saveGraph]);
  const { flowDetail: agentDetail } = useFetchDataOnMount();
  const { issues, getLatestIssues } = useCanvasChecklist({
    ownerTenantId: agentDetail?.tenant_id,
    canvasID: id,
  });
  const hasBlockingIssues = useCallback(() => {
    if (getLatestIssues().length > 0) {
      message.warning(t('flow.checklistResolveBefore'));
      return true;
    }
    return false;
  }, [getLatestIssues, t]);
  const { buildDslData } = useBuildDslData();
  const { setAgent, loading: savingWidgetSettings } = useSetAgent(false);
  const { handleRun } = useSaveGraphBeforeOpeningDebugDrawer(showChatDrawer);
  const {
    visible: versionDialogVisible,
    hideModal: hideVersionDialog,
    showModal: showVersionDialog,
  } = useSetModalState();

  const {
    visible: settingDialogVisible,
    hideModal: hideSettingDialog,
    showModal: showSettingDialog,
  } = useSetModalState();

  const { showEmbedModal, hideEmbedModal, embedVisible, beta } =
    useShowEmbedModal();
  const { navigateToAgentLogs, navigateToAgentExplore } = useNavigatePage();
  const time = useWatchAgentChange(chatDrawerVisible);
  const isWebhookMode = useIsWebhookMode();

  const isConversationMode = useIsConversationMode();

  // pipeline

  const {
    visible: pipelineRunSheetVisible,
    hideModal: hidePipelineRunSheet,
    showModal: showPipelineRunSheet,
  } = useSetModalState();

  const {
    visible: webhookTestSheetVisible,
    hideModal: hideWebhookTestSheet,
    showModal: showWebhookTestSheet,
  } = useSetModalState();

  const {
    visible: pipelineLogSheetVisible,
    showModal: showPipelineLogSheet,
    hideModal: hidePipelineLogSheet,
  } = useSetModalState();

  const {
    visible: globalParamSheetVisible,
    showModal: showGlobalParamSheet,
    hideModal: hideGlobalParamSheet,
  } = useSetModalState();

  const {
    isParsing,
    logs,
    messageId,
    setMessageId,
    isCompleted,
    stopFetchTrace,
    isLogEmpty,
  } = useFetchPipelineLog(pipelineLogSheetVisible);

  const findNodeByName = useGraphStore((state) => state.findNodeByName);

  const handleRunPipeline = useCallback(() => {
    if (!findNodeByName(Operator.Tokenizer)) {
      message.warning(t('flow.tokenizerRequired'));
      return;
    }

    if (isParsing) {
      // show log sheet
      showPipelineLogSheet();
    } else {
      hidePipelineLogSheet();
      // handleRun();
      showPipelineRunSheet();
    }
  }, [
    findNodeByName,
    hidePipelineLogSheet,
    isParsing,
    showPipelineLogSheet,
    showPipelineRunSheet,
    t,
  ]);

  const { handleCancel } = useCancelCurrentDataflow({
    messageId,
    stopFetchTrace,
  });

  const handleButtonRunClick = useCallback(async () => {
    if (hasBlockingIssues()) {
      return;
    }
    if (isWebhookMode) {
      if ((await saveGraph())?.code === 0) showWebhookTestSheet();
    } else if (isPipeline) {
      handleRunPipeline();
    } else {
      handleRun();
    }
  }, [
    hasBlockingIssues,
    handleRun,
    handleRunPipeline,
    isPipeline,
    isWebhookMode,
    saveGraph,
    showWebhookTestSheet,
  ]);

  const handleExploreClick = useCallback(() => {
    if (hasBlockingIssues()) {
      return;
    }
    navigateToAgentExplore(id as string)();
  }, [hasBlockingIssues, id, navigateToAgentExplore]);

  // ── 工作室列表下发的「一次性动作」 ──
  //
  // 列表页的「更多」菜单把运行 / 检查清单 / 历史版本 / 发布搬到了画布外，
  // 点击后跳到这里并带上 ?action=xxx。这些动作都依赖画布 store，只能在
  // 画布内执行，所以做法是：进入时读一次参数，等图加载完再触发，然后清掉
  // 参数 —— 否则刷新页面会莫名其妙再跑一次。
  const [searchParams, setSearchParams] = useSearchParams();
  // 只捕获进入时的值：清参数不应该反过来取消已经决定的行为。
  const [autoAction] = useState(() => searchParams.get('action'));
  const canvasNodeCount = useGraphStore((state) => state.nodes.length);
  const autoActionDone = useRef(false);

  useEffect(() => {
    if (!autoAction) {
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.delete('action');
    setSearchParams(next, { replace: true });
  }, [autoAction, searchParams, setSearchParams]);

  useEffect(() => {
    // 检查清单与发布靠 autoOpen 交给组件自己打开，这里只处理需要主动触发的两个。
    if (!autoAction || autoActionDone.current || canvasNodeCount === 0) {
      return;
    }
    if (autoAction === 'run') {
      autoActionDone.current = true;
      handleButtonRunClick();
    } else if (autoAction === 'versions') {
      autoActionDone.current = true;
      showVersionDialog();
    }
  }, [autoAction, canvasNodeCount, handleButtonRunClick, showVersionDialog]);

  const handleEmbedClick = useCallback(() => {
    if (hasBlockingIssues()) {
      return;
    }
    showEmbedModal();
  }, [hasBlockingIssues, showEmbedModal]);

  // Single source for the Run button so the tooltip gating in the JSX below
  // doesn't duplicate it.
  const runButton = (
    <Button
      data-testid="agent-run"
      variant={'secondary'}
      onClick={handleButtonRunClick}
    >
      <CirclePlay />
      {t('flow.run')}
    </Button>
  );

  const {
    run: runPipeline,
    loading: pipelineRunning,
    uploadedFileData,
  } = useRunDataflow({ showLogSheet: showPipelineLogSheet, setMessageId });

  const initialWidgetSettings = useMemo<WidgetSettings>(() => {
    const widgetSettings =
      agentDetail?.dsl?.globals?.[AgentWidgetSettingsGlobalKey];

    return {
      ...defaultWidgetSettings,
      ...(widgetSettings && typeof widgetSettings === 'object'
        ? widgetSettings
        : {}),
    };
  }, [agentDetail]);

  const handleSaveWidgetSettings = useCallback(
    async (widgetSettings: WidgetSettings) => {
      const dsl = buildDslData();

      return setAgent({
        id: id!,
        title: agentDetail.title,
        dsl: {
          ...dsl,
          globals: {
            ...dsl.globals,
            [AgentWidgetSettingsGlobalKey]: widgetSettings,
          },
        },
      });
    },
    [agentDetail.title, buildDslData, id, setAgent],
  );

  return (
    <section className="h-full" data-testid="agent-detail">
      <PageHeader>
        <section>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink onClick={navigateToAgents}>
                  {t('header.flow')}
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{agentDetail.title}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="text-xs text-text-secondary translate-y-3">
            {t('flow.autosaved')} {time}
          </div>
        </section>
        <div className="flex items-center gap-5">
          <ButtonLoading
            variant={'secondary'}
            onClick={handleSave}
            loading={loading}
          >
            <LaptopMinimalCheck /> {t('flow.save')}
          </ButtonLoading>
          {showRunButton &&
            (runTooltipKey ? (
              <RunTooltip tooltip={runTooltipKey}>{runButton}</RunTooltip>
            ) : (
              runButton
            ))}
          {isConversationMode && (
            <Button variant={'secondary'} onClick={handleExploreClick}>
              <Compass />
              {t('explore.title')}
            </Button>
          )}
          <PublishConfirmDialog
            autoOpen={autoAction === 'publish'}
            agentDetail={agentDetail}
            loading={loading}
            onPublish={() => saveGraph(undefined, undefined, true)}
            onBeforeOpen={hasBlockingIssues}
          />
          <CanvasChecklist
            issues={issues}
            autoOpen={autoAction === 'checklist'}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant={'secondary'}>
                <ChevronDown /> {t('flow.management')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <AgentDropdownMenuItem onClick={() => showGlobalParamSheet()}>
                <MessageSquareCode />
                {t('flow.conversationVariable')}
              </AgentDropdownMenuItem>
              <DropdownMenuSeparator />
              <AgentDropdownMenuItem onClick={showVersionDialog}>
                <History />
                {t('flow.historyVersion')}
              </AgentDropdownMenuItem>
              <DropdownMenuSeparator />
              {isPipeline || (
                <AgentDropdownMenuItem
                  onClick={() => navigateToAgentLogs(id as string)()}
                >
                  <Logs />
                  {t('flow.log')}
                </AgentDropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <AgentDropdownMenuItem onClick={handleExportJson}>
                <Upload />
                {t('flow.export')}
              </AgentDropdownMenuItem>
              <DropdownMenuSeparator />
              <AgentDropdownMenuItem onClick={showSettingDialog}>
                <Settings />
                {t('flow.setting')}
              </AgentDropdownMenuItem>
              {isPipeline ||
                (location.hostname !== DomainHostname && (
                  <>
                    <DropdownMenuSeparator />
                    <AgentDropdownMenuItem onClick={handleEmbedClick}>
                      <ScreenShare />
                      {t('common.embedIntoSite')}
                    </AgentDropdownMenuItem>
                  </>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </PageHeader>
      <OwnerTenantIdContext.Provider value={agentDetail?.tenant_id}>
        <ReactFlowProvider>
          <DropdownProvider>
            <AgentCanvas
              drawerVisible={chatDrawerVisible}
              hideDrawer={hideChatDrawer}
            ></AgentCanvas>
          </DropdownProvider>
        </ReactFlowProvider>
      </OwnerTenantIdContext.Provider>
      {embedVisible && (
        <EmbedDialog
          visible={embedVisible}
          hideModal={hideEmbedModal}
          token={id!}
          from={SharedFrom.Agent}
          beta={beta}
          isAgent
          initialWidgetSettings={initialWidgetSettings}
          onSaveWidgetSettings={handleSaveWidgetSettings}
          savingWidgetSettings={savingWidgetSettings}
        ></EmbedDialog>
      )}
      {versionDialogVisible && (
        <DropdownProvider>
          <VersionDialog hideModal={hideVersionDialog}></VersionDialog>
        </DropdownProvider>
      )}
      {settingDialogVisible && (
        <SettingDialog hideModal={hideSettingDialog}></SettingDialog>
      )}

      {pipelineLogSheetVisible && (
        <PipelineLogSheet
          hideModal={hidePipelineLogSheet}
          isParsing={isParsing}
          isCompleted={isCompleted}
          isLogEmpty={isLogEmpty}
          logs={logs}
          handleCancel={handleCancel}
          messageId={messageId}
          uploadedFileData={uploadedFileData}
        ></PipelineLogSheet>
      )}
      {pipelineRunSheetVisible && (
        <PipelineRunSheet
          hideModal={hidePipelineRunSheet}
          run={runPipeline}
          loading={pipelineRunning}
        ></PipelineRunSheet>
      )}
      {globalParamSheetVisible && (
        <GlobalParamSheet
          data={{}}
          hideModal={hideGlobalParamSheet}
        ></GlobalParamSheet>
      )}
      {webhookTestSheetVisible && (
        <WebhookSheet hideModal={hideWebhookTestSheet}></WebhookSheet>
      )}
    </section>
  );
}
