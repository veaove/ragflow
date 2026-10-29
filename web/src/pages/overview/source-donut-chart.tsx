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
    <div className="flex h-full min-h-0 flex-col">
      {/* 环形图吃满剩余高度，而不是写死 260px。
          卡片在 xl 下是定高 360px（内高约 280px），而图例行数随分类数变化
          （最多 8 类，通常 2~3 行）。原来图固定 260px、图例挂在它下面，两者相加
          一旦超过内高就被卡片的 overflow-hidden 从底下剪掉——表现就是图例只剩
          第一行。改成 flex-1 之后图会自己让出图例需要的空间。
          小屏（< xl）卡片高度是内容撑开的，flex-1 没有可分配的高度，所以保留
          一个基准高度，避免 ResponsiveContainer 量到 0 高度。 */}
      <div className="relative h-[260px] w-full xl:h-auto xl:min-h-0 xl:flex-1">
        <ResponsiveContainer width="100%" height="100%">
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

        {/* 中心数字只覆盖环形图本身：跟图例一起居中会让它掉到圆环偏下的位置。 */}
        <CenterLabel total={total} label={totalLabel} />
      </div>

      <ul className="mt-2 flex shrink-0 flex-wrap items-center justify-center gap-x-5 gap-y-2">
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
