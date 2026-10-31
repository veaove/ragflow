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

import {
  isSuperUserDenied,
  subscribeSuperUserDenied,
} from '@/utils/super-user-store';
import { useSyncExternalStore } from 'react';

/**
 * 订阅「当前登录账号是平台超级管理员」这个结论。
 *
 * 结论由请求层在收到 `403 Super user shouldn't access the URL` 时写入，
 * 根布局据此整页换成「去控制台」的说明，而不是让 PermissionGate 一直转圈。
 */
export const useSuperUserDenied = () =>
  useSyncExternalStore(
    subscribeSuperUserDenied,
    isSuperUserDenied,
    () => false,
  );
