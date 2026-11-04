import { expect, test } from '@playwright/test';

import { IDENTITIES, api, authFile, tokenOf } from '../support/env';

const TID = IDENTITIES.owner.tenantId;

/**
 * 资源级「排除」的正向链路 —— **会写数据，默认不跑**。
 *
 *   E2E_ALLOW_WRITE=1 npx playwright test specs/85-exclude-flow.spec.ts
 *
 * 为什么必须显式开启：这条链路要真的建一个知识库、写授权、再删掉。跑在真实
 * 租户上，任何一步失败都可能留下垃圾数据，所以只给发版验收用。
 * 库名带随机后缀，beforeAll 建、afterAll 删，删不掉会打印 id 供人工清理。
 */
test.describe('资源级排除 · 正向链路', () => {
  test.skip(
    !process.env.E2E_ALLOW_WRITE,
    '写用例：需要 E2E_ALLOW_WRITE=1 显式开启（会建/删一个临时知识库）',
  );

  test.use({ storageState: authFile('owner') });

  const headers = () => ({
    Authorization: tokenOf('owner'),
    'Content-Type': 'application/json',
  });
  const memberHeaders = () => ({
    Authorization: tokenOf('member'),
    'Content-Type': 'application/json',
  });

  let kbID = '';
  let memberID = '';
  const kbName = `E2E-排除验证-${Date.now()}`;

  test.beforeAll(async ({ request }) => {
    // 建库必须带 embedding_model + parser_id + parse_type：直接借一个现有库的
    // embedding_model（模型 id 是租户级配置，写死会随环境漂移）。
    const list = await (await request.get(api.datasets, { headers: headers() })).json();
    const sample = (list.data as { embedding_model?: string }[]).find(
      (d) => d.embedding_model,
    );
    expect(sample?.embedding_model, '租户里没有可借用的 embedding_model').toBeTruthy();

    const created = await (
      await request.post(api.datasets, {
        headers: headers(),
        data: {
          name: kbName,
          embedding_model: sample!.embedding_model,
          parser_id: 'general',
          parse_type: 1,
        },
      })
    ).json();
    expect(created.code, `创建临时知识库失败：${created.message}`).toBe(0);
    kbID = created.data.id;

    const me = await (
      await request.get('/api/v1/users/me', { headers: memberHeaders() })
    ).json();
    memberID = me.data.id;
    expect(memberID, '拿不到 member 的 user id').toBeTruthy();
  });

  test.afterAll(async ({ request }) => {
    if (!kbID) return;
    const res = await request.delete(api.datasets, {
      headers: headers(),
      data: { ids: [kbID] },
    });
    const body = await res.json();
    if (body.code !== 0) {
      // 清理失败要留下线索，别让临时库悄悄留在租户里。
      console.error(`[85] 临时知识库未删除，请手工清理：${kbID} (${kbName})`);
    }
  });

  test('全团队允许 + 单人排除 → 该成员看不到、打不开；其他人正常', async ({
    request,
  }) => {
    // 1) 先给全团队可编辑：此时 member 应该能看见。
    const allowAll = await (
      await request.put(api.setGrants(TID, 'dataset', kbID), {
        headers: headers(),
        data: {
          subjects: [{ kind: 'team', id: '', permission: 'edit', effect: 'allow' }],
        },
      })
    ).json();
    expect(allowAll.code, `写入全团队授权失败：${allowAll.message}`).toBe(0);

    const beforeRead = await (
      await request.get(api.dataset(kbID), { headers: memberHeaders() })
    ).json();
    expect(beforeRead.code, '全团队可编辑时 member 应该能读').toBe(0);

    // 2) 追加一条对 member 的排除：deny 应压过上面那条 team allow。
    const withDeny = await (
      await request.put(api.setGrants(TID, 'dataset', kbID), {
        headers: headers(),
        data: {
          subjects: [
            { kind: 'team', id: '', permission: 'edit', effect: 'allow' },
            { kind: 'user', id: memberID, permission: 'read', effect: 'deny' },
          ],
        },
      })
    ).json();
    expect(withDeny.code, `写入排除失败：${withDeny.message}`).toBe(0);

    // 3) 可见：列表里不出现。
    const list = await (
      await request.get(api.datasets, { headers: memberHeaders() })
    ).json();
    const ids = (list.data as { id: string }[]).map((d) => d.id);
    expect(ids, '被排除的库不应出现在 member 的列表里').not.toContain(kbID);

    // 4) 可读：详情 404 语义，且不泄露存在性。
    const denied = await (
      await request.get(api.dataset(kbID), { headers: memberHeaders() })
    ).json();
    expect(denied.code, '被排除的库详情应拒绝').not.toBe(0);
    expect(denied.message).toContain('Resource not found');

    // 5) 对照：owner 自己不受影响（排除对管理层无效）。
    const ownerRead = await (
      await request.get(api.dataset(kbID), { headers: headers() })
    ).json();
    expect(ownerRead.code, 'owner 不应被自己的排除规则挡住').toBe(0);
  });

  test('移除排除后恢复可见（排除是可撤销的，不是一次性降级）', async ({
    request,
  }) => {
    const removed = await (
      await request.put(api.setGrants(TID, 'dataset', kbID), {
        headers: headers(),
        data: {
          subjects: [{ kind: 'team', id: '', permission: 'edit', effect: 'allow' }],
        },
      })
    ).json();
    expect(removed.code, `移除排除失败：${removed.message}`).toBe(0);

    const list = await (
      await request.get(api.datasets, { headers: memberHeaders() })
    ).json();
    const ids = (list.data as { id: string }[]).map((d) => d.id);
    expect(ids, '移除排除后 member 应重新看到该库').toContain(kbID);

    const read = await (
      await request.get(api.dataset(kbID), { headers: memberHeaders() })
    ).json();
    expect(read.code).toBe(0);
    expect(read.data.id).toBe(kbID);
  });
});
