import { expect, test } from '@playwright/test';

import { IDENTITIES, authFile } from '../support/env';

/**
 * 冒烟：两个账号都能进入控制台，且一级导航齐全。
 *
 * 这里只验证「能不能进、进去了是不是自己」，不涉及资源可见性 ——
 * 后者在 30-resource-scope 里按模块断言。
 */
for (const who of ['owner', 'member'] as const) {
  test.describe(`冒烟 · ${IDENTITIES[who].label}`, () => {
    test.use({ storageState: authFile(who) });

    test('登录态有效，身份与一级导航正确', async ({ page }) => {
      await page.goto('/datasets');
      await page.waitForLoadState('networkidle');

      await expect(page.getByText(IDENTITIES[who].email).first()).toBeVisible();

      for (const nav of [
        '总览',
        '知识库',
        '知识问答',
        '知识搜索',
        '智能体',
        '记忆中心',
        '会话质检',
        '文件管理',
        '租户中心',
      ]) {
        await expect(
          page.getByText(nav, { exact: true }).first(),
          `一级导航缺少「${nav}」`,
        ).toBeVisible();
      }
    });

    test('未登录访问被重定向到登录页', async ({ browser }) => {
      // 必须显式清空登录态：browser.newContext() 会继承 test.use 里的
      // storageState，不写这一句等于带着 token 访问，永远不会 401。
      const ctx = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      });
      const page = await ctx.newPage();
      await page.goto('/datasets');
      // 前端没有路由守卫：跳转由 /users/me 的 401 触发，实测要 3～4 秒
      //（先 401，再拉 captcha 与 system/config 才渲染登录页）。
      // 固定 sleep 2s 会误判，改成等 URL 变化。
      await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
      await expect(page.getByText('账号登录')).toBeVisible();
      await ctx.close();
    });
  });
}
