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

import { useCallback, useEffect, useMemo, useState } from 'react';

const DEFAULT_CLIENT_PAGE_SIZE = 10;

/**
 * Client-side pagination for lists whose data source returns everything at
 * once (tenant members, org units, the audit tail, agent versions…).
 *
 * Server-paginated lists must NOT use this: they keep page/pageSize in the URL
 * (`useGetPaginationWithRouter`) and send the offset upstream, so slicing here
 * would paginate an already-paginated page. This exists so a full-list table can
 * still offer the same size changer as the rest of the product instead of
 * rendering every row.
 */
export function useClientPagination<T>(
  list: T[] | undefined,
  options?: { defaultPageSize?: number },
) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(
    options?.defaultPageSize ?? DEFAULT_CLIENT_PAGE_SIZE,
  );

  const items = useMemo(() => list ?? [], [list]);
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  // Filtering (search box) or deleting a row can leave the offset past the end
  // of the list; without this the table goes blank while `total` is non-zero.
  useEffect(() => {
    if (page > pageCount) {
      setPage(pageCount);
    }
  }, [page, pageCount]);

  // Dropping the size argument is what made the product-wide "pick 100, still
  // shows 20" bug: the size changer would only repaint itself. Keeping the
  // second argument required here forces every caller to think about it.
  const onPaginationChange = useCallback(
    (nextPage: number, nextSize: number) => {
      if (nextSize && nextSize !== pageSize) {
        setPageSize(nextSize);
        setPage(1);
        return;
      }
      setPage(nextPage);
    },
    [pageSize],
  );

  const pagedList = useMemo(() => {
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize]);

  /** Ready to spread onto <RAGFlowPagination {...paginationProps} />. */
  const paginationProps = {
    current: page,
    pageSize,
    total,
    onChange: onPaginationChange,
  };

  return {
    page,
    pageSize,
    total,
    setPage,
    setPageSize,
    onPaginationChange,
    pagedList,
    paginationProps,
  };
}
