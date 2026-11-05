import { expect, test } from '@playwright/test';

import { api, authFile, IDENTITIES, tokenOf } from '../support/env';
import { fetchRows, type ListRow } from '../support/list-rows';

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
 *
 * 两个容易把断言写错的坑，都在这里处理掉：
 *
 * 1. `/agents` 会把**调用者自己的**编译算子组（`type=compilation_template_group`）
 *    并进同一份列表。它按 `ListSaved(userID)` 取，是个人资产、不参与租户共享，
 *    拿整份列表比 owner 会凭空多出 6 条 —— 比对前必须剔掉。
 * 2. E2E 三个账号注册时各自带出一个个人租户（id = 自己的 user id），浏览器会话
 *    绑定的是那个空租户，所以 UI 用例用 owner 的登录态跑（owner 只有一个租户）。
 *    「管理员能看到 owner 档资源」由上面第一条接口用例覆盖，不靠 UI 重复证明。
 */
const TID = IDENTITIES.owner.tenantId;

type Kind = {
  key: string;
  label: string;
  list: string;
  /** 剔除「调用者私有、不属于租户共享」的条目（目前只有 /agents 的编译算子组）。 */
  exclude?: (row: ListRow) => boolean;
};

const KINDS: Kind[] = [
  { key: 'dataset', label: '知识库', list: api.datasets },
  { key: 'chat', label: '知识问答', list: api.chats },
  { key: 'search_app', label: '知识搜索', list: api.searches },
  {
    key: 'canvas',
    label: '智能体',
    list: api.agents,
    // 编译算子组是调用者私有的（见文件头注释 1）。
    exclude: (row) => row.type === 'compilation_template_group',
  },
  { key: 'memory', label: '记忆', list: api.memories },
];

const visibleIDs = (rows: ListRow[], kind: Kind) =>
  rows.filter((row) => !kind.exclude?.(row)).map((row) => row.id).sort();

test.describe('可见范围一致性 · 租户管理员', () => {
  test.use({ storageState: authFile('admin') });

  test('五类资源的可见集合与 owner 完全相同', async ({ request }) => {
    const counts: string[] = [];

    for (const kind of KINDS) {
      const ownerRows = await fetchRows(request, kind.list, tokenOf('owner'));
      const adminRows = await fetchRows(request, kind.list, tokenOf('admin'));
      const owner = visibleIDs(ownerRows, kind);
      const admin = visibleIDs(adminRows, kind);
      counts.push(`${kind.label}: owner=${owner.length} admin=${admin.length}`);

      expect(owner.length, `${kind.label}：owner 列表为空，没有对照基准`).toBeGreaterThan(0);
      // 一处不齐平就是 D7 复发：同一个人在这类资源里被当成「普通成员」。
      expect(admin, `${kind.label}：租户管理员应与 owner 看到同一批资源`).toEqual(owner);
    }

    test.info().annotations.push({ type: 'counts', description: counts.join(' | ') });
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

    const checked: string[] = [];
    const unsampled: string[] = [];

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
      // 本租户没有 MCP 服务 / 数据源 / 技能空间实例，声明无从读起。这里如实记进
      // annotation 而不是静默跳过：那三类的「不许写排除」由 80-exclude 的写拒绝
      // 用例守着（新旧版本都拒绝，不依赖本用例的样本）。
      if (rows.length === 0) {
        unsampled.push(label);
        continue;
      }
      for (const row of rows) {
        expect(row.supports_deny, `${label}/${row.resource_name}`).toBe(want);
      }
      checked.push(`${label}=${rows.length}`);
    }

    // 五类资产与文件是本用例的硬前提：它们必须真的有样本，否则等于空跑。
    expect(unsampled, '五类资产与文件必须有样本').not.toContain('知识库');
    expect(unsampled, '五类资产与文件必须有样本').not.toContain('知识问答');
    expect(unsampled, '五类资产与文件必须有样本').not.toContain('知识搜索');
    expect(unsampled, '五类资产与文件必须有样本').not.toContain('智能体');
    expect(unsampled, '五类资产与文件必须有样本').not.toContain('记忆');
    expect(unsampled, '五类资产与文件必须有样本').not.toContain('文件');

    test.info().annotations.push({
      type: 'samples',
      description: `${checked.join(' ')}${unsampled.length ? ` | 无样本：${unsampled.join('、')}` : ''}`,
    });
  });
});

test.describe('授权弹窗 · 不可见选项', () => {
  // 用 owner 而不是 admin：E2E 账号的个人租户会覆盖浏览器会话（见文件头注释 2）。
  test.use({ storageState: authFile('owner') });

  /**
   * 只跑四类平铺列表：知识库/文件是层级视图，没有「设置」按钮，它的弹窗入口
   * （详情面板 →「添加授权」）与「不可见（排除）」选项由 80-exclude 守着。
   * 这四类正是 D7 之前只能「允许」、没有排除选项的那一批。
   */
  test('四类资源的授权弹窗都能选「不可见（排除）」', async ({ page }) => {
    await page.goto('/console/grants');
    await page.waitForLoadState('networkidle');

    for (const tab of ['知识问答', '知识搜索', '智能体', '记忆中心']) {
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
