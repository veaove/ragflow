import { request as playwrightRequest } from '@playwright/test';

import { BASE_URL, tokenOf } from './env';
import { fetchRows, type ListRow } from './list-rows';

/**
 * 同一个列表接口在 owner 与 member 两个身份下的差集。
 *
 * 目标环境是真实租户，授权随时会变（2026-11-05 就有三个问答/搜索被临时开成
 * 「全团队」）。把「member 看到几条」写死，数据一变就假红；这里统一改成从两份
 * 列表求差集：
 *   member —— 成员当下该看到的；
 *   hidden —— owner 看得到而成员看不到的，也就是「绝不能出现在成员页面上」的样本。
 */
export type ScopeDiff = {
  owner: ListRow[];
  member: ListRow[];
  hidden: ListRow[];
};

export const compareScope = async (path: string): Promise<ScopeDiff> => {
  const client = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    const owner = await fetchRows(client, path, tokenOf('owner'));
    const member = await fetchRows(client, path, tokenOf('member'));
    const memberIDs = new Set(member.map((row) => row.id));
    return { owner, member, hidden: owner.filter((row) => !memberIDs.has(row.id)) };
  } finally {
    await client.dispose();
  }
};

/** 列表条目的展示名：各接口的字段名不统一。 */
export const displayName = (row: ListRow): string =>
  String(row.name ?? row.title ?? '').trim();
