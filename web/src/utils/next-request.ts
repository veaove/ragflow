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

import message from '@/components/ui/message';
import { Authorization } from '@/constants/authorization';
import authorizationUtil, {
  getAuthorization,
  redirectToLogin,
} from '@/utils/authorization-util';
import notification from '@/utils/notification';
import { getCurrentTenantId, TENANT_HEADER } from '@/utils/tenant-context';
import axios from 'axios';
import { convertTheKeysOfTheObjectToSnake, isFormData } from './common-util';
import {
  actionLabelFromMethod,
  describeFailure,
  describeSessionExpired,
} from './error-message';
import { setCachedLlmList } from './llm-cache';
import { addTenantParams } from './llm-util';

const errorHandler = (error: {
  config?: { method?: string };
  response: Response;
  message: string;
}): Response => {
  const { response } = error;
  // 网络断了、超时、HTTP 报错都走同一套说明：只讲原因类别和下一步，
  // 不把状态码、接口地址、英文原文摆到用户面前。
  const notice = describeFailure(
    {
      status: response?.status,
      message: error.message,
    },
    actionLabelFromMethod(error.config?.method),
  );
  notification.error({
    message: notice.title,
    description: notice.description,
    duration: 5,
  });
  return response ?? { data: { code: 1999 } };
};

// avoid duplicate 401 redirects
let isRedirecting = false;

const request = axios.create({
  //   errorHandler,
  timeout: 300000,
  //   getResponse: true,
});

request.interceptors.request.use(
  (config) => {
    const data = convertTheKeysOfTheObjectToSnake(config.data);
    const params = convertTheKeysOfTheObjectToSnake(config.params);

    // Add tenant parameters to data
    const dataWithTenantParams = isFormData(data)
      ? data
      : addTenantParams(data, config.url);

    const newConfig = { ...config, data: dataWithTenantParams, params };

    // Skip token if explicitly requested
    if (!(newConfig as any).skipToken) {
      newConfig.headers.set(Authorization, getAuthorization());
    }

    // 当前租户：切换租户后所有请求都带上，后端据此覆盖默认租户。与
    // utils/request.ts 保持一致 —— 少了这一行，走 axios 的接口（模型目录、
    // 知识搜索配置等）会被后端按「默认租户」解析，成员看到的是别处的数据。
    const currentTenantId = getCurrentTenantId();
    if (currentTenantId) {
      newConfig.headers.set(TENANT_HEADER, currentTenantId);
    }

    return newConfig;
  },
  function (error) {
    return Promise.reject(error);
  },
);

request.interceptors.response.use(
  async (response) => {
    if (response?.status === 413 || response?.status === 504) {
      const notice = describeFailure(
        { status: response.status },
        actionLabelFromMethod(response.config?.method),
      );
      message.error(notice.title, { description: notice.description });
    }

    if (response.config.responseType === 'blob') {
      return response;
    }
    const data = response?.data;

    // Update LLM list cache when fetching my_llm or llm_list
    if (data?.code === 0 && data?.data) {
      const url = response?.config?.url || '';
      if (url.includes('/v1/llm/my_llms') || url.includes('/v1/llm/list')) {
        setCachedLlmList(data.data);
      }
    }

    const skipErrorNotification = (response.config as any)
      ?.skipGlobalErrorNotification;
    if (data?.code === 401) {
      if (!isRedirecting) {
        isRedirecting = true;
        const notice = describeSessionExpired();
        notification.error({
          message: notice.title,
          description: notice.description,
          duration: 3,
        });
        authorizationUtil.removeAll();
        redirectToLogin();
      }
    } else if (data?.code !== 0 && !skipErrorNotification) {
      const notice = describeFailure(
        { code: data?.code, message: data?.message },
        actionLabelFromMethod(response.config?.method),
      );
      notification.error({
        message: notice.title,
        description: notice.description,
        duration: 5,
      });
    }
    return response;
  },
  function (error) {
    // Handle HTTP 401 (token expired / invalid)
    const status = error?.response?.status;
    if (status === 401) {
      if (!isRedirecting) {
        isRedirecting = true;
        const notice = describeSessionExpired();
        notification.error({
          message: notice.title,
          description: notice.description,
          duration: 3,
        });
        authorizationUtil.removeAll();
        redirectToLogin();
      }

      return Promise.reject(error);
    }

    if (!(error?.config as any)?.skipGlobalErrorNotification) {
      errorHandler(error);
    }
    return Promise.reject(error);
  },
);

export default request;

export const get = (url: string) => {
  return request.get(url);
};

export const post = (url: string, body: any) => {
  return request.post(url, { data: body });
};

export const drop = () => {};

export const put = () => {};
