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
 * @deprecated This file will be deprecated. Please use `@web/src/utils/next-request.ts` instead.
 */

import message from '@/components/ui/message';
import { Authorization } from '@/constants/authorization';
import {
  getCurrentTenantId,
  TENANT_HEADER,
} from '@/utils/tenant-context';
import { ResponseType } from '@/interfaces/database/base';
import i18n from '@/locales/config';
import authorizationUtil, {
  getAuthorization,
  redirectToLogin,
} from '@/utils/authorization-util';
import notification from '@/utils/notification';
import { RequestMethod, extend } from 'umi-request';
import { convertTheKeysOfTheObjectToSnake, isFormData } from './common-util';
import { setCachedLlmList } from './llm-cache';
import { addTenantParams } from './llm-util';

const FAILED_TO_FETCH = 'Failed to fetch';

/**
 * API URL path → 中文模块名映射。
 *
 * 后端返回 403 / code=108 时，前端把请求 URL 丢进这张表匹配一下，
 * 给用户弹一条「您当前角色没有「XX」的操作权限」而不是干巴巴的 403。
 *
 * 加新模块时记得同步 MENU_MODULE（use-console-permissions.ts）和这里。
 */
const API_PATH_TO_MODULE: Array<{ test: RegExp; moduleName: string }> = [
  { test: /\/overview\/|\/analytics\//, moduleName: '总览' },
  { test: /\/analytics\//, moduleName: '报表统计' },
  { test: /\/tenant\/[^/]+\/departments/, moduleName: '组织架构' },
  { test: /\/tenant\/[^/]+\/console\/members/, moduleName: '成员管理' },
  { test: /\/tenant\/[^/]+\/console\/roles/, moduleName: '角色权限' },
  { test: /\/tenant\/[^/]+\/console\/grants/, moduleName: '资源授权' },
  { test: /\/tenant\/[^/]+\/team/, moduleName: '团队' },
  { test: /\/datasets?\/[^/]+\/documents/, moduleName: '知识库文件' },
  { test: /\/datasets?\/[^/]+\/parsed/, moduleName: '知识库解析结果' },
  { test: /\/datasets?\/[^/]+\/chunk/, moduleName: '知识库分块' },
  { test: /\/(datasets?|knowledge)/, moduleName: '知识库' },
  { test: /\/chats?(\/|$)/, moduleName: '对话' },
  { test: /\/searches?(\/|$)|\/search(\/|$)/, moduleName: '知识检索' },
  { test: /\/agents?(\/|$)|\/flow(\/|$)|\/studio(\/|$)|\/pipeline/, moduleName: '智能体' },
  { test: /\/memor(y|ies)/, moduleName: '记忆' },
  { test: /\/qc(\/|$)/, moduleName: 'QC 规则' },
  { test: /\/files\/?(\?|$)|\/file-manager/, moduleName: '文件管理' },
  { test: /\/compilation/, moduleName: '知识编译产物' },
  { test: /\/vocab/, moduleName: '词表' },
  { test: /\/similar-question/, moduleName: '相似问管理' },
  { test: /\/(model|llm|provider|models\/instances)/, moduleName: '模型' },
  { test: /\/datasource|\/data-source/, moduleName: '数据源' },
  { test: /\/chat-channel|\/channel/, moduleName: '应用渠道' },
  { test: /\/mcp(\/|$)/, moduleName: 'MCP 服务' },
  { test: /\/api-key|\/apikey/, moduleName: 'API 密钥' },
  { test: /\/sandbox/, moduleName: '沙箱' },
];

function moduleNameFor(url: string): string {
  const match = API_PATH_TO_MODULE.find(({ test }) => test.test(url));
  return match?.moduleName ?? '该功能';
}

// 后端自己拼好的中文权限提示（包含「」书名号或 "没有" 关键字）→ 直接用后端 message。
const BACKEND_PERMISSION_HINT = /[「"].*[」"]|没有.*权限|无.*权限|forbidden|permission denied/i;

// 5 秒内同一模块只弹一次权限提示，避免页面加载时 N 个 403 刷屏。
const permissionToastCooldown = new Map<string, number>();
function notifyPermissionDenied(url: string, backendMessage?: string) {
  const mod = moduleNameFor(url);
  const now = Date.now();
  const last = permissionToastCooldown.get(mod) ?? 0;
  if (now - last < 5000) return;
  permissionToastCooldown.set(mod, now);

  // 后端已经返回了友好中文提示 → 直接用，不要再加一层
  if (backendMessage && BACKEND_PERMISSION_HINT.test(backendMessage)) {
    notification.warning({
      message: '权限不足',
      description: backendMessage,
      duration: 5,
    });
    return;
  }

  notification.warning({
    message: '权限不足',
    description: `您当前角色没有「${mod}」的操作权限，请联系管理员在「角色权限」中为您授予相应权限。`,
    duration: 5,
  });
}

export const RetcodeMessage = {
  200: i18n.t('message.200'),
  201: i18n.t('message.201'),
  202: i18n.t('message.202'),
  204: i18n.t('message.204'),
  400: i18n.t('message.400'),
  401: i18n.t('message.401'),
  403: i18n.t('message.403'),
  404: i18n.t('message.404'),
  406: i18n.t('message.406'),
  410: i18n.t('message.410'),
  413: i18n.t('message.413'),
  422: i18n.t('message.422'),
  500: i18n.t('message.500'),
  502: i18n.t('message.502'),
  503: i18n.t('message.503'),
  504: i18n.t('message.504'),
};
export type ResultCode =
  | 200
  | 201
  | 202
  | 204
  | 400
  | 401
  | 403
  | 404
  | 406
  | 410
  | 413
  | 422
  | 500
  | 502
  | 503
  | 504;

const errorHandler = (error: {
  response: Response;
  message: string;
}): Response => {
  const { response } = error;
  if (error.message === FAILED_TO_FETCH) {
    notification.error({
      description: i18n.t('message.networkAnomalyDescription'),
      message: i18n.t('message.networkAnomaly'),
    });
  } else {
    if (response && response.status) {
      // 403 = 权限不足。普通成员（role=normal）打开管理类页面、或租户里没有
      // 某个资源时后端就会返回它 —— 这是预期结果，不是故障。
      // 弹一条友好的中文提示，5 秒内同一模块只弹一次避免刷屏。
      if (response.status === 403) {
        // 后端 body 里可能已经有友好中文提示（如 "当前角色没有「数据源」模块的操作权限"）
        // 尝试读出来，如果读不到就用我们自己拼的
        response
          .clone()
          .json()
          .then((body) => {
            notifyPermissionDenied(response.url, body?.message);
          })
          .catch(() => {
            notifyPermissionDenied(response.url);
          });
        return response;
      }
      const errorText =
        RetcodeMessage[response.status as ResultCode] || response.statusText;
      const { status, url } = response;
      notification.error({
        message: `${i18n.t('message.requestError')} ${status}: ${url}`,
        description: errorText,
      });
    }
  }
  return response ?? { data: { code: 1999 } };
};

const request: RequestMethod = extend({
  errorHandler,
  timeout: 300000,
  getResponse: true,
});

// avoid duplicate 401 redirects
let isRedirecting = false;

request.interceptors.request.use((url: string, options: any) => {
  const data = convertTheKeysOfTheObjectToSnake(options.data);
  const params = convertTheKeysOfTheObjectToSnake(options.params);

  // Add tenant parameters to data
  const dataWithTenantParams = isFormData(data)
    ? data
    : addTenantParams(data, url);

  return {
    url,
    options: {
      ...options,
      data: dataWithTenantParams,
      params,
      headers: {
        ...(options.skipToken
          ? undefined
          : { [Authorization]: getAuthorization() }),
        // 当前租户：切换租户后所有请求都带上，后端据此覆盖默认租户
        ...(getCurrentTenantId()
          ? { [TENANT_HEADER]: getCurrentTenantId() }
          : {}),
        ...options.headers,
      },
      interceptors: true,
    },
  };
});

request.interceptors.response.use(async (response: Response, options) => {
  if (response?.status === 413 || response?.status === 504) {
    message.error(RetcodeMessage[response?.status as ResultCode]);
  }

  // Handle HTTP 401
  if (response?.status === 401) {
    if (!isRedirecting) {
      isRedirecting = true;

      const data = await response
        .clone()
        .json()
        .catch(() => ({}));

      const messageText = data?.message || RetcodeMessage[401];
      notification.error({
        message: messageText,
        description: messageText,
        duration: 3,
      });
      authorizationUtil.removeAll();
      redirectToLogin();
    }

    return response;
  }

  if (options.responseType === 'blob') {
    return response;
  }

  // Per-request opt-out for response codes that the caller handles itself
  // (e.g. a vanished folder on a list request is a normal navigation case,
  // not a user-facing error).
  const skipErrorCodes = (options as any)?.skipErrorCodes as
    | number[]
    | undefined;

  const data: ResponseType = await response?.clone()?.json();

  // Update LLM list cache when fetching my_llm or llm_list
  if (data?.code === 0 && data?.data) {
    const url = response?.url || '';
    if (url.includes('/v1/llm/my_llms') || url.includes('/v1/llm/list')) {
      setCachedLlmList(data.data);
    }
  }

  if (data?.code === 100) {
    message.error(data?.message);
  } else if (data?.code === 401) {
    if (!isRedirecting) {
      isRedirecting = true;
      notification.error({
        message: data?.message,
        description: data?.message,
        duration: 3,
      });
      authorizationUtil.removeAll();
      redirectToLogin();
    }
    authorizationUtil.removeAll();
    redirectToLogin();
  } else if (data?.code === 108 || data?.code === 403) {
    // 权限不足：后端有两个业务码 —— 108（PermissionError）和 403（Forbidden）。
    // 弹友好的中文提示，5 秒内同一模块只弹一次。
    notifyPermissionDenied(response?.url, data?.message);
  } else if (data?.code !== 0 && !skipErrorCodes?.includes(data?.code)) {
    notification.error({
      message: `${i18n.t('message.hint')} : ${data?.code}`,
      description: data?.message,
      duration: 3,
    });
  }
  return response;
});

export default request;

export const get = (url: string) => {
  return request.get(url);
};

export const post = (url: string, body: any) => {
  return request.post(url, { data: body });
};

export const drop = () => {};

export const put = () => {};
