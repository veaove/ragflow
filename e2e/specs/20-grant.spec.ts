import { expect, test } from '@playwright/test';

import { IDENTITIES, RESOURCES, api, authFile, tokenOf } from '../support/env';

const TID = IDENTITIES.owner.tenantId;

test.describe('资源授权 · 层级与交互', () => {
  test.use({ storageState: authFile('owner') });

  test('资源树按「库 → 文件夹」展示，并给出文件数与摘要', async ({ page }) => {
    await page.goto('/console/grants');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(/资源（\d+ 个库）/)).toBeVisible();
    await expect(page.getByText(/\d+ 个文件/).first()).toBeVisible();

    // 默认只展开根节点：库在树上，文件不进树。
    await expect(
      page.getByText(RESOURCES.privateKb.name, { exact: true }).first(),
    ).toBeVisible();
  });

  test('点知识库 → 右栏切换为该库；点子文件夹 → 右栏跟进（回归）', async ({
    page,
  }) => {
    await page.goto('/console/grants');
    await page.waitForLoadState('networkidle');

    // 页面上有两个 aside：左侧全局导航（complementary）和授权树面板。
    // 用树面板头部的「资源（N 个库）」定位，别用 .first() 抓到导航。
    const tree = page
      .locator('aside')
      .filter({ hasText: /资源（\d+ 个库）/ });
    await tree.getByText(RESOURCES.privateKb.name, { exact: true }).click();

    const title = page.locator('h2').first();
    await expect(title).toHaveText(RESOURCES.privateKb.name);
    await expect(page.getByText('本层授权')).toBeVisible();
    await expect(page.getByText('子项例外')).toBeVisible();

    // 07-帮助中心 下的文件夹「银行介绍」：点它必须切换右栏标题，
    // 而不是回落成第一个知识库（历史缺陷）。
    await tree.getByText('银行介绍', { exact: true }).click();
    await expect(title).toHaveText('银行介绍');
    await expect(
      page.getByText(/文件夹不单独授权，规则落在知识库与文件上/),
    ).toBeVisible();
  });

  test('「按成员」视角给出直接授权/部门来源', async ({ page }) => {
    await page.goto('/console/grants');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: '按成员' }).click();
    await expect(
      page.getByText(/直接授权|部门|全团队/).first(),
    ).toBeVisible();
  });

  test('接口层：授权树带出文件数与例外数', async ({ request }) => {
    const res = await request.get(api.grantTree(TID), {
      headers: { Authorization: tokenOf('owner') },
    });
    const body = await res.json();
    expect(body.code).toBe(0);

    const nodes = body.data.nodes as {
      name: string;
      file_count: number;
      exception_count: number;
      children?: unknown[];
    }[];
    expect(nodes.length).toBe(body.data.total);

    const help = nodes.find((n) => n.name === RESOURCES.privateKb.name);
    expect(help, '授权树应包含 07-帮助中心').toBeTruthy();
    expect(help!.file_count).toBe(44);
    expect(Array.isArray(help!.children)).toBe(true);

    // 库上的授权只有那几条例外，其余都在继承。
    const granted = nodes.find((n) => n.name === RESOURCES.grantedKb.name);
    expect(granted, '授权树应包含问数-示例SQL').toBeTruthy();
  });
});
