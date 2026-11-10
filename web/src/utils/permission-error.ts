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

// 权限拒绝在请求层有几种形态，都要认出来，否则页面会把失败当成功：
//   · HTTP 200 + 业务码 403/108 —— 资源层判定失败，请求本身是成功的；
//   · HTTP 200 + 业务码 404 —— 后端把「不可见 / 无权限」按隐藏资源收敛
//     （permissionresponse.NormalizeHidden），文案是 "Resource not found"；
//   · HTTP 403 —— errorHandler 不抛异常，原样把 Response 交回来（status 在顶层）。
// 页面文案统一成「没有编辑权限」一种说法，别再让用户看到 404 这种码。
const DENIED_CODES = [108, 403, 404];
const DENIED_MESSAGE_PATTERNS = [
  /read-only/i,
  /权限不足/,
  /没有[^，。]*权限/,
  /permission denied/i,
  /forbidden/i,
];

/**
 * 判断一次接口调用（返回值或抛出的错误）是否表达「没有编辑权限」。
 *
 * 调用方必须是在**刚成功读过这个资源**的上下文里调用它：只有那样，404 才只能
 * 解释成「看得见一部分、但写不动」，而不是资源真的消失了。
 */
export function isEditPermissionDenied(result: unknown): boolean {
  if (!result) return false;
  const res = result as {
    status?: number;
    code?: number | string;
    message?: string;
    response?: { status?: number };
    data?: { code?: number | string; message?: string };
  };

  const status = res.status ?? res.response?.status;
  if (typeof status === 'number' && DENIED_CODES.includes(status)) {
    return true;
  }

  const code = res.data?.code ?? res.code;
  if (typeof code === 'number' && DENIED_CODES.includes(code)) {
    return true;
  }

  const message = res.data?.message ?? res.message ?? '';
  return (
    typeof message === 'string' &&
    DENIED_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))
  );
}
