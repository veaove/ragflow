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
  const { label, value, unit, delta, hint } = metric;

  return (
    <div
      className="rounded-lg border border-border-default px-3 py-3"
      title={hint}
    >
      <div className="flex items-center gap-1 text-xs text-text-secondary">
        <span className="truncate">{label}</span>
        {hint && (
          <span className="cursor-help text-text-disabled" aria-hidden>
            ⓘ
          </span>
        )}
      </div>

      <div className="mt-1.5 flex items-baseline gap-0.5 text-xl font-semibold text-text-primary">
        {loading ? (
          <Skeleton className="h-6 w-16" />
        ) : value === null ? (
          '—'
        ) : (
          <>
            {renderValue(value)}
            {unit && (
              <span className="text-xs font-normal text-text-secondary">
                {unit}
              </span>
            )}
          </>
        )}
      </div>

      <div className="mt-1 flex h-4 items-center gap-1 text-xs">
        {loading ? (
          <Skeleton className="h-3 w-20" />
        ) : delta === null ? (
          <span className="text-text-disabled">{hint || emptyDeltaLabel}</span>
        ) : (
          <>
            <span
              className={cn(
                'inline-flex items-center gap-0.5 font-medium',
                delta >= 0 ? 'text-state-success' : 'text-state-error',
              )}
            >
              {delta >= 0 ? (
                <TrendingUp className="size-3" />
              ) : (
                <TrendingDown className="size-3" />
              )}
              {delta >= 0 ? '+' : ''}
              {delta.toFixed(1)}%
            </span>
            <span className="text-text-disabled">{deltaLabel}</span>
          </>
        )}
      </div>
    </div>
  );
}
