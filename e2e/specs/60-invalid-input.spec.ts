import { expect, test } from '@playwright/test';

import { IDENTITIES, api, authFile, tokenOf } from '../support/env';

const TID = IDENTITIES.owner.tenantId;

/**
 * 异常输入。只读：所有写请求要么打不存在的资源，要么在解析/校验阶段就被拒绝，
 * 不会落库。每条用例标题即预期结果。
 */
test.describe('异常输入 · 请求体与鉴权', () => {
  test.use({ storageState: authFile('owner') });

  const headers = () => ({
    Authorization: tokenOf('owner'),
    'Content-Type': 'application/json',
  });

  test('授权写入体不是合法 JSON → HTTP 400', async ({ request }) => {
    // data 传字符串时 Playwright 原样发送，正好构造出畸形 body。
    const raw = await request.fetch(
      api.setGrants(TID, 'dataset', 'does-not-exist-0001'),
      {
        method: 'PUT',
        headers: headers(),
        data: '{not json',
        failOnStatusCode: false,
      },
    );
    // 预期：解析失败按 400 返回，且优先于权限/资源校验（不写出任何东西）。
    expect(raw.status()).toBe(400);
    expect((await raw.json()).code).toBe(400);
  });

  test('授权写入 kind 非法 → code 非 0「不支持的资源类型」', async ({
    request,
  }) => {
    const body = await (
      await request.put(api.setGrants(TID, 'bogus', 'does-not-exist-0001'), {
        headers: headers(),
        data: { subjects: [] },
      })
    ).json();
    // 预期：先校验类型再查资源，避免把未知 kind 当成某个真实表去查。
    expect(body.code).not.toBe(0);
    expect(body.message).toContain('不支持的资源类型');
  });

  test('授权写入打不存在的资源 → code 非 0，且不落任何行', async ({
    request,
  }) => {
    const body = await (
      await request.put(api.setGrants(TID, 'dataset', 'does-not-exist-0001'), {
        headers: headers(),
        data: { subjects: [{ kind: 'user', id: 'does-not-exist-0002' }] },
      })
    ).json();
    expect(body.code).not.toBe(0);
    expect(body.message).toContain('资源不存在');
  });

  test('质检规则 app_type / app_id 必须成对 → code 101', async ({
    request,
  }) => {
    const onlyType = await (
      await request.get(`${api.qcRules}?app_type=chat`, { headers: headers() })
    ).json();
    const onlyID = await (
      await request.get(`${api.qcRules}?app_id=chat-1`, { headers: headers() })
    ).json();
    // 预期：成对校验，避免「只给类型」时退化成全租户扫描。
    expect(onlyType.code).toBe(101);
    expect(onlyID.code).toBe(101);
    expect(onlyType.message).toContain('must be provided together');
  });

  test('不带 Authorization → HTTP 401「Missing Authorization header」', async ({
    request,
  }) => {
    const res = await request.get(api.grantTree(TID), { failOnStatusCode: false });
    // 预期：未认证在路由中间件处就被拦下，不进业务逻辑。
    expect(res.status()).toBe(401);
    expect((await res.json()).message).toContain('Missing Authorization header');
  });

  test('伪造 token → HTTP 401「Invalid access token」', async ({ request }) => {
    const res = await request.get(api.grantTree(TID), {
      headers: { Authorization: 'Bearer forged-token' },
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(401);
    expect((await res.json()).message).toContain('Invalid access token');
  });
});

test.describe('异常输入 · 普通成员指向他人租户', () => {
  test.use({ storageState: authFile('member') });

  test('请求里塞别的租户 id → 403，不回落到自己的租户', async ({
    request,
  }) => {
    const headers = { Authorization: tokenOf('member') };
    const res = await request.get(
      api.grants('00000000000000000000000000000000'),
      { headers, failOnStatusCode: false },
    );
    const body = await res.json();
    // 预期：租户由路径显式指定时必须按其校验，不能因为「调用者有自己的租户」
    // 就悄悄换成自己的数据（否则越权探测会得到 200 而看不出异常）。
    expect(res.status()).toBe(403);
    expect(body.message).toContain('租户不存在');
  });
});
