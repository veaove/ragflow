import { expect, test, type APIRequestContext } from '@playwright/test';

import { api, authFile, IDENTITIES, tokenOf } from '../support/env';

/**
 * 授权图谱（第三个视角）的回归。
 *
 * 背景：2026-11-06 发版 b02ccc1 后，外部巡检报告「grant-graph 返回 code=0 但
 * nodes=0 edges=0」，并据此推断 `len(row.Grants)==0` 把所有行都 continue 掉了。
 * 实际是**字段名误读**：这个接口返回的是 `resources[].grants`（边由前端展开），
 * 从来没有扁平的 `nodes` / `edges` 字段 —— 取不到就是 undefined，被当成 0。
 * 第一条用例把响应形状钉死，避免同一次误判再来一次。
 *
 * 只读用例：不发写请求。租户数据会被临时改动，所以断言一律「与列表接口同源」
 * 和「受限身份 ⊆ owner」，不写死条数。
 */

type Grant = {
  kind: string;
  id: string;
  name: string;
  permission?: string;
  effect?: string;
};

type GraphResource = {
  id: string;
  kind: string;
  name: string;
  owner_name: string;
  exception_count: number;
  unconfigured: boolean;
  grants: Grant[];
};

type Graph = {
  members: { id: string; name: string; email: string; department_id: string }[];
  teams: { kind: string; id?: string; name: string }[];
  resources: GraphResource[];
  stats: { visible: number; configured: number; unconfigured: number; truncated?: boolean };
};

const TID = IDENTITIES.owner.tenantId;

/** 图谱覆盖的五类平铺资源，与后端 graphKinds 一致。 */
const KINDS: { key: string; label: string; list: string }[] = [
  { key: 'dataset', label: '知识库', list: api.grants(TID, 'dataset') },
  { key: 'chat', label: '知识问答', list: api.grants(TID, 'chat') },
  { key: 'search_app', label: '知识搜索', list: api.grants(TID, 'search_app') },
  { key: 'canvas', label: '智能体', list: api.grants(TID, 'canvas') },
  { key: 'memory', label: '记忆', list: api.grants(TID, 'memory') },
];

const keyOf = (resource: { kind: string; id: string }) => `${resource.kind}:${resource.id}`;

const graphOf = async (
  request: APIRequestContext,
  who: keyof typeof IDENTITIES,
): Promise<Graph> => {
  const res = await request.get(api.grantGraph(TID), {
    headers: { Authorization: tokenOf(who) },
  });
  expect(res.status(), `${who} 请求图谱应 200（401 多半是登录态过期）`).toBe(200);
  const body = await res.json();
  expect(body.code, `${who} 图谱业务码`).toBe(0);
  return body.data as Graph;
};

/** 列表接口里「有规则」的资源 id（图谱只该画这些）。 */
const listedWithGrants = async (
  request: APIRequestContext,
  path: string,
  who: keyof typeof IDENTITIES,
): Promise<{ ids: Set<string>; total: number; rows: number }> => {
  const res = await request.get(`${path}&page=1&page_size=500`, {
    headers: { Authorization: tokenOf(who) },
  });
  expect(res.status(), `列表 ${path} 应 200`).toBe(200);
  const body = await res.json();
  const rows = (body.data?.resources ?? []) as { resource_id: string; grants?: Grant[] }[];
  return {
    ids: new Set(rows.filter((row) => (row.grants ?? []).length > 0).map((row) => row.resource_id)),
    total: body.data?.total ?? rows.length,
    rows: rows.length,
  };
};

