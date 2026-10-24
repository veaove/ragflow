import { useQuery } from '@tanstack/react-query';
import agentService from '@/services/agent-service';

/** One run record, mirroring the backend `agent_run` row. */
export interface IAgentRun {
  id: string;
  canvas_id: string;
  /**
   * 应用名。后端 LEFT JOIN user_canvas 得到；画布已删除时是空串，
   * 展示侧需回退到 canvas_id。
   */
  canvas_title?: string;
  tenant_id: string;
  version_seq: number;
  trigger_type: string;
  status: string;
  error_code?: string;
  error_message?: string;
  duration_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  conversation_id?: string;
  created_by?: string;
  create_time: number;
}

export type RunSortKey =
  | 'created_desc'
  | 'duration_desc'
  | 'duration_asc'
  | 'tokens_desc';

export const RUN_SORT_OPTIONS: {
  key: RunSortKey;
  labelKey: string;
}[] = [
  { key: 'created_desc', labelKey: 'studio.runSortRecent' },
  { key: 'duration_desc', labelKey: 'studio.runSortSlowest' },
  { key: 'duration_asc', labelKey: 'studio.runSortFastest' },
  { key: 'tokens_desc', labelKey: 'studio.runSortTokens' },
];

export const RUN_STATUS_OPTIONS = ['running', 'succeeded', 'failed'];

export const RUN_TRIGGER_OPTIONS = ['debug', 'api', 'schedule', 'webhook'];

export function useFetchRuns(params: {
  keywords?: string;
  canvasId?: string;
  status?: string;
  triggerType?: string;
  sort?: RunSortKey;
  page: number;
  pageSize: number;
}) {
  const { keywords, canvasId, status, triggerType, sort, page, pageSize } =
    params;

  const { data, isFetching: loading } = useQuery<{
    runs: IAgentRun[];
    total: number;
  }>({
    queryKey: [
      'agent-runs',
      keywords,
      canvasId,
      status,
      triggerType,
      sort,
      page,
      pageSize,
    ],
    placeholderData: (previousData) => previousData ?? { runs: [], total: 0 },
    gcTime: 0,
    queryFn: async () => {
      const { data } = await agentService.listRuns(
        {
          params: {
            keywords: keywords || undefined,
            canvas_id: canvasId || undefined,
            status: status || undefined,
            trigger_type: triggerType || undefined,
            sort: sort || undefined,
            page,
            page_size: pageSize,
          },
        },
        true,
      );
      return data?.data ?? { runs: [], total: 0 };
    },
  });

  return {
    runs: data?.runs ?? [],
    total: data?.total ?? 0,
    loading,
  };
}

/** 一次运行的完整记录。列表接口不返回 inputs/outputs，详情单独取。 */
export interface IAgentRunDetail extends IAgentRun {
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
}

/** 单个节点的执行记录（agent_node_execution）。 */
export interface IAgentRunNode {
  id: string;
  run_id: string;
  canvas_id: string;
  node_id: string;
  node_type: string;
  status: string;
  inputs?: Record<string, unknown>;
  process?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  error_code?: string;
  error_message?: string;
  duration_ms: number;
  retry_count: number;
  create_time: number;
}

/** 单次运行的详情。runId 为空时不发请求。 */
export function useFetchRunDetail(runId?: string) {
  const { data, isFetching: loading } = useQuery<IAgentRunDetail | null>({
    queryKey: ['agent-run-detail', runId],
    enabled: !!runId,
    gcTime: 0,
    queryFn: async () => {
      const { data } = await agentService.getRun({ runId: runId as string }, true);
      return data?.data ?? null;
    },
  });

  return { detail: data ?? null, loading };
}

/** 单次运行的节点执行记录。runId 为空时不发请求。 */
export function useFetchRunNodes(runId?: string) {
  const { data, isFetching: loading } = useQuery<IAgentRunNode[]>({
    queryKey: ['agent-run-nodes', runId],
    enabled: !!runId,
    gcTime: 0,
    queryFn: async () => {
      const { data } = await agentService.getRunNodes(
        { runId: runId as string },
        true,
      );
      return data?.data ?? [];
    },
  });

  return { nodes: data ?? [], loading };
}

/**
 * canvas_id → 应用名 映射。
 *
 * 运行日志接口已带 canvas_title（后端 LEFT JOIN user_canvas），但该改动在
 * 部分部署里还没生效，页面会退化成一列 UUID。这里用应用列表兜底：
 * canvas_title 有值时优先用它，没有才查这张表。
 */
export function useAgentTitleMap() {
  const { data } = useQuery<Record<string, string>>({
    queryKey: ['agent-title-map'],
    gcTime: 0,
    queryFn: async () => {
      const { data } = await agentService.listAgents(
        { params: { page: 1, page_size: 200 } },
        true,
      );
      const payload = data?.data as
        | { canvas?: { id?: string; title?: string }[] }
        | undefined;
      const list = payload?.canvas ?? [];
      return Object.fromEntries(
        list
          .filter((item) => item.id)
          .map((item) => [item.id as string, item.title ?? '']),
      );
    },
  });

  return data ?? {};
}
