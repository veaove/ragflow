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

import { restAPIv1 } from '@/utils/api';
import request from '@/utils/request';

// ---- 质检规则类型 ----

export type QcAppType = 'chat' | 'canvas';
export type QcMatchMode = 'contains' | 'whole_word' | 'regex';
export type QcScope = 'ai_answer' | 'user_input' | 'both';
export type QcSeverity = 'info' | 'warn' | 'block';
export type QcAction = 'log' | 'log_and_alert' | 'block_and_alert';

export interface IQcRule {
  id: string;
  tenant_id: string;
  app_type: QcAppType;
  app_id: string;
  name: string;
  keywords: string[];
  match_mode: QcMatchMode;
  scope: QcScope;
  severity: QcSeverity;
  action: QcAction;
  prompt_message: string;
  enabled: boolean;
  created_by?: string;
  create_time?: number;
  update_time?: number;
}

export interface IQcRulePayload {
  app_type: QcAppType;
  app_id: string;
  name: string;
  keywords: string[];
  match_mode: QcMatchMode;
  scope: QcScope;
  severity: QcSeverity;
  action: QcAction;
  prompt_message: string;
  enabled: boolean;
}

export interface IQcTestHit {
  keyword: string;
  start: number;
  end: number;
}

export interface IQcTestResult {
  /** 命中「处」数：按出现次数计，不是按关键词去重计。 */
  hit_count: number;
  hits: IQcTestHit[];
  /** 每一处命中的 rune 区间（可多段，用于逐处高亮）。 */
  ranges?: { start: number; end: number }[];
  highlighted: string;
}

// ---- 命中记录类型 ----

export interface IQcHit {
  id: string;
  tenant_id: string;
  rule_id: string;
  rule_name: string;
  session_id: string;
  chat_id: string;
  app_type: QcAppType;
  app_id: string;
  /** Resolved server-side: dialog.name for chat, user_canvas.title for canvas. */
  app_name?: string;
  scope: QcScope;
  severity: QcSeverity;
  matched_text: string;
  context_before?: string;
  context_after?: string;
  action_taken: QcAction;
  create_time: number;
}

// ---- 系统配置 ----

export interface IQcConfig {
  enabled: boolean;
  max_rules_per_tenant: number;
  retention_days: number;
}

// ---- 列表响应 ----

export interface IQcList<T> {
  list: T[];
  total: number;
}

// 后端返回 { code, data, message, total? }；request 层 getResponse=true，
// 因此 service 方法 resolve 出的是 Response，调用方读 response.data.data / response.data.total。

export const listQcRules = (params: {
  /** 可选：传了按应用过滤（应用设置页用），不传返回本租户全部规则。 */
  app_type?: QcAppType;
  app_id?: string;
  page?: number;
  size?: number;
  keyword?: string;
  scope?: string;
  severity?: string;
  enabled?: boolean;
}) => request.get(`${restAPIv1}/qc/rules`, { params });

export const getQcRule = (id: string) =>
  request.get(`${restAPIv1}/qc/rules/${id}`);

/** 规则被哪些应用引用（应用名/类型/引用时间）。 */
export interface IQcRuleReference {
  app_type: QcAppType;
  app_id: string;
  app_name: string;
  /** 应用已在别处删除，但绑定行还在。 */
  missing: boolean;
  create_time: number;
}

export const getQcRuleReferences = (id: string) =>
  request.get(`${restAPIv1}/qc/rules/${id}/references`);

export const createQcRule = (data: IQcRulePayload) =>
  request.post(`${restAPIv1}/qc/rules`, { data });

export const updateQcRule = (id: string, data: Partial<IQcRulePayload>) =>
  request.put(`${restAPIv1}/qc/rules/${id}`, { data });

export const deleteQcRule = (id: string) =>
  request.delete(`${restAPIv1}/qc/rules/${id}`);

export const toggleQcRule = (id: string, enabled: boolean) =>
  request.post(`${restAPIv1}/qc/rules/${id}/toggle`, { data: { enabled } });

export const testQcRule = (data: {
  keywords: string[];
  match_mode: QcMatchMode;
  text: string;
}) => request.post(`${restAPIv1}/qc/rules/test`, { data });

export const listQcHits = (params: {
  page?: number;
  size?: number;
  from?: number;
  to?: number;
  rule_id?: string;
  scope?: string;
  severity?: string;
  session_id?: string;
  app_type?: string;
  app_id?: string;
}) => request.get(`${restAPIv1}/qc/hits`, { params });

export const getQcHit = (id: string) =>
  request.get(`${restAPIv1}/qc/hits/${id}`);

export const exportQcHits = (params: Record<string, any>) =>
  request.get(`${restAPIv1}/qc/hits/export`, {
    params,
    responseType: 'blob',
  });

export const getQcConfig = () => request.get(`${restAPIv1}/qc/config`);

export const updateQcConfig = (data: {
  enabled?: boolean;
  max_rules_per_tenant?: number;
  retention_days?: number;
}) => request.put(`${restAPIv1}/qc/config`, { data });

// ---- 应用级「选用规则」（聊天/智能体设置页里的质检区块） ----

/** 规则 + 它是否在当前应用生效。`home` 表示这条规则就是在当前应用里创建的。 */
export interface IQcRuleSelection extends IQcRule {
  selected: boolean;
  home: boolean;
}

export const getQcRuleSelection = (params: {
  app_type: QcAppType;
  app_id: string;
}) => request.get(`${restAPIv1}/qc/rules/selection`, { params });

export const updateQcRuleSelection = (data: {
  app_type: QcAppType;
  app_id: string;
  rule_ids: string[];
}) => request.put(`${restAPIv1}/qc/rules/selection`, { data });

// ---- 应用候选（质检菜单里选择「引用」哪个应用来配规则） ----

export interface IQcAppOption {
  id: string;
  name: string;
}

/**
 * 拉取当前用户可配置质检规则的应用：chat = 聊天应用（/chats），
 * canvas = 对话流/工作流（/agents）。返回精简的 {id, name} 供下拉选择。
 */
export const listQcAppOptions = async (
  appType: QcAppType,
): Promise<IQcAppOption[]> => {
  const url = appType === 'chat' ? `${restAPIv1}/chats` : `${restAPIv1}/agents`;
  const response = await request.get(url, {
    params: { page: 1, page_size: 200 },
  });
  const payload = response?.data?.data ?? {};
  const list: any[] =
    (appType === 'chat' ? payload.chats : payload.canvas) ?? [];
  return list.map((item) => ({
    id: item.id,
    name: item.name ?? item.title ?? item.id,
  }));
};
