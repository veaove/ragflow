import { useCallback, useState } from 'react';

export type ListViewMode = 'card' | 'table';

/**
 * 视图偏好的作用域。**每个列表页一份，互不影响**：在知识库切成表格，
 * 不该顺手把知识问答、搜索、记忆也切成表格——这些页面的内容结构不同，
 * 用户对不同页面的视图选择是相互独立的决定。
 *
 * `canvas` 是唯一例外：智能体与工作室共用一份（产品文档 3.2），
 * 因为这两个页面的列表结构完全一致。
 */
export type ListViewScope = 'canvas' | 'dataset' | 'chat' | 'search' | 'memory';

const STORAGE_BASE_KEY = 'ragflow:list-view-mode';

/** 旧版本只写一个全局 key，仅用于迁移 `canvas` 作用域的存量偏好。 */
const LEGACY_GLOBAL_KEY = STORAGE_BASE_KEY;

function storageKey(scope: ListViewScope) {
  return `${STORAGE_BASE_KEY}:${scope}`;
}

function readStored(scope: ListViewScope): ListViewMode {
  try {
    const storage = globalThis.localStorage;
    if (!storage) {
      return 'card';
    }

    const scoped = storage.getItem(storageKey(scope));
    if (scoped === 'table' || scoped === 'card') {
      return scoped;
    }

    // 兼容旧版本：那时只有一个全局 key，且只有智能体 / 工作室两个页面在用。
    // 把它迁移到 canvas 作用域，其余列表页按各自默认值开始，不再被它带偏。
    if (scope === 'canvas' && storage.getItem(LEGACY_GLOBAL_KEY) === 'table') {
      storage.setItem(storageKey(scope), 'table');
      return 'table';
    }

    return 'card';
  } catch {
    // localStorage 不可用（隐私模式 / SSR）时回落到卡片视图。
    return 'card';
  }
}

/**
 * 列表视图偏好，卡片 / 表格二选一，按 `scope` 分别持久化到 localStorage。
 */
export function useListViewPreference(scope: ListViewScope) {
  const [mode, setMode] = useState<ListViewMode>(() => readStored(scope));

  const toggle = useCallback(
    (next: ListViewMode) => {
      setMode(next);
      try {
        globalThis.localStorage?.setItem(storageKey(scope), next);
      } catch {
        // 写不进去不影响本次会话内的切换。
      }
    },
    [scope],
  );

  return { mode, setMode: toggle };
}
