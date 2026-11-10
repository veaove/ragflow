import { expect, test, type APIRequestContext } from '@playwright/test';

import {
  IDENTITIES,
  api,
  authFile,
  tokenOf,
  type AccountName,
} from '../support/env';
import { pickRows } from '../support/list-rows';

const TID = IDENTITIES.owner.tenantId;

/**
 * 三个受限身份的角色边界（只读）。
 *
 * 分层口径（见 PLAN.md「权限模型」）：
 *   ① 角色矩阵：模块 × 查看/新建/修改/删除/管理 —— 决定能不能调这类接口；
 *   ② 资源可见性 + 资源授权：决定能对哪条资源做什么。
 * 请求先过 ①（路由中间件，403「当前角色没有「X」模块的该操作权限」），
 * 再到 ②（service 层 CheckResource，403/404）。
 *
 * 本文件只读：写接口一律提交「空 body」或「不存在的 id」——
 *   空 body 会在参数校验处被拒（code=102），能证明请求已经穿过矩阵；
 *   不存在的 id 会在资源校验处被拒，不会改任何数据。
 */
const WHO: AccountName[] = ['admin', 'dept', 'plain'];

/**
 * 必须显式带 `X-Tenant-ID`。
 *
 * 三个 E2E 账号注册时各带一个个人租户，服务端「默认租户」对写请求可能落到那里
 * —— 在那里他们都是 owner（矩阵豁免），于是「普通成员能不能写」会测出一个假
 * 放行。读接口还会跨租户并集，于是列表看着正常、闸门判的却是另一个租户。
 * 显式指定目标租户，两层判定才对着同一份数据。
 */
const headers = (who: AccountName) => ({
  Authorization: tokenOf(who),
  'Content-Type': 'application/json',
  'X-Tenant-ID': TID,
});

const call = async (
  request: APIRequestContext,
  method: 'get' | 'post' | 'put' | 'delete',
  path: string,
  who: AccountName,
  data?: unknown,
) => {
  const res = await request[method](path, { headers: headers(who), data });
  const body = await res.json().catch(() => ({}));
  return { status: res.status(), code: body.code as number, message: String(body.message ?? ''), body };
};

const datasetIDs = async (request: APIRequestContext, who: AccountName) => {
  const res = await call(request, 'get', `${api.datasets}?page=1&page_size=100`, who);
  expect(res.status, `${who} 读知识库列表应 200（401 是登录态过期）`).toBe(200);
  expect(res.code, `${who} 读知识库列表失败：${res.message}`).toBe(0);
  return pickRows(res.body.data).map((row) => row.id);
};

test.describe('角色边界 · 三个受限身份', () => {
  for (const who of WHO) {
    test.describe(who, () => {
      test.use({ storageState: authFile(who) });

      test('登录态有效，且落在目标租户', async ({ request }) => {
        const me = await call(request, 'get', '/api/v1/users/me', who);
        expect(me.status, `${who} 登录态失效（401）时请重跑 npm run auth`).toBe(200);
        expect(me.body.data?.email, `${who} 登录身份与账号表不一致`).toBe(
          IDENTITIES[who].email,
        );

        // 默认租户必须是华夏基金：否则列表断言会变成空对空的假绿。
        const ids = await datasetIDs(request, who);
        expect(ids.length, `${who} 在目标租户里看不到任何知识库`).toBeGreaterThan(0);
      });

      test('页面登录可用：/datasets 渲染出自己可见的库', async ({ page, request }) => {
        const ids = await datasetIDs(request, who);
        const first = await call(request, 'get', api.dataset(ids[0]), who);
        expect(first.code).toBe(0);
        const name = first.body.data?.name as string;

        await page.goto('/datasets');
        await page.waitForLoadState('networkidle');
        await expect(
          page.getByText(name, { exact: true }).first(),
          `${who} 登录后页面看不到接口返回的库「${name}」`,
        ).toBeVisible();
      });
    });
  }
});

