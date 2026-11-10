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

/**
 * 红色 / 黄色提示的统一出口。
 *
 * 全站的失败与警告（toast.error / toast.warning / message.error / notification.*
 * 以及请求层的权限提示）都汇到这里，由 AppNoticeHost 用同一个弹框渲染：标题一行、
 * 说明一段、「知道了」收尾。放在模块级 store 而不是 context，是因为请求层这种
 * 非组件代码也要能弹，且页面上失败往往发生在 await 之后。
 */
export type AppNoticeLevel = 'error' | 'warning';

export interface AppNotice {
  id: number;
  level: AppNoticeLevel;
  title: string;
  description?: string;
}

let notices: AppNotice[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

const emit = () => {
  listeners.forEach((listener) => listener());
};

export function subscribeAppNotices(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 只读快照：数组引用只在增删时变化，可直接交给 useSyncExternalStore。 */
export function getAppNotices(): AppNotice[] {
  return notices;
}

/**
 * 排队一条提示。
 *
 * 同一条内容（例如批量上传时每个文件各报一次）只保留一条：弹框是阻塞式的，
 * 五条一模一样的提示要点五次「知道了」。
 */
export function pushAppNotice(
  level: AppNoticeLevel,
  title: string,
  description?: string,
) {
  const text = title.trim();
  if (!text) {
    return;
  }
  const duplicated = notices.some(
    (notice) =>
      notice.level === level &&
      notice.title === text &&
      notice.description === description,
  );
  if (duplicated) {
    return;
  }
  notices = [...notices, { id: nextId++, level, title: text, description }];
  emit();
}

export function dismissAppNotice(id: number) {
  notices = notices.filter((notice) => notice.id !== id);
  emit();
}
