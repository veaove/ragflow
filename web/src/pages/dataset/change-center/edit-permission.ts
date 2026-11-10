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

/** 变更中心的入口动作。弹框文案按动作区分，避免一句「操作失败」。 */
export type ChangeSetEditAction = 'publish' | 'discard';

// 权限拒绝在请求层有两条路径，两条都必须认出来，否则页面会把失败当成功：
//   · HTTP 403 —— errorHandler 不抛异常，原样把 Response 交回来（status 在顶层）；
//   · HTTP 200 + 业务码 108/403 —— 资源层判定失败，请求本身是成功的。
// 只读授权（可查看）与部门管理员对知识库都没有编辑权限，发布 / 放弃会被这两条
// 之一拒掉；把它们统一成「没有编辑权限」一种语义，界面才有一致的说法。
const DENIED_CODES = [108, 403];
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
 * 除了显式的状态码与业务码，还要看 message：后端把权限不足打在 103 之类的
 * 通用错误码上时，只有文案能认出来。
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

  if ((res.status ?? res.response?.status) === 403) {
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