test.describe('角色矩阵 · 模块闸门', () => {
  test.use({ storageState: authFile('owner') });

  /**
   * 空 body 的写请求：矩阵拒绝 → http 403；矩阵放行 → 参数校验 code=102。
   * 用 403 与 102 的差别判断「闸门」是否生效，不依赖任何写结果。
   */
  test('普通成员被模块闸门拦住，租户管理员/部门管理员放行', async ({ request }) => {
    const cases: { who: AccountName; expectBlocked: boolean; label: string }[] = [
      { who: 'plain', expectBlocked: true, label: '内置普通成员' },
      { who: 'dept', expectBlocked: false, label: '内置部门管理员' },
      { who: 'admin', expectBlocked: false, label: '内置租户管理员' },
      { who: 'owner', expectBlocked: false, label: '租户所有者' },
    ];

    for (const item of cases) {
      const res = await call(request, 'post', api.datasets, item.who, {});
      expect(res.status, `${item.label} 的 POST /datasets 状态异常`).not.toBe(401);
      if (item.expectBlocked) {
        expect(res.status, `${item.label} 应被「知识库」模块闸门拦住`).toBe(403);
        expect(res.message, `${item.label} 的 403 文案应指出模块`).toContain('知识库');
      } else {
        expect(res.status, `${item.label} 不应被模块闸门拦住`).toBe(200);
        expect(res.code, `${item.label} 应走到参数校验（102）`).toBe(102);
      }
    }
  });

  test('资源授权与成员管理只认管理层', async ({ request }) => {
    const ghost = 'does-not-exist-0001';
    const grantPath = api.setGrants(TID, 'dataset', ghost);

    for (const who of ['plain', 'member'] as AccountName[]) {
      const grant = await call(request, 'put', grantPath, who, { subjects: [] });
      expect(grant.status, `${who} 不该能写资源授权`).toBe(403);
      expect(grant.message, `${who} 的授权 403 文案不对`).toContain('租户管理员');

      const members = await call(
        request,
        'put',
        api.member(TID, 'does-not-exist-0001'),
        who,
        { status: '1' },
      );
      expect(members.status, `${who} 不该能改租户成员`).toBe(403);
    }

    // 管理层用不存在的 id：能穿过闸门，失败在资源不存在（不写字）。
    for (const who of ['admin', 'owner'] as AccountName[]) {
      const res = await call(request, 'put', grantPath, who, { subjects: [] });
      expect(res.status, `${who} 应能进入授权流程`).toBe(200);
      expect(res.code, `${who} 应报资源不存在，而不是权限被拒`).not.toBe(0);
      expect(res.message, `${who} 的失败原因应是资源归属`).toContain('资源不存在');
    }
  });

  /**
   * FINDING：部门管理员当前能写租户级资源授权。
   *
   * `tenantIsManagement` 认的是 user_tenant.role ∈ {owner, admin} 或内置租户
   * 管理员角色；部门管理员的角色 id 不在其中，但它这一行的 role 枚举是 admin，
   * 于是被当成管理层 —— 可以改任意资源的授权，也能看到全部 18 个库。
   *
   * 改角色时代码只更新 role_id、不动 role 枚举（`UpdateMember`），所以这属于
   * 存量数据与判定的口径不一致：新建租户里正常分配的部门管理员会是 normal，
   * 反而写不了授权。修好这条（枚举与角色对齐，或让判定只认 role_id）之后，
   * 下面的断言应改为 403 —— 那时这条用例会红，正好是提醒。
   */
  test('FINDING：部门管理员继承 role=admin 枚举，越权写授权', async ({ request }) => {
    const res = await call(
      request,
      'put',
      api.setGrants(TID, 'dataset', 'does-not-exist-0001'),
      'dept',
      { subjects: [] },
    );
    test.info().annotations.push({
      type: 'finding',
      description: `dept 写授权 http=${res.status} code=${res.code} ${res.message}`,
    });
    expect(res.status, 'dept 的 403 会说明 enumeration 已被修正，请更新这条用例').toBe(200);
    expect(res.message, 'dept 应被当成管理层放行到资源校验').toContain('资源不存在');
  });
});

test.describe('资源可见性 · 三个身份都是 owner 的子集', () => {
  test.use({ storageState: authFile('owner') });

  test('列表子集 + 不可见即不可读 + 授权树按读权限收窄', async ({ request }) => {
    const ownerIDs = new Set(await datasetIDs(request, 'owner'));
    expect(ownerIDs.size, 'owner 列表为空，没有对照基准').toBeGreaterThan(0);

    const counts: string[] = [`owner=${ownerIDs.size}`];
    const visible: Record<string, Set<string>> = {};

    for (const who of WHO) {
      const ids = await datasetIDs(request, who);
      visible[who] = new Set(ids);
      counts.push(`${who}=${ids.length}`);
      for (const id of ids) {
        expect(ownerIDs, `${who} 出现 owner 都看不到的库 ${id}`).toContain(id);
      }
    }
    test.info().annotations.push({ type: 'counts', description: counts.join(' ') });

    // plain 必须严格少于 owner，否则「不可见即不可读」没有对照组。
    expect(visible.plain.size, 'plain 能看到全部知识库，矩阵用例失去对照').toBeLessThan(
      ownerIDs.size,
    );

    const hidden = [...ownerIDs].filter((id) => !visible.plain.has(id));
    const phantom = 'does-not-exist-0001';
    const phantomRes = await call(request, 'get', api.dataset(phantom), 'plain');
    for (const id of hidden.slice(0, 3)) {
      const res = await call(request, 'get', api.dataset(id), 'plain');
      expect(res.code, `plain 不该读到未见过的库 ${id}`).not.toBe(0);
      // 存在性不泄露：别人的 id 与不存在的 id 文案必须一致。
      expect(res.message, `库 ${id} 的拒绝文案泄露了存在性`).toBe(phantomRes.message);
    }

    // 授权树只返回自己读得到的库：否则数字和名字本身就在泄露资源清单。
    for (const who of WHO) {
      const tree = await call(request, 'get', api.grantTree(TID), who);
      expect(tree.status, `${who} 读授权树应 200`).toBe(200);
      const nodes = (tree.body.data?.nodes ?? []) as { id: string; name: string }[];
      for (const node of nodes) {
        expect(
          visible[who].has(node.id),
          `${who} 的授权树里出现读不到的库「${node.name}」`,
        ).toBe(true);
      }
    }
  });
});
