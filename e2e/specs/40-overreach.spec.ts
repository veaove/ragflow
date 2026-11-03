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

  test('FINDING：成员能读到资源授权树（只读管理视角）', async ({
    request,
  }) => {
    const res = await request.get(api.grantTree(TID), {
      headers: { Authorization: tokenOf('member') },
    });
    const body = await res.json();
    // 当前实现：grant.view 放行，树里是全部 18 个库（含 member 打不开的私库）。
    // 只读、写操作已 403，但仍属信息暴露，记录在 PLAN.md「已知缺陷」。
    expect(body.code).toBe(0);
    expect(body.data.total).toBe(18);
  });

  test('FINDING：质检规则未按资源授权过滤', async ({ request }) => {
    const res = await request.get(api.qcRules, {
      headers: { Authorization: tokenOf('member') },
    });
    const body = await res.json();
    expect(body.code).toBe(0);
    // 当前实现：规则按租户返回，与「归属应用是否可见」无关。
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });

  test.fixme(
    '缺陷：成员看不到自己创建的私库（详情 200 / 列表缺失）',
    async ({ request }) => {
      const detail = await request.get(api.dataset(RESOURCES.memberOwnKb.id), {
        headers: { Authorization: tokenOf('member') },
      });
      expect((await detail.json()).code).toBe(0);

      const list = await request.get(api.datasets, {
        headers: { Authorization: tokenOf('member') },
      });
      const names = ((await list.json()).data as { name: string }[]).map(
        (d) => d.name,
      );
      // 期望成立（创建者恒可见），当前实现不成立：列表 scope 只认
      // owner / team / 授权 / 部门管理员，漏了 created_by = 本人。
      expect(names).toContain(RESOURCES.memberOwnKb.name);
    },
  );
});
