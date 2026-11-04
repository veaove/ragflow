import { expect, test, type APIRequestContext } from '@playwright/test';

import { api, authFile, tokenOf } from '../support/env';

/**
 * 角色 × 资源 × 操作 的矩阵化校验（数据驱动）。
 *
 * 两个账号 = 两个身份：租户所有者（owner）与自定义角色「技术员」的成员（member）。
 * 每个资源类型跑三件事：
 *   1. 可见：member 的列表必须是 owner 列表的子集（不能凭空多出 id）；
 *   2. 可读：member 列表里的每个资源，详情必须 200；
 *   3. 不可见即不可读：owner 有、member 没有的资源，详情必须 4xx 且
 *      message 为 Resource not found（不泄露存在性）。
 *
 * 「可管理」不在这里逐类型探测：各资源的删除/授权接口形态不同（知识库是
 * DELETE /datasets + body、智能体是 /agents/:id 等），逐个猜路径只会测到 gin
 * 的 404。管理类校验集中在 40-overreach（授权/角色/成员写操作 403）。
 */

type Kind = {
  key: string;
  label: string;
  list: string;
  detail: (id: string) => string;
};

const KINDS: Kind[] = [
  { key: 'dataset', label: '知识库', list: api.datasets, detail: api.dataset },
  {
    key: 'chat',
    label: '知识问答',
    list: api.chats,
    detail: (id) => `/api/v1/chats/${id}`,
  },
  {
    key: 'search',
    label: '知识检索',
    list: api.searches,
    detail: (id) => `/api/v1/searches/${id}`,
  },
  {
    key: 'agent',
    label: '智能体',
    list: api.agents,
    detail: (id) => `/api/v1/agents/${id}`,
  },
  {
    key: 'memory',
    label: '记忆',
    list: api.memories,
    detail: (id) => `/api/v1/memories/${id}`,
  },
];

const auth = (who: 'owner' | 'member') => ({ Authorization: tokenOf(who) });

/**
 * 列表统一抽出条目。
 *
 * 各接口的集合字段名不统一（知识库直接是数组，其余是 { total, chats } /
 * { total, searches } / …），逐个列举字段名一旦猜错就会得到「owner 也 0 条」，
 * 矩阵随即静默全 skip —— 那是最难发现的假绿。所以按「data 里最长的对象数组」
 * 取，并且把两边的数量作为 annotation 写进报告，方便一眼看出是不是取错了。
 */
const pickRows = (data: unknown): { id: string; name?: string }[] => {
  if (Array.isArray(data)) return data as { id: string; name?: string }[];
  if (!data || typeof data !== 'object') return [];
  const arrays = Object.values(data as Record<string, unknown>).filter((v) =>
    Array.isArray(v),
  ) as unknown[][];
  const longest = arrays.sort((a, b) => b.length - a.length)[0] ?? [];
  return longest.filter(
    (row): row is { id: string; name?: string } =>
      !!row && typeof row === 'object' && 'id' in (row as Record<string, unknown>),
  );
};

const idsOf = async (request: APIRequestContext, path: string, who: 'owner' | 'member') => {
  const res = await request.get(path, { headers: auth(who) });
  expect(res.status(), `${who} GET ${path} 应 200（401 通常是登录态过期）`).toBe(200);
  const body = await res.json();
  return pickRows(body.data);
};

for (const kind of KINDS) {
  test.describe(`矩阵 · ${kind.label}`, () => {
    test.use({ storageState: authFile('member') });

    test('可见：member 的列表是 owner 的子集', async ({ request }) => {
      const ownerRows = await idsOf(request, kind.list, 'owner');
      const memberRows = await idsOf(request, kind.list, 'member');
      const ownerIDs = new Set(ownerRows.map((r) => r.id));

      // 把数量写进报告：owner=0 通常意味着列表字段取错了（假绿）。
      test.info().annotations.push({
        type: 'counts',
        description: `${kind.label}: owner=${ownerRows.length} member=${memberRows.length}`,
      });

      // 预期：不越权拿到 owner 之外的东西；数量不超过 owner。
      expect(memberRows.length).toBeLessThanOrEqual(ownerRows.length);
      for (const row of memberRows) {
        expect(ownerIDs, `${kind.label} 出现 owner 都看不到的 ${row.id}`).toContain(row.id);
      }
    });

    test('可读：可见的每个资源详情都能打开', async ({ request }) => {
      const memberRows = await idsOf(request, kind.list, 'member');
      test.skip(
        memberRows.length === 0,
        `member 在当前租户没有任何可见的${kind.label}（属预期，列表为空）`,
      );

      for (const row of memberRows.slice(0, 3)) {
        const res = await request.get(kind.detail(row.id), { headers: auth('member') });
        const body = await res.json();
        // 预期：列表能看到的，详情一定打得开（列表与判定用同一套口径）。
        expect(body.code, `${kind.label} ${row.id} 列表可见但详情被拒`).toBe(0);
      }
    });

    test('不可见即不可读：owner 有、member 无的资源 → 404', async ({ request }) => {
      const ownerRows = await idsOf(request, kind.list, 'owner');
      const memberIDs = new Set((await idsOf(request, kind.list, 'member')).map((r) => r.id));
      const hidden = ownerRows.filter((r) => !memberIDs.has(r.id));
      test.skip(hidden.length === 0, `member 能看到全部${kind.label}，没有对照组`);

      for (const row of hidden.slice(0, 3)) {
        const res = await request.get(kind.detail(row.id), { headers: auth('member') });
        const body = await res.json();
        // 预期：拒绝，且不泄露「它存在」。
        expect(body.code, `${kind.label} ${row.id} 不该被 member 读到`).not.toBe(0);

        // 智能体目前回的是「Make sure you have permission to access the agent.」，
        // 其它类型统一回「Resource not found」——两者都拒绝，但前者的措辞等于
        // 承认资源存在（已记为 D6）。这里容忍两种文案，等文案统一后再收紧。
        const denied = /Resource not found|permission to access/i.test(body.message ?? '');
        expect(denied, `未识别的拒绝文案：${body.message}`).toBe(true);
        if (!/Resource not found/.test(body.message ?? '')) {
          test.info().annotations.push({
            type: 'finding',
            description: `${kind.label} 拒绝文案不统一：${body.message}`,
          });
        }
      }
    });

  });
}

test.describe('矩阵 · 会话质检', () => {
  test.use({ storageState: authFile('member') });

  test('可见：member 的规则是 owner 的子集，且随应用可见性收窄', async ({
    request,
  }) => {
    const ownerBody = await (await request.get(api.qcRules, { headers: auth('owner') })).json();
    const memberBody = await (
      await request.get(api.qcRules, { headers: auth('member') })
    ).json();
    expect(ownerBody.code).toBe(0);
    expect(memberBody.code).toBe(0);

    const ownerIDs = new Set((ownerBody.data as { id: string }[]).map((r) => r.id));
    const memberIDs = (memberBody.data as { id: string }[]).map((r) => r.id);
    // 预期：member 一条都看不到（本租户没给他授权任何 chat/canvas 应用）。
    expect(memberIDs.length).toBeLessThanOrEqual(ownerIDs.size);
    for (const id of memberIDs) {
      expect(ownerIDs).toContain(id);
    }
  });
});
