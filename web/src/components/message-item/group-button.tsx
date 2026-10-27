/*
 *  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

import { PromptIcon } from '@/assets/icon/next-icon';
import CopyToClipboard from '@/components/copy-to-clipboard';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useSetModalState } from '@/hooks/common-hooks';
import { IRemoveMessageById } from '@/hooks/logic-hooks';
import { cn } from '@/lib/utils';
import { removeThinkSection } from '@/utils/chat';
import {
  LucidePauseCircle,
  LucideRefreshCw,
  LucideThumbsDown,
  LucideThumbsUp,
  LucideTrash2,
  LucideVolume2,
} from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import FeedbackDialog from '../feedback-dialog';
import { PromptDialog } from '../prompt-dialog';
import { Button } from '../ui/button';
import { useRemoveMessage, useSendFeedback, useSpeech } from './hooks';

interface IProps {
  messageId: string;
  content: string;
  prompt?: string;
  showLikeButton: boolean;
  /** 当前回答的点赞状态（来自 conversation_message.thumb_up）。 */
  thumbup?: boolean;
  /** 点赞状态变化的本地回调，用于乐观更新 / 失败回滚。 */
  onThumbupChange?: (next: boolean) => void;
  /** 是否已差评（thumb_up=false 且 feedback 非空）。 */
  thumbdown?: boolean;
  /** 差评状态变化的本地回调。 */
  onThumbdownChange?: (next: boolean) => void;
  audioBinary?: string;
  showLoudspeaker?: boolean;
}

export const AssistantGroupButton = ({
  messageId,
  content,
  prompt,
  audioBinary,
  showLikeButton,
  thumbup = false,
  onThumbupChange,
  thumbdown = false,
  onThumbdownChange,
  showLoudspeaker = true,
}: IProps) => {
  const { visible, hideModal, showModal, onFeedbackOk, loading } =
    useSendFeedback(messageId);
  const {
    visible: promptVisible,
    hideModal: hidePromptModal,
    showModal: showPromptModal,
  } = useSetModalState();
  const { t } = useTranslation();
  const { handleRead, isPlaying } = useSpeech(content, audioBinary);

  const copyText = useMemo(() => removeThinkSection(content), [content]);

  // 抖音式点赞：点一次点赞，再点一次取消；先本地翻转，失败回滚。
  const handleLike = useCallback(async () => {
    const next = !thumbup;
    onThumbupChange?.(next);
    if (next) {
      onThumbdownChange?.(false);
    }
    const ret = await onFeedbackOk({ thumbup: next });
    if (ret !== 0) {
      onThumbupChange?.(!next);
      if (next) {
        onThumbdownChange?.(thumbdown);
      }
    }
  }, [thumbup, thumbdown, onFeedbackOk, onThumbupChange, onThumbdownChange]);

  // 点赞与差评互斥：差评提交时传 thumbup=false，后端会覆盖点赞状态；
  // 成功后把点赞图标置灰（handleFeedbackOk 统一处理），因此无需先手动取消。
  const handleDislike = showModal;

  const handleFeedbackOk = useCallback(
    async (params: Parameters<typeof onFeedbackOk>[0]) => {
      const ret = await onFeedbackOk(params);
      if (ret === 0) {
        onThumbupChange?.(false);
        onThumbdownChange?.(true);
      }
      return ret;
    },
    [onFeedbackOk, onThumbupChange, onThumbdownChange],
  );

  return (
    <>
      <div
        className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100"
        role="toolbar"
      >
        <CopyToClipboard
          text={copyText}
          className="border-0"
          size="icon-xs"
          avoidButtonWrapper
        />

        {showLoudspeaker && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="transparent"
                  size="icon-xs"
                  className="border-0"
                  onClick={handleRead}
                >
                  <span>
                    {isPlaying ? <LucidePauseCircle /> : <LucideVolume2 />}
                  </span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('chat.read')}</TooltipContent>
            </Tooltip>
          </>
        )}
        {showLikeButton && (
          <>
            <Button
              variant="transparent"
              size="icon-xs"
              className={
                thumbup
                  ? 'border-0 text-red-500 hover:text-red-500'
                  : 'border-0'
              }
              onClick={handleLike}
            >
              <LucideThumbsUp
                className={thumbup ? 'fill-current' : undefined}
              />
            </Button>

            <Button
              variant="transparent"
              size="icon-xs"
              className="border-0"
              onClick={handleDislike}
            >
              <LucideThumbsDown
                className={thumbdown ? 'fill-current' : undefined}
              />
            </Button>
          </>
        )}
        {prompt && (
          <Button
            onClick={showPromptModal}
            variant="transparent"
            size="icon-xs"
            className="border-0"
          >
            <PromptIcon style={{ fontSize: '16px' }} />
          </Button>
        )}
      </div>
      {visible && (
        <FeedbackDialog
          visible={visible}
          hideModal={hideModal}
          onOk={handleFeedbackOk}
          loading={loading}
        ></FeedbackDialog>
      )}
      {promptVisible && (
        <PromptDialog
          visible={promptVisible}
          hideModal={hidePromptModal}
          prompt={prompt}
        ></PromptDialog>
      )}
    </>
  );
};

interface UserGroupButtonProps extends Partial<IRemoveMessageById> {
  messageId: string;
  content: string;
  regenerateMessage?: () => void;
  sendLoading: boolean;
  deleteDisabled?: boolean;
}

export const UserGroupButton = ({
  content,
  messageId,
  sendLoading,
  deleteDisabled = false,
  removeMessageById,
  regenerateMessage,
}: UserGroupButtonProps) => {
  const { onRemoveMessage, loading } = useRemoveMessage(
    messageId,
    removeMessageById,
  );
  const { t } = useTranslation();

  return (
    <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
      <CopyToClipboard
        text={content}
        className="border-0"
        size="icon-xs"
        avoidButtonWrapper
      />

      {regenerateMessage && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="transparent"
              size="icon-xs"
              className="border-0"
              onClick={regenerateMessage}
              disabled={sendLoading}
            >
              <LucideRefreshCw className={cn(sendLoading && 'animate-spin')} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('chat.regenerate')}</TooltipContent>
        </Tooltip>
      )}
      {removeMessageById && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="transparent"
              size="icon-xs"
              className="border-0"
              onClick={onRemoveMessage}
              disabled={loading || deleteDisabled}
            >
              <LucideTrash2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('common.delete')}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
};
