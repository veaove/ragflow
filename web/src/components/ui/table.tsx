import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * 表格有两种滚动归属，选错表头就不吸附（`TableHeader` 是 sticky，依附「最近的
 * 滚动容器」）：
 *
 * - `self`（默认）：表格自己滚。此时 `rootClassName` 必须带高度约束
 *   （`max-h-[calc(100vh-280px)]` 之类），这一层才真的滚得起来。
 * - `page`：外层容器滚（列表页的 `flex-1 overflow-auto`、对话框的
 *   `max-h-[70vh] overflow-y-auto`）。此时表格**绝不能**自己成为滚动容器：
 *   它高度随内容撑开、内部并不滚动，表头会贴在这个假滚动容器上，
 *   外层一滚就跟着消失。
 *
 * 两者不可兼得——横向滚动能力本身就意味着这一层是滚动容器，而滚动容器会
 * 截断 sticky 的依附链。所以宽表要么自己滚（`self` + 高度约束），要么交给
 * 页面滚（`page`，横向溢出由页面容器处理）。
 */
const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement> & {
    rootClassName?: string;
    scroll?: 'self' | 'page';
  }
>(({ className, rootClassName, scroll = 'self', ...props }, ref) => (
  <div
    className={cn(
      // 列表统一外观：8px 圆角 + 白底 + 极淡描边，让表格在浅灰/白底页面上
      // 都能立成一张卡片（原先 16px + 半透明灰，和设计稿不一致）。
      'relative w-full overflow-auto rounded-lg bg-bg-base border border-border-light scrollbar-auto',
      scroll === 'page' && 'overflow-visible',
      rootClassName,
    )}
  >
    <table
      ref={ref}
      className={cn('w-full caption-bottom text-[13px] ', className)}
      {...props}
    />
  </div>
));
Table.displayName = 'Table';

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn(
      // 表头必须有实底：sticky 生效后行内容会从下面穿过去，透明表头会糊成一片。
      // 底边补一条分隔线，滚动时才分得清表头与内容。表格根节点已经是 bg-bg-base，
      // 所以在浅色卡片里这段实底不产生色差。
      '[&_tr]:border-b-0 top-0 sticky z-10 bg-bg-base [&_th]:border-b [&_th]:border-border-light',
      className,
    )}
    {...props}
  />
));
TableHeader.displayName = 'TableHeader';

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn('[&_tr:last-child]:border-0', className)}
    {...props}
  />
));
TableBody.displayName = 'TableBody';

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      'border-t-0.5 border-border-button bg-muted/50 font-medium [&>tr]:last:border-b-0',
      className,
    )}
    {...props}
  />
));
TableFooter.displayName = 'TableFooter';

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      'border-b border-border-light transition-colors hover:bg-bg-card/60 data-[state=selected]:bg-bg-card',
      className,
    )}
    {...props}
  />
));
TableRow.displayName = 'TableRow';

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      // 紧凑表格：表头 12px / 40px 行高，贴合企业后台的信息密度
      'first-of-type:pl-6 last-of-type:pr-6 h-11 px-4 text-left align-middle font-normal text-[13px] text-text-secondary [&:has([role=checkbox])]:pr-0 ',
      className,
    )}
    {...props}
  />
));
TableHead.displayName = 'TableHead';

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      'first-of-type:pl-6 last-of-type:pr-6 px-4 py-3.5 align-middle text-[13px] [&:has([role=checkbox])]:pr-0 text-text-primary font-normal',
      className,
    )}
    {...props}
  />
));
TableCell.displayName = 'TableCell';

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn('mt-4 text-sm text-muted-foreground', className)}
    {...props}
  />
));
TableCaption.displayName = 'TableCaption';

export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
};
