import { expect, test } from '@playwright/test';

import { IDENTITIES, RESOURCES, api, authFile, tokenOf } from '../support/env';

const TID = IDENTITIES.owner.tenantId;

/**
 * 越权访问。全部只读：写操作一律打「不存在的资源 id」，
 * 权限层放行才会走到「资源不存在」，因此能证明授权结果而不改任何数据。
 */
test.describe('越权访问 · 普通成员', () => {
  test.use({ storageState: authFile('member') });

  test('读别人的私有知识库 → 404，且不泄露存在性', async ({ request }) => {
    const res = await request.get(api.dataset(RESOURCES.privateKb.id), {
      headers: { Authorization: tokenOf('member') },
    });
    const body = await res.json();
    expect(body.code).not.toBe(0);
    expect(body.message).toContain('Resource not found');
  });

  test('读被授权的知识库 → 200', async ({ request }) => {
    const res = await request.get(api.dataset(RESOURCES.grantedKb.id), {
      headers: { Authorization: tokenOf('member') },
    });
    const body = await res.json();
    expect(body.code).toBe(0);
    expect(body.data.id).toBe(RESOURCES.grantedKb.id);
  });

  test('改资源授权 / 角色矩阵 / 成员角色 → 403（与矩阵无关）', async ({
    request,
  }) => {
    const headers = {
      Authorization: tokenOf('member'),
      'Content-Type': 'application/json',
    };

    const grant = await request.put(
      api.setGrants(TID, 'dataset', 'does-not-exist-0001'),
      { headers, data: { subjects: [] } },
    );
    expect(grant.status(), '资源授权写入应被 403 拦截').toBe(403);

    const role = await request.put(
      api.rolePermissions(TID, 'does-not-exist-0001'),
      { headers, data: { permissions: [] } },
    );
    expect(role.status(), '角色矩阵写入应被 403 拦截').toBe(403);

    const member = await request.put(
      api.member(TID, 'does-not-exist-0001'),
      { headers, data: { role_id: '' } },
    );
    expect(member.status(), '成员角色变更应被 403 拦截').toBe(403);
  });

  test('授权树只含本人可读的资源（D2 回归）', async ({ request }) => {
    const headers = { Authorization: tokenOf('member') };
    const tree = await (await request.get(api.grantTree(TID), { headers })).json();
    expect(tree.code).toBe(0);

    // 预期：member 只看到自己可读的库（被授权库 + 自建库），看不到
    // RESOURCES.privateKb（owner 的私库）。
    const ids = (tree.data.nodes as { id: string }[]).map((n) => n.id);
    expect(ids).toContain(RESOURCES.grantedKb.id);
    expect(ids).not.toContain(RESOURCES.privateKb.id);
    expect(tree.data.total).toBe(ids.length);

    // 与列表接口保持一致：树里的库必须都在 /datasets 里出现。
    const list = await (await request.get(api.datasets, { headers })).json();
    const listIds = (list.data as { id: string }[]).map((d) => d.id);
    for (const id of ids) {
      expect(listIds, `授权树里的 ${id} 应同时出现在知识库列表`).toContain(id);
    }
  });

  test('读不到的库按 id 展开子项 → 拒绝（D2 回归）', async ({ request }) => {
    const headers = { Authorization: tokenOf('member') };
    // 预期：不能靠换 id 绕过树上的收窄，子项接口直接拒绝，不返回任何文件名。
    const denied = await (
      await request.get(
        `${api.grantExceptions(TID)}?kind=dataset&dataset_id=${RESOURCES.privateKb.id}`,
        { headers },
      )
    ).json();
    expect(denied.code).not.toBe(0);
    expect(denied.data?.total ?? 0).toBe(0);

    // 对照组：读得到的库可以正常展开（证明拒绝来自权限，不是接口本身报错）。
    const allowed = await (
      await request.get(
        `${api.grantExceptions(TID)}?kind=dataset&dataset_id=${RESOURCES.grantedKb.id}`,
        { headers },
      )
    ).json();
    expect(allowed.code).toBe(0);
  });

  test('质检规则跟随应用可见性（D3 回归）', async ({ request }) => {
    const res = await request.get(api.qcRules, {
      headers: { Authorization: tokenOf('member') },
    });
    const body = await res.json();
    expect(body.code).toBe(0);
    // 预期：member 一个可配置应用都看不到（/qc 页面为空态），规则列表也应为空；
    // 租户管理层的列表不受影响（见下方 owner 用例）。
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(0);

    const ownerRes = await request.get(api.qcRules, {
      headers: { Authorization: tokenOf('owner') },
    });
    const ownerBody = await ownerRes.json();
    expect(ownerBody.code).toBe(0);
    expect(ownerBody.data.length).toBeGreaterThan(0);
  });

  test('成员能看到自己创建的私库（D1 回归）', async ({ request }) => {
    const headers = { Authorization: tokenOf('member') };
    const detail = await request.get(api.dataset(RESOURCES.memberOwnKb.id), {
      headers,
    });
    expect((await detail.json()).code).toBe(0);

    const list = await request.get(api.datasets, { headers });
    const names = ((await list.json()).data as { name: string }[]).map(
      (d) => d.name,
    );
    // 预期：创建者恒可见，列表与详情的可见集合一致。
    expect(names).toContain(RESOURCES.memberOwnKb.name);
  });
});
