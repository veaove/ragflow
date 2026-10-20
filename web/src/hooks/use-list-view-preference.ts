import { useCallback, useState } from 'react';

export type ListViewMode = 'card' | 'table';

const STORAGE_KEY = 'ragflow:list-view-mode';

function readStored(): ListViewMode {
  try {
    const v = globalThis.localStorage?.getItem(STORAGE_KEY);
    return v === 'table' ? 'table' : 'card';
  } catch {
    // localStorage 不可用（隐私模式 / SSR）时回落到卡片视图。
    return 'card';
  }
}

/**
 * 列表视图偏好，卡片 / 表格二选一。
 *
 * 两个页面（智能体、工作室）共用同一个 key：切换一次全局生效，这是产品
 * 文档 3.2 的明确取舍——用户对「我现在想看表格还是卡片」的偏好是一次性
 * 决定，不该每进一个页面就重设。存 localStorage，刷新后保持。
 */
export function useListViewPreference() {
  const [mode, setMode] = useState<ListViewMode>(readStored);

  const toggle = useCallback((next: ListViewMode) => {
    setMode(next);
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, next);
    } catch {
      // 写不进去不影响本次会话内的切换。
    }
  }, []);

  return { mode, setMode: toggle };
}
