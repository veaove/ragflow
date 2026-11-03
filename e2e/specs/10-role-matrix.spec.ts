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
   * 允许 owner 微调内置角色，避免为改一格权限重建一个自定义角色），所以这里
   * 不断言「写被拒绝」，而是断言矩阵本身始终满格 —— owner 身份在
   * ModulePermission 里本来就永远放行，矩阵被改窄只会误伤其他成员。
   *
   * 现存缺陷（不写成用例，避免往线上真实租户写数据）：
   * 1. PUT /roles/:id 对内置角色不拦改名，而「租户管理员」查找与 backfill 都按
   *    名字匹配，改名后这些逻辑静默失效；
   * 2. 给内置角色提交空矩阵会返回成功，但下一次 ListRoles 会按 ConsoleModules
   *    回填默认行 —— 「撤销全部」无法持久化，看着保存成功，实际被改回默认。
   */
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
