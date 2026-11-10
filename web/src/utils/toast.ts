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

import { ExternalToast, toast as sonnerToast } from 'sonner';

import { pushAppNotice } from './app-notice';

type ToastContent = Parameters<typeof sonnerToast>[0];

type ToastPromiseData = {
  loading?: string | (() => string);
  success?: string | ((value: unknown) => string);
  error?: string | ((error: unknown) => string);
};

/** 提示文字拆成「标题 + 说明」：第一行当标题，其余作为正文。 */
function splitNoticeText(message: ToastContent, data?: ExternalToast) {
  const head = typeof message === 'string' ? message : String(message ?? '');
  // 有些调用点已经把说明拼进正文了（历史写法 message + '\n' + description），
  // 再追加一次会让同一段话在弹框里出现两遍。
  const tail =
    typeof data?.description === 'string' ? data.description : undefined;
  const text = tail && !head.includes(tail) ? `${head}\n${tail}` : head;
  const lines = text.split('\n');
  const title = (lines[0] ?? '').trim();
  const description = lines.slice(1).join('\n').trim();
  return { title, description: description || undefined };
}

function pushLevelNotice(
  level: 'error' | 'warning',
  message: ToastContent,
  data?: ExternalToast,
) {
  const { title, description } = splitNoticeText(message, data);
  pushAppNotice(
    level,
    title || (level === 'error' ? '操作失败' : '请注意'),
    description,
  );
}

/**
 * toast 是 sonner 的替代品，红 / 黄两档走统一弹框，其余照旧。
 *
 * 全站失败提示统一成弹框（标题 + 说明 + 知道了），成功与进行中仍是轻提示：
 * 这两类不需要用户停下来确认，做成弹框只会打断操作。
 */
export const toast = Object.assign(
  ((message: ToastContent, data?: ExternalToast) =>
    sonnerToast(message, data)) as typeof sonnerToast,
  // 先继承 sonner 的全套方法（success / info / custom / dismiss / loading …），
  // 再覆盖红黄两档；少了这一步 toast.success 会是 undefined。
  sonnerToast,
  {
    error: (message: ToastContent, data?: ExternalToast) => {
      pushLevelNotice('error', message, data);
    },
    warning: (message: ToastContent, data?: ExternalToast) => {
      pushLevelNotice('warning', message, data);
    },
    // sonner 的 promise 一定会弹一条红 toast，这里改成「进行中轻提示 + 失败弹框」。
    promise: <T,>(promise: Promise<T>, data?: ToastPromiseData) => {
      const { loading, success, error } = data ?? {};
      const loadingText = typeof loading === 'function' ? loading() : loading;
      const toastId = loadingText ? sonnerToast.loading(loadingText) : undefined;
      return promise.then(
        (value) => {
          if (toastId !== undefined) {
            sonnerToast.dismiss(toastId);
          }
          const text = typeof success === 'function' ? success(value) : success;
          if (text) {
            sonnerToast.success(text);
          }
          return value;
        },
        (reason: unknown) => {
          if (toastId !== undefined) {
            sonnerToast.dismiss(toastId);
          }
          const text = typeof error === 'function' ? error(reason) : error;
          if (text) {
            pushAppNotice('error', String(text));
          }
          // 调用点都是发后不管，失败已经由弹框说明，不再抛出未处理的 rejection。
          return undefined;
        },
      );
    },
  },
) as typeof sonnerToast;

export default toast;
