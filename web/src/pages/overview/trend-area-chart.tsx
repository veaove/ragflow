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
import { BRAND_BLUE } from './constants';
import { formatThousand } from './utils';
import type { ITrendPoint } from './interface';

export function TrendAreaChart({
  data,
  loading,
  emptyHint,
}: {
  data: ITrendPoint[];
  loading?: boolean;
  emptyHint?: string;
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
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
        <defs>
          <linearGradient id="overviewTrendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={BRAND_BLUE} stopOpacity={0.24} />
            <stop offset="100%" stopColor={BRAND_BLUE} stopOpacity={0.02} />
          </linearGradient>
        </defs>

        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--border-default)"
          vertical={false}
        />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 12, fill: 'var(--text-secondary)' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 12, fill: 'var(--text-secondary)' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(value: number) => formatThousand(value)}
          width={56}
        />
        <Tooltip
          formatter={(value: number) => [formatThousand(value), '']}
          labelFormatter={(label: string) => `日期 ${label}`}
          contentStyle={{ borderRadius: 8, fontSize: 12 }}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={BRAND_BLUE}
          strokeWidth={2}
          fill="url(#overviewTrendFill)"
          dot={{ r: 3, fill: BRAND_BLUE, strokeWidth: 0 }}
          activeDot={{ r: 5 }}
          isAnimationActive={!loading}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
