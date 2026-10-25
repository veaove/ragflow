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

const STORAGE_KEY = 'ragflow.current_tenant_id';

/**
 * 当前租户存在 localStorage，由请求拦截器统一塞进 X-Tenant-ID 头。
 *
 * 为什么不用服务端字段（user.current_tenant_id）：
 * 同一用户在多标签页/多设备可能想同时看不同租户的数据，
 * 服务端存单值会互相覆盖。放浏览器本地是天然隔离的。
 */
export function getCurrentTenantId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setCurrentTenantId(tenantId: string) {
  try {
    if (tenantId) {
      localStorage.setItem(STORAGE_KEY, tenantId);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // localStorage 不可用（隐私模式）时降级为「不切换」
  }
}

export function clearCurrentTenantId() {
  setCurrentTenantId('');
}

/** 请求头名称，与后端 handler.TenantHeader 保持一致。 */
export const TENANT_HEADER = 'X-Tenant-ID';
