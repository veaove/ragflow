import { expect, test } from '@playwright/test';

import { IDENTITIES, RESOURCES, api, authFile, tokenOf } from '../support/env';

const TID = IDENTITIES.owner.tenantId;

/**
 * 「全员可见后排除个别人」——资源级 deny。
 *
 * 分两类断言：
 *  1. 结构性断言（supports_deny / 界面入口）：读只读，但要等这批后端 + 前端
 *     发版后才会绿，属于发版验收条件；
 *  2. 拒绝类断言：新旧版本都会拒绝，只是错误文案不同 —— 所以只断 code != 0，
 *     不发真实资源、不写库。
 *
 * 正向路径（team allow + 单人 deny → 该成员列表/详情/检索都看不到）需要往线上
 * 真实知识库写一条排除规则，等发版后用专用测试库再做，清单见 PLAN.md。
 */
test.describe('资源级排除 · 结构与入口', () => {
  test.use({ storageState: authFile('owner') });

  test('授权列表对知识库声明 supports_deny', async ({ request }) => {
    const body = await (
      await request.get(api.grants(TID, 'dataset'), {
        headers: { Authorization: tokenOf('owner') },
      })
    ).json();
    expect(body.code).toBe(0);
    const rows = body.data.resources as {
      resource_id: string;
      supports_deny?: boolean;
    }[];
    const kb = rows.find((r) => r.resource_id === RESOURCES.privateKb.id);
    expect(kb, '私有库应出现在 owner 的授权列表里').toBeTruthy();
    // 预期：能写排除，前端据此把「不可见（排除）」放进下拉。
    expect(kb!.supports_deny).toBe(true);
  });

  test('授权树：知识库可排除，文件夹不可排除', async ({ request }) => {
    const body = await (
      await request.get(api.grantTree(TID), {
        headers: { Authorization: tokenOf('owner') },
      })
    ).json();
    expect(body.code).toBe(0);

    type Node = {
      name: string;
      node_kind: string;
      supports_deny?: boolean;
      children?: Node[];
    };
    const nodes = body.data.nodes as Node[];
    const kb = nodes.find((n) => n.name === RESOURCES.privateKb.name);
    expect(kb, '根节点应有 07-帮助中心').toBeTruthy();
    // 预期：库级可排除（这是本次改造开放的那一层）。
    expect(kb!.supports_deny).toBe(true);

    const folder = (kb!.children ?? []).find((c) => c.node_kind === 'folder');
    expect(folder, '库里应至少有一个文件夹').toBeTruthy();
    // 预期：文件夹的排除语义还没接列表谓词，明确返回 false 而不是默认可写。
    expect(folder!.supports_deny).toBe(false);
  });

  test('子项例外：库内文件可排除', async ({ request }) => {
    // 默认只返回「与父级不同的例外项」，本库的文件全部继承，item 数为 0；
    // 要看全部文件必须 all=1。
    const body = await (
      await request.get(
        `${api.grantExceptions(TID)}?kind=dataset&dataset_id=${RESOURCES.privateKb.id}&all=1`,
        { headers: { Authorization: tokenOf('owner') } },
      )
    ).json();
    expect(body.code).toBe(0);
    expect(body.data.total, '07-帮助中心 应有文件').toBeGreaterThan(0);

    const items = body.data.items as { grant_kind: string; supports_deny?: boolean }[];
    const docs = items.filter((i) => i.grant_kind === 'document');
    expect(docs.length, '文件项应带 grant_kind=document').toBeGreaterThan(0);
    // 预期：库内文件与库自身都支持排除（文件级 deny 是既有能力）。
    for (const doc of docs.slice(0, 5)) {
      expect(doc.supports_deny, '文件项应支持排除').toBe(true);
    }
  });

  test('设置可见范围里有「不可见（排除）」入口', async ({ page }) => {
    await page.goto('/console/grants');
    await page.waitForLoadState('networkidle');

    const tree = page.locator('aside').filter({ hasText: /资源（\d+ 个库）/ });
    await tree.getByText(RESOURCES.privateKb.name, { exact: true }).click();
    await page.getByRole('button', { name: /添加授权/ }).click();
    await expect(page.getByText('设置可见范围')).toBeVisible();

    // 预期：和「可查看 / 可编辑」并列的第三档，用于全员可见后排除个别人。
    // 注意：<option> 永远不是「可见元素」（Playwright 只认 <select> 本身），
    // 所以按属性 + 文本断言，不用 toBeVisible。
    const option = page.locator('option[value="deny"]');
    await expect(option).toHaveCount(1);
    await expect(option).toHaveText('不可见（排除）');
  });
});

