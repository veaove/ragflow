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

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useDateLocale } from '@/hooks/use-date-locale';
import { cn } from '@/lib/utils';
import { formatFilterDateTime } from '@/utils/dataset-filter';
import dayjs from 'dayjs';
import { ArrowRight, CalendarIcon, X } from 'lucide-react';
import { useCallback } from 'react';
import { DateRange } from 'react-day-picker';

interface DateRangeFilterProps {
  /** 字段名，未选值时显示在控件里，用来区分「创建时间」/「更新时间」。 */
  label: string;
  value?: DateRange;
  onChange: (range?: DateRange) => void;
  /** 清除当前选择。筛选条按「已提交的条件」重算，所以由调用方决定怎么清。 */
  onClear: () => void;
  className?: string;
}

/**
 * 筛选用日期区间选择器。
 *
 * 两个时间字段共用这一个组件，样式和格式天然一致：
 *   - 空：`[📅 创建时间]`
 *   - 有值：`[📅 创建时间 2026-10-02 00:00 → 2026-11-02 23:59 (×)]`
 *
 * 没有复用 ui/range-picker 的 DatePickerWithRange：那个是「必选区间」语义，
 * 而筛选要能把时间条件清空。这里按需组合 Popover + Calendar，不动共享组件。
 *
 * 起止联动由 Calendar 的 range 模式提供：先点开始日，再点结束日；结束日早于
 * 开始日时重新开始一轮选择，不会出现 to < from 的区间。
 */
export function DateRangeFilter({
  label,
  value,
  onChange,
  onClear,
  className,
}: DateRangeFilterProps) {
  const locale = useDateLocale();
  const hasValue = Boolean(value?.from);
  const waitingForEnd = Boolean(value?.from) && !value?.to;

  // 日历返回的起止都是当天 00:00。结束日必须归一成当天最后一刻，否则"选完是
  // 2026-11-02 00:00、查询后变 23:59"——同一区间前后显示两种时间。
  const handleSelect = useCallback(
    (range?: DateRange) => {
      if (!range?.from) {
        onChange(undefined);
        return;
      }
      if (!range.to) {
        onChange({ from: dayjs(range.from).startOf('day').toDate() });
        return;
      }
      onChange({
        from: dayjs(range.from).startOf('day').toDate(),
        to: dayjs(range.to).endOf('day').toDate(),
      });
    },
    [onChange],
  );

  return (
    <div className={cn('relative inline-flex', className)}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              'justify-start gap-2 px-2.5 font-normal',
              hasValue ? 'pr-7' : undefined,
            )}
          >
            <CalendarIcon className="size-4 shrink-0 text-text-secondary" />
            <span className="shrink-0 text-text-secondary">{label}</span>
            {hasValue ? (
              <>
                <span className="tabular-nums">
                  {formatFilterDateTime(value?.from)}
                </span>
                <ArrowRight className="size-3 shrink-0 text-text-disabled" />
                <span
                  className={cn(
                    'tabular-nums',
                    waitingForEnd && 'text-text-secondary',
                  )}
                >
                  {value?.to ? formatFilterDateTime(value.to) : '选择结束'}
                </span>
              </>
            ) : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            selected={value}
            onSelect={handleSelect}
            numberOfMonths={2}
            locale={locale}
          />
          <p className="border-t border-border-button px-3 py-2 text-xs text-text-secondary">
            {waitingForEnd
              ? '再选结束日期（不早于开始日期）'
              : '先选开始日期，再选结束日期'}
          </p>
        </PopoverContent>
      </Popover>

      {hasValue ? (
        <button
          type="button"
          aria-label={`清除${label}`}
          title={`清除${label}`}
          onClick={onClear}
          className="absolute right-1.5 top-1/2 z-10 flex size-4 -translate-y-1/2 items-center justify-center rounded-full bg-text-disabled text-bg-base transition-colors hover:bg-text-secondary"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  );
}
