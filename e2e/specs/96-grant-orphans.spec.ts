import { expect, test, type APIRequestContext } from '@playwright/test';

import { api, authFile, IDENTITIES, tokenOf } from '../support/env';

/**
 * 孤儿授权：指向「已删除资源」的规则。
 *
 * 删除资源时会在同一事务里清掉它的规则（deleteDataset / deleteDocRecordWithCounters），
 * 这条用例守的是更外一层：即使库里混进了历史孤儿行（清理被绕过、直接改库），
 * 「按成员」视角也不能把它们列成空白 —— 解释不了来源，点不进去，还把页头的
 * 授权条数抬高。线上 2026-11-09 清理过 8 条历史孤儿（5 库 + 3 文件）。
 */

type Row = { resource_kind: string; resource_id: string; resource_name: string };

const TID = IDENTITIES.owner.tenantId;

const rowsOf = async (
  request: APIRequestContext,
  who: keyof typeof IDENTITIES,
  subjectID: string,
): Promise<Row[]> => {
  const res = await request.get(api.grantsBySubject(TID, subjectID), {
    headers: { Authorization: tokenOf(who) },
  });
  expect(res.status(), `${who} 查 ${subjectID} 的按成员视角应 200`).toBe(200);
  const body = await res.json();
  expect(body.code).toBe(0);
  return (body.data?.rows ?? []) as Row[];
};

test.describe('按成员视角 · 孤儿授权', () => {
  test.use({ storageState: authFile('owner') });

  test('不展示指向已删资源的规则', async ({ request }) => {
    const graph = await request.get(api.grantGraph(TID), {
      headers: { Authorization: tokenOf('owner') },
    });
    const members = ((await graph.json()).data?.members ?? []) as { id: string; name: string }[];
    expect(members.length, '租户成员列不应为空').toBeGreaterThan(0);

    for (const member of members) {
      const rows = await rowsOf(request, 'owner', member.id);
      const blank = rows.filter((row) => !row.resource_name || !row.resource_name.trim());
      expect(
        blank,
        `${member.name} 名下有 ${blank.length} 条指向已删资源的规则：` +
          JSON.stringify(blank.map((row) => `${row.resource_kind}/${row.resource_id}`)),
      ).toEqual([]);
    }
  });
});
