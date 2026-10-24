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

import { SUFFIX_CATEGORY, SOURCE_COLORS, SOURCE_LABELS, TREND_DAYS } from './constants';
import {
  type IDualTrendPoint,
  type ISourceSlice,
  type ITrendPoint,
} from './interface';

/**
 * 后端 `/system/stats` 每条序列的元素是 `[日期字符串, 数值]` 元组。
 * 这里只取数值，日期在 buildTrend 里单独处理。
 */
export type StatsSeries = [string, number][] | undefined;

/** 取一条序列在某天的数值，缺失按 0 计。 */
export function seriesValueOn(series: StatsSeries, date: string): number {
  const hit = series?.find(([d]) => String(d).startsWith(date));
  return hit ? Number(hit[1]) || 0 : 0;
}

/** 序列求和。 */
export function seriesSum(series: StatsSeries): number {
  return (series ?? []).reduce((sum, [, value]) => sum + (Number(value) || 0), 0);
}

/** `2026-10-19 00:00:00` -> `2026-10-19`；顺便兼容后端直接给 date 的情况。 */
function toDateOnly(rawDate: string): string {
  return String(rawDate).slice(0, 10);
}

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 用 UTC 构造，避免本地时区把日期整体前移一天。 */
function weekdayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return WEEKDAY_LABELS[weekday] ?? date;
}

/**
 * 把 `[date, value]` 元组序列转成图表可用的点列。
 *
 * 后端返回的日期形如 `2026-10-19 00:00:00`，这里截取到日。
 * X 轴标签用「周X」，与设计稿一致。
 */
export function buildTrend(series: StatsSeries): ITrendPoint[] {
  return (series ?? []).map(([rawDate, value]) => {
    const date = toDateOnly(rawDate);

    return {
      date,
      label: weekdayLabel(date),
      value: Number(value) || 0,
    };
  });
}

/**
 * 把「API 调用」与「网页手工检索」两条序列对齐到同一根 X 轴上。
 *
 * 两边的日期集合不一定相同：某天只有 API 没有网页检索（或反之）时，
 * 只在其中一条序列里出现的日期也必须出现在轴上，否则两条曲线的点
 * 会错位。缺失的一侧补 0——这比让它 undefined 更准确，因为
 * recharts 对 undefined 会断线或拉直线，两种看起来都像「有数据」。
 *
 * 轴长固定为 days 天（含今天），中间某天两边都没数据也占一格：
 * 否则 X 轴会跳日期，一周看起来只剩四五天，读数容易误会。
 * 整条轴全为 0 时返回空数组，交给调用方展示空态。
 */
export function buildDualTrend(
  apiSeries: StatsSeries,
  webSeries: StatsSeries,
  days: number = TREND_DAYS,
): IDualTrendPoint[] {
  const apiMap = new Map<string, number>();
  const webMap = new Map<string, number>();

  (apiSeries ?? []).forEach(([rawDate, value]) => {
    apiMap.set(toDateOnly(rawDate), Number(value) || 0);
  });
  (webSeries ?? []).forEach(([rawDate, value]) => {
    webMap.set(toDateOnly(rawDate), Number(value) || 0);
  });

  const points: IDualTrendPoint[] = [];
  const today = new Date();

  for (let i = days - 1; i >= 0; i -= 1) {
    // 逐日回退用 Date 构造器而不是减毫秒，跨月/跨夏令时都不会算错。
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const date = `${d.getFullYear()}-${month}-${day}`;

    points.push({
      date,
      label: weekdayLabel(date),
      api: apiMap.get(date) ?? 0,
      web: webMap.get(date) ?? 0,
    });
  }

  return points.some((p) => p.api > 0 || p.web > 0) ? points : [];
}

/**
 * 计算环比变化百分比。
 *
 * 上期基数为 0 时无法计算（增长无穷大），返回 null 由UI 显示为「—」，
 * 避免出现「+∞%」这类误导性数字。
 */
export function calcDelta(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

/** 从趋势序列里取最近 N 天与前 N 天分别求和，用于算环比。 */
export function splitRecentAndPrevious(series: StatsSeries): {
  recent: number;
  previous: number;
} {
  const points = buildTrend(series);
  if (points.length < 2) {
    return { recent: seriesSum(series), previous: 0 };
  }

  const half = Math.floor(points.length / 2);
  const sum = (arr: ITrendPoint[]) => arr.reduce((s, p) => s + p.value, 0);

  return {
    recent: sum(points.slice(points.length - half)),
    previous: sum(points.slice(0, points.length - half)),
  };
}

/**
 * 把后端返回的后缀计数聚合成「知识来源分布」。
 *
 * 后端只给 `suffix -> count`（如 `{ pdf: 12, docx: 5 }`），
 * 这里按业务归类合并，PDF 与 Word 等同属「文档」时会被计入同一类。
 */
export function buildSourceDistribution(
  suffixCounter: Record<string, number> | undefined,
): ISourceSlice[] {
  if (!suffixCounter) return [];

  const merged = new Map<string, number>();
  Object.entries(suffixCounter).forEach(([suffix, count]) => {
    const key = SUFFIX_CATEGORY[suffix.toLowerCase()] ?? 'other';
    merged.set(key, (merged.get(key) ?? 0) + count);
  });

  return Array.from(merged.entries())
    .map(([key, value]) => ({
      key,
      label: SOURCE_LABELS[key] ?? key,
      value,
      color: SOURCE_COLORS[key] ?? SOURCE_COLORS.other,
    }))
    .filter((slice) => slice.value > 0)
    .sort((a, b) => b.value - a.value);
}

/** 汇总知识资产总量。 */
export function sumDatasetField(
  datasets: { chunk_count?: number; document_count?: number; token_num?: number }[],
  field: 'chunk_count' | 'document_count' | 'token_num',
): number {
  return datasets.reduce((sum, ds) => sum + (Number(ds[field]) || 0), 0);
}

/** 大数字缩写：12345 -> 1.2万，用于空间有限的卡片。 */
export function formatCompactNumber(value: number): string {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`;
  return String(value);
}

/** 千分位分隔：12345 -> 12,345。 */
export function formatThousand(value: number): string {
  return value.toLocaleString('en-US');
}

export { TREND_DAYS };
