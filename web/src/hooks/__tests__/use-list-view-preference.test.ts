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

import { act, renderHook } from '@testing-library/react';
import { useListViewPreference } from '../use-list-view-preference';

const STORAGE_BASE_KEY = 'ragflow:list-view-mode';

describe('useListViewPreference', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('没有存量偏好时默认卡片视图', () => {
    const { result } = renderHook(() => useListViewPreference('dataset'));

    expect(result.current.mode).toBe('card');
  });

  it('切换只写入本页面的作用域，不污染其它列表页', () => {
    const dataset = renderHook(() => useListViewPreference('dataset'));

    act(() => dataset.result.current.setMode('table'));

    expect(dataset.result.current.mode).toBe('table');
    expect(localStorage.getItem(`${STORAGE_BASE_KEY}:dataset`)).toBe('table');
    expect(localStorage.getItem(`${STORAGE_BASE_KEY}:chat`)).toBeNull();

    // 关键回归：知识库切表格后，知识问答 / 搜索 / 记忆仍各自保持卡片。
    expect(
      renderHook(() => useListViewPreference('chat')).result.current.mode,
    ).toBe('card');
    expect(
      renderHook(() => useListViewPreference('search')).result.current.mode,
    ).toBe('card');
    expect(
      renderHook(() => useListViewPreference('memory')).result.current.mode,
    ).toBe('card');
  });

  it('各作用域重新挂载后各自恢复自己的选择', () => {
    localStorage.setItem(`${STORAGE_BASE_KEY}:chat`, 'table');
    localStorage.setItem(`${STORAGE_BASE_KEY}:search`, 'card');

    expect(
      renderHook(() => useListViewPreference('chat')).result.current.mode,
    ).toBe('table');
    expect(
      renderHook(() => useListViewPreference('search')).result.current.mode,
    ).toBe('card');
    expect(
      renderHook(() => useListViewPreference('memory')).result.current.mode,
    ).toBe('card');
  });

  it('把旧版全局偏好迁移到 canvas，不影响其它列表页', () => {
    localStorage.setItem(STORAGE_BASE_KEY, 'table');

    expect(
      renderHook(() => useListViewPreference('canvas')).result.current.mode,
    ).toBe('table');
    expect(localStorage.getItem(`${STORAGE_BASE_KEY}:canvas`)).toBe('table');
    expect(
      renderHook(() => useListViewPreference('dataset')).result.current.mode,
    ).toBe('card');
  });
});