test.describe('资源级排除 · 拒绝非法组合', () => {
  test.use({ storageState: authFile('owner') });

  const headers = () => ({
    Authorization: tokenOf('owner'),
    'Content-Type': 'application/json',
  });

  test('还没接排除谓词的类型不许写排除', async ({ request }) => {
    const res = await request.put(api.setGrants(TID, 'chat', 'does-not-exist-0001'), {
      headers: headers(),
      data: {
        subjects: [
          { kind: 'user', id: 'does-not-exist-0002', permission: 'read', effect: 'deny' },
        ],
      },
    });
    const body = await res.json();
    // 先要求 200：登录态失效时的 401 也会让 code != 0，那样这条用例会假通过。
    expect(res.status()).toBe(200);
    // 预期：配置错误先于「资源不存在」暴露（新版本报「暂不支持」，旧版本报
    // 「不支持拒绝」），两者都不写库。
    expect(body.code).not.toBe(0);
  });

  test('「全团队」不能作为排除对象', async ({ request }) => {
    const res = await request.put(api.setGrants(TID, 'dataset', 'does-not-exist-0001'), {
      headers: headers(),
      data: {
        subjects: [{ kind: 'team', id: '', permission: 'read', effect: 'deny' }],
      },
    });
    const body = await res.json();
    expect(res.status()).toBe(200);
    // 预期：排除全团队等于清空授权，两个入口同一结果只会误用。
    expect(body.code).not.toBe(0);
  });

  test('不能把租户所有者写进排除名单', async ({ request }) => {
    const meRes = await request.get('/api/v1/users/me', { headers: headers() });
    expect(meRes.status(), '登录态失效时先重跑 scripts/auth.mjs').toBe(200);
    const me = ((await meRes.json()) as { data: { id: string } }).data.id;

    // 提交「现有授权 + 一条针对 owner 的排除」：即使某个版本误接受了这条规则，
    // 该库原有的授权也不会被整表替换掉（SetGrants 是 replace 语义）。
    const current = await (
      await request.get(`${api.grants(TID, 'dataset')}&page_size=50`, {
        headers: headers(),
      })
    ).json();
    const row = (current.data.resources as {
      resource_id: string;
      grants: { kind: string; id: string; permission: string; effect?: string }[];
    }[]).find((r) => r.resource_id === RESOURCES.privateKb.id);
    const subjects = [
      ...(row?.grants ?? []).map((g) => ({
        kind: g.kind,
        id: g.id,
        permission: g.permission,
        effect: g.effect ?? 'allow',
      })),
      { kind: 'user', id: me, permission: 'read', effect: 'deny' },
    ];

    const res = await request.put(api.setGrants(TID, 'dataset', RESOURCES.privateKb.id), {
      headers: headers(),
      data: { subjects },
    });
    const body = await res.json();
    expect(res.status()).toBe(200);
    // 预期：排除对租户管理层不生效，写进去只会让人以为已经排除，保存时就拒绝。
    expect(body.code, '排除租户所有者必须被拒绝').not.toBe(0);

    // 兜底核对：被拒绝之后，原有授权必须原样都在。
    const after = await (
      await request.get(`${api.grants(TID, 'dataset')}&page_size=50`, {
        headers: headers(),
      })
    ).json();
    const afterRow = (after.data.resources as {
      resource_id: string;
      grants: { kind: string; id: string }[];
    }[]).find((r) => r.resource_id === RESOURCES.privateKb.id);
    expect(
      (afterRow?.grants ?? []).map((g) => `${g.kind}:${g.id}`).sort(),
      '被拒绝的请求不得改动已有授权',
    ).toEqual((row?.grants ?? []).map((g) => `${g.kind}:${g.id}`).sort());
  });
});
