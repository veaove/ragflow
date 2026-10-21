import { ReactNode } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

export interface ListColumn<T> {
  key: string;
  title: ReactNode;
  render: (row: T) => ReactNode;
  /** 操作列用 right，其余保持 left。 */
  align?: 'left' | 'right';
  className?: string;
}

/**
 * 各业务列表共用的表格视图。
 *
 * 为什么是 column 驱动而不是每个页面手写一份 <Table>：这些列表的骨架完全
 * 一样（边框、横向滚动、行 hover、操作列右对齐），只有列定义不同。手写四份
 * 会在细节上逐渐跑偏；一个组件 + 各自声明列，样式天然一致。
 *
 * 列的定义原则（产品要求）：**宁可多列，不可少列**——使用者扫一眼列表就要能
 * 判断「这个应用/知识库是什么、能不能用、谁在维护」，而不是点进去才知道。
 */
export function ListDataTable<T extends { id: string }>({
  columns,
  rows,
  tableTestId,
  rowTestId,
}: {
  columns: ListColumn<T>[];
  rows: T[];
  tableTestId?: string;
  rowTestId?: string;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border-default">
      <Table data-testid={tableTestId}>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead
                key={column.key}
                className={cn(
                  'whitespace-nowrap',
                  column.align === 'right' && 'text-right',
                  column.className,
                )}
              >
                {column.title}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} data-testid={rowTestId}>
              {columns.map((column) => (
                <TableCell
                  key={column.key}
                  className={cn(
                    column.align === 'right' && 'text-right',
                    column.className,
                  )}
                >
                  {column.render(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** 时间列的统一格式：失效时给 "-"，不要留空白让人以为是数据缺失。 */
export function formatListTime(value?: number | string | null): string {
  if (!value) {
    return '-';
  }
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleString();
}
