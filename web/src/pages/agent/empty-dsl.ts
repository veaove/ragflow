import { FileId, initialParserValues } from '@/pages/agent/constant/pipeline';
import {
  AgentDialogueMode,
  BeginId,
  initialAnswerValues,
  initialBeginValues,
  initialEndValues,
} from '@/constants/agent';

const FILE_OPERATOR = 'File';

// Dataflow seed DSL. Kept separate from UI hooks so pure DSL helpers
// can import it without pulling React modules into tests/runtime.
export const DataflowEmptyDsl = {
  graph: {
    nodes: [
      {
        id: FileId,
        type: 'beginNode',
        position: {
          x: 50,
          y: 200,
        },
        data: {
          label: FILE_OPERATOR,
          name: FILE_OPERATOR,
        },
        sourcePosition: 'left',
        targetPosition: 'right',
      },
      {
        data: {
          form: initialParserValues,
          label: 'Parser',
          name: 'Parser',
        },
        dragging: false,
        id: 'Parser:HipSignsRhyme',
        measured: {
          height: 57,
          width: 200,
        },
        position: {
          x: 316.99524094206413,
          y: 195.39629819663406,
        },
        selected: true,
        sourcePosition: 'right',
        targetPosition: 'left',
        type: 'parserNode',
      },
    ],
    edges: [
      {
        id: 'xy-edge__Filestart-Parser:HipSignsRhymeend',
        source: FileId,
        sourceHandle: 'start',
        target: 'Parser:HipSignsRhyme',
        targetHandle: 'end',
      },
    ],
  },
  components: {
    [FILE_OPERATOR]: {
      obj: {
        component_name: FILE_OPERATOR,
        params: {},
      },
      downstream: [],
      upstream: [],
    },
  },
  retrieval: [],
  history: [],
  path: [],
  globals: {},
  variables: [],
};

// ── 工作室（Chatflow / Workflow）的空图种子 ──
//
// 之前创建工作室应用时统一用 agent 的空图（`initialEmptyDsl(true)`），
// 而那个种子的 Begin 节点 mode 是 conversational，导致「任务流」创建出来
// 自带一个「对话式」的开始节点 —— 形态和画布语义从一开始就是错的。
// `initialEmptyDsl(false)` 给的是数据管道（File + Parser），更不对。
//
// 所以这里按形态各给一个种子：
//   Chatflow: Begin(conversational) → Answer   （对话式，流式回答）
//   Workflow: Begin(task)          → End       （无对话，结构化输出）
// 终止节点用通用 ragNode 渲染（NodeMap 未映射时的既有 fallback），
// component_name 写后端注册名（End / Answer），保证编译期能识别。

const studioBeginNode = (mode: AgentDialogueMode) => ({
  id: BeginId,
  type: 'beginNode',
  position: { x: 50, y: 200 },
  data: {
    label: 'Begin',
    name: 'begin',
    form: {
      ...initialBeginValues,
      mode,
      // Workflow 没有开场白概念，留空避免界面出现无意义的问候语。
      prologue: mode === AgentDialogueMode.Task ? '' : initialBeginValues.prologue,
    },
  },
  sourcePosition: 'left',
  targetPosition: 'right',
});

const studioTerminalNode = (
  id: string,
  componentName: 'End' | 'Answer',
  form: Record<string, unknown>,
) => ({
  id,
  type: 'ragNode',
  position: { x: 420, y: 200 },
  data: { label: componentName, name: id, form },
  sourcePosition: 'left',
  targetPosition: 'right',
});

const studioDsl = (beginMode: AgentDialogueMode, terminal: 'End' | 'Answer') => {
  const terminalId = terminal.toLowerCase();
  const terminalForm =
    terminal === 'End' ? initialEndValues : initialAnswerValues;
  return {
    graph: {
      nodes: [studioBeginNode(beginMode), studioTerminalNode(terminalId, terminal, terminalForm)],
      edges: [
        {
          id: `xy-edge__${BeginId}start-${terminalId}end`,
          source: BeginId,
          sourceHandle: 'start',
          target: terminalId,
          targetHandle: 'end',
        },
      ],
    },
    components: {
      begin: {
        obj: { component_name: 'Begin', params: {} },
        downstream: [terminalId],
        upstream: [],
      },
      [terminalId]: {
        obj: { component_name: terminal, params: {} },
        downstream: [],
        upstream: [BeginId],
      },
    },
    retrieval: [],
    history: [],
    path: [],
    variables: [],
    globals: {},
  };
};

/** 对话流：Begin(对话式) → Answer */
export const ChatflowEmptyDsl = studioDsl(AgentDialogueMode.Conversational, 'Answer');

/** 任务流：Begin(任务式) → End */
export const WorkflowEmptyDsl = studioDsl(AgentDialogueMode.Task, 'End');
