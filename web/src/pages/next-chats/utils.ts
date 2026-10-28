import { NextMessageInputOnPressEnterParameter } from '@/components/message-input/next';
import { EmptyConversationId } from '@/constants/chat';
import { IThinkingStep } from '@/interfaces/database/agent';
import { IConversation, IReference } from '@/interfaces/database/chat';
import storage from '@/utils/authorization-util';

/**
 * Regenerate is triggered from the transcript, which has no access to the input
 * box's thinking / internet toggles, so callers replay the options of their last
 * send. A view that hasn't sent anything yet has no record: fall back to the
 * input box's own defaults — it re-reads the persisted thinking level and starts
 * with internet off, so both stay in sync after a remount.
 */
export function resolveResendOptions(
  lastSendOptions: NextMessageInputOnPressEnterParameter,
): NextMessageInputOnPressEnterParameter {
  const {
    enableThinking = storage.getThinkingLevel(),
    enableInternet = false,
  } = lastSendOptions;

  return { enableThinking, enableInternet };
}

export const isConversationIdExist = (conversationId: string) => {
  return conversationId !== EmptyConversationId && conversationId !== '';
};

export const getDocumentIdsFromConversionReference = (data: IConversation) => {
  const documentIds = data.reference.reduce(
    (pre: Array<string>, cur: IReference) => {
      cur.doc_aggs
        ?.map((x) => x.doc_id)
        .forEach((x) => {
          if (pre.every((y) => y !== x)) {
            pre.push(x);
          }
        });
      return pre;
    },
    [],
  );
  return documentIds.join(',');
};

// Shared fallback so a message without a reference keeps handing MessageItem the
// same object across renders. A fresh literal here would break the item's memo
// on every streaming flush. See useMessageReferences.
/**
 * 把知识问答的引用结果折叠成「检索过程」面板要的步骤。
 *
 * 为什么复用 IThinkingStep：ThinkingPanel 的视觉（折叠行 + 命中切片 + 查看原文）
 * 已经打磨过，stepLabel 按 type 查表，`retrieval` / `agent` 能直接命中现有翻译。
 * 硬造一套并行类型只会让两个页面的样式慢慢分叉。
 *
 * 和智能体的差别要说清楚：Chat 应用走 RAG 问答链路，不产生节点事件，
 * 所以**没有 elapsed（各步耗时）**，只能是「检索命中几条、生成了多少字」。
 * 这里不编造耗时——假的 0.4 秒比不显示更糟。
 */
export const buildRetrievalSteps = (
  reference: IReference,
  answer: string,
): IThinkingStep[] => {
  const steps: IThinkingStep[] = [];
  const chunks = reference?.chunks ?? [];

  if (chunks.length > 0) {
    steps.push({
      id: 'retrieval',
      type: 'retrieval',
      name: 'retrieval',
      status: 'done',
      chunkCount: reference.total || chunks.length,
      chunks: chunks.map((chunk) => ({
        id: chunk.id,
        content: chunk.content ?? '',
        similarity: chunk.similarity,
        documentId: chunk.document_id,
        documentName: chunk.document_name,
      })),
    });
  }

  if (answer) {
    steps.push({
      id: 'answer',
      type: 'agent',
      name: 'answer',
      status: 'done',
      outputChars: answer.length,
    });
  }

  return steps;
};

export const EmptyReference: IReference = {
  doc_aggs: [],
  chunks: [],
  total: 0,
};
