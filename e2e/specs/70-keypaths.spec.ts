import { expect, test } from '@playwright/test';

import { RESOURCES, api, authFile, tokenOf } from '../support/env';

/**
 * 关键路径。只读：页面往返、角色切换、成员自己的入口。
 * 关注「状态是否串台」——这类问题单元测试看不出来，只能靠连续操作暴露。
 */
test.describe('关键路径 · 所有者', () => {
  test.use({ storageState: authFile('owner') });

  test('授权页「按资源 ↔ 按成员」往返后仍停留在同一个库', async ({ page }) => {
    await page.goto('/console/grants');
    await page.waitForLoadState('networkidle');

    const tree = page.locator('aside').filter({ hasText: /资源（\d+ 个库）/ });
    await tree.getByText(RESOURCES.grantedKb.name, { exact: true }).click();
    const title = page.locator('h2').first();
    await expect(title).toHaveText(RESOURCES.grantedKb.name);

    await page.getByRole('button', { name: '按成员' }).click();
    await page.getByRole('button', { name: '按资源' }).click();

    // 预期：切回「按资源」仍选中刚才那个库，右栏不退回第一个库。
    await expect(title).toHaveText(RESOURCES.grantedKb.name);
    await expect(page.getByText('本层授权')).toBeVisible();
  });

  test('角色矩阵连续切换角色不串台', async ({ page }) => {
    await page.goto('/console/roles');
    await page.waitForLoadState('networkidle');

    // 预期：每次切换都能渲染出矩阵首行「知识库」，且选中的是刚点的角色。
    // 只点可见元素：角色名在页面上有隐藏副本（描述、下拉），.first() 可能命中
    // 隐藏节点而一直等待。
    const visibleText = (text: string) =>
      page.getByText(text, { exact: true }).filter({ visible: true }).first();
    for (const role of ['技术员', '质检员', '普通成员']) {
      await visibleText(role).click();
      await expect(
        visibleText('知识库'),
        `切到「${role}」后矩阵没渲染出来`,
      ).toBeVisible();
      await expect(visibleText(role)).toBeVisible();
    }
  });
});

test.describe('关键路径 · 普通成员', () => {
  test.use({ storageState: authFile('member') });

  test('授权树页只列出自己可读的库（D2 的 UI 面）', async ({ page }) => {
    await page.goto('/console/grants');
    await page.waitForLoadState('networkidle');

    const tree = page.locator('aside').filter({ hasText: /资源（\d+ 个库）/ });
    // 预期：被授权的库出现在树里，owner 的私库不出现（接口收窄后 UI 自然一致）。
    await expect(
      tree.getByText(RESOURCES.grantedKb.name, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(RESOURCES.privateKb.name, { exact: true }),
    ).toHaveCount(0);
  });

  test('知识库列表页：只出现被授权与自建的库', async ({ page, request }) => {
    const body = await (
      await request.get(api.dataset(RESOURCES.grantedKb.id), {
        headers: { Authorization: tokenOf('member') },
      })
    ).json();
    // 预期：接口放行，name 与 env 里登记的一致（改名时先改 env，别放宽断言）。
    expect(body.code).toBe(0);
    expect(body.data.name).toBe(RESOURCES.grantedKb.name);

    await page.goto('/datasets');
    await page.waitForLoadState('networkidle');
    // 预期：列表只渲染可见的库 —— 被授权的在，owner 的私库不在。
    await expect(
      page.getByText(RESOURCES.grantedKb.name, { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText(RESOURCES.privateKb.name, { exact: true }),
    ).toHaveCount(0);
  });
});
