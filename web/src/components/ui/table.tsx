import * as React from 'react';

import { cn } from '@/lib/utils';
import {
  clampColumnWidth,
  columnWidthsStorageKey,
  parseStoredColumnWidths,
  serializeColumnWidths,
} from './table-resize';

/**
 * 列宽拖拽的上下文。`null` 表示当前 `TableHead` 不在可拖拽的 `Table` 里
 * （独立使用时），此时不渲染手柄。
 */
type TableResizeContextValue = {
  beginResize: (th: HTMLElement | null, clientX: number) => void;
};

const TableResizeContext = React.createContext<TableResizeContextValue | null>(
  null,
);

const readStoredWidths = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // 隐私模式 / 存储被禁用时不该影响表格渲染。
    return null;
  }
};

const writeStoredWidths = (key: string, widths: (number | null)[]) => {
  try {
    window.localStorage.setItem(key, serializeColumnWidths(widths));
  } catch {
    // 同上：存不下就算了，宽度在本次会话内仍然有效。
  }
};

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
 *
 * 列宽拖拽：默认**不冻结**，表头保持浏览器自动布局，和没有这个功能时完全
 * 一致。用户一旦拖动某列的边界，就把当前每列的实际宽度冻结成像素值
 * （`table-layout: fixed`），此后按拖动结果走，并按表头文字存进 localStorage。
 * 这样既不会改变任何现有页面的观感，也不需要在 43 个表格里逐页接线。
 */
const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement> & {
    rootClassName?: string;
    scroll?: 'self' | 'page';
    /** 关掉列宽拖拽（弹窗里的密集小表格可关）。 */
    resizable?: boolean;
  }
