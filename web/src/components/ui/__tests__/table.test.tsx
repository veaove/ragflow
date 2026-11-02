import { fireEvent, render, screen } from '@testing-library/react';

import { columnWidthsStorageKey } from '../table-resize';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '../table';

// jsdom 没有 PointerEvent，`fireEvent.pointerDown` 会丢掉 clientX。用 MouseEvent
// 顶替（同构的 clientX/clientY），拖拽计算才测得到。
if (!('PointerEvent' in window)) {
  // @ts-expect-error 仅测试环境需要的替身
  window.PointerEvent = MouseEvent;
}

/**
 * 表头是 `sticky`，它依附「最近的滚动容器」。所以「谁滚动」必须是表格自己
 * 声明的确定事实：如果表格根节点默认带 `overflow-auto` 而高度随内容撑开、
 * 内部并不滚动，sticky 表头就贴在这个假滚动容器上，外层一滚就消失。
 *
 * 这两条用例钉住两种布局的类名契约，避免以后有人把默认值改回去。
 */
const classes = (element: HTMLElement | null) =>
  (element?.className ?? '').split(/\s+/).filter(Boolean);

const renderTable = (scroll?: 'self' | 'page') =>
  render(
    <Table scroll={scroll}>
      <TableHeader>
        <TableRow>
          <TableHead>Header</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody />
    </Table>,
  );

describe('Table scroll ownership', () => {
  it('is its own scroll container by default (needs a max-height)', () => {
    renderTable();
    const root = screen.getByRole('table').parentElement;
    expect(classes(root)).toContain('overflow-auto');
    expect(classes(root)).not.toContain('overflow-visible');
  });

  it('gives up being a scroll container when the page scrolls', () => {
    renderTable('page');
    const root = screen.getByRole('table').parentElement;
    expect(classes(root)).toContain('overflow-visible');
    expect(classes(root)).not.toContain('overflow-auto');
  });

  it('keeps the header sticky and opaque so rows cannot bleed through', () => {
    renderTable('page');
    // thead 与 tbody 都是 rowgroup，表头是第一个。
    const header = screen.getAllByRole('rowgroup')[0];
    expect(classes(header)).toContain('sticky');
    expect(classes(header)).toContain('bg-bg-base');
  });
});

describe('Table column resizing', () => {
  const renderTwoColumns = (props: { resizable?: boolean } = {}) =>
    render(
      <Table {...props}>
        <TableHeader>
          <TableRow>
            <TableHead>需求</TableHead>
            <TableHead>任务 ID</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody />
      </Table>,
    );

  const tableEl = () => screen.getByRole('table') as HTMLTableElement;

  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders a drag handle for every header cell', () => {
    renderTwoColumns();

    expect(screen.getAllByTestId('column-resizer')).toHaveLength(2);
  });

  it('can be switched off for dense dialogs', () => {
    renderTwoColumns({ resizable: false });

    expect(screen.queryAllByTestId('column-resizer')).toHaveLength(0);
  });

  it('leaves the automatic layout alone until someone drags', () => {
    renderTwoColumns();

    // 没拖过就不该冻结：否则所有既有页面的列宽分配会变。
    expect(tableEl().style.tableLayout).toBe('');
    expect(screen.getAllByRole('columnheader')[0].style.width).toBe('');
  });

  it('freezes the measured widths and follows the pointer on drag', () => {
    renderTwoColumns();
    const handle = screen.getAllByTestId('column-resizer')[0];

    // jsdom 没有布局，实测宽度一律为 0，被夹到最小宽度 64。
    fireEvent.pointerDown(handle, { clientX: 100 });
    fireEvent.pointerMove(window, { clientX: 180 });
    fireEvent.pointerUp(window);

    expect(tableEl().style.tableLayout).toBe('fixed');
    expect(screen.getAllByRole('columnheader')[0].style.width).toBe('144px');
    expect(tableEl().style.minWidth).toBe('208px');
  });

  it('persists the dragged widths so a reload keeps them', () => {
    renderTwoColumns();
    const handle = screen.getAllByTestId('column-resizer')[0];

    fireEvent.pointerDown(handle, { clientX: 100 });
    fireEvent.pointerMove(window, { clientX: 180 });
    fireEvent.pointerUp(window);

    const key = columnWidthsStorageKey(window.location.pathname, [
      '需求',
      '任务 ID',
    ]);

    expect(JSON.parse(window.localStorage.getItem(key) ?? 'null')).toEqual([
      144, 64,
    ]);
  });

  it('applies stored widths on mount instead of waiting for a drag', () => {
    window.localStorage.setItem(
      columnWidthsStorageKey(window.location.pathname, ['需求', '任务 ID']),
      JSON.stringify([200, 120]),
    );

    renderTwoColumns();

    expect(tableEl().style.tableLayout).toBe('fixed');
    expect(screen.getAllByRole('columnheader')[0].style.width).toBe('200px');
    expect(screen.getAllByRole('columnheader')[1].style.width).toBe('120px');
  });
});
