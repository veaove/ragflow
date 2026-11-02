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
import dayjs from 'dayjs';
import { CalendarIcon } from 'lucide-react';
import { DateRange } from 'react-day-picker';

/** 与后端 *_from / *_to 的 YYYY-MM-DD 约定保持一致。 */
const DateRangeLabelFormat = 'YYYY-MM-DD';

interface DateRangeFilterProps {
  /** 未选择时的提示，用来区分「创建时间」/「更新时间」。 */
  placeholder: string;
  value?: DateRange;
  onChange: (range?: DateRange) => void;
  className?: string;
}

/**
 * 筛选用日期区间选择器。
 *
 * 没有复用 ui/range-picker 的 DatePickerWithRange：那个是「必选区间」语义，
 * 而筛选要能把时间条件清空。这里按需组合 Popover + Calendar，不动共享组件。
 */
export function DateRangeFilter({
  placeholder,
  value,
  onChange,
  className,
}: DateRangeFilterProps) {
  const locale = useDateLocale();
  const hasValue = Boolean(value?.from);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn('justify-start px-2.5 font-normal', className)}
        >
          <CalendarIcon />
          <span className={cn('truncate', !hasValue && 'text-text-secondary')}>
            {hasValue ? formatRangeLabel(value as DateRange) : placeholder}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          selected={value}
          onSelect={onChange}
          numberOfMonths={2}
          locale={locale}
        />
      </PopoverContent>
    </Popover>
  );
}

function formatRangeLabel(range: DateRange): string {
  const from = dayjs(range.from).format(DateRangeLabelFormat);
  return range.to
    ? `${from} ~ ${dayjs(range.to).format(DateRangeLabelFormat)}`
    : from;
}
