import { useQuery } from '@tanstack/react-query';
import agentService from '@/services/agent-service';

/** One run record, mirroring the backend `agent_run` row. */
export interface IAgentRun {
  id: string;
  canvas_id: string;
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
