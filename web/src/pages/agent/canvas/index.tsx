import { useTheme } from '@/components/theme-provider';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useSetModalState } from '@/hooks/common-hooks';
import { cn } from '@/lib/utils';
import {
  ConnectionMode,
  ControlButton,
  Controls,
  NodeTypes,
  Position,
  ReactFlow,
  ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { NotebookPen } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChatSheet } from '../chat/chat-sheet';
import {
  AgentChatContext,
  AgentChatLogContext,
  AgentInstanceContext,
  CanvasReadonlyContext,
  HandleContext,
} from '../context';

import FormSheet from '../form-sheet/next';
import { useIsPipeline } from '../hooks/use-is-pipeline';
import { hasPipelineNextOperators } from '../utils/pipeline-connection';
import { useSelectCanvasData, useValidateConnection } from '../hooks';
import { useAddNode } from '../hooks/use-add-node';
import { useBeforeDelete } from '../hooks/use-before-delete';
import { useCacheChatLog } from '../hooks/use-cache-chat-log';
import { useConnectionDrag } from '../hooks/use-connection-drag';
import { Operator } from '../constant';
import { useDropdownPosition } from '../hooks/use-dropdown-position';
import useGraphStore from '../store';
import { useMoveNote } from '../hooks/use-move-note';
import { usePlaceholderManager } from '../hooks/use-placeholder-manager';
import { useDropdownManager } from './context';

import { AgentBackground } from '@/components/canvas/background';
import Spotlight from '@/components/spotlight';
import { useNodeFocusRequest } from '../hooks/use-node-focus-request';
import { useNodeLoading } from '../hooks/use-node-loading';
import {
  useHideFormSheetOnNodeDeletion,
  useShowDrawer,
} from '../hooks/use-show-drawer';
import { useStopMessageUnmount } from '../hooks/use-stop-message';
import { LogSheet } from '../log-sheet';
import RunSheet from '../run-sheet';
import { ButtonEdge } from './edge';
import { ReadonlyEdge } from './edge/readonly-edge';
import styles from './index.module.less';
import { CanvasSkinToggle } from './canvas-skin-toggle';
import { useCanvasSkin } from './use-canvas-skin';
import { RagNode } from './node';
import { StudioNode } from './node/studio-node';
import { NodeContextMenu, INodeContextMenu } from './context-menu';
import { AgentNode } from './node/agent-node';
import { BeginNode } from './node/begin-node';
import { CategorizeNode } from './node/categorize-node';
import { ChunkerNode } from './node/chunker-node';
import { CompilationNode } from './node/compilation-node';
import { DataOperationsNode } from './node/data-operations-node';
import { NextStepDropdown } from './node/dropdown/next-step-dropdown';
import { ExitLoopNode } from './node/exit-loop-node';
import { ExtractorNode } from './node/extractor-node';
import { FileNode } from './node/file-node';
import { IterationNode, IterationStartNode } from './node/iteration-node';
import { KeywordNode } from './node/keyword-node';
import { ListOperationsNode } from './node/list-operations-node';
import { LoopNode, LoopStartNode } from './node/loop-node';
import { MessageNode } from './node/message-node';
import NoteNode from './node/note-node';
import ParserNode from './node/parser-node';
import { PlaceholderNode } from './node/placeholder-node';
import { RetrievalNode } from './node/retrieval-node';
import { RewriteNode } from './node/rewrite-node';
import { SwitchNode } from './node/switch-node';
import TokenizerNode from './node/tokenizer-node';
import { ToolNode } from './node/tool-node';
import { VariableAggregatorNode } from './node/variable-aggregator-node';
import { VariableAssignerNode } from './node/variable-assigner-node';

