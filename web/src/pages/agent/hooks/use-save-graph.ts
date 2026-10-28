import {
  useFetchAgent,
  useResetAgent,
  useSetAgent,
} from '@/hooks/use-agent-request';
import {
  GlobalVariableType,
  RAGFlowNodeType,
} from '@/interfaces/database/agent';
import { formatDate } from '@/utils/date';
import { useDebounceEffect } from 'ahooks';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import useGraphStore from '../store';
import { useBuildDslData } from './use-build-dsl';

export const useSaveGraph = (
  showMessage: boolean = true,
  skipInvalidation: boolean = false,
) => {
  const { data } = useFetchAgent();
  const { setAgent, loading } = useSetAgent(showMessage, skipInvalidation);
  const { id } = useParams();
  const { buildDslData } = useBuildDslData();

  // Saving is always allowed, even with unresolved canvas issues — those live
  // in the canvas checklist (useCanvasChecklist) which gates the
  // publish/run/embed/explore entry points instead.
  const saveGraph = useCallback(
    async (
      currentNodes?: RAGFlowNodeType[],
      otherParam?: {
        globalVariables: Record<string, GlobalVariableType>;
      },
      release?: boolean,
      remark?: string,
    ) => {
      if (!id) {
        return;
      }

      const params: Record<string, any> = {
        id,
        title: data.title,
        dsl: buildDslData(currentNodes, otherParam),
      };

      if (release) {
        params.release = 'true';
      }
      if (remark) {
        params.remark = remark;
      }

      return setAgent(params);
    },
    [id, data.title, buildDslData, setAgent],
  );

  return { saveGraph, loading };
};

export const useSaveGraphBeforeOpeningDebugDrawer = (show: () => void) => {
  const { saveGraph, loading } = useSaveGraph();
  const { resetAgent } = useResetAgent();

  const handleRun = useCallback(
    async (nextNodes?: RAGFlowNodeType[]) => {
      const saveRet = await saveGraph(nextNodes);
      if (saveRet?.code === 0) {
        // Call the reset api before opening the run drawer each time
        const resetRet = await resetAgent();
        // After resetting, all previous messages will be cleared.
        if (resetRet?.code === 0) {
          show();
        }
      }
    },
    [saveGraph, resetAgent, show],
  );

  return { handleRun, loading };
};

export function shouldAutosaveCanvas({
  chatDrawerVisible,
  agentId,
  agentLoaded,
  nodeCount,
  edgeCount,
}: {
  chatDrawerVisible: boolean;
  agentId?: string;
  agentLoaded: boolean;
  nodeCount: number;
  edgeCount: number;
}): boolean {
  if (chatDrawerVisible) {
    return false;
  }
  if (!agentId || !agentLoaded) {
    return false;
  }
  // An empty store is the Zustand default and also the fallback when DSL has
  // not been applied yet. Autosaving it would PUT components:{} over a real
  // pipeline (#18771). Explicit Save still persists an empty canvas.
  if (nodeCount === 0 && edgeCount === 0) {
    return false;
  }
  return true;
}

/**
 * True when the canvas we are about to write is the one the server already
 * holds. Only `graph` is compared: `components` is a pure function of it
 * (`buildDslComponentsByGraph` reads `node.data.form` and the edges), and the
 * rest of the DSL is spread through from the previous payload untouched.
 */
export function isSameCanvasContent(
  serverDsl: Record<string, any> | undefined,
  nextDsl: Record<string, any> | undefined,
): boolean {
  if (!serverDsl || !nextDsl) {
    return false;
  }
  return JSON.stringify(serverDsl.graph) === JSON.stringify(nextDsl.graph);
}

export const useWatchAgentChange = (chatDrawerVisible: boolean) => {
  const [time, setTime] = useState<string>();
  const { id } = useParams();
  const nodes = useGraphStore((state) => state.nodes);
  const edges = useGraphStore((state) => state.edges);
  const { saveGraph } = useSaveGraph(false, true);
  const { data: flowDetail } = useFetchAgent();
  const { buildDslData } = useBuildDslData();

  const setSaveTime = useCallback((updateTime: number) => {
    setTime(formatDate(updateTime));
  }, []);

  useEffect(() => {
    setSaveTime(flowDetail?.update_time);
  }, [flowDetail, setSaveTime]);

  const saveAgent = useCallback(async () => {
    if (
      !shouldAutosaveCanvas({
        chatDrawerVisible,
        agentId: id,
        agentLoaded: Boolean(flowDetail?.id),
        nodeCount: nodes.length,
        edgeCount: edges.length,
      })
    ) {
      return;
    }
    // The debounce below fires on any nodes/edges reference change, and a
    // refetch re-seeds the store with brand-new node objects — so a publish, a
    // manual save or a window refocus all look like an edit here. Writing that
    // back is not a no-op: the request omits `release`, and the backend coerces
    // an absent release to false, which unpublishes the agent it just
    // published. Skip anything the server already has.
    if (isSameCanvasContent(flowDetail?.dsl, buildDslData())) {
      return;
    }
    const ret = await saveGraph();
    if (ret?.data?.update_time) {
      setSaveTime(ret.data.update_time);
    }
  }, [
    buildDslData,
    chatDrawerVisible,
    edges.length,
    flowDetail?.dsl,
    flowDetail?.id,
    id,
    nodes.length,
    saveGraph,
    setSaveTime,
  ]);

  useDebounceEffect(
    () => {
      saveAgent();
    },
    [nodes, edges],
    {
      wait: 1000 * 20,
    },
  );

  return time;
};
