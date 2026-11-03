import { expect, test } from '@playwright/test';

import { IDENTITIES, api, authFile, tokenOf } from '../support/env';

const TID = IDENTITIES.owner.tenantId;

/** 边界条件。只读：分页上下界、通配符、超长参数、必填缺失、越界 id。 */
test.describe('边界条件 · 分页与查询参数', () => {
  test.use({ storageState: authFile('owner') });

  const headers = () => ({
    Authorization: tokenOf('owner'),
    'Content-Type': 'application/json',
  });

  test('page=0 → code 101，不落到 SQL 的 LIMIT 0', async ({ request }) => {
    const body = await (
      await request.get(`${api.datasets}?page=0&page_size=0`, {
        headers: headers(),
      })
    ).json();
    // 预期：参数校验先于查询。若 LIMIT 0 放行，前端会把「参数错」当成「没有数据」。
    expect(body.code).toBe(101);
    expect(body.message).toContain('greater than or equal to 1');
  });

  test('page 为负数 → code 101，不透传负 offset', async ({ request }) => {
    const body = await (
      await request.get(`${api.datasets}?page=-1&page_size=1000`, {
        headers: headers(),
      })
    ).json();
    expect(body.code).toBe(101);
  });

  test('page_size=1000 → 夹紧到上限，行数与 total 一致', async ({
    request,
  }) => {
    const body = await (
      await request.get(`${api.grants(TID)}&page_size=1000`, {
        headers: headers(),
      })
    ).json();
    expect(body.code).toBe(0);
    // 预期：page_size 超过 200 时回落到默认 20（不是报错、也不是真的取 1000 条）；
    // 本租户 18 个库 < 20，所以一页就取完。
    expect(body.data.total).toBe(18);
    expect(body.data.resources.length).toBe(18);
  });

  test("keywords='%' → 按字面量匹配，不变成通配符", async ({ request }) => {
    const body = await (
      await request.get(
        `${api.grantTree(TID)}&keywords=${encodeURIComponent('%')}`,
        { headers: headers() },
      )
    ).json();
    // 预期：参数化查询把 % 当普通字符，没有库名含 %，total=0。
    // 若被拼进 LIKE 会返回全部 18 个库 —— 这是注入的起点。
    expect(body.code).toBe(0);
    expect(body.data.total).toBe(0);
  });

  test('keywords 超长（300 字符）→ code 0，不 500', async ({ request }) => {
    const body = await (
      await request.get(`${api.grantTree(TID)}&keywords=${'a'.repeat(300)}`, {
        headers: headers(),
      })
    ).json();
    expect(body.code).toBe(0);
    expect(body.data.total).toBe(0);
  });

  test('grant-exceptions 缺 dataset_id → code 102「缺少知识库 id」', async ({
    request,
  }) => {
    const body = await (
      await request.get(`${api.grantExceptions(TID)}?kind=dataset`, {
        headers: headers(),
      })
    ).json();
    // 预期：必填缺失明确报错，而不是空列表（空列表会被读成「这个库没有文件」）。
    expect(body.code).toBe(102);
    expect(body.message).toContain('缺少知识库 id');
  });

  test('不存在的租户 → HTTP 403「租户不存在」', async ({ request }) => {
    const res = await request.get(api.grantTree('00000000000000000000000000000000'), {
      headers: headers(),
    });
    const body = await res.json();
    // 预期：无成员关系直接 403，不返回 200 + 空树（后者无法区分「没数据」与「不属于」）。
    expect(res.status()).toBe(403);
    expect(body.message).toContain('租户不存在');
  });

  test('未知资源类型：grants 与 grant-tree 都显式报错', async ({
    request,
  }) => {
    const grants = await (
      await request.get(api.grants(TID, 'bogus'), { headers: headers() })
    ).json();
    expect(grants.code).not.toBe(0);
    expect(grants.message).toContain('不支持的资源类型');

    const tree = await (
      await request.get(api.grantTree(TID, 'bogus'), { headers: headers() })
    ).json();
    expect(tree.code).not.toBe(0);
    expect(tree.message).toContain('没有层级结构');
  });

  test('不存在的资源 id → 与「无权访问」同一条 message', async ({
    request,
  }) => {
    const body = await (
      await request.get(api.dataset('does-not-exist-0001'), {
        headers: headers(),
      })
    ).json();
    // 预期：不泄露存在性，404 与 403 都用 Resource not found。
    expect(body.code).not.toBe(0);
    expect(body.message).toContain('Resource not found');
  });
});

test.describe('边界条件 · 普通成员的越界查询', () => {
  test.use({ storageState: authFile('member') });

  test('查他人授权清单 → 403；查自己 → 200（D2 回归）', async ({
    request,
  }) => {
    const headers = { Authorization: tokenOf('member') };

    const ownerID = (
      (await (
        await request.get('/api/v1/users/me', {
          headers: { Authorization: tokenOf('owner') },
        })
      ).json()) as { data: { id: string } }
    ).data.id;
    const other = await request.get(api.grantsBySubject(TID, ownerID), {
      headers,
    });
    // 预期：「他能看到什么」是管理视角，普通成员只能自查。
    expect(other.status(), '查他人授权应被 403 拦截').toBe(403);

    const me = (await (await request.get('/api/v1/users/me', { headers })).json())
      .data as { id: string };
    const self = await request.get(api.grantsBySubject(TID, me.id), { headers });
    // 预期：自查放行，返回本人可见资源清单（code=0）。
    expect(self.status()).toBe(200);
    expect((await self.json()).code).toBe(0);
  });
});
