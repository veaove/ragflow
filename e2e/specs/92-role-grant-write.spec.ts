import { expect, test, type APIRequestContext } from '@playwright/test';

import {
  DEPARTMENTS,
  IDENTITIES,
  api,
  authFile,
  tokenOf,
  type AccountName,
} from '../support/env';

const TID = IDENTITIES.owner.tenantId;
const GHOST = 'does-not-exist-0001';

/**
 * 角色授权 + 资源授权的写入链路 —— **会改真实租户，默认不跑**。
 *
 *   E2E_ALLOW_WRITE=1 npx playwright test specs/92-role-grant-write.spec.ts
 *
 * 安全边界（改完必须回到原位）：
 *   · 角色：只新建/删除自己的临时角色，不碰 5 个内置角色与 2 个自定义角色；
 *     唯一的成员绑定改动是把 e2e-plain 临时挂到临时角色上，afterAll 写回原值。
 *   · 资源：知识库是本次新建的临时库，afterAll 删除；别人的库一条不碰。
 *   · 越权写：一律打不存在的 id，或提交「当前值」，保证幂等。
 */
test.describe('角色授权与资源授权 · 写入链路', () => {
  test.skip(
    !process.env.E2E_ALLOW_WRITE,
    '写用例：需要 E2E_ALLOW_WRITE=1 显式开启（会建临时角色/临时知识库并清理）',
  );

  test.use({ storageState: authFile('owner') });

  type Res = {
    status: number;
    code: number;
    message: string;
    data: any;
  };

  const headers = (who: AccountName) => ({
    Authorization: tokenOf(who),
    'Content-Type': 'application/json',
    // 三个受限账号都有个人租户；不指定目标租户时，写请求可能判到那里去。
    'X-Tenant-ID': TID,
  });

  const call = async (
    request: APIRequestContext,
    method: 'get' | 'post' | 'put' | 'delete',
    path: string,
    who: AccountName,
    data?: unknown,
  ): Promise<Res> => {
    const res = await request[method](path, { headers: headers(who), data });
    const body = await res.json().catch(() => ({}));
    return {
      status: res.status(),
      code: body.code as number,
      message: String(body.message ?? ''),
      data: body.data,
    };
  };

  const grant = async (
    request: APIRequestContext,
    subjects: { kind: string; id: string; permission: string; effect: string }[],
  ) => {
    const res = await call(request, 'put', api.setGrants(TID, 'dataset', kbID), 'owner', {
      subjects,
    });
    expect(res.code, `写资源授权失败：${res.message}`).toBe(0);
  };

  /** 把矩阵写成「只有知识库模块，按参数给 view/create」；其余模块一律关。 */
  const setRoleMatrix = async (
    request: APIRequestContext,
    roleId: string,
    can: { view: boolean; create: boolean },
  ) => {
    const res = await call(
      request,
      'put',
      api.rolePermissions(TID, roleId),
      'owner',
      {
        permissions: [
          {
            module: 'dataset',
            can_view: can.view,
            can_create: can.create,
            can_edit: false,
            can_delete: false,
            can_manage: false,
          },
        ],
      },
    );
    expect(res.code, `写角色矩阵失败：${res.message}`).toBe(0);
  };

  const bindRole = async (request: APIRequestContext, userId: string, roleId: string) => {
    const res = await call(request, 'put', api.member(TID, userId), 'owner', {
      role_id: roleId,
    });
    expect(res.code, `改成员角色失败：${res.message}`).toBe(0);
  };

  let kbID = '';
  let kbName = '';
  let roleID = '';
  let roleName = '';
  let plainID = '';
  let plainRoleID = '';
  let memberID = '';
  let phantomMessage = '';

  test.beforeAll(async ({ request }) => {
    const members = await call(
      request,
      'get',
      `${api.members(TID)}?page_size=200`,
      'owner',
    );
    const rows = members.data?.members ?? [];
    const plain = rows.find((m: { email: string }) => m.email === IDENTITIES.plain.email);
    const member = rows.find((m: { email: string }) => m.email === IDENTITIES.member.email);
    expect(plain, '找不到 e2e-plain 的成员记录').toBeTruthy();
    expect(member, '找不到 hjzd@hjzd 的成员记录').toBeTruthy();
    plainID = plain.id;
    plainRoleID = plain.role_id;
    memberID = member.id;
    expect(plainRoleID, 'e2e-plain 没有角色，恢复时无处可写').toBeTruthy();

    const list = await call(request, 'get', `${api.datasets}?page=1&page_size=100`, 'owner');
    const sample = (list.data ?? []).find((d: { embedding_model?: string }) => d.embedding_model);
    expect(sample?.embedding_model, '租户里没有可借用的 embedding_model').toBeTruthy();

    kbName = `E2E-授权验证-${Date.now()}`;
    const created = await call(request, 'post', api.datasets, 'owner', {
      name: kbName,
      embedding_model: sample.embedding_model,
      parser_id: 'general',
      parse_type: 1,
    });
    expect(created.code, `创建临时知识库失败：${created.message}`).toBe(0);
    kbID = created.data.id;

    const phantom = await call(request, 'get', api.dataset(GHOST), 'dept');
    phantomMessage = phantom.message;
  });

  test.afterAll(async ({ request }) => {
    // 顺序：先恢复成员角色，再删角色，最后删库。任何一步失败都打印现场。
    if (plainID && plainRoleID) {
      const restore = await call(request, 'put', api.member(TID, plainID), 'owner', {
        role_id: plainRoleID,
      });
      if (restore.code !== 0) {
        console.error(
          `[92] e2e-plain 的角色未恢复，请手工写回 role_id=${plainRoleID}：${restore.message}`,
        );
      }
    }
    if (roleID) {
      const del = await call(request, 'delete', `${api.roles(TID)}/${roleID}`, 'owner');
      if (del.code !== 0) {
        console.error(`[92] 临时角色未删除，请手工清理：${roleID}`);
      }
    }
    if (kbID) {
      const del = await call(request, 'delete', api.datasets, 'owner', { ids: [kbID] });
      if (del.code !== 0) {
        console.error(`[92] 临时知识库未删除，请手工清理：${kbID} (${kbName})`);
      }
    }
  });

  // ── 角色授权：授予 → 变更 → 回收 ─────────────────────────────────────────

  test('角色授予：新角色勾上知识库「新建」后，plain 立刻不再被 403', async ({ request }) => {
    const before = await call(request, 'post', api.datasets, 'plain', {});
    expect(before.status, '前置不成立：plain 起手就该被「知识库」模块闸门拦住').toBe(403);

    roleName = `E2E-角色-${Date.now()}`;
    const created = await call(request, 'post', api.roles(TID), 'owner', {
      name: roleName,
      description: 'E2E 角色生命周期用例，勿手工修改',
    });
    expect(created.code, `创建临时角色失败：${created.message}`).toBe(0);
    roleID = created.data?.id ?? created.data?.role?.id;
    expect(roleID, '创建角色没有返回 id').toBeTruthy();

    // 只开「查看」：此时仍是 403，说明放行来自 create 而不是别的东西。
    await setRoleMatrix(request, roleID, { view: true, create: false });
    await bindRole(request, plainID, roleID);
    const viewOnly = await call(request, 'post', api.datasets, 'plain', {});
    expect(viewOnly.status, '只开查看时不该放行新建').toBe(403);

    // 打开「新建」：闸门放行，请求走到参数校验（空 body → 102），不会真建库。
    await setRoleMatrix(request, roleID, { view: true, create: true });
    const granted = await call(request, 'post', api.datasets, 'plain', {});
    expect(granted.status, '授予新建后仍被 403，说明矩阵没有生效').toBe(200);
    expect(granted.code, '应走到参数校验（102），而不是矩阵拒绝').toBe(102);

    // 读权限同步生效。
    const list = await call(request, 'get', `${api.datasets}?page=1&page_size=100`, 'plain');
    expect(list.code).toBe(0);
  });

  test('角色变更：收回「新建」立即恢复拒绝，读权限不受影响', async ({ request }) => {
    expect(roleID, '上一步没有建出角色，无法变更').toBeTruthy();

    await setRoleMatrix(request, roleID, { view: true, create: false });
    const denied = await call(request, 'post', api.datasets, 'plain', {});
    expect(denied.status, '收回新建后应立刻 403').toBe(403);
    expect(denied.message, '403 文案应指出模块').toContain('知识库');

    const list = await call(request, 'get', `${api.datasets}?page=1&page_size=100`, 'plain');
    expect(list.code, '只收回 create，不该影响 view').toBe(0);
  });

  test('角色回收：把 plain 写回原角色并删除临时角色', async ({ request }) => {
    expect(roleID, '上一步没有建出角色，无法回收').toBeTruthy();

    await bindRole(request, plainID, plainRoleID);
    const restored = await call(request, 'post', api.datasets, 'plain', {});
    expect(restored.status, '回到原角色后应重新被 403').toBe(403);

    const del = await call(request, 'delete', `${api.roles(TID)}/${roleID}`, 'owner');
    expect(del.code, `删除临时角色失败：${del.message}`).toBe(0);
    roleID = '';

    const roles = await call(request, 'get', api.roles(TID), 'owner');
    const names = (roles.data?.roles ?? []).map((r: { name: string }) => r.name);
    expect(names, `临时角色「${roleName}」仍留在列表里`).not.toContain(roleName);
    roleName = '';
  });

  // ── 资源授权：可见性 + 操作级别 ─────────────────────────────────────────

  /**
   * 主体选择说明：
   *   · member（技术员，user_tenant.role=normal）用来跑 read/edit 阶梯，他不在
   *     管理层，读权限只能来自授权本身；
   *   · plain（普通成员，培训部）用来做「未授权不可见」的反面对照；
   *   · dept（部门管理员）**不能**用在这类断言上：他的 user_tenant.role 是
   *     admin，管理层天然对本租户所有可见资源有读权限，授权前/回收后都能读，
   *     会把这个用例测成假绿。详见 91 的 FINDING 用例。
   */
  test('授权前：未授权成员读不到临时库，文案与不存在的 id 一致', async ({ request }) => {
    expect(kbID).toBeTruthy();
    for (const who of ['member', 'plain'] as AccountName[]) {
      const res = await call(request, 'get', api.dataset(kbID), who);
      expect(res.code, `${who} 不该读到未授权的库`).not.toBe(0);
      expect(res.message, `${who} 的拒绝文案泄露了库的存在性`).toBe(phantomMessage);
    }
  });

  test('授予「可查看」：能看库与文件列表，但不能改配置', async ({ request }) => {
    await grant(request, [
      { kind: 'user', id: memberID, permission: 'read', effect: 'allow' },
    ]);

    const read = await call(request, 'get', api.dataset(kbID), 'member');
    expect(read.code, `可查看授权后应能读：${read.message}`).toBe(0);

    const docs = await call(
      request,
      'get',
      `${api.datasetDocuments(kbID)}?page=1&page_size=10`,
      'member',
    );
    expect(docs.code, '可查看授权后应能读文件列表').toBe(0);

    // 提交当前值：即便真的放行也不会改动数据，只用来分辨 read / edit。
    const write = await call(request, 'put', api.dataset(kbID), 'member', { name: kbName });
    expect(write.code, '可查看不该能改库配置').not.toBe(0);

    const hidden = await call(request, 'get', api.dataset(kbID), 'plain');
    expect(hidden.code, '只授权了 member，plain 不该跟着可见').not.toBe(0);
  });

  test('升级为「可编辑」后能改配置，但仍不能删除整个库', async ({ request }) => {
    await grant(request, [
      { kind: 'user', id: memberID, permission: 'edit', effect: 'allow' },
    ]);

    const write = await call(request, 'put', api.dataset(kbID), 'member', { name: kbName });
    expect(write.code, `可编辑后应能改配置：${write.message}`).toBe(0);

    // 成员操作集里没有 delete：编辑权不等于所有权。
    const del = await call(request, 'delete', api.datasets, 'member', { ids: [kbID] });
    expect(del.code, '可编辑授权不该能删除知识库').not.toBe(0);

    const still = await call(request, 'get', api.dataset(kbID), 'member');
    expect(still.code, '库被删掉了，说明删除权越界').toBe(0);
  });

  test('部门级授权：整条用户授权撤掉后，技术部成员仍可见，培训部不可见', async ({
    request,
  }) => {
    // 用「只保留部门授权」替换掉上一步的 user 授权，可见性来源就只剩部门。
    await grant(request, [
      { kind: 'department', id: DEPARTMENTS.tech.id, permission: 'read', effect: 'allow' },
    ]);

    const member = await call(request, 'get', api.dataset(kbID), 'member');
    expect(member.code, '技术部成员（hjzd@hjzd）应通过部门授权看到').toBe(0);

    const plain = await call(request, 'get', api.dataset(kbID), 'plain');
    expect(plain.code, '培训部成员不该看到技术部的授权').not.toBe(0);
    expect(plain.message, '培训部成员的拒绝文案泄露了库的存在性').toBe(phantomMessage);
  });

  test('回收全部授权：可见性与操作权限同时消失', async ({ request }) => {
    await grant(request, []);

    for (const who of ['member', 'plain'] as AccountName[]) {
      const res = await call(request, 'get', api.dataset(kbID), who);
      expect(res.code, `${who} 在回收后仍能读到库`).not.toBe(0);
      expect(res.message, `${who} 的回收后文案不一致`).toBe(phantomMessage);
    }
  });

  /**
   * FINDING：三档可见范围目前不参与判定，只改标签。
   *
   * 五类资源的单资源判定在档位分支前就放行了资源 owner、平台超管、租户管理员，
   * 剩下的进 `tieredAccess`，而它只认「创建者 / 显式授权 / 部门管理员」，根本不读
   * 档位；列表 SQL 同理（唯一读 permission 的是历史 'team' 分支，迁移后已无命中）。
   * 所以「仅所有者 / 租户管理层可见 / 平台管理员可见」当前完全等价。
   *
   * 一旦有人把档位接进判定（例如 owner 档不再放行租户管理员），这条会红，正好提醒
   * 同步改文案与文档。
   */
  test('FINDING：三档可见范围对成员/管理层行为完全一致', async ({ request }) => {
    for (const tier of ['owner', 'tenant_owner', 'platform']) {
      const put = await call(request, 'put', api.dataset(kbID), 'owner', {
        permission: tier,
      });
      expect(put.code, `切换可见范围到 ${tier} 失败：${put.message}`).toBe(0);

      const readBack = await call(request, 'get', api.dataset(kbID), 'owner');
      expect(readBack.data?.permission, `可见范围没有落库：${tier}`).toBe(tier);

      for (const who of ['member', 'plain'] as AccountName[]) {
        const res = await call(request, 'get', api.dataset(kbID), who);
        expect(
          res.code,
          `${tier} 档下 ${who} 仍不可见；若档位已接入判定，请更新这条 FINDING 与文案`,
        ).not.toBe(0);
      }
      for (const who of ['admin', 'dept'] as AccountName[]) {
        const res = await call(request, 'get', api.dataset(kbID), who);
        expect(res.code, `${tier} 档下管理层 ${who} 应可见`).toBe(0);
      }
    }
  });
});
