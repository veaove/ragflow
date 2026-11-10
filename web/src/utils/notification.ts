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

import { toast } from '@/utils/toast';

const defaultConfig = { duration: 4000, position: 'top-right' as const };

type NotificationOptions = {
  message: string;
  description?: string;
  duration?: number;
};

/**
 * notification 保留 message/description 两段结构，交给 `@/utils/toast` 决定形态：
 * 成功 / 信息仍是角落提示，错误与警告统一成「标题 + 说明」的弹框。
 */
function emit(
  level: 'success' | 'info' | 'error' | 'warning',
  options: NotificationOptions,
) {
  const config = {
    ...defaultConfig,
    description: options.description,
    duration: options.duration ? options.duration * 1000 : defaultConfig.duration,
  };
  toast[level](options.message, config);
}

const notification = {
  success: (options: NotificationOptions) => emit('success', options),
  error: (options: NotificationOptions) => emit('error', options),
  warning: (options: NotificationOptions) => emit('warning', options),
  info: (options: NotificationOptions) => emit('info', options),
};

export default notification;
