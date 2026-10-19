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

/** 顶部 KPI 卡片。 */
export interface IOverviewMetric {
  key: string;
  label: string;
  value: number;
  /** 单位后缀，如「条」「次」。为空表示纯数字。 */
  unit?: string;
  icon: LucideIcon;
  /** 相比上一周期的变化百分比；null 表示无法计算（首日无对比基准）。 */
  delta: number | null;
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
