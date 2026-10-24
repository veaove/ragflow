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
  const ref = useRef<HTMLAudioElement>(null);
  const { read } = useSpeechWithSse();
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const objectUrlRef = useRef<string | null>(null);

  // 后端 TTS 返回的是 audio/wav（provider 决定的），而 MediaSource 不支持 WAV
  // （Chrome 的 MSE 只认 audio/mp4 / audio/webm），把 WAV 喂给 mp4 的
  // SourceBuffer 会被静默丢弃 —— 表现就是「按钮变成暂停、但没有声音」。
  // 客服语音都是短句，直接拿完整 blob 交给 <audio> 原生播放最简单可靠。
  const speech = useCallback(async () => {
    const audio = ref.current;
    if (!audio) return;

    // 优先用消息自带的音频。
    //
    // 必须在**用户手势的同步调用栈里**设置 src 并调用 play()：Chrome 的
    // autoplay 策略只给手势上下文内的播放放行，一旦中间 await 了网络请求
    // （下面那条回退路径），手势上下文就丢了 —— 表现正是「按钮变成暂停、
    // 但完全没有声音」，因为 play() 的 Promise 仍会 resolve，只是不发声。
    //
    // 消息里的 audio_binary 是 MP3 base64（见 chat_pipeline.synthesizeTTS，
    // Format:"mp3"），而 /chat/audio/speech 接口返回的是 WAV，两者不同源。
    if (audioBinary) {
      audio.src = `data:audio/mp3;base64,${audioBinary}`;
      try {
        await audio.play();
        setIsPlaying(true);
      } catch (error) {
        console.warn('tts play failed (audioBinary)', error);
        setIsPlaying(false);
      }
      return;
    }

    // 命中缓存：同步播放，不再请求（第二次点同一段回答时走这里）。
    const cached = ttsUrlCache.get(content);
    if (cached) {
      audio.src = cached;
      try {
        await audio.play();
        setIsPlaying(true);
      } catch (error) {
        console.warn('tts play failed (cached)', error);
        setIsPlaying(false);
      }
      return;
    }

    // 回退：实时请求 TTS（历史消息没有 audio_binary 时）。
    // isLoading 让按钮显示 loading，避免用户以为点了没反应。
    setIsLoading(true);
    let response: Response | undefined;
    try {
      response = await read({ text: content });
      if (!response) return;
      const blob = await response.blob();
      if (blob.size === 0) return;
      const url = URL.createObjectURL(blob);
      cacheTtsUrl(content, url);
      objectUrlRef.current = url;
      audio.src = url;
      await audio.play();
      setIsPlaying(true);
    } catch (error) {
      console.warn('tts play failed', error);
      setIsPlaying(false);
    } finally {
      setIsLoading(false);
    }
  }, [read, content, audioBinary]);

  const pause = useCallback(() => {
    ref.current?.pause();
    setIsPlaying(false);
  }, []);

  const handleRead = useCallback(() => {
    if (isPlaying) {
      pause();
    } else {
      speech();
    }
  }, [isPlaying, pause, speech]);

  // 播放结束/被暂停时复位按钮状态；卸载时释放 object URL。
  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    const onStopped = () => setIsPlaying(false);
    audio.addEventListener('ended', onStopped);
    audio.addEventListener('pause', onStopped);
    return () => {
      audio.removeEventListener('ended', onStopped);
      audio.removeEventListener('pause', onStopped);
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  // 历史消息里若已带有十六进制音频，直接用同样的 blob 路径播放。
  useEffect(() => {
    if (!audioBinary) return;
    const units = hexStringToUint8Array(audioBinary);
    if (!units) return;
    const audio = ref.current;
    if (!audio) return;
    const blob = new Blob([units], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }
    objectUrlRef.current = url;
    audio.src = url;
  }, [audioBinary]);

  return { ref, isPlaying, isLoading, handleRead };
};
