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

import type { LucideIcon } from 'lucide-react';

/**
 * 指标卡图标底色的色调。
 *
 * 只有 accent 走主题强调色（跟随亮/暗色皮肤）；其余四种是固定的语义色，
 * 用来在同一排卡片里区分「人 / 组织 / 内容 / 应用」四类对象，
 * 靠 10% 透明度铺底，在浅色和深色主题下都不会糊成一块。
 */
export type MetricTone = 'accent' | 'blue' | 'green' | 'purple' | 'orange';

/** 顶部 KPI 卡片。 */
export interface IOverviewMetric {
  key: string;
  label: string;
  /** 取不到数据时传 null，卡片渲染成「—」而不是 0。 */
  value: number | null;
  /** 单位后缀，如「条」「次」。为空表示纯数字。 */
  unit?: string;
  icon: LucideIcon;
  /** 相比上一周期的变化百分比；null 表示无法计算（首日无对比基准）。 */
  delta: number | null;
  /**
   * 底部灰色副文案，用来替代涨跌幅。
   *
   * 与 delta 互斥：给了 hint 就固定渲染 hint，不再渲染百分比——
   * 组织规模这类指标没有「上一周期」可比，硬算环比只会得到 +∞%。
   */
  hint?: string;
  /** 图标底色，默认 accent。 */
  tone?: MetricTone;
}

/** 「用户活跃度」卡片：租户总用户数与窗口内的活跃用户数。 */
export interface IUserActivity {
  total_users: number;
  active_users: number;
  /** 活跃统计的回看天数，卡片提示文案要与它保持一致。 */
  days: number;
}

/** 知识来源分布的一个分类。 */
export interface ISourceSlice {
  key: string;
  label: string;
  value: number;
  color: string;
}

/** 近 N 日趋势的一个数据点。 */
export interface ITrendPoint {
  /** 原始日期，如 2026-10-19。 */
  date: string;
  /** X 轴短标签，如「周一」。 */
  label: string;
  value: number;
}

/**
 * 双曲线趋势的一个数据点。
 *
 * api = API Key 调用（api_4_conversation）
 * web = 网页端手工检索（conversation_message 里的用户提问）
 *
 * 两条曲线共用同一个 X 轴，缺数据的那天补 0，否则 recharts 会把
 * 断点连成直线，看起来像「那天有量」。
 */
export interface IDualTrendPoint {
  date: string;
  label: string;
  api: number;
  web: number;
}

export interface IOverviewData {
  metrics: IOverviewMetric[];
  sourceDistribution: ISourceSlice[];
  trend: ITrendPoint[];
  /** 点赞数 / 调用数 × 100，用于展示满意度。 */
  satisfaction: number | null;
  /** 数据是否已加载完成（骨架屏用）。 */
  loading: boolean;
  /** 任一接口失败时的降级提示，非空则页面顶部展示告警条。 */
  degradedMessage: string | null;
}
