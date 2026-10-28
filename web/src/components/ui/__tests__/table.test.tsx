import { render, screen } from '@testing-library/react';

import { Table, TableBody, TableHead, TableHeader, TableRow } from '../table';

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
