import {
  IEventList,
  INodeData,
  INodeEvent,
  MessageEventType,
} from '@/hooks/use-send-message';
import {
  IThinkingChunk,
  IThinkingStep,
  ThinkingStepStatus,
} from '@/interfaces/database/agent';
import { BeginId } from '@/constants/agent';

export type { IThinkingChunk, IThinkingStep, ThinkingStepStatus };

/** Cap on chunks kept per retrieval step; the rest collapse into a count. */
export const THINKING_CHUNK_LIMIT = 5;

const toNumber = (value: unknown): number | undefined => {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

const normalizeChunks = (raw: unknown): IThinkingChunk[] => {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item, index): IThinkingChunk | null => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const chunk = item as Record<string, unknown>;
      const content = typeof chunk.content === 'string' ? chunk.content : '';
      if (!content) {
        return null;
      }
      const id =
        (typeof chunk.chunk_id === 'string' && chunk.chunk_id) ||
        (typeof chunk.id === 'string' && chunk.id) ||
        `chunk-${index}`;
      return {
        id,
        content,
        similarity:
          toNumber(chunk.similarity) ?? toNumber(chunk.vector_similarity),
        documentId:
          typeof chunk.document_id === 'string' ? chunk.document_id : undefined,
        documentName:
          typeof chunk.document_name === 'string'
            ? chunk.document_name
            : undefined,
      };
    })
    .filter((x): x is IThinkingChunk => x !== null)
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, THINKING_CHUNK_LIMIT);
};

/**
 * Folds the SSE frames of one answer into an ordered list of pipeline steps.
 *
 * The stream carries a `node_started` and a `node_finished` frame per node, in
 * execution order. The Begin node is dropped: it only echoes the question the
 * user already sees above the answer.
 */
export function buildThinkingSteps(eventList?: IEventList): IThinkingStep[] {
  if (!Array.isArray(eventList) || eventList.length === 0) {
    return [];
  }

  const order: string[] = [];
  const steps = new Map<string, IThinkingStep>();

  eventList.forEach((event) => {
    if (
      event?.event !== MessageEventType.NodeStarted &&
      event?.event !== MessageEventType.NodeFinished
    ) {
      return;
    }
    const data = (event as INodeEvent).data as INodeData | undefined;
    const componentId = data?.component_id;
    if (!componentId || componentId === BeginId || data?.component_type === 'Begin') {
      return;
    }

    let step = steps.get(componentId);
    if (!step) {
      step = {
        id: componentId,
        type: data.component_type ?? '',
        name: data.component_name ?? componentId,
        status: 'running',
      };
      steps.set(componentId, step);
      order.push(componentId);
    }

    if (event.event !== MessageEventType.NodeFinished) {
      return;
    }

    step.status = data.error ? 'error' : 'done';
    step.elapsed = toNumber(data.elapsed_time);
    step.error = data.error || undefined;

    const outputs = (data.outputs ?? {}) as Record<string, unknown>;
    const chunks = normalizeChunks(outputs.chunks);
    if (chunks.length > 0) {
      step.chunks = chunks;
      step.chunkCount = Array.isArray(outputs.chunks)
        ? outputs.chunks.length
        : chunks.length;
    }
    if (typeof outputs.category === 'string') {
      step.category = outputs.category;
    }
    if (typeof outputs.content === 'string') {
      step.outputChars = outputs.content.length;
    }
  });

  return order.map((id) => steps.get(id)!);
}

export function totalElapsed(steps: IThinkingStep[]): number {
  return steps.reduce((sum, step) => sum + (step.elapsed ?? 0), 0);
}