test.describe('授权图谱 · 响应契约', () => {
  test.use({ storageState: authFile('owner') });

  test('返回 resources+grants，没有扁平的 nodes / edges 字段', async ({ request }) => {
    const graph = await graphOf(request, 'owner');

    // 巡检把「取不到 nodes/edges」当成「0 个节点」，这一步用断言把真相写下来。
    const raw = graph as unknown as Record<string, unknown>;
    expect(raw.nodes, '图谱不提供 nodes 字段（边由 resources[].grants 展开）').toBeUndefined();
    expect(raw.edges, '图谱不提供 edges 字段（边由 resources[].grants 展开）').toBeUndefined();
    expect(Object.keys(raw).sort()).toEqual(['members', 'resources', 'stats', 'teams']);

    expect(graph.members.length, '成员列不应为空').toBeGreaterThan(0);
    expect(graph.teams.length, '团队列至少有「全团队」').toBeGreaterThan(0);
    expect(graph.resources.length, '资源列不应为空').toBeGreaterThan(0);

    const edgeCount = graph.resources.reduce((sum, r) => sum + r.grants.length, 0);
    expect(edgeCount, '图上必须有边，否则等于空图').toBeGreaterThan(0);

    test.info().annotations.push({
      type: 'counts',
      description:
        `members=${graph.members.length} teams=${graph.teams.length} ` +
        `resources=${graph.resources.length} edges=${edgeCount} ` +
        `stats=${JSON.stringify(graph.stats)}`,
    });
  });

  test('资源列与列表接口同源：有规则才进图，且不画列表里没有的资源', async ({
    request,
  }) => {
    const graph = await graphOf(request, 'owner');
    const configured = graph.resources.filter((r) => !r.unconfigured);
    const counts: string[] = [];

    for (const kind of KINDS) {
      const listed = await listedWithGrants(request, kind.list, 'owner');
      const inGraph = configured.filter((r) => r.kind === kind.key).map((r) => r.id);
      counts.push(`${kind.label}: graph=${inGraph.length}/${listed.total} 可见, 其中有规则 ${listed.ids.size}`);

      for (const id of inGraph) {
        expect(
          listed.ids.has(id),
          `${kind.label}/${id} 出现在图上，但列表里它没有规则`,
        ).toBe(true);
      }
      // 列表页可能被 page_size 截断，截断时只验「图上 ⊆ 列表」这一个方向。
      if (listed.total <= listed.rows) {
        for (const id of listed.ids) {
          expect(
            inGraph.includes(id),
            `${kind.label}/${id} 列表里有规则却没进图`,
          ).toBe(true);
        }
      }
    }

    // 绝大多数资源从没配过授权，图上只画有规则的那部分 —— 这是设计而非漏画。
    expect(configured.length).toBeLessThanOrEqual(graph.stats.visible);

    test.info().annotations.push({ type: 'counts', description: counts.join(' | ') });
  });

  test('每个非样例节点至少一条规则；样例节点不连线且每类最多 2 个', async ({
    request,
  }) => {
    const graph = await graphOf(request, 'owner');

    for (const resource of graph.resources) {
      if (resource.unconfigured) {
        expect(resource.grants, `${resource.kind}/${resource.name} 是未配置样例`).toHaveLength(0);
        continue;
      }
      expect(
        resource.grants.length,
        `${resource.kind}/${resource.name} 进了图却没有规则`,
      ).toBeGreaterThan(0);
      for (const grant of resource.grants) {
        expect(['user', 'team', 'department']).toContain(grant.kind);
        expect(['allow', 'deny']).toContain(grant.effect ?? 'allow');
      }
    }

    const bareByKind = new Map<string, number>();
    for (const resource of graph.resources.filter((r) => r.unconfigured)) {
      bareByKind.set(resource.kind, (bareByKind.get(resource.kind) ?? 0) + 1);
    }
    for (const [kind, count] of bareByKind) {
      expect(count, `${kind} 的未配置样例超过 2 个`).toBeLessThanOrEqual(2);
    }
  });

  test('统计自洽：configured 等于非样例节点数，unconfigured = visible − configured', async ({
    request,
  }) => {
    const graph = await graphOf(request, 'owner');
    const configured = graph.resources.filter((r) => !r.unconfigured).length;

    expect(graph.stats.configured, 'configured 与实际画出的非样例节点数一致').toBe(
      configured,
    );
    expect(graph.stats.visible, 'visible 不能小于已配置数').toBeGreaterThanOrEqual(
      configured,
    );
    expect(graph.stats.unconfigured, 'unconfigured = visible − configured').toBe(
      graph.stats.visible - configured,
    );
  });
});

