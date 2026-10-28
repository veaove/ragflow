import { MessageType } from '@/constants/chat';
import { Authorization } from '@/constants/authorization';
import api from '@/utils/api';
import { getAuthorization } from '@/utils/authorization-util';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 智能体运行面板的「自动朗读」。
 *
 * 为什么需要它：平台的朗读能力挂在小喇叭按钮上（点一次念一条），而电话渠道要的是
 * 「一进来就把菜单念出来、每问一句就答一句」。所以这里加一个开关，打开后：
 *   - 开场白（Begin 的 prologue）出现时自动念；
 *   - 每轮回答跑完（sendLoading true → false）自动念最后一条 assistant 消息。
 *
 * 三条克制的设计：
 *   1. 默认关。全站默认开会让所有智能体一进来就出声，是打扰不是功能。
 *   2. 只念"这一轮新产生的"，历史消息和切换会话不会被朗读一遍。
 *   3. 新一轮开始（sendLoading 变 true）立刻掐掉上一轮的声音，避免两条叠着说。
 */

const STORAGE_KEY = 'agent_auto_read';
const CACHE_LIMIT = 50;

/** 模块级单例播放器：自动朗读和手点喇叭各播各的，但自动朗读自身同一时刻只留一路。 */
let currentAudio: HTMLAudioElement | null = null;

const urlCache = new Map<string, string>();

function stopCurrent() {
  if (!currentAudio) return;
  currentAudio.onended = null;
  currentAudio.pause();
  currentAudio = null;
}

function cacheUrl(text: string, url: string) {
  if (urlCache.has(text)) {
    urlCache.delete(text);
  }
  urlCache.set(text, url);
  while (urlCache.size > CACHE_LIMIT) {
    const oldest = urlCache.keys().next().value;
    if (!oldest) break;
    const stale = urlCache.get(oldest);
    if (stale) {
      URL.revokeObjectURL(stale);
    }
    urlCache.delete(oldest);
  }
}

/** 调平台的 TTS 接口拿 wav；失败返回空串，静默降级（不弹错、不影响对话）。 */
async function synthesize(text: string): Promise<string> {
  const hit = urlCache.get(text);
  if (hit) {
    return hit;
  }
  try {
    const response = await fetch(api.chatsTts, {
      method: 'POST',
      headers: {
        [Authorization]: getAuthorization(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) {
      return '';
    }
    const blob = await response.blob();
    if (!blob.size) {
      return '';
    }
    const url = URL.createObjectURL(blob);
    cacheUrl(text, url);
    return url;
  } catch {
    return '';
  }
}

type ChatMessage = { id?: string; role?: string; content?: unknown };

export function useAgentAutoRead(
  messages: ChatMessage[],
  sendLoading: boolean,
) {
  const [enabled, setEnabledState] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored !== null) {
        return stored === '1';
      }
    } catch {
      // localStorage 被禁用时按默认值走
    }
    return false;
  });

  /** 已经处理过的消息 id，保证一条只说一次。 */
  const spokenRef = useRef<Set<string>>(new Set());
  const prevLoadingRef = useRef<boolean>(sendLoading);
  /** 被浏览器自动播放策略拦下的文本，等用户第一次点击再补播。 */
  const pendingRef = useRef<string>('');

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      // 存不了就只在本次会话生效
    }
    if (!next) {
      pendingRef.current = '';
      stopCurrent();
    }
  }, []);

  const speak = useCallback(async (text: string) => {
    const clean = (text || '').trim();
    if (!clean) {
      return;
    }
    stopCurrent();
    const url = await synthesize(clean);
    if (!url) {
      return;
    }
    const el = new Audio(url);
    currentAudio = el;
    el.onended = () => {
      if (currentAudio === el) {
        currentAudio = null;
      }
    };
    try {
      await el.play();
    } catch (err) {
      if (currentAudio === el) {
        currentAudio = null;
      }
      // 开场白是在用户还没点过页面的情况下播的，浏览器会以 NotAllowedError 拦掉。
      // 这里记下文本，等用户第一次点任意位置再补念一次，而不是从此沉默。
      if ((err as DOMException)?.name === 'NotAllowedError') {
        pendingRef.current = clean;
      }
    }
  }, []);

  // 用户第一次交互后补播被拦下的那段（平时没有待播内容时是个空转监听）
  useEffect(() => {
    const flushPending = () => {
      const text = pendingRef.current;
      if (!text) {
        return;
      }
      pendingRef.current = '';
      speak(text);
    };
    document.addEventListener('click', flushPending);
    return () => document.removeEventListener('click', flushPending);
  }, [speak]);

  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = sendLoading;

    if (!enabled) {
      return;
    }

    // 新一轮开始：掐掉上一轮的播报，别让两条声音叠着
    if (sendLoading) {
      stopCurrent();
      return;
    }

    const last = messages?.[messages.length - 1];
    if (!last || last.role !== MessageType.Assistant) {
      return;
    }
    const content = typeof last.content === 'string' ? last.content : '';
    if (!content.trim()) {
      return;
    }
    const id = last.id || '';
    if (id && spokenRef.current.has(id)) {
      return;
    }

    // 开场白：面板里只有这一条 assistant 消息
    const isPrologue = messages.length === 1 && !wasLoading;
    // 刚刚跑完一轮：sendLoading 从 true 落到 false
    const justFinished = wasLoading && !sendLoading;
    if (!isPrologue && !justFinished) {
      return;
    }

    if (id) {
      spokenRef.current.add(id);
    }
    speak(content);
  }, [enabled, messages, sendLoading, speak]);

  // 关掉面板 / 切走时别让声音继续在后台念
  useEffect(() => stopCurrent, []);

  return { enabled, setEnabled, stop: stopCurrent };
}
