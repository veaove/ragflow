import { useCallback, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';
import api from '@/utils/api';
import request from '@/utils/request';

const PREVIEW_MAX = 40;

type ConversationDetail = {
  question?: string;
  answer?: string;
};

/**
 * 记忆消息列表的「会话预览」单元格。
 *
 * 两条数据路径，刻意分开：
 * - 列表已经带回 `session_question`（后端一次批量查出来的），所以单元格第一次
 *   渲染就有字，不需要等 hover，也不会因为逐行请求而让表格卡顿。
 * - hover 时才请求完整的一问一答（懒加载），打开表格时不会把整页会话都读一遍。
 */
export function SessionPreviewCell({
  sessionID,
  preview,
}: {
  sessionID?: string;
  preview?: string;
}) {
  const { t } = useTranslation();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const memoryID = searchParams.get('id') || id;

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);

  const loadDetail = useCallback(async () => {
    // 已经取过就不再请求（同一个 session 在一页里可能重复出现）。
    if (detail || loading || !sessionID || !memoryID) {
      return;
    }
    setLoading(true);
    try {
      const { data } = await request.get(
        api.getSessionConversation(memoryID, sessionID),
      );
      setDetail((data as { data?: ConversationDetail })?.data ?? {});
    } catch {
      setDetail({});
    } finally {
      setLoading(false);
    }
  }, [detail, loading, memoryID, sessionID]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) {
        loadDetail();
      }
    },
    [loadDetail],
  );

  const raw = (preview ?? '').trim();
  const truncated =
    raw.length > PREVIEW_MAX ? `${raw.slice(0, PREVIEW_MAX)}…` : raw;

  return (
    <HoverCard open={open} onOpenChange={handleOpenChange} openDelay={150}>
      <HoverCardTrigger asChild>
        <span
          className={
            'block max-w-[220px] cursor-default truncate text-sm ' +
            (truncated ? '' : 'text-text-secondary')
          }
          title={raw || undefined}
        >
          {truncated || t('memory.messages.noSessionContent')}
        </span>
      </HoverCardTrigger>
      <HoverCardContent className="w-80" align="start">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 className="size-4 animate-spin" />
            {t('common.loading')}
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            {detail?.question ? (
              <div>
                <div className="mb-0.5 text-xs text-text-secondary">
                  {t('memory.messages.sessionQuestion')}
                </div>
                <div className="whitespace-pre-wrap break-words">
                  {detail.question}
                </div>
              </div>
            ) : null}
            {detail?.answer ? (
              <div>
                <div className="mb-0.5 text-xs text-text-secondary">
                  {t('memory.messages.sessionAnswer')}
                </div>
                <div className="whitespace-pre-wrap break-words text-text-secondary">
                  {detail.answer}
                </div>
              </div>
            ) : null}
            {!detail?.question && !detail?.answer ? (
              <div className="text-text-secondary">
                {t('memory.messages.noSessionContent')}
              </div>
            ) : null}
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}
