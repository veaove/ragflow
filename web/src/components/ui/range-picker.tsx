'use client';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PropsRangeRequired } from 'react-day-picker';
import { useDateLocale } from '@/hooks/use-date-locale';

export function DatePickerWithRange({
  selected,
  ...props
}: Omit<PropsRangeRequired, 'mode'>) {
  //   const [date, setDate] = React.useState<DateRange | undefined>({
  //     from: new Date(new Date().getFullYear(), 0, 20),
  //     to: addDays(new Date(new Date().getFullYear(), 0, 20), 20),
  //   });

  // 日期文本与日历面板都不读 i18next，默认 en-US；界面是中文时这里会
  // 留一块英文日历。按当前语言喂 locale，切中文显示中文、切英文显示英文。
  const locale = useDateLocale();
  const { t } = useTranslation();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          id="date-picker-range"
          className="justify-start px-2.5 font-normal"
        >
          <CalendarIcon />
          {selected?.from ? (
            selected.to ? (
              <>
                {format(selected.from, 'LLL dd, y', { locale })} -{' '}
                {format(selected.to, 'LLL dd, y', { locale })}
              </>
            ) : (
              format(selected.from, 'LLL dd, y', { locale })
            )
          ) : (
            <span>{t('common.pickDate')}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          selected={selected}
          //   defaultMonth={date?.from}
          numberOfMonths={2}
          locale={locale}
          {...props}
        />
      </PopoverContent>
    </Popover>
  );
}