>(
  (
    { className, rootClassName, scroll = 'self', resizable = true, ...props },
    ref,
  ) => {
    const innerRef = React.useRef<HTMLTableElement | null>(null);
    const widthsRef = React.useRef<(number | null)[] | null>(null);
    const storageKeyRef = React.useRef<string | null>(null);
    const dragRef = React.useRef<{
      index: number;
      startX: number;
      startWidth: number;
    } | null>(null);
    const [widths, setWidths] = React.useState<(number | null)[] | null>(null);
    // 拖拽开始/结束各 +1，用来重挂全局 pointer 监听（ref 不触发生效）。
    const [draggingTick, setDraggingTick] = React.useState(0);

    React.useImperativeHandle(
      ref,
      () => innerRef.current as HTMLTableElement,
      [],
    );

    // 拖拽中宽度只走 ref + 直接改 DOM：每次 pointermove 都 setState 会让整张
    // 表（可能上百行）重渲染，拖动直接变卡。松手时才回写 state 对齐。
    React.useLayoutEffect(() => {
      widthsRef.current = widths;
    }, [widths]);

    const headerCells = React.useCallback(() => {
      const table = innerRef.current;
      return table
        ? Array.from(table.querySelectorAll<HTMLElement>('thead th'))
        : [];
    }, []);

    /**
     * 把宽度写进 DOM。优先写页面自带的 `<colgroup>`（admin 用户/白名单两页
     * 用它做初始列宽，且 `table-layout: fixed` 下列宽以 `col` 为准），
     * 没有 colgroup 就写表头单元格。
     */
    const applyWidths = React.useCallback(
      (next: (number | null)[]) => {
        const table = innerRef.current;
        if (!table) {
          return;
        }
        const cols = Array.from(
          table.querySelectorAll<HTMLElement>(':scope > colgroup > col'),
        );
        const ths = headerCells();
        let total = 0;

        ths.forEach((th, index) => {
          const width = next[index];
          if (width == null) {
            return;
          }
          (cols[index] ?? th).style.width = `${width}px`;
          total += width;
        });

        table.style.tableLayout = 'fixed';
        // 只设 minWidth：`w-full`（100%）仍然生效，列宽和小于容器时表照旧
        // 铺满，剩余空间由浏览器在列间分配；大于容器则横向滚动。
        table.style.minWidth = `${total}px`;
      },
      [headerCells],
    );

    /**
     * 拖拽中的单列更新：只改这一列的宽度和表格的 minWidth，不触发 React
     * 渲染，保证跟手。
     */
    const applyColumnWidth = React.useCallback(
      (index: number, next: (number | null)[]) => {
        const table = innerRef.current;
        const width = next[index];
        if (!table || width == null) {
          return;
        }
        const cols = table.querySelectorAll<HTMLElement>(
          ':scope > colgroup > col',
        );
        const target = cols[index] ?? headerCells()[index];
        if (!target) {
          return;
        }
        target.style.width = `${width}px`;

        let total = 0;
        next.forEach((value) => {
          if (value != null) {
            total += value;
          }
        });
        table.style.tableLayout = 'fixed';
        table.style.minWidth = `${total}px`;
      },
      [headerCells],
    );

    React.useLayoutEffect(() => {
      if (widths) {
        applyWidths(widths);
      }
    }, [applyWidths, widths]);

    // 刷新后恢复上次的列宽。表头是数据驱动的（`table.getHeaderGroups()`），
    // 首帧可能还没有 th，所以等一次 DOM 变化再试。
    React.useLayoutEffect(() => {
      const table = innerRef.current;
      if (!table) {
        return;
      }
      const restore = () => {
        if (widthsRef.current) {
          return true;
        }
        const ths = headerCells();
        if (ths.length === 0) {
          return false;
        }
        const key = columnWidthsStorageKey(
          window.location.pathname,
          ths.map((th) => th.textContent ?? ''),
        );
        const stored = parseStoredColumnWidths(
          readStoredWidths(key),
          ths.length,
        );
        if (stored) {
          storageKeyRef.current = key;
          setWidths(stored);
        }
        return true;
      };

      if (restore()) {
        return;
      }
      const observer = new MutationObserver(() => {
        if (restore()) {
          observer.disconnect();
        }
      });
      observer.observe(table, { childList: true, subtree: true });
      return () => observer.disconnect();
    }, [headerCells]);

    // 拖拽期间的全局监听：指针移出表头甚至移出窗口也要跟手。
    React.useEffect(() => {
      const drag = dragRef.current;
      if (!drag) {
        return;
      }
      const onMove = (event: PointerEvent) => {
        const next = [...(widthsRef.current ?? [])];
        next[drag.index] = clampColumnWidth(
          drag.startWidth + (event.clientX - drag.startX),
        );
        widthsRef.current = next;
        applyColumnWidth(drag.index, next);
      };
      const stop = () => {
        dragRef.current = null;
        const finalWidths = widthsRef.current;
        if (storageKeyRef.current && finalWidths) {
          writeStoredWidths(storageKeyRef.current, finalWidths);
          // 松手才回写 state：让换页、切视图后的重渲染沿用同一套宽度。
          setWidths([...finalWidths]);
        }
        document.body.style.removeProperty('cursor');
        document.body.style.removeProperty('user-select');
        setDraggingTick((tick) => tick + 1);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', stop);
      window.addEventListener('pointercancel', stop);
      return () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', stop);
        window.removeEventListener('pointercancel', stop);
      };
    }, [applyColumnWidth, draggingTick]);

    const beginResize = React.useCallback(
      (th: HTMLElement | null, clientX: number) => {
        const table = innerRef.current;
        if (!table || !th) {
          return;
        }
        const ths = headerCells();
        const index = ths.indexOf(th);
        if (index < 0) {
          return;
        }

        let next = widthsRef.current;
        if (!next) {
          // 首次拖拽才冻结：读的就是浏览器当下的实际宽度，所以画面不跳。
          next = ths.map((cell) =>
            clampColumnWidth(cell.getBoundingClientRect().width),
          );
          const key = columnWidthsStorageKey(
            window.location.pathname,
            ths.map((cell) => cell.textContent ?? ''),
          );
          const stored = parseStoredColumnWidths(
            readStoredWidths(key),
            ths.length,
          );
          if (stored) {
            next = stored;
          }
          storageKeyRef.current = key;
          widthsRef.current = next;
          setWidths(next);
        }

        dragRef.current = {
          index,
          startX: clientX,
          startWidth:
            next[index] ?? clampColumnWidth(th.getBoundingClientRect().width),
        };
        // 拖拽中禁止选中文字、整页显示列宽光标。
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';
        setDraggingTick((tick) => tick + 1);
      },
      [headerCells],
    );

    const resizeContext = React.useMemo(
      () => (resizable ? { beginResize } : null),
      [beginResize, resizable],
    );

    return (
      <TableResizeContext.Provider value={resizeContext}>
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
            ref={innerRef}
            className={cn(
              'w-full caption-bottom text-[13px] ',
              // 最后一列右侧就是表格边界，手柄会被 overflow 裁成半截；拖它
              // 左边界的列效果一样，所以直接不显示。
              "[&_th:last-of-type_[data-testid='column-resizer']]:hidden",
              className,
            )}
            {...props}
          />
        </div>
      </TableResizeContext.Provider>
    );
  },
);
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
>(({ className, children, ...props }, ref) => {
  const resize = React.useContext(TableResizeContext);
  const innerRef = React.useRef<HTMLTableCellElement | null>(null);

  React.useImperativeHandle(
    ref,
    () => innerRef.current as HTMLTableCellElement,
    [],
  );

  return (
    <th
      ref={innerRef}
      className={cn(
        // 紧凑表格：表头 12px / 40px 行高，贴合企业后台的信息密度
        // relative 供列宽手柄定位。
        'group/th relative first-of-type:pl-6 last-of-type:pr-6 h-11 px-4 text-left align-middle font-normal text-[13px] text-text-secondary [&:has([role=checkbox])]:pr-0 ',
        className,
      )}
      {...props}
    >
      {children}
      {resize && (
        <span
          // 手柄骑在列边界上：默认透明，hover 表头时显出淡线，hover 自己变主色，
          // 这样 43 张表的默认观感不变，又能被找到。
          role="separator"
          aria-orientation="vertical"
          data-testid="column-resizer"
          onPointerDown={(event) => {
            // 别把拖拽当成表头的排序/全选点击。
            event.preventDefault();
            event.stopPropagation();
            resize.beginResize(innerRef.current, event.clientX);
          }}
          onDoubleClick={(event) => event.stopPropagation()}
          className="absolute inset-y-1.5 -right-1 z-20 w-2 cursor-col-resize touch-none select-none before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-transparent before:transition-colors group-hover/th:before:bg-border-default hover:before:bg-accent-primary"
        />
      )}
    </th>
  );
});
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
