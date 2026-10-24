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

import { cn } from '@/lib/utils';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCompactNumber, formatThousand } from './utils';
import type { IOverviewMetric } from './interface';

/** 数值展示：大数字用万/亿缩写，其余用千分位。 */
const renderValue = (value: number) =>
  value >= 100_000 ? formatCompactNumber(value) : formatThousand(value);

export function MetricCard({
  metric,
  loading,
  deltaLabel = '较上周期',
  emptyDeltaLabel = '较上周期无对比数据',
}: {
  metric: IOverviewMetric;
  loading?: boolean;
  /**
   * 环比说明文案。默认值是本组件原有的中文兜底，租户端「总览」不传即可；
   * 管理端有独立语言切换，必须由调用方传入当前语言的文案。
   */
  deltaLabel?: string;
  emptyDeltaLabel?: string;
}) {
  const { icon: Icon, label, value, unit, delta } = metric;

  return (
    <div className="flex flex-col justify-between rounded-xl border border-border-default bg-bg-base p-5 transition-shadow hover:shadow-sm">
      <header className="flex items-start justify-between gap-3">
        <span className="text-sm text-text-secondary">{label}</span>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-primary/10 text-accent-primary">
          <Icon className="size-4.5" strokeWidth={2} />
        </span>
      </header>

      <div className="mt-4">
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <p className="flex items-baseline gap-1 text-[26px] font-semibold leading-none text-text-primary">
            {renderValue(value)}
            {unit && (
              <span className="text-sm font-normal text-text-secondary">
                {unit}
              </span>
            )}
          </p>
        )}
      </div>

      <footer className="mt-3 flex h-5 items-center gap-1.5 text-xs">
        {loading ? (
          <Skeleton className="h-4 w-28" />
        ) : delta === null ? (
          // 上期基数为 0，无法计算环比，此时不展示涨跌幅，
          // 避免出现「+∞%」这种会误导用户的数字。
          <span className="text-text-disabled">{emptyDeltaLabel}</span>
        ) : (
          <>
            <span
              className={cn(
                'inline-flex items-center gap-0.5 font-medium',
                delta >= 0 ? 'text-state-success' : 'text-state-error',
              )}
            >
              {delta >= 0 ? (
                <TrendingUp className="size-3.5" />
              ) : (
                <TrendingDown className="size-3.5" />
              )}
              {delta >= 0 ? '+' : ''}
              {delta.toFixed(1)}%
            </span>
            <span className="text-text-disabled">{deltaLabel}</span>
          </>
        )}
      </footer>
    </div>
  );
}
