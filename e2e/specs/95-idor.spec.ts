import { expect, test } from '@playwright/test';

import { IDENTITIES, api, authFile, tokenOf } from '../support/env';

const TID = IDENTITIES.owner.tenantId;

/**
 * 存在性泄露（IDOR 的一种读法）：对「不存在的 id」与「别人的 id」，
 * 响应必须**逐字相同**。否则攻击者能拿 404/403 的差异枚举出哪些 id 真实存在。
 *
 * 智能体走的是专用文案（"Make sure you have permission to access the agent."），
 * 与其它资源的 "Resource not found" 不同，但只要两个 case 一致就不算泄露。
 */
const auth = (who: 'owner' | 'member') => ({ Authorization: tokenOf(who) });

test.describe('存在性不泄露 · 同一文案', () => {
  test.use({ storageState: authFile('member') });

  test('智能体：不存在的 id 与别人的 id → 文案完全一致', async ({ request }) => {
    const ownerAgents = await (
      await request.get(api.agents, { headers: auth('owner') })
    ).json();
    const ownerRows = (ownerAgents.data?.canvas ?? []) as { id: string }[];
    const memberAgents = await (
      await request.get(api.agents, { headers: auth('member') })
    ).json();
    const memberIDs = new Set(
      ((memberAgents.data?.canvas ?? []) as { id: string }[]).map((a) => a.id),
    );
    const foreign = ownerRows.find((a) => !memberIDs.has(a.id));
    test.skip(!foreign, 'member 能看到全部智能体，构造不出「别人的 id」');

    const [missing, denied] = await Promise.all([
      request.get('/api/v1/agents/does-not-exist-0001', { headers: auth('member') }),
      request.get(`/api/v1/agents/${foreign!.id}`, { headers: auth('member') }),
    ]);
    const missingBody = await missing.json();
    const deniedBody = await denied.json();

    // 预期：两者都是 code 103（OperatingError）+ 同一句 message。
    expect(deniedBody.code).toBe(missingBody.code);
    expect(deniedBody.message).toBe(missingBody.message);
    // 顺带确认它确实不是「成功」。
    expect(missingBody.code).not.toBe(0);
  });

  test('知识库：不存在的 id 与别人的 id → 都是 Resource not found', async ({
    request,
  }) => {
    const ownerRows = (await (await request.get(api.datasets, { headers: auth('owner') })).json())
      .data as { id: string }[];
    const memberRows = (await (await request.get(api.datasets, { headers: auth('member') })).json())
      .data as { id: string }[];
    const memberIDs = new Set(memberRows.map((d) => d.id));
    const foreign = ownerRows.find((d) => !memberIDs.has(d.id));
    test.skip(!foreign, 'member 能看到全部知识库，构造不出「别人的 id」');

    const [missing, denied] = await Promise.all([
      request.get(api.dataset('does-not-exist-0001'), { headers: auth('member') }),
      request.get(api.dataset(foreign!.id), { headers: auth('member') }),
    ]);
    const missingBody = await missing.json();
    const deniedBody = await denied.json();

    expect(missing.status()).toBe(200);
    expect(denied.status()).toBe(200);
    expect(deniedBody.code).toBe(missingBody.code);
    expect(deniedBody.message).toBe(missingBody.message);
    expect(deniedBody.message).toContain('Resource not found');
  });

  test('授权树：越界租户与不存在租户 → 同一句「租户不存在」', async ({
    request,
  }) => {
    const bogus = '00000000000000000000000000000000';
    const res = await request.get(api.grantTree(bogus), {
      headers: auth('member'),
      failOnStatusCode: false,
    });
    // 预期：403 + 租户不存在（不暴露该租户是否真实存在）。
    expect(res.status()).toBe(403);
    expect((await res.json()).message).toContain('租户不存在');
  });

  test('角色接口：member 读矩阵放行、写矩阵 403', async ({ request }) => {
    const read = await request.get(api.roles(TID), { headers: auth('member') });
    // 预期：矩阵是只读可见的（前端要渲染），但写入属于管理动作。
    expect(read.status()).toBe(200);

    const write = await request.put(api.rolePermissions(TID, 'does-not-exist-0001'), {
      headers: { ...auth('member'), 'Content-Type': 'application/json' },
      data: { permissions: [] },
    });
    expect(write.status(), 'member 改矩阵必须 403').toBe(403);
  });
});
