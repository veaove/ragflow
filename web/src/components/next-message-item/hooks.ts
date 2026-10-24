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

// import { useDeleteMessage, useFeedback } from '@/hooks/chat-hooks';
import { useSetModalState } from '@/hooks/common-hooks';
import { IRemoveMessageById, useSpeechWithSse } from '@/hooks/logic-hooks';
import { useDeleteMessage, useFeedback } from '@/hooks/use-chat-request';
import { IFeedbackRequestBody } from '@/interfaces/request/chat';
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
      // 返回结果码：调用方（点赞按钮）需要据此决定是否回滚乐观更新。
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

/**
 * TTS 音频缓存：content -> blob URL。
 *
 * 历史消息没有 audio_binary，每次点播放都要重新请求 + 后端重新合成
 * （用户反馈「点播放响应特别慢，过几秒才有响应」）。同一段回答第二次
 * 播放时直接命中缓存，同步 play，既有声音也立刻出声。
 *
 * 上限 50 条，超出按插入顺序淘汰最早的（Map 保持插入序）。
 */
const ttsUrlCache = new Map<string, string>();
const ttsCacheLimit = 50;

function cacheTtsUrl(content: string, url: string) {
  if (ttsUrlCache.has(content)) {
    // 先删再设，刷新插入顺序
    ttsUrlCache.delete(content);
  }
  ttsUrlCache.set(content, url);
  while (ttsUrlCache.size > ttsCacheLimit) {
    const oldest = ttsUrlCache.keys().next().value;
    if (oldest === undefined) break;
    const stale = ttsUrlCache.get(oldest);
    if (stale) URL.revokeObjectURL(stale);
    ttsUrlCache.delete(oldest);
  }
}

export const useSpeech = (content: string, audioBinary?: string) => {
  const { read } = useSpeechWithSse();
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  /**
   * 每次播放都用独立的 `new Audio(url)`。
   *
   * 原来复用一个渲染在按钮里的 `<audio src="">`，而组件挂载时还会把
   * audio_binary 解出来的字节塞进同一个元素。audio_binary 是后端
   * `[]byte` 走 JSON 的 **base64 MP3**，挂载逻辑却按十六进制解，
   * 得到一份无效音频；元素从此停在 readyState=0 / networkState=LOADING，
   * 之后 play() 仍然 resolve（所以图标变成暂停），但 currentTime 永远是 0
   * —— 表现就是「点了没声音」。播放器不参与渲染就不会被这类脏状态污染。
   */
  const audioRef = useRef<HTMLAudioElement | null>(null);

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
      await el.play();
      setIsPlaying(true);
    },
    [stopCurrent],
  );

  const speech = useCallback(async () => {
    // 消息自带的音频优先。audio_binary 是 base64 MP3
    // （chat_pipeline.synthesizeTTS 固定 Format:"mp3"）。
    if (audioBinary) {
      try {
        await playUrl(`data:audio/mp3;base64,${audioBinary}`);
      } catch (error) {
        console.warn('tts play failed (audioBinary)', error);
        setIsPlaying(false);
      }
      return;
    }

    // 命中缓存：直接播，不再请求（第二次点同一段回答时走这里）。
    const cached = ttsUrlCache.get(content);
    if (cached) {
      try {
        await playUrl(cached);
      } catch (error) {
        console.warn('tts play failed (cached)', error);
        setIsPlaying(false);
      }
      return;
    }

    // 回退：实时请求 TTS（历史消息没有 audio_binary 时）。接口返回 WAV，
    // 交给 <audio> 原生解码，不走 MSE。
    setIsLoading(true);
    try {
      const response = await read({ text: content });
      if (!response) return;
      // 合成失败时后端返回 200 + JSON（如 no default tts model is set）。
      // 这种响应绝不能喂给 <audio>，否则只会得到一个解码失败的空元素。
      // 具体报错提示由 useSpeechWithSse 统一给出。
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.startsWith('audio/')) {
        console.warn('tts response is not audio', contentType);
        return;
      }
      const blob = await response.blob();
      if (blob.size === 0) return;
      const url = URL.createObjectURL(blob);
      cacheTtsUrl(content, url);
      await playUrl(url);
    } catch (error) {
      console.warn('tts play failed', error);
      setIsPlaying(false);
    } finally {
      setIsLoading(false);
    }
  }, [read, content, audioBinary, playUrl]);

  const handleRead = useCallback(() => {
    if (isPlaying) {
      stopCurrent();
    } else {
      speech();
    }
  }, [isPlaying, stopCurrent, speech]);

  // 卸载时停掉残留播放（页面切走还在响是最容易被投诉的体验问题）。
  useEffect(() => {
    return () => {
      const el = audioRef.current;
      if (el) {
        el.onended = null;
        el.pause();
        audioRef.current = null;
      }
    };
  }, []);

  return { isPlaying, isLoading, handleRead };
};
