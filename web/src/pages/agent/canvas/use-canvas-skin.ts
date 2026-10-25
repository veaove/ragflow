import { useCallback, useSyncExternalStore } from 'react';

/**
 * 画布皮肤：`legacy` 是原有的浅色卡片风，`tech` 是深蓝星海 + 发光描边的科技风。
 *
 * 皮肤是纯展示偏好，不属于图数据（不写 DSL、不走 `/agents/:id` 保存），
 * 因此放在 localStorage 而不是 `useGraphStore`——否则切换皮肤会被当成
 * 「画布已修改」，触发保存与版本提示。
 */
export const CANVAS_SKINS = ['legacy', 'tech'] as const;

export type CanvasSkin = (typeof CANVAS_SKINS)[number];

const STORAGE_KEY = 'ragflow-canvas-skin';

/**
 * 默认科技风。想恢复「一进画布就是旧样式」，把这里改成 'legacy' 即可，
 * 其它逻辑不用动。
 */
export const DEFAULT_CANVAS_SKIN: CanvasSkin = 'tech';

const isCanvasSkin = (value: unknown): value is CanvasSkin =>
  CANVAS_SKINS.includes(value as CanvasSkin);

function readStoredSkin(): CanvasSkin {
  if (typeof window === 'undefined') {
    return DEFAULT_CANVAS_SKIN;
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isCanvasSkin(stored) ? stored : DEFAULT_CANVAS_SKIN;
  } catch {
    // 隐私模式 / 禁用存储：退回默认值，不影响画布可用性。
    return DEFAULT_CANVAS_SKIN;
  }
}

let currentSkin: CanvasSkin = readStoredSkin();

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function setCanvasSkin(skin: CanvasSkin) {
  if (skin === currentSkin) {
    return;
  }

  currentSkin = skin;

  try {
    window.localStorage.setItem(STORAGE_KEY, skin);
  } catch {
    // 存不下就只在本次会话生效。
  }

  emit();
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);

  // 多标签页/多窗口打开同一画布时保持同步。
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) {
      return;
    }

    const next = isCanvasSkin(event.newValue)
      ? event.newValue
      : DEFAULT_CANVAS_SKIN;

    if (next === currentSkin) {
      return;
    }

    currentSkin = next;
    emit();
  };

  window.addEventListener('storage', onStorage);

  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener('storage', onStorage);
  };
}

export function useCanvasSkin() {
  const skin = useSyncExternalStore(
    subscribe,
    () => currentSkin,
    () => DEFAULT_CANVAS_SKIN,
  );

  const setSkin = useCallback((next: CanvasSkin) => setCanvasSkin(next), []);

  return { skin, setSkin };
}
