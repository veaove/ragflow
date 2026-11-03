import { expect, test } from '@playwright/test';

import { IDENTITIES, api, authFile, tokenOf } from '../support/env';

const TID = IDENTITIES.owner.tenantId;

const BUILTIN_ROLES = ['Owner', '普通成员', '租户管理员', '部门管理员'];
const CUSTOM_ROLES = ['技术员', '质检员'];
const MODULES = ['知识库', '知识问答', '知识搜索', '智能体', '记忆中心', '资源授权'];

test.describe('角色权限 · 矩阵渲染与只读约束', () => {
  test.use({ storageState: authFile('owner') });

  test('内置与自定义角色都在列表里，且能切换矩阵', async ({ page }) => {
    await page.goto('/console/roles');
    await page.waitForLoadState('networkidle');

    for (const role of [...BUILTIN_ROLES, ...CUSTOM_ROLES]) {
      await expect(
        page.getByText(role, { exact: true }).first(),
        `角色列表缺少「${role}」`,
      ).toBeVisible();
    }

    // Owner 是系统内置：描述里明确「全权限，不可编辑」。
    await expect(page.getByText(/不可编辑/).first()).toBeVisible();

    // 切到自定义角色，矩阵仍要完整渲染（25 个模块里至少覆盖核心 6 个）。
    await page.getByText('技术员', { exact: true }).first().click();
    for (const module of MODULES) {
      await expect(
        page.getByText(module, { exact: true }).first(),
        `矩阵缺少模块「${module}」`,
      ).toBeVisible();
    }
    await expect(page.getByText('查看', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('管理', { exact: true }).last()).toBeVisible();
  });

  test('接口层：矩阵含 25 个模块，技术员为全勾', async ({ request }) => {
    const res = await request.get(api.roles(TID), {
      headers: { Authorization: tokenOf('owner') },
    });
    const body = await res.json();
    expect(body.code).toBe(0);
    expect(Array.isArray(body.data.modules)).toBe(true);
    expect(body.data.modules.length).toBe(25);

    const tech = (
      body.data.roles as {
        id: string;
        name: string;
        is_builtin: boolean;
        permissions?: Record<string, unknown>[];
      }[]
    ).find((r) => r.name === '技术员');
    expect(tech, '技术员角色应存在').toBeTruthy();
    expect(tech!.is_builtin).toBe(false);
  });

  /**
   * 内置角色的矩阵「可以被写」是刻意设计（见 dao.RoleDAO.ReplacePermissions：
   * 允许 owner 微调内置角色，避免为改一格权限重建一个自定义角色）；但 Owner
   * 例外 —— 它对应 user_tenant.role 枚举，DAO 里本来就对 owner 无条件放行，
   * 所以 Owner 的矩阵开写入口只会让「改了没效果」变成一张工单（D4 的修法）。
   */
  test('Owner 矩阵写入被拒绝（D4 回归）', async ({ request }) => {
    const headers = {
      Authorization: tokenOf('owner'),
      'Content-Type': 'application/json',
    };
    const roles = await (
      await request.get(api.roles(TID), { headers })
    ).json();
    const owner = (roles.data.roles as { id: string; name: string }[]).find(
      (r) => r.name === 'Owner',
    );
    expect(owner, 'Owner 角色应存在').toBeTruthy();

    // 提交的是「当前这份矩阵」而不是空数组：老版本会接受并重写（值不变，无副作用），
    // 新版本会拒绝。这样这条用例在修复前后都只读，不会把线上矩阵清空。
    const current = await (await request.get(api.roles(TID), { headers })).json();
    const rows = (
      current.data.roles as {
        name: string;
        permissions: Record<string, unknown>[];
      }[]
    ).find((r) => r.name === 'Owner')!.permissions;
    const res = await request.put(api.rolePermissions(TID, owner!.id), {
      headers,
      data: { permissions: rows },
    });
    const body = await res.json();
    expect(body.code, 'Owner 矩阵写入必须被拒绝').not.toBe(0);

    // 写失败后矩阵仍是满格：25 行 × 5 动作全 true。
    const after = await (await request.get(api.roles(TID), { headers })).json();
    const stillFull = (
      after.data.roles as {
        name: string;
        permissions: (Record<string, boolean> & { module: string })[];
      }[]
    ).find((r) => r.name === 'Owner')!;
    expect(stillFull.permissions.length).toBe(after.data.modules.length);
    for (const row of stillFull.permissions) {
      expect(row.can_view, `Owner 的「${row.module}」被改窄了`).toBe(true);
    }
  });

  test('内置角色不可改名（D5 回归）', async ({ request }) => {
    const headers = {
      Authorization: tokenOf('owner'),
      'Content-Type': 'application/json',
    };
    const roles = await (
      await request.get(api.roles(TID), { headers })
    ).json();
    const builtin = (
      roles.data.roles as { id: string; name: string; is_builtin: boolean }[]
    ).find((r) => r.name === '普通成员');
    expect(builtin?.is_builtin).toBe(true);

    // 提交「改回自己现在的名字」：老版本接受但值不变（幂等），新版本拒绝。
    // 不能发一个新名字 —— 未发版的旧服务会真的把内置角色改掉（本套件踩过）。
    const res = await request.put(`${api.roles(TID)}/${builtin!.id}`, {
      headers,
      data: { name: builtin!.name },
    });
    const body = await res.json();
    expect(body.code, '内置角色改名必须被拒绝').not.toBe(0);

    const after = await (await request.get(api.roles(TID), { headers })).json();
    const names = (after.data.roles as { name: string }[]).map((r) => r.name);
    expect(names).toContain('普通成员');
    expect(names).toHaveLength(6);
  });

  test('Owner 内置角色：矩阵满 25 个模块且全勾', async ({ request }) => {
    const body = await (
      await request.get(api.roles(TID), {
        headers: { Authorization: tokenOf('owner') },
      })
    ).json();
    expect(body.code).toBe(0);

    const owner = (
      body.data.roles as {
        name: string;
        is_builtin: boolean;
        description: string;
        permissions: (Record<string, boolean> & { module: string })[];
      }[]
    ).find((r) => r.name === 'Owner');
    expect(owner, 'Owner 角色应存在').toBeTruthy();
    expect(owner!.is_builtin).toBe(true);
    expect(owner!.description).toContain('不可编辑');
    expect(owner!.permissions.length).toBe(body.data.modules.length);

    for (const row of owner!.permissions) {
      for (const action of [
        'can_view',
        'can_create',
        'can_edit',
        'can_delete',
        'can_manage',
      ]) {
        expect(row[action], `Owner 的「${row.module}」缺 ${action}`).toBe(true);
      }
    }
  });
});
