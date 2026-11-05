import type { APIRequestContext } from '@playwright/test';

/**
 * 列表条目。
 *
 * 除 id 外全部按需读取：各接口的字段名不一致（`title` / `name`），而且有的接口
 * 会把「调用者自己的私有条目」混进同一份列表（例如 `/agents` 会并入
 * `type=compilation_template_group` 的编译算子组），断言前需要看得到这些字段。
 */
export type ListRow = { id: string; name?: string; title?: string; type?: string } & Record<
  string,
  unknown
>;

/**
 * 列表接口统一抽出条目。
 *
 * 各接口的集合字段名不统一（知识库直接是数组，其余是 { total, chats } /
 * { total, searches } / …），逐个列举字段名一旦猜错就会得到「owner 也 0 条」，
 * 矩阵随即静默全 skip —— 那是最难发现的假绿。所以按「data 里最长的对象数组」
 * 取，并且调用方要把数量作为 annotation 写进报告，方便一眼看出是不是取错了。
 */
export const pickRows = (data: unknown): ListRow[] => {
  if (Array.isArray(data)) return data as ListRow[];
  if (!data || typeof data !== 'object') return [];
  const arrays = Object.values(data as Record<string, unknown>).filter((v) =>
    Array.isArray(v),
  ) as unknown[][];
  const longest = arrays.sort((a, b) => b.length - a.length)[0] ?? [];
  return longest.filter(
    (row): row is ListRow =>
      !!row && typeof row === 'object' && 'id' in (row as Record<string, unknown>),
  );
};

/** 以指定身份拉一次列表，返回条目；非 200 直接抛错（多半是登录态过期）。 */
export const fetchRows = async (
  request: APIRequestContext,
  path: string,
  authorization: string,
): Promise<ListRow[]> => {
  const res = await request.get(path, { headers: { Authorization: authorization } });
  if (res.status() !== 200) {
    throw new Error(`GET ${path} -> HTTP ${res.status()}（401 通常是登录态过期）`);
  }
  const body = await res.json();
  return pickRows(body.data);
};
