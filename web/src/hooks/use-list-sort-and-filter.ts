import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';

/**
 * 应用列表的排序维度（产品文档《交互调整说明》3.4）。
 *
 * 取值即后端 `sort` 参数的 `column:direction` 形式，列名取自后端
 * userCanvasOrderableColumns 白名单（title / update_time / create_time）。
 */
export type ListSortKey =
  | 'updated_desc' // 最近更新
  | 'updated_asc' // 最久未更新
  | 'title_asc' // 名称 A-Z
  | 'title_desc'; // 名称 Z-A

export const LIST_SORT_OPTIONS: {
  key: ListSortKey;
  sort: string;
  labelKey: string;
}[] = [
  { key: 'updated_desc', sort: 'update_time:desc', labelKey: 'studio.sortRecent' },
  { key: 'title_asc', sort: 'title:asc', labelKey: 'studio.sortNameAsc' },
  { key: 'title_desc', sort: 'title:desc', labelKey: 'studio.sortNameDesc' },
  { key: 'updated_asc', sort: 'update_time:asc', labelKey: 'studio.sortOldest' },
];

const SORT_KEYS = LIST_SORT_OPTIONS.map((o) => o.key);

export const DEFAULT_LIST_SORT: ListSortKey = 'updated_desc';

/**
 * 列表的排序 + 状态筛选状态机。
 *
 * 两个状态都落在 URL query 上：
 *   - sort     排序维度
 *   - release  发布状态（true 已发布 / false 草稿，缺省表示全部）
 *
 * 放 URL 而不是组件 state，是为了让「筛选 + 排序 + 分页」三者的组合可分享、
 * 可前进后退，也避免刷新后丢失用户已经选好的维度。
 *
 * 统一规则（产品文档 3.4）：改任一筛选或排序都回到第 1 页；任一筛选生效
 * 时才出现「重置筛选」；空态按「有没有搜索词」区分原因。
 */
export function useListSortAndFilter() {
  const [searchParams, setSearchParams] = useSearchParams();

  const rawSort = searchParams.get('sort');
  const sortKey: ListSortKey = SORT_KEYS.includes(rawSort as ListSortKey)
    ? (rawSort as ListSortKey)
    : DEFAULT_LIST_SORT;

  const rawRelease = searchParams.get('release');
  const release =
    rawRelease === 'true' ? true : rawRelease === 'false' ? false : undefined;

  const sortOption =
    LIST_SORT_OPTIONS.find((o) => o.key === sortKey) ?? LIST_SORT_OPTIONS[0];

  const update = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams);
      mutate(params);
      // 改筛选/排序后回到第 1 页：旧页码在新结果集下可能不存在。
      params.delete('page');
      setSearchParams(params);
    },
    [searchParams, setSearchParams],
  );

  const setSort = useCallback(
    (key: ListSortKey) =>
      update((params) => {
        if (key === DEFAULT_LIST_SORT) {
          params.delete('sort');
        } else {
          params.set('sort', key);
        }
      }),
    [update],
  );

  const setRelease = useCallback(
    (value: boolean | undefined) =>
      update((params) => {
        if (value === undefined) {
          params.delete('release');
        } else {
          params.set('release', value ? 'true' : 'false');
        }
      }),
    [update],
  );

  /** Whether any filter (other than the default sort) is active. */
  const hasActiveFilter = useMemo(
    () => release !== undefined || sortKey !== DEFAULT_LIST_SORT,
    [release, sortKey],
  );

  const resetFilters = useCallback(() => {
    const params = new URLSearchParams(searchParams);
    params.delete('release');
    params.delete('sort');
    params.delete('page');
    setSearchParams(params);
  }, [searchParams, setSearchParams]);

  return {
    sortKey,
    sort: sortOption.sort,
    release,
    setSort,
    setRelease,
    hasActiveFilter,
    resetFilters,
  };
}
