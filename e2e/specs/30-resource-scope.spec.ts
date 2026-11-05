import { expect, test } from '@playwright/test';

import { IDENTITIES, RESOURCES, api, authFile, tokenOf } from '../support/env';
import { pickHiddenDataset } from '../support/hidden-dataset';
import { pickRows } from '../support/list-rows';
import { compareScope, displayName } from '../support/scope-diff';

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

  test('知识问答 / 知识搜索 / 记忆不展示未授权的条目', async ({ page }) => {
    // 不再断「一定是空态」：管理员随时可能把某个问答/搜索开成全团队（2026-11-05
    // 就有两条问答 + 一条搜索被这样授权过）。真正的不变量是「owner 看得到、
    // member 看不到的条目不得出现在页面上」，空态文案只在成员真的一条都没有时校验。
    for (const [path, route, emptyText] of [
      [api.chats, '/chats', '尚未创建聊天应用'],
      [api.searches, '/searches', '尚未创建搜索应用'],
      [api.memories, '/memories', '尚未创建记忆'],
    ] as const) {
      const { member, hidden } = await compareScope(path);

      await page.goto(route);
      await page.waitForLoadState('networkidle');

      // 只在内容区断言：顶栏的租户切换器会显示「华夏基金」，拿整页文本比对会把
      // 租户名当成「泄露的资源名」。
      const content = page.locator('main');

      for (const row of hidden) {
        const name = displayName(row);
        if (!name) continue;
        await expect(
          content.getByText(name, { exact: true }),
          `${route}: ${name} 未授权，不得出现在成员页面上`,
        ).toHaveCount(0);
      }
      if (member.length === 0) {
        await expect(content.getByText(emptyText)).toBeVisible();
      }

      test.info().annotations.push({
        type: 'scope',
        description: `${route}: member=${member.length} hidden=${hidden.length}`,
      });
    }
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

  test('会话质检只提供成员看得到的应用', async ({ page }) => {
    const { member, hidden } = await compareScope(api.chats);

    await page.goto('/qc');
    await page.waitForLoadState('networkidle');

    // 成员一条问答都没有时才是空态；有授权就有可选项，但不能出现未授权的应用名。
    const content = page.locator('main');
    if (member.length === 0) {
      await expect(
        content.getByText('暂无可配置的应用，请先创建聊天应用或对话流'),
      ).toBeVisible();
      return;
    }
    for (const row of hidden) {
      const name = displayName(row);
      if (!name) continue;
      await expect(
        content.getByText(name, { exact: true }),
        `/qc: ${name} 未授权，不得出现在可选应用里`,
      ).toHaveCount(0);
    }
  });
});

test.describe('资源可见性 · 接口计数对齐', () => {
  const TID = IDENTITIES.owner.tenantId;

  test('member 的可见集合是 owner 的子集，且每条都能解释来源', async ({ request }) => {
    const get = async (path: string, who: 'owner' | 'member') => {
      const res = await request.get(path, { headers: { Authorization: tokenOf(who) } });
      expect(res.status(), `${who} GET ${path}`).toBe(200);
      const body = await res.json();
      expect(body.code, `${who} GET ${path}: ${body.message}`).toBe(0);
      return body.data;
    };
    const rowsOf = async (path: string, who: 'owner' | 'member') =>
      pickRows(await get(path, who));

    // 「他为什么能看到」的权威口径：按成员视角的授权清单（直接 / 部门 / 全团队三条来源）。
    const members = pickRows(await get(api.members(TID), 'owner'));
    const member = members.find((row) => row.email === IDENTITIES.member.email);
    expect(member, `成员列表里没有 ${IDENTITIES.member.email}`).toBeTruthy();
    const audit = await get(api.grantsBySubject(TID, String(member!.id)), 'owner');
    const explained = new Set(
      (audit.rows as { resource_kind: string; resource_id: string }[]).map(
        (row) => `${row.resource_kind}:${row.resource_id}`,
      ),
    );

    const KINDS = [
      [api.datasets, 'dataset', '知识库'],
      [api.chats, 'chat', '知识问答'],
      [api.searches, 'search_app', '知识搜索'],
      [api.agents, 'canvas', '智能体'],
      [api.memories, 'memory', '记忆'],
    ] as const;

    for (const [path, kind, label] of KINDS) {
      const ownerRows = await rowsOf(path, 'owner');
      const memberRows = await rowsOf(path, 'member');
      const ownerIDs = new Set(ownerRows.map((row) => row.id));

      for (const row of memberRows) {
        const name = displayName(row) || row.id;
        expect(ownerIDs.has(row.id), `${label}/${name}：成员看得到但 owner 看不到`).toBe(true);
        const createdBy = String(row.user_id ?? row.created_by ?? '');
        expect(
          createdBy === member!.id || explained.has(`${kind}:${row.id}`),
          `${label}/${name}：成员看得到，却既不是自建也没有任何授权记录（来源不明）`,
        ).toBe(true);
      }

      test.info().annotations.push({
        type: 'scope',
        description: `${label}: owner=${ownerRows.length} member=${memberRows.length}`,
      });
    }

    // 知识库仍是严格子集：成员不该看到全部库。
    expect((await rowsOf(api.datasets, 'member')).length).toBeGreaterThan(0);
    expect((await rowsOf(api.datasets, 'member')).length).toBeLessThan(
      (await rowsOf(api.datasets, 'owner')).length,
    );
  });
});
