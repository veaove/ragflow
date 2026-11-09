import { expect, test, type APIRequestContext } from '@playwright/test';

import { api, authFile, IDENTITIES, tokenOf } from '../support/env';

/**
 * 孤儿授权：指向「已删除资源」的规则。
 *
 * 删知识库 / 删文件都不会级联删 `resource_grant`，于是库里留着这些行。它们既
 * 没有名字也没有归属，在「按成员」视角里表现为一行空白 —— 解释不了来源，点不
 * 进去，还把页头的授权条数抬高。线上 2026-11-09 实测有 8 条（5 库 + 3 文件）。
 *
 * 修法是不展示（`grantResourceLabels` 报 missing，`GrantsBySubject` 丢行），
 * 数据本身仍然建议清一次。
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