export const nodeTypes: NodeTypes = {
  ragNode: RagNode,
  studioNode: StudioNode,
  categorizeNode: CategorizeNode,
  beginNode: BeginNode,
  placeholderNode: PlaceholderNode,
  noteNode: NoteNode,
  switchNode: SwitchNode,
  retrievalNode: RetrievalNode,
  messageNode: MessageNode,
  rewriteNode: RewriteNode,
  keywordNode: KeywordNode,
  // emailNode: EmailNode,
  iterationNode: IterationNode,
  iterationStartNode: IterationStartNode,
  agentNode: AgentNode,
  toolNode: ToolNode,
  fileNode: FileNode,
  parserNode: ParserNode,
  tokenizerNode: TokenizerNode,
  chunkerNode: ChunkerNode,
  compilationNode: CompilationNode,
  contextNode: ExtractorNode,
  dataOperationsNode: DataOperationsNode,
  listOperationsNode: ListOperationsNode,
  variableAssignerNode: VariableAssignerNode,
  variableAggregatorNode: VariableAggregatorNode,
  loopNode: LoopNode,
  loopStartNode: LoopStartNode,
  exitLoopNode: ExitLoopNode,
};

const edgeTypes = {
  buttonEdge: ButtonEdge,
};

// ReadonlyEdgeTypes swaps ButtonEdge for ReadonlyEdge on the read-only canvas.
// The mapping covers both the persisted edge `type: 'buttonEdge'` in DSL graph
// data and `defaultEdgeOptions.type`, so every edge renders without the delete
// button and without ButtonEdge's useFetchAgent call (a built-in pipeline id
// would 404 against GET /agents/:id).
const ReadonlyEdgeTypes = {
  buttonEdge: ReadonlyEdge,
};

interface IProps {
  drawerVisible?: boolean;
  hideDrawer?: () => void;
  readOnly?: boolean;
  /**
   * 画布左侧插槽。工作室要放节点面板，智能体不传 → 什么都不渲染。
   *
   * 为什么用插槽而不是在画布里直接判断形态：这个画布是工作室和智能体共用的，
   * 一旦在这里写形态分支，两边就会互相影响（节点面板会出现在智能体上）。
   * 页面决定放什么，画布只负责在 AgentInstanceContext 内部渲染——面板需要
   * 那个 context 才能调 addCanvasNode。
   */
  sidebar?: React.ReactNode;
  /**
   * 是否启用节点右键菜单（复制 / 删除）。工作室开启，智能体默认关闭——
   * 避免给智能体画布引入它没要求的交互。
   */
  enableContextMenu?: boolean;
}

const NoopDrawer = () => {};

