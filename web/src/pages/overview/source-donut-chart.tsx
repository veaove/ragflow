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

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { formatThousand } from './utils';
import type { ISourceSlice } from './interface';

/** 环形图中心的总量文案。 */
function CenterLabel({ total, label }: { total: number; label: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
      <span className="text-2xl font-semibold text-text-primary">
        {formatThousand(total)}
      </span>
      <span className="mt-0.5 text-xs text-text-secondary">{label}</span>
    </div>
  );
}

export function SourceDonutChart({
  data,
  totalLabel,
  loading,
}: {
  data: ISourceSlice[];
  totalLabel: string;
  loading?: boolean;
}) {
  const total = data.reduce((sum, slice) => sum + slice.value, 0);

  if (!loading && data.length === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center text-sm text-text-disabled">
        暂无文档数据
      </div>
    );
  }

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Tooltip
            formatter={(value: number, name: string) => [
              `${formatThousand(value)} 个`,
              name,
            ]}
            contentStyle={{ borderRadius: 8, fontSize: 12 }}
          />
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            cx="50%"
            cy="50%"
            innerRadius="58%"
            outerRadius="82%"
            paddingAngle={2}
            stroke="none"
            isAnimationActive={!loading}
          >
            {data.map((slice) => (
              <Cell key={slice.key} fill={slice.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>

      <CenterLabel total={total} label={totalLabel} />

      <ul className="mt-2 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
        {data.map((slice) => (
          <li
            key={slice.key}
            className="flex items-center gap-1.5 text-xs text-text-secondary"
          >
            <span
              aria-hidden
              className="size-2.5 rounded-sm"
              style={{ backgroundColor: slice.color }}
            />
            {slice.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
