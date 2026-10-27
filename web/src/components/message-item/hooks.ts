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

import { useSetModalState } from '@/hooks/common-hooks';
import { IRemoveMessageById, useSpeechWithSse } from '@/hooks/logic-hooks';
import { useDeleteMessage, useFeedback } from '@/hooks/use-chat-request';
import { IFeedbackRequestBody } from '@/interfaces/request/chat';
import { hexStringToUint8Array } from '@/utils/common-util';
import { useCallback, useEffect, useRef, useState } from 'react';

export const useSendFeedback = (messageId: string) => {
  const { visible, hideModal, showModal } = useSetModalState();
  const { feedback, loading } = useFeedback();

  const onFeedbackOk = useCallback(
    async (params: IFeedbackRequestBody) => {
      const ret = await feedback({
        ...params,
        messageId: messageId,
      });

      if (ret === 0) {
        hideModal();
      }
      // 返回结果码：点赞按钮据此决定是否回滚乐观更新。
      return ret;
    },
    [feedback, hideModal, messageId],
  );

  return {
    loading,
    onFeedbackOk,
    visible,
    hideModal,
    showModal,
  };
};

export const useRemoveMessage = (
  messageId: string,
  removeMessageById?: IRemoveMessageById['removeMessageById'],
) => {
  const { deleteMessage, loading } = useDeleteMessage();

  const onRemoveMessage = useCallback(async () => {
    if (messageId) {
      const code = await deleteMessage(messageId);
      if (code === 0) {
        removeMessageById?.(messageId);
      }
    }
  }, [deleteMessage, messageId, removeMessageById]);

  return { onRemoveMessage, loading };
};

export const useSpeech = (content: string, audioBinary?: string) => {
  const { read } = useSpeechWithSse();
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  /**
   * 每次播放都用独立的 `new Audio(url)`。
   *
   * 原方案把 TTS 返回的 audio/wav 喂给 MediaSource → mp4 SourceBuffer
   * 被静默丢弃（表现是按钮变暂停但没声音）。WorkBuddy 换成了
   * 原生 <audio src=blob URL> 方向对了，但还卡在两个坑上：
   *
   * 1. useEffect 空依赖 + ref.current=null 时跳过绑 ended/pause
   *    listener，按钮状态卡「播放中」。
   * 2. 历史消息 audio_binary 在 audio 元素渲染到 DOM 之前就设置 src，
   *    ref.current=null 直接 return，二进制音频被丢弃。
   *
   * 跟 next-message-item 统一：不渲染 JSX <audio>，每次 play 创建
   * 独立 Audio 实例，天然隔离，不用 useEffect 绑事件，也不怕 showLoudspeaker
   * 条件下 audio 元素不存在。
   */
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const stopCurrent = useCallback(() => {
    const el = audioRef.current;
    if (el) {
      el.onended = null;
      el.pause();
      audioRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  const playUrl = useCallback(
    async (url: string) => {
      stopCurrent();
      const el = new Audio(url);
      audioRef.current = el;
      el.onended = () => {
        if (audioRef.current === el) {
          audioRef.current = null;
          setIsPlaying(false);
        }
      };
      el.onerror = () => {
        if (audioRef.current === el) {
          audioRef.current = null;
          setIsPlaying(false);
        }
      };
      try {
        await el.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
    },
    [stopCurrent],
  );

  const speech = useCallback(async () => {
    // 历史消息 audioBinary 预创建的 URL 已存在就直接用；否则走 SSE。
    if (objectUrlRef.current) {
      await playUrl(objectUrlRef.current);
      return;
    }
    const response = await read({ text: content });
    if (!response) return;
    const blob = await response.blob();
    if (blob.size === 0) return;
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }
    const url = URL.createObjectURL(blob);
    objectUrlRef.current = url;
    await playUrl(url);
  }, [read, content, playUrl]);

  const handleRead = useCallback(() => {
    if (isPlaying) {
      stopCurrent();
    } else {
      speech();
    }
  }, [isPlaying, stopCurrent, speech]);

  // 组件卸载时停掉正在播的音频并释放 object URL。
  useEffect(() => {
    return () => {
      stopCurrent();
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, [stopCurrent]);

  // 历史消息若带十六进制音频，预创建 object URL。
  useEffect(() => {
    if (!audioBinary) return;
    const units = hexStringToUint8Array(audioBinary);
    if (!units) return;
    const blob = new Blob([units], { type: 'audio/wav' });
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }
    objectUrlRef.current = URL.createObjectURL(blob);
    // 不自动播放，等用户点 handleRead 触发 playUrl。
  }, [audioBinary]);

  return { isPlaying, handleRead };
};