test.describe('授权图谱 · 受限身份不越权', () => {
  test('租户管理员与部门管理员的已授权集合与 owner 完全一致', async ({ request }) => {
    const owner = new Set(
      (await graphOf(request, 'owner')).resources
        .filter((r) => !r.unconfigured)
        .map(keyOf),
    );
    for (const who of ['admin', 'dept'] as const) {
      const graph = await graphOf(request, who);
      const mine = graph.resources.filter((r) => !r.unconfigured).map(keyOf);
      expect(new Set(mine), `${who} 应与 owner 看到同一批已授权资源`).toEqual(owner);
    }
  });

  test('普通成员与无授权成员的图谱是各自可见集合的子集', async ({ request }) => {
    const counts: string[] = [];
    const owner = new Set((await graphOf(request, 'owner')).resources.map(keyOf));

    for (const who of ['member', 'plain'] as const) {
      const graph = await graphOf(request, who);
      // 样例节点按「查看者可见的最近更新文档」取，因此跨身份不保证相同，比对时排除。
      const configured = graph.resources.filter((r) => !r.unconfigured);
      counts.push(`${who}: configured=${configured.length} visible=${graph.stats.visible}`);

      // 一、不许出现 owner 都看不到的资源。
      for (const resource of configured) {
        expect(
          owner.has(keyOf(resource)),
          `${who} 看到了 owner 看不到的 ${resource.kind}/${resource.name}`,
        ).toBe(true);
      }
      // 二、图上的节点必须是他自己列表里有规则的资源（不允许凭空造边）。
      for (const kind of KINDS) {
        const listed = await listedWithGrants(request, kind.list, who);
        for (const resource of configured.filter((r) => r.kind === kind.key)) {
          expect(
            listed.ids.has(resource.id),
            `${who} 的图上 ${kind.label}/${resource.name} 在自己列表里没有规则`,
          ).toBe(true);
          expect(
            resource.grants.length,
            `${who} 的 ${kind.label}/${resource.name} 没有规则却进了图`,
          ).toBeGreaterThan(0);
        }
      }
    }

    test.info().annotations.push({ type: 'counts', description: counts.join(' | ') });
  });

  test('未登录请求被拒绝', async ({ request }) => {
    const res = await request.get(api.grantGraph(TID));
    expect(res.status(), '没有 Authorization 时不应放行').toBe(401);
  });
});

test.describe('授权图谱 · 控制台界面', () => {
  // UI 用例只能用 owner：其余 E2E 账号的浏览器会话绑定的是它们各自的空租户。
  test.use({ storageState: authFile('owner') });

  test('切到图谱能画出节点与连线，图例与统计同步', async ({ page, request }) => {
    const apiErrors: string[] = [];
    page.on('response', (res) => {
      if (res.url().includes('/api/v1/') && res.status() >= 400) {
        apiErrors.push(`${res.status()} ${res.url()}`);
      }
    });

    await page.goto('/console/grants');
    await page.waitForLoadState('networkidle');

    const graphTab = page.getByRole('button', { name: '授权图谱' });
    await expect(graphTab, '资源授权页缺少「授权图谱」入口').toBeVisible();
    await graphTab.click();

    const canvas = page.getByTestId('grant-graph');
    await expect(canvas).toBeVisible();

    const nodes = page.getByTestId('graph-node');
    const edges = page.getByTestId('graph-edge');
    await expect
      .poll(async () => nodes.count(), { message: '图谱没有画出任何节点' })
      .toBeGreaterThan(0);
    const edgeTotal = await edges.count();
    expect(edgeTotal, '图谱没有画出任何连线').toBeGreaterThan(0);

    // 底部「未配置」必须与接口一致，否则图与数字各说各话。
    const graph = await graphOf(request, 'owner');
    await expect(page.getByTestId('graph-stat-unconfigured')).toHaveAttribute(
      'data-value',
      String(graph.stats.unconfigured),
    );

    // 关掉「明确拒绝」：连线数与统计里的拒绝数一起归零。
    const denyEdges = await page.locator('[data-edge-type="deny"]').count();
    await page.getByTestId('graph-legend-edge-deny').click();
    await expect
      .poll(async () => edges.count(), { message: '关掉拒绝边后连线数没有减少' })
      .toBe(edgeTotal - denyEdges);
    await expect(page.getByTestId('graph-stat-deny')).toHaveAttribute('data-value', '0');
    await page.getByTestId('graph-legend-edge-deny').click();

    // 点一个资源节点进入聚焦，底部换成「谁能到它」的口径。
    await page.locator('[data-node-kind="dataset"]').first().click();
    await expect(page.getByTestId('graph-stat-focus-allow')).toBeVisible();
    await expect(page.getByTestId('graph-stat-focus-deny')).toBeVisible();
    await page.getByTestId('graph-focus-all').click();
    await expect(page.getByTestId('graph-stat-allow')).toBeVisible();

    expect(apiErrors, '图谱页出现 4xx/5xx 接口').toEqual([]);
  });
});
