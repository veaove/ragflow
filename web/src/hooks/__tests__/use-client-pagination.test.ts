import { act, renderHook } from '@testing-library/react';

import { useClientPagination } from '../logic-hooks/use-pagination';

const rows = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('useClientPagination', () => {
  it('slices the list and reports the filtered total', () => {
    const { result } = renderHook(() => useClientPagination(rows(25)));

    expect(result.current.total).toBe(25);
    expect(result.current.pageSize).toBe(10);
    expect(result.current.pagedList).toEqual(rows(10));

    act(() => result.current.onPaginationChange(3, 10));
    expect(result.current.pagedList).toEqual([21, 22, 23, 24, 25]);
  });

  it('restarts at page 1 when the page size changes', () => {
    const { result } = renderHook(() => useClientPagination(rows(100)));

    act(() => result.current.onPaginationChange(4, 10));
    expect(result.current.page).toBe(4);

    // Staying on page 4 with 20 rows/page would skip rows 41-60 entirely.
    act(() => result.current.onPaginationChange(1, 20));
    expect(result.current.page).toBe(1);
    expect(result.current.pagedList).toEqual(rows(20));
  });

  it('clamps the offset when the list shrinks past the current page', () => {
    const { result, rerender } = renderHook(
      ({ items }) => useClientPagination(items),
      { initialProps: { items: rows(60) } },
    );

    act(() => result.current.onPaginationChange(6, 10));
    expect(result.current.pagedList).toEqual([
      51, 52, 53, 54, 55, 56, 57, 58, 59, 60,
    ]);

    // A search box narrows the list to 12 rows: page 6 no longer exists.
    rerender({ items: rows(12) });
    expect(result.current.page).toBe(2);
    expect(result.current.pagedList).toEqual([11, 12]);
  });

  it('treats an undefined list as empty without dropping the page size', () => {
    const { result } = renderHook(() => useClientPagination<number>(undefined));

    expect(result.current.total).toBe(0);
    expect(result.current.pagedList).toEqual([]);
    expect(result.current.paginationProps).toMatchObject({
      current: 1,
      pageSize: 10,
      total: 0,
    });
  });
});
