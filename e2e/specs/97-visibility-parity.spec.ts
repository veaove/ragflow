import { expect, test } from '@playwright/test';

import { api, authFile, IDENTITIES, tokenOf } from '../support/env';
import { fetchRows } from '../support/list-rows';

/**
 * 五类资源的可见范围与授权能力一致性（D7 回归）。
 *
 * 背景：可见范围原本只在知识库上完整生效 —— 知识库列表 SQL 认
 * `user_tenant.role_id` 指向的内置「租户管理员」，而知识问答 / 知识搜索 /
 * 智能体 / 记忆走逐条判定、不看这个角色，于是同一个管理员在知识库能看到
 * 18 个库、在另外四类看到 0 条。2026-11-05 起判定统一，这里把它钉成回归。
 *
 * 只读用例：不发任何写请求，跑在真实租户上也不会留下数据。
 * 「不可见（排除）」的写入用例在 85-exclude-flow / 87-file-deny 里，
 * 走自建临时资源 + afterAll 清理，需要 E2E_ALLOW_WRITE=1。
 */
const TID = IDENTITIES.owner.tenantId;

const KINDS = [
  { key: 'dataset', label: '知识库', list: api.datasets },
  { key: 'chat', label: '知识问答', list: api.chats },
  { key: 'search_app', label: '知识搜索', list: api.searches },
  { key: 'canvas', label: '智能体', list: api.agents },
  { key: 'memory', label: '记忆', list: api.memories },
] as const;

const sortedIDs = (rows: { id: string }[]) => rows.map((row) => row.id).sort();

test.describe('可见范围一致性 · 租户管理员', () => {
  test.use({ storageState: authFile('admin') });

  test('五类资源的可见集合与 owner 完全相同', async ({ request }) => {
    for (const kind of KINDS) {
      const owner = sortedIDs(await fetchRows(request, kind.list, tokenOf('owner')));
      const admin = sortedIDs(await fetchRows(request, kind.list, tokenOf('admin')));

      expect(owner.length, `${kind.label}：owner 列表为空，没有对照基准`).toBeGreaterThan(0);
      // 一处不齐平就是 D7 复发：同一个人在这类资源里被当成「普通成员」。
      expect(admin, `${kind.label}：租户管理员应与 owner 看到同一批资源`).toEqual(owner);
    }
  });
});

test.describe('授权能力声明 · supports_deny', () => {
  test.use({ storageState: authFile('owner') });

  test('五类资源可写「不可见」，文件与集成类不可写', async ({ request }) => {
    const expected: [kind: string, label: string, supportsDeny: boolean][] = [
      ['dataset', '知识库', true],
      ['chat', '知识问答', true],
      ['search_app', '知识搜索', true],
      ['canvas', '智能体', true],
      ['memory', '记忆', true],
      ['file', '文件', false],
      ['mcp_server', 'MCP 服务', false],
      ['connector', '数据源', false],
      ['skill_space', '技能空间', false],
    ];

    for (const [kind, label, want] of expected) {
      const res = await request.get(api.grants(TID, kind), {
        headers: { Authorization: tokenOf('owner') },
      });
      expect(res.status(), `${label} 列表应 200`).toBe(200);
      const body = await res.json();
      expect(body.code, `${label} 列表`).toBe(0);

      const rows = (body.data?.resources ?? []) as {
        resource_id: string;
        resource_name: string;
        supports_deny: boolean;
      }[];
      expect(rows.length, `${label} 没有资源，无法验证声明`).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.supports_deny, `${label}/${row.resource_name}`).toBe(want);
      }
    }
  });
});

test.describe('授权弹窗 · 不可见选项', () => {
  test.use({ storageState: authFile('admin') });

  test('四类资源与知识库一样能在弹窗里选「不可见（排除）」', async ({ page }) => {
    await page.goto('/console/grants');
    await page.waitForLoadState('networkidle');

    for (const tab of ['知识库', '知识问答', '知识搜索', '智能体', '记忆中心']) {
      await page.getByRole('tab', { name: tab }).click();
      const firstEdit = page.getByRole('button', { name: '设置' }).first();
      await expect(firstEdit, `${tab} 没有可设置的资源`).toBeVisible();
      await firstEdit.click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      // 「不可见（排除）」是添加区第二个下拉里的第三个 option，只在
      // supports_deny 为真时渲染 —— 这条断言同时验证后端声明与前端分支。
      const options = await dialog.locator('option').allTextContents();
      expect(options, `${tab} 的弹窗缺少「不可见（排除）」`).toContain('不可见（排除）');

      await dialog.getByRole('button', { name: '取消' }).click();
      await expect(dialog).toBeHidden();
    }
  });
});
