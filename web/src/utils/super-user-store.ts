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
 * 「当前登录的是平台超级管理员」这件事的全局标记。
 *
 * 后端在 `AuthMiddleware` 里对 `user.is_superuser = 1` 的账号一律回
 * `403 {"message":"Super user shouldn't access the URL"}` —— 主站所有接口
 * 都进不去（超管只走 `/admin`，见 docs/deployment-report-2026-10-27.md §9.4）。
 *
 * 前端不能把它当成「权限没配」：那样 PermissionGate 会永远停在「加载权限…」，
 * 用户看到的就是「登录后一个页面都没有」。所以请求层识别到这条 403 就把标记翻成
 * true，根布局据此整页换成「请去控制台」的说明。
 *
 * 单独一个模块是为了避免 request.ts ↔ authorization-util.ts 的循环依赖：
 * 登录/登出要重置标记，请求层要写标记，两边都只依赖这里。
 */

// 后端原文：Super user shouldn't access the URL
// 撇号有直 / 弯两种写法，也可能被去掉，都算。
const SUPER_USER_DENIED_PATTERN = /super\s*user\s*shouldn['’]?t\s*access/i;

/** 后端 message 是否是「超管禁入主站」这条。 */
export const isSuperUserDeniedMessage = (message?: string): boolean =>
  SUPER_USER_DENIED_PATTERN.test(message ?? '');

let denied = false;
const subscribers = new Set<() => void>();

const emit = () => subscribers.forEach((notify) => notify());

/** 当前会话是否已经被判定为平台超管。 */
export const isSuperUserDenied = () => denied;

/** 翻成 true 并通知订阅者；重复调用无副作用。 */
export const markSuperUserDenied = () => {
  if (denied) return;
  denied = true;
  emit();
};

/** 换了登录身份（登录成功 / 退出登录）就要清掉，别把上一个人的结论留给下一个人。 */
export const resetSuperUserDenied = () => {
  if (!denied) return;
  denied = false;
  emit();
};

/** 给 useSyncExternalStore 用。 */
export const subscribeSuperUserDenied = (notify: () => void) => {
  subscribers.add(notify);
  return () => {
    subscribers.delete(notify);
  };
};
