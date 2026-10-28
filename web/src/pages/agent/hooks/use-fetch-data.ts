import { useFetchAgent } from '@/hooks/use-agent-request';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useParams } from 'react-router';
import { dslToGraph } from '../utils/dsl-bridge';
import { useSetGraphInfo } from './use-set-graph';

export const useFetchDataOnMount = () => {
  const { id } = useParams();
  const { loading, data, refetch } = useFetchAgent();
  const setGraphInfo = useSetGraphInfo();

  // The graph store outlives a route transition. Empty it before retrieval
  // nodes mount for the next agent, so they cannot query the previous agent's
  // dataset ids while the new detail request is pending.
  useLayoutEffect(() => {
    if (id) {
      setGraphInfo({ nodes: [], edges: [] });
    }
  }, [id, setGraphInfo]);

  // Every save invalidates the detail query, and each refetch re-tags every
  // message with a fresh uuid, so `data` is always a new object afterwards.
  // Re-seeding unconditionally replaced all nodes/edges, which the autosave
  // watcher reads as a user edit and writes back 20s later — and that write
  // omits `release`, which the backend coerces to false. Net effect: publishing
  // an agent made it fall back to draft on its own. Seed only when the part of
  // the DSL that produces the graph actually changed; `messages` is per-run
  // state that `dslToGraph` ignores, so it must not count as a change.
  const seededSignature = useRef('');

  useEffect(() => {
    if (!data?.dsl) {
      return;
    }
    const graphDsl: Record<string, unknown> = { ...data.dsl };
    delete graphDsl.messages;
    const signature = JSON.stringify([id, graphDsl]);
    if (seededSignature.current === signature) {
      return;
    }
    seededSignature.current = signature;
    setGraphInfo(dslToGraph(data.dsl));
  }, [data, id, setGraphInfo]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { loading, flowDetail: data };
};