function AgentCanvas({
  drawerVisible = false,
  hideDrawer = NoopDrawer,
  readOnly = false,
  sidebar,
  enableContextMenu = false,
}: IProps) {
  const { t } = useTranslation();
  const {
    nodes,
    edges,
    onConnect: originalOnConnect,
    onEdgesChange,
    onNodesChange,
    onSelectionChange,
    onEdgeMouseEnter,
    onEdgeMouseLeave,
  } = useSelectCanvasData();
  const isValidConnection = useValidateConnection();

  const [reactFlowInstance, setReactFlowInstance] =
    useState<ReactFlowInstance<any, any>>();
  const [contextMenu, setContextMenu] = useState<INodeContextMenu | null>(null);

  const {
    addEventList,
    setCurrentMessageId,
    currentEventListWithoutMessageById,
    currentEventListWithoutMessage,
    clearEventList,
    currentMessageId,
    latestTaskId,
  } = useCacheChatLog();

  const {
    onNodeClick,
    clickedNode,
    formDrawerVisible,
    hideFormDrawer,
    singleDebugDrawerVisible,
    hideSingleDebugDrawer,
    showSingleDebugDrawer,
    chatVisible,
    runVisible,
    hideRunOrChatDrawer,
    showChatModal,
    showFormDrawer,
    showFormDrawerById,
    logSheetVisible,
    showLogSheet,
    hideLogSheet,
  } = useShowDrawer({
    drawerVisible,
    hideDrawer,
    setCurrentMessageId,
  });

  const [lastSendLoading, setLastSendLoading] = useState(false);

  // 当前执行到的节点：取本轮对话最后一条节点事件的 component_id。
  // 换消息时 currentEventListWithoutMessage 会变，等于每轮对话重新开始。
  const activeNodeId = useMemo(() => {
    const list = currentEventListWithoutMessage ?? [];
    const last = list[list.length - 1];
    return (last as { data?: { component_id?: string } })?.data?.component_id ?? '';
  }, [currentEventListWithoutMessage]);

  // 高亮直接操作 react-flow 的节点 DOM。
  // 节点组件有七八个（begin/agent/switch/retrieval/...），逐个加 prop 改动面太大，
  // react-flow 给每个节点都渲染了 .react-flow__node[data-id=<节点id>]，从容器层统一处理。
  useEffect(() => {
    const nodes = document.querySelectorAll<HTMLElement>('.react-flow__node');
    nodes.forEach((node) => {
      node.style.boxShadow = '';
      node.style.borderRadius = '';
    });
    if (!activeNodeId) {
      return;
    }
    const target = document.querySelector<HTMLElement>(
      `.react-flow__node[data-id="${activeNodeId}"]`,
    );
    if (target) {
      target.style.boxShadow =
        '0 0 0 2px #6366f1, 0 0 16px rgba(99, 102, 241, 0.55)';
      target.style.borderRadius = '8px';
      target.style.transition = 'box-shadow 0.2s ease';
    }
  }, [activeNodeId]);

  const [currentSendLoading, setCurrentSendLoading] = useState(false);

  const { stopMessage } = useStopMessageUnmount(
    chatVisible && currentSendLoading,
    latestTaskId,
  );

  const { handleBeforeDelete } = useBeforeDelete();

  const { addCanvasNode, addNoteNode } = useAddNode(reactFlowInstance);

  const { ref, showImage, hideImage, imgVisible, mouse } = useMoveNote();

  const { theme } = useTheme();

  // 画布皮肤（复古 / 科技）只是展示偏好，存 localStorage，不写 DSL。
  const { skin } = useCanvasSkin();

  useEffect(() => {
    if (!chatVisible) {
      if (currentSendLoading) {
        stopMessage(latestTaskId);
      }
      clearEventList();
    }
  }, [
    chatVisible,
    clearEventList,
    currentSendLoading,
    latestTaskId,
    stopMessage,
  ]);

  const setLastSendLoadingFunc = (loading: boolean, messageId: string) => {
    setCurrentSendLoading(!!loading);
    if (messageId === currentMessageId) {
      setLastSendLoading(loading);
    } else {
      setLastSendLoading(false);
    }
  };

  useHideFormSheetOnNodeDeletion({ hideFormDrawer });

  // Focus requests posted through the store (e.g. by the canvas checklist in
  // the page header): select + center the node, and open its form sheet unless
  // the caller only wants the highlight (orphan-step issues).
  useNodeFocusRequest({ reactFlowInstance, showFormDrawerById });

  const { visible, hideModal, showModal } = useSetModalState();
  const [dropdownPosition, setDropdownPosition] = useState({ x: 0, y: 0 });

  const { clearActiveDropdown } = useDropdownManager();

  const {
    removePlaceholderNode,
    onNodeCreated,
    setCreatedPlaceholderRef,
    checkAndRemoveExistingPlaceholder,
  } = usePlaceholderManager(reactFlowInstance);

  const { calculateDropdownPosition } = useDropdownPosition(reactFlowInstance);

  const isPipeline = useIsPipeline();
  const { findNodeByName, getOperatorTypeFromId } = useGraphStore(
    (state) => state,
  );

  // Whether the "next step" menu offers anything for the drag source. On a
  // pipeline, single-instance operators already on canvas plus the
  // topology rules can leave the menu empty; such a drag is aborted.
  const hasNextStepOperators = useCallback(
    (sourceNodeId: string) => {
      if (!isPipeline) {
        return true;
      }
      return hasPipelineNextOperators(
        getOperatorTypeFromId(sourceNodeId) as Operator | undefined,
        (operator) => !!findNodeByName(operator),
      );
    },
    [findNodeByName, getOperatorTypeFromId, isPipeline],
  );

  const {
    onConnectStart,
    onConnectEnd,
    handleConnect,
    getConnectionStartContext,
    shouldPreventClose,
    onMove,
    nodeId,
  } = useConnectionDrag(
    originalOnConnect,
    showModal,
    hideModal,
    setDropdownPosition,
    setCreatedPlaceholderRef,
    calculateDropdownPosition,
    removePlaceholderNode,
    clearActiveDropdown,
    checkAndRemoveExistingPlaceholder,
    reactFlowInstance,
    hasNextStepOperators,
  );

  const onPaneClick = useCallback(() => {
    if (enableContextMenu) {
      setContextMenu(null);
    }
    hideFormDrawer();
    if (visible && !shouldPreventClose()) {
      removePlaceholderNode();
      hideModal();
      clearActiveDropdown();
    }
    if (imgVisible) {
      addNoteNode(mouse);
      hideImage();
    }
  }, [
    hideFormDrawer,
    visible,
    shouldPreventClose,
    hideModal,
    imgVisible,
    addNoteNode,
    mouse,
    hideImage,
    clearActiveDropdown,
    removePlaceholderNode,
    enableContextMenu,
  ]);
  const { lastNode, setDerivedMessages, startButNotFinishedNodeIds } =
    useNodeLoading({
      currentEventListWithoutMessageById,
    });
  return (
    <div
      className={cn(styles.canvasWrapper, 'px-5 pb-5')}
      // 皮肤钩子：canvas-skin.css 的所有科技风规则都以这个属性为前提，
      // legacy 时它们全部不生效，旧样式逐像素保留。
      data-canvas-skin={skin}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        style={{ position: 'absolute', top: 10, left: 0 }}
      >
        <defs>
          <marker
            fill="rgb(var(--accent-primary))"
            id="selected-marker"
            viewBox="0 0 40 40"
            refX="8"
            refY="5"
            markerUnits="strokeWidth"
            markerWidth="20"
            markerHeight="20"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
          <marker
            fill="var(--text-disabled)"
            id="logo"
            viewBox="0 0 40 40"
            refX="8"
            refY="5"
            markerUnits="strokeWidth"
            markerWidth="20"
            markerHeight="20"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
        </defs>
      </svg>
      <CanvasReadonlyContext.Provider value={readOnly}>
        <AgentInstanceContext.Provider
          value={{
            addCanvasNode,
            showFormDrawer,
            lastNode,
            currentSendLoading,
            startButNotFinishedNodeIds,
          }}
        >
          <ReactFlow
            connectionMode={ConnectionMode.Loose}
            nodes={nodes}
            onNodesChange={onNodesChange}
            edges={edges}
            onEdgesChange={onEdgesChange}
            fitView
            onConnect={readOnly ? undefined : handleConnect}
            nodeTypes={nodeTypes}
            edgeTypes={readOnly ? ReadonlyEdgeTypes : edgeTypes}
            onConnectStart={readOnly ? undefined : onConnectStart}
            onConnectEnd={readOnly ? undefined : onConnectEnd}
            onMove={onMove}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onNodeContextMenu={(event, node) => {
              if (!enableContextMenu) {
                return;
              }
              event.preventDefault();
              setContextMenu({
                id: node.id,
                top: event.clientY,
                left: event.clientX,
              });
            }}
            onInit={setReactFlowInstance}
            onSelectionChange={onSelectionChange}
            nodeOrigin={[0.5, 0]}
            isValidConnection={isValidConnection}
            onEdgeMouseEnter={onEdgeMouseEnter}
            onEdgeMouseLeave={onEdgeMouseLeave}
            className="h-full"
            colorMode={theme}
            defaultEdgeOptions={{
              type: 'buttonEdge',
              markerEnd: 'logo',
              zIndex: 1001, // https://github.com/xyflow/xyflow/discussions/3498
            }}
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            deleteKeyCode={readOnly ? null : ['Delete', 'Backspace']}
            onBeforeDelete={handleBeforeDelete}
            panActivationKeyCode={null}
            // 右下角那块灰斑是 xyflow 自带的 "React Flow" 水印（深色模式下
            // 背景是 rgba(150,150,150,.25)、字色 #999，在星空底上只剩一块
            // 说不清是什么的半透明方块）。xyflow 是 MIT，允许关掉。
            proOptions={{ hideAttribution: true }}
          >
            {!readOnly && sidebar}
            {enableContextMenu && contextMenu && (
              <NodeContextMenu {...contextMenu} />
            )}
            <AgentBackground skin={skin}></AgentBackground>
            {/* 科技风自带星海与光晕，再叠 Spotlight 会糊成一片 */}
            {skin === 'legacy' && (
              <Spotlight className="z-0" opcity={0.7} coverage={70} />
            )}
            <Controls
              position={'bottom-center'}
              orientation="horizontal"
              className="bg-bg-base px-4 py-2 h-auto w-auto [&>button]:bg-transparent [&>button]:border-0 [&>button]:text-text-primary [&>button]:hover:bg-bg-base-hover [&>button]:hover:text-text-primary [&>button]:active:bg-bg-base-active [&>button]:p-0 [&>button]:size-4 gap-2.5 rounded-md"
            >
              {!readOnly && (
                <ControlButton>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <NotebookPen className="!fill-none" onClick={showImage} />
                    </TooltipTrigger>
                    <TooltipContent>{t('flow.note')}</TooltipContent>
                  </Tooltip>
                </ControlButton>
              )}
            </Controls>
          </ReactFlow>
          {!readOnly && <CanvasSkinToggle />}
          {!readOnly && visible && (
            <HandleContext.Provider
              value={
                getConnectionStartContext() || {
                  nodeId: '',
                  id: '',
                  type: 'source',
                  position: Position.Right,
                  isFromConnectionDrag: true,
                }
              }
            >
              <NextStepDropdown
                hideModal={() => {
                  removePlaceholderNode();
                  hideModal();
                  clearActiveDropdown();
                }}
                position={dropdownPosition}
                onNodeCreated={onNodeCreated}
                nodeId={nodeId}
              >
                <span></span>
              </NextStepDropdown>
            </HandleContext.Provider>
          )}
        </AgentInstanceContext.Provider>
        <NotebookPen
          className={cn('hidden absolute size-6', { block: imgVisible })}
          ref={ref}
        ></NotebookPen>
        {formDrawerVisible && (
          <AgentInstanceContext.Provider
            value={{ addCanvasNode, showFormDrawer }}
          >
            <FormSheet
              node={clickedNode}
              visible={formDrawerVisible}
              hideModal={hideFormDrawer}
              chatVisible={chatVisible}
              singleDebugDrawerVisible={singleDebugDrawerVisible}
              hideSingleDebugDrawer={hideSingleDebugDrawer}
              showSingleDebugDrawer={showSingleDebugDrawer}
              readOnly={readOnly}
            ></FormSheet>
          </AgentInstanceContext.Provider>
        )}

        {chatVisible && (
          <AgentChatContext.Provider
            value={{ showLogSheet, setLastSendLoadingFunc, setDerivedMessages }}
          >
            <AgentChatLogContext.Provider
              value={{ addEventList, setCurrentMessageId }}
            >
              <ChatSheet
                hideModal={() => {
                  hideRunOrChatDrawer();
                  hideLogSheet();
                }}
              ></ChatSheet>
            </AgentChatLogContext.Provider>
          </AgentChatContext.Provider>
        )}
        {runVisible && (
          <RunSheet
            hideModal={hideRunOrChatDrawer}
            showModal={showChatModal}
          ></RunSheet>
        )}
        {logSheetVisible && (
          <LogSheet
            hideModal={hideLogSheet}
            currentEventListWithoutMessageById={
              currentEventListWithoutMessageById
            }
            currentMessageId={currentMessageId}
            sendLoading={lastSendLoading}
          ></LogSheet>
        )}
      </CanvasReadonlyContext.Provider>
    </div>
  );
}

export default AgentCanvas;
