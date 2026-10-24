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
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TREND_COLORS } from './constants';
import { formatThousand } from './utils';
import type { IDualTrendPoint } from './interface';

/**
 * 坐标轴文字取色。
 *
 * `--text-secondary` 在 tailwind.css 里是「R G B」三元组（22 22 24），
 * 直接塞进 `fill` 会被判为非法值、退回 SVG 默认黑色，
 * 深色主题下就成了黑底黑字。必须包一层 rgb()。
 */
const AXIS_TICK = { fontSize: 12, fill: 'rgb(var(--text-secondary))' };

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="inline-block size-2 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

/**
 * 近 N 日检索趋势：API 调用 vs 网页端手工检索。
 *
 * 两条曲线共用一根 X 轴，颜色与图例一一对应。图例不做进 recharts 的
 * `<Legend>`，是因为卡片在 xl 下是定高 360px，多一行 recharts 图例会
 * 把绘图区挤到卡片外面；自己画一行 16px 的图例更好控高。
 */
export function TrendAreaChart({
  data,
  loading,
  emptyHint,
  apiLabel,
  webLabel,
}: {
  data: IDualTrendPoint[];
  loading?: boolean;
  emptyHint?: string;
  apiLabel: string;
  webLabel: string;
}) {
  if (!loading && data.length === 0) {
    return (
      <div className="flex h-[260px] flex-col items-center justify-center gap-2 text-center">
        <span className="text-sm text-text-disabled">暂无统计数据</span>
        {emptyHint && (
          <span className="max-w-[320px] text-xs leading-relaxed text-text-disabled">
            {emptyHint}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="mb-2 flex shrink-0 items-center justify-end gap-4 text-xs text-text-secondary">
        <LegendDot color={TREND_COLORS.api} label={apiLabel} />
        <LegendDot color={TREND_COLORS.web} label={webLabel} />
      </div>

      <ResponsiveContainer width="100%" height={236}>
        <AreaChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
          <defs>
            <linearGradient id="overviewTrendApiFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={TREND_COLORS.api} stopOpacity={0.24} />
              <stop offset="100%" stopColor={TREND_COLORS.api} stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="overviewTrendWebFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={TREND_COLORS.web} stopOpacity={0.22} />
              <stop offset="100%" stopColor={TREND_COLORS.web} stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--border-default)"
            vertical={false}
          />
          <XAxis
            dataKey="label"
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            tickFormatter={(value: number) => formatThousand(value)}
            width={56}
            allowDecimals={false}
          />
          <Tooltip
            formatter={(value: number, name: string) => [
              formatThousand(value),
              name,
            ]}
            labelFormatter={(label: string) => `日期 ${label}`}
            contentStyle={{
              borderRadius: 8,
              fontSize: 12,
              background: 'var(--bg-base)',
              border: '1px solid var(--border-default)',
            }}
            labelStyle={{ color: 'rgb(var(--text-secondary))' }}
            itemStyle={{ color: 'rgb(var(--text-primary))' }}
            cursor={{ stroke: 'var(--border-default)' }}
          />

          <Area
            type="monotone"
            dataKey="api"
            name={apiLabel}
            stroke={TREND_COLORS.api}
            strokeWidth={2}
            fill="url(#overviewTrendApiFill)"
            dot={{ r: 3, fill: TREND_COLORS.api, strokeWidth: 0 }}
            activeDot={{ r: 5 }}
            isAnimationActive={!loading}
          />
          <Area
            type="monotone"
            dataKey="web"
            name={webLabel}
            stroke={TREND_COLORS.web}
            strokeWidth={2}
            fill="url(#overviewTrendWebFill)"
            dot={{ r: 3, fill: TREND_COLORS.web, strokeWidth: 0 }}
            activeDot={{ r: 5 }}
            isAnimationActive={!loading}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
