import { expect, test } from '@playwright/test';

import { IDENTITIES, RESOURCES, api, authFile, tokenOf } from '../support/env';
import { pickHiddenDataset } from '../support/hidden-dataset';

/**
 * 六类核心资源在两个账号下的可见边界。
 *
 * 判定口径（与实现一致）：
 *   可见 = 创建者 | 租户管理层 | (team 档 ∧ 普通成员) | 显式授权
 * 写操作额外要求租户管理层，不看矩阵 —— 由 40-overreach 覆盖。
 */

test.describe('资源可见性 · 所有者', () => {
  test.use({ storageState: authFile('owner') });

  test('知识库列表包含未授权的私有库', async ({ page }) => {
    await page.goto('/datasets');
    await page.waitForLoadState('networkidle');
    await expect(
      page.getByText(RESOURCES.privateKb.name, { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText(RESOURCES.grantedKb.name, { exact: true }).first(),
    ).toBeVisible();
  });

  test('知识问答 / 知识搜索 / 记忆 / 智能体 / 质检都有数据', async ({
    page,
  }) => {
    await page.goto('/chats');
    await page.waitForLoadState('networkidle');
    await expect(
      page.getByText(RESOURCES.privateChat, { exact: true }).first(),
    ).toBeVisible();

    await page.goto('/searches');
    await page.waitForLoadState('networkidle');
    await expect(
      page.getByText(RESOURCES.privateSearch, { exact: true }).first(),
    ).toBeVisible();

    await page.goto('/memories');
    await page.waitForLoadState('networkidle');
    await expect(
      page.getByText(RESOURCES.privateMemory, { exact: true }).first(),
    ).toBeVisible();

    await page.goto('/agents');
    await page.waitForLoadState('networkidle');
    await expect(
      page.getByText(RESOURCES.privateAgent, { exact: true }).first(),
    ).toBeVisible();

    await page.goto('/qc');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/共 \d+ 条/).first()).toBeVisible();
  });
});

test.describe('资源可见性 · 普通成员', () => {
  test.use({ storageState: authFile('member') });

  test('知识库只看到被授权与自建的库，看不到私有库', async ({ page }) => {
    // 「私有库」从数据里取（owner 可见 - member 可见的差集），不写死 id：
    // 管理员把某个库临时开成全团队时，写死的断言会假红。
    const hidden = await pickHiddenDataset();

    await page.goto('/datasets');
    await page.waitForLoadState('networkidle');

    await expect(
      page.getByText(RESOURCES.grantedKb.name, { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText(hidden.name, { exact: true }),
      '未授权的私有库不得出现在列表里',
    ).toHaveCount(0);
  });

  test('知识问答 / 知识搜索 / 记忆为空态', async ({ page }) => {
    await page.goto('/chats');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('尚未创建聊天应用')).toBeVisible();

    await page.goto('/searches');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('尚未创建搜索应用')).toBeVisible();

    await page.goto('/memories');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('尚未创建记忆')).toBeVisible();
  });

  test('智能体只看到被授权的那一个', async ({ page }) => {
    await page.goto('/agents');
    await page.waitForLoadState('networkidle');

    await expect(
      page.getByText(RESOURCES.grantedAgent, { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText(RESOURCES.privateAgent, { exact: true }),
      '未授权的智能体不得出现',
    ).toHaveCount(0);
  });

  test('会话质检没有可配置的应用', async ({ page }) => {
    await page.goto('/qc');
    await page.waitForLoadState('networkidle');
    // 正则同时会命中下拉里的 <option>暂无可用应用</option>，而 option 永远
    // 不是「可见元素」（Playwright 只认 select 本身），所以直接断空态文案。
    await expect(
      page.getByText('暂无可配置的应用，请先创建聊天应用或对话流'),
    ).toBeVisible();
  });
});

test.describe('资源可见性 · 接口计数对齐', () => {
  const count = async (
    request: import('@playwright/test').APIRequestContext,
    path: string,
    who: 'owner' | 'member',
  ) => {
    const res = await request.get(path, {
      headers: { Authorization: tokenOf(who) },
    });
    const body = await res.json();
    const data = body.data;
    // 两种返回形态：知识库直接给数组，聊天/搜索/智能体给 { total, list }。
    // 解错一层会得到 -1，看起来像「比预期多」，实际是解析失败。
    if (Array.isArray(data)) return data.length;
    if (typeof data?.total === 'number') return data.total;
    return -1;
  };

  test('member 的可见集合是 owner 的子集', async ({ request }) => {
    const ownerKb = await count(request, api.datasets, 'owner');
    const memberKb = await count(request, api.datasets, 'member');
    expect(memberKb).toBeGreaterThan(0);
    expect(memberKb).toBeLessThan(ownerKb);

    expect(await count(request, api.chats, 'member')).toBe(0);
    expect(await count(request, api.searches, 'member')).toBe(0);
    expect(await count(request, api.agents, 'member')).toBe(1);
    expect(await count(request, api.agents, 'owner')).toBeGreaterThan(1);
  });
});
