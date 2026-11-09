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
  owner_id?: string;
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
  // 五类平铺资源上，管理层与 owner 齐平（D7 基线）。文件是例外：文件级规则是
  // 名单制，一个只点名了别人的文件，管理员也读不到 —— 所以这里只比平铺资源，
  // 文件的「画了就要读得到」由下一条用例按本人文件列表逐个核对。
  test('租户管理员与部门管理员的平铺资源与 owner 完全一致', async ({ request }) => {
    const ownerGraph = await graphOf(request, 'owner');
    const flatKeys = (graph: Graph) =>
      graph.resources
        .filter((r) => !r.unconfigured && r.kind !== 'document')
        .map(keyOf);
    const ownerFlat = new Set(flatKeys(ownerGraph));
    const ownerDocs = new Set(
      ownerGraph.resources.filter((r) => r.kind === 'document').map((r) => r.id),
    );

    for (const who of ['admin', 'dept'] as const) {
      const graph = await graphOf(request, who);
      expect(new Set(flatKeys(graph)), `${who} 应与 owner 看到同一批已授权资源`).toEqual(
        ownerFlat,
      );
      // 文件节点只能是 owner 的子集：多出来就是越权。
      for (const doc of graph.resources.filter((r) => r.kind === 'document')) {
        expect(ownerDocs.has(doc.id), `${who} 看到了 owner 都没有的文件 ${doc.name}`).toBe(
          true,
        );
      }
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

  // 图谱是「绕过列表的泄露通道」里最容易被漏掉的一条：文件级规则是名单制，
  // 有规则的文件对不在名单内的人不可读，但图谱从资源表出发画图，一个不留神就
  // 把文件名和「谁被排除」透出去了。b02ccc1 就漏了这一层（4 个文件对 member /
  // plain 可见），c9059ce 补上。断言用的是同一个事实来源：文件列表里读得到才算数。
  test('读不到的文件不出现在图谱里', async ({ request }) => {
    const counts: string[] = [];

    for (const who of ['member', 'plain', 'admin', 'dept'] as const) {
      const readable = await readableDocumentIDs(request, who);
      const graph = await graphOf(request, who);
      const docs = graph.resources.filter((resource) => resource.kind === 'document');
      counts.push(`${who}: 图上文件 ${docs.length} / 本人可读 ${readable.size}`);

      for (const resource of docs) {
        expect(
          readable.has(resource.id),
          `${who} 读不到 ${resource.name}，屏幕上却画着它`,
        ).toBe(true);
      }
    }

    test.info().annotations.push({ type: 'counts', description: counts.join(' | ') });
  });
});

/** 查看者真正读得到的文件 id：把他能读的知识库逐个翻页取全（接口每页上限 10）。 */
const readableDocumentIDs = async (
  request: APIRequestContext,
  who: keyof typeof IDENTITIES,
): Promise<Set<string>> => {
  const seen = new Set<string>();
  const res = await request.get(`${api.grants(TID, 'dataset')}&page=1&page_size=500`, {
    headers: { Authorization: tokenOf(who) },
  });
  const body = await res.json();
  for (const row of body.data?.resources ?? []) {
    for (let page = 1; page <= 60; page += 1) {
      const docs = await request.get(
        `${api.datasetDocuments(row.resource_id)}?page=${page}&page_size=10`,
        { headers: { Authorization: tokenOf(who) } },
      );
      const items = (await docs.json()).data?.docs ?? [];
      for (const doc of items) seen.add(doc.id);
      if (items.length < 10) break;
    }
  }
  return seen;
};

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

    // 底部「未单独授权」必须与接口一致，否则图与数字各说各话。
    const graph = await graphOf(request, 'owner');
    const unconfigured = page.getByTestId('graph-stat-unconfigured');
    await expect(unconfigured).toHaveAttribute(
      'data-value',
      String(graph.stats.unconfigured),
    );
    // 口径说明不能丢：「可见 198 / 图上 14 个点」全靠这两行解释，缺了就像漏画。
    // 它在画布容器外面（ct 是 data-testid="grant-graph" 的 svg 容器），按文案找。
    await expect(unconfigured).toContainText('未单独授权');
    await expect(page.getByText('图上只画有授权记录的资源').first()).toBeVisible();

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

  // 线上 c9059ce 还没有这一版：聚焦条只按顺序截前 4 个成员，当前登录用户（租户
  // 所有者）排第 5 就从条上消失；而且所有者一条规则都没有，点开只会看到「可访问 0」。
  // 修复在本地（聚焦条自己第一 + 成员节点标「所有者」+ 聚焦时说明「属他所有」），
  // 发版后把这条 fixme 改成 test。
  test.fixme('聚焦条第一位是当前登录用户，并能说明「属他所有」（发版后启用）', async ({
    page,
    request,
  }) => {
    const graph = await graphOf(request, 'owner');
    const owner = graph.members.find((member) => member.email === IDENTITIES.owner.email);
    expect(owner, '图谱成员列里应有当前登录用户').toBeDefined();
    const owned = graph.resources.filter((r) => r.owner_id === owner!.id).length;
    expect(owned, '所有者名下应有资源（否则这条用例没有意义）').toBeGreaterThan(0);

    await page.goto('/console/grants');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: '授权图谱' }).click();
    await page.waitForSelector('[data-testid=graph-node]');

    const chips = page.getByTestId(/^graph-focus-member-/);
    await expect(chips.first()).toHaveAttribute(
      'data-testid',
      `graph-focus-member-${owner!.id}`,
    );

    await chips.first().click();
    await expect(page.getByTestId('graph-stat-focus-owned')).toHaveAttribute(
      'data-value',
      String(owned),
    );
  });
});
