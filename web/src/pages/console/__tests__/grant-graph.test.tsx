import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { GrantGraph } from '../grant-graph';
import {
  COMPACT_HEIGHT,
  RESOURCE_KINDS,
  buildGraphModel,
  computeVisibility,
  defaultFilter,
  focusStats,
  layoutGraph,
  pickFocusMembers,
  subjectStats,
  toggleResourceKinds,
} from '../grant-graph-layout';

jest.mock('@/services/console-service', () => ({
  ...jest.requireActual('@/services/console-service'),
  fetchGrantGraph: jest.fn(),
}));

// 测试文件的 transform 只做模块改写，类型标注里的 import 绑定会和 jest.mock
// 冲突，所以这里不写类型标注，样本按结构交给 tsc 校验。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockedGraph = require('@/services/console-service')
  .fetchGrantGraph as jest.Mock;

/**
 * 三列样本：两个成员（各属一个部门）、一个部门 + 一条「全团队」、三个资源
 * （一个正常、一个带拒绝和部门授权、一个从未配置）。
 */
const payload = () => ({
  members: [
    {
      id: 'u1',
      name: '张伟',
      email: 'zhangwei@example.com',
      department_id: 'd1',
      department_name: '风控部',
    },
    {
      id: 'u2',
      name: '李四',
      email: 'lisi@example.com',
      department_id: 'd2',
      department_name: '客服部',
    },
  ],
  teams: [
    { kind: 'department' as const, id: 'd1', name: '风控部' },
    { kind: 'team' as const, name: '全团队' },
  ],
  resources: [
    {
      id: 'kb1',
      kind: 'dataset',
      name: '帮助中心',
      owner_id: 'u1',
      owner_name: '张伟',
      grants: [
        {
          kind: 'user' as const,
          id: 'u1',
          name: '张伟',
          permission: 'read' as const,
          effect: 'allow' as const,
        },
      ],
    },
    {
      id: 'kb2',
      kind: 'dataset',
      name: '对账单',
      owner_id: 'u1',
      owner_name: '张伟',
      grants: [
        {
          kind: 'user' as const,
          id: 'u1',
          name: '张伟',
          permission: 'read' as const,
          effect: 'deny' as const,
        },
        {
          kind: 'department' as const,
          id: 'd1',
          name: '风控部',
          permission: 'edit' as const,
        },
      ],
    },
    {
      id: 'a1',
      kind: 'chat',
      name: '问答助手',
      owner_id: 'u2',
      owner_name: '李四',
      unconfigured: true,
      grants: [],
    },
  ],
  stats: { visible: 3, configured: 2, unconfigured: 7 },
});

const layoutOf = () =>
  layoutGraph(buildGraphModel(payload()), {
    width: 960,
    height: 700,
    barHeight: 60,
  });

describe('buildGraphModel', () => {
  it('把成员、团队、资源分开，并把「未配置」资源留成无连线的点', () => {
    const model = buildGraphModel(payload());

    expect(model.members.map((m) => m.key)).toEqual(['member:u1', 'member:u2']);
    expect(model.teams.map((t) => t.key)).toEqual(['team:d1', 'team:__team__']);
    // 张伟是图上资源的创建者，成员节点会标出「所有者」。
    expect(model.members[0].sub).toBe('所有者 · 风控部');

    const unconfigured = model.resources.find((r) => r.key === 'chat:a1');
    expect(unconfigured?.unconfigured).toBe(true);
    expect(unconfigured?.sub).toBe('未单独授权');
    expect(model.edges.some((e) => e.to === 'chat:a1')).toBe(false);

    // 只列图上真正出现的资源类型，图例不该出现空的分类。
    expect(model.kindsInUse).toEqual(['dataset', 'chat']);
    expect(model.stats.unconfigured).toBe(7);
  });

  it('指向已离职成员的规则不画边，但资源本身照画', () => {
    const data = payload();
    data.resources[0].grants = [
      {
        kind: 'user' as const,
        id: 'u-gone',
        name: '已离职',
        permission: 'read' as const,
        effect: 'allow' as const,
      },
    ];
    const model = buildGraphModel(data);

    expect(model.resources.some((r) => r.key === 'dataset:kb1')).toBe(true);
    // 只剩另一个库上的两条规则，kb1 自己一条边都不剩。
    expect(model.edges).toHaveLength(2);
    expect(model.edges.some((edge) => edge.to === 'dataset:kb1')).toBe(false);
  });

  it('团队授权单独成类，直接授权按 allow / deny 分类', () => {
    const model = buildGraphModel(payload());

    const denyEdge = model.edges.find((e) => e.effect === 'deny');
    expect(denyEdge?.type).toBe('deny');
    expect(denyEdge?.from).toBe('member:u1');

    // 部门授权画到中间列，不能混进成员那一列。
    const departmentEdge = model.edges.find((e) => e.subject === 'team');
    expect(departmentEdge?.type).toBe('team');
    expect(departmentEdge?.from).toBe('team:d1');
  });

  it('成员到部门的隶属关系只作为背景虚线', () => {
    const model = buildGraphModel(payload());
    expect(model.memberships).toEqual([
      { member: 'member:u1', team: 'team:d1' },
    ]);
  });

  it('资源所有者标到成员节点上：所有者没有规则也不会像个空节点', () => {
    // 租户所有者通常一条规则都没有，访问全靠「资源是我建的」。
    const data = payload();
    data.resources.forEach((res) => {
      res.grants = [];
    });
    const model = buildGraphModel(data);

    // 没有规则就没有边。
    expect(model.edges).toEqual([]);
    // 张伟拥有 kb1 / kb2；李四拥有样例节点 a1。
    expect(model.members[0].owned).toBe(2);
    expect(model.members[0].sub).toBe('所有者 · 风控部');
    expect(model.members[1].owned).toBe(1);
    expect(model.members[1].sub).toBe('所有者 · 客服部');
    expect(model.members[0].title).toContain('所有者');
  });
});

describe('pickFocusMembers', () => {
  const member = (id: string) => ({ key: `member:${id}` });

  it('自己永远进聚焦条，哪怕排在第 5 位', () => {
    const members = ['a', 'b', 'c', 'd', 'me'].map(member);
    const picked = pickFocusMembers(members, [], 'member:me');
    expect(picked[0].key).toBe('member:me');
    expect(picked).toHaveLength(4);
  });

  it('其余名额按规则条数补齐，规则越多越靠前', () => {
    const members = ['a', 'b', 'c', 'me'].map(member);
    const edges = [
      ...Array.from({ length: 3 }, () => ({ from: 'member:b' })),
      ...Array.from({ length: 2 }, () => ({ from: 'member:c' })),
      { from: 'member:a' },
    ];
    const picked = pickFocusMembers(members, edges, 'member:me');
    expect(picked.map((m) => m.key)).toEqual([
      'member:me',
      'member:b',
      'member:c',
      'member:a',
    ]);
  });
});

describe('layoutGraph', () => {
  it('三列各自固定横坐标，且资源不越过底部横条', () => {
    const layout = layoutOf();
    const { member, team, resource } = layout.columnX;

    expect(member).toBeLessThan(team);
    expect(team).toBeLessThan(resource);
    expect(layout.members.every((n) => n.x === member)).toBe(true);
    expect(layout.resources.every((n) => n.x === resource)).toBe(true);
    // barHeight = 60，底部还要留 12px 余量。
    expect(Math.max(...layout.resources.map((n) => n.y))).toBeLessThanOrEqual(
      700 - 60,
    );
  });

  it('矮窗口切紧凑模式，节点更小更密', () => {
    const model = buildGraphModel(payload());
    const tall = layoutGraph(model, {
      width: 960,
      height: COMPACT_HEIGHT + 40,
      barHeight: 60,
    });
    const short = layoutGraph(model, {
      width: 960,
      height: COMPACT_HEIGHT - 40,
      barHeight: 60,
    });

    expect(tall.compact).toBe(false);
    expect(short.compact).toBe(true);
    expect(short.nodeHeight).toBeLessThan(tall.nodeHeight);
  });

  it('过滤不改变坐标：勾选图例只影响画不画', () => {
    const model = buildGraphModel(payload());
    const layout = layoutOf();
    const all = computeVisibility(model, layout, defaultFilter(model), null);
    const noDeny = computeVisibility(
      model,
      layout,
      { ...defaultFilter(model), edges: ['allow', 'team'] },
      null,
    );

    expect(all.edges.size).toBe(3);
    expect(noDeny.edges.size).toBe(2);
    expect(noDeny.nodes).toEqual(all.nodes);
  });

  it('节点类型被关掉时，挂在它上面的连线一起消失', () => {
    const model = buildGraphModel(payload());
    const filter = defaultFilter(model);
    const withoutTeam = computeVisibility(
      model,
      layoutOf(),
      { ...filter, nodes: filter.nodes.filter((kind) => kind !== 'team') },
      null,
    );

    expect(
      [...withoutTeam.nodes].every((key) => !key.startsWith('team:')),
    ).toBe(true);
    // 部门那条边两端少了团队节点，必须一起消失，不能留悬空线；直接授权的两条还在。
    expect(withoutTeam.edges.size).toBe(2);
  });
});

describe('computeVisibility', () => {
  it('聚焦成员时只留他能到的资源，其余节点变暗', () => {
    const model = buildGraphModel(payload());
    const visibility = computeVisibility(
      model,
      layoutOf(),
      defaultFilter(model),
      {
        kind: 'member',
        key: 'member:u1',
      },
    );

    // 两条直接规则 + 他所在部门带来的那条。
    expect(visibility.edges.size).toBe(3);
    expect(visibility.dimmed.has('member:u2')).toBe(true);
    expect(visibility.dimmed.has('member:u1')).toBe(false);
    expect(visibility.dimmed.has('dataset:kb1')).toBe(false);
    expect(visibility.dimmed.has('chat:a1')).toBe(true);
  });

  it('聚焦资源时只留指向它的边', () => {
    const model = buildGraphModel(payload());
    const visibility = computeVisibility(
      model,
      layoutOf(),
      defaultFilter(model),
      {
        kind: 'resource',
        key: 'dataset:kb2',
      },
    );

    expect([...visibility.edges]).toHaveLength(2);
    expect(visibility.dimmed.has('member:u1')).toBe(false);
    expect(visibility.dimmed.has('dataset:kb1')).toBe(true);
  });
});

describe('统计', () => {
  it('成员视角：拒绝优先，剩下的算「本层无授权」', () => {
    const model = buildGraphModel(payload());
    const stats = focusStats(
      model.edges.filter(
        (edge) => edge.effect === 'deny' || edge.to === 'dataset:kb1',
      ),
      3,
    );

    expect(stats.allow).toBe(1);
    expect(stats.deny).toBe(1);
    expect(stats.untouched).toBe(1);
  });

  it('资源视角：按主体去重，同一主体的拒绝压过允许', () => {
    const stats = subjectStats([
      {
        key: 'a',
        from: 'member:u1',
        to: 'dataset:kb2',
        subject: 'member' as const,
        effect: 'allow' as const,
        type: 'allow' as const,
        permission: 'read',
        subjectName: '张伟',
        resourceName: '对账单',
      },
      {
        key: 'b',
        from: 'member:u1',
        to: 'dataset:kb2',
        subject: 'member' as const,
        effect: 'deny' as const,
        type: 'deny' as const,
        permission: 'read',
        subjectName: '张伟',
        resourceName: '对账单',
      },
      {
        key: 'c',
        from: 'team:d1',
        to: 'dataset:kb2',
        subject: 'team' as const,
        effect: 'allow' as const,
        type: 'team' as const,
        permission: 'edit',
        subjectName: '风控部',
        resourceName: '对账单',
      },
    ]);

    expect(stats).toEqual({ allow: 1, deny: 1 });
  });

  it('资源图例是「6 类合集」：全开时点一下全关', () => {
    const off = toggleResourceKinds([...RESOURCE_KINDS], RESOURCE_KINDS);
    expect(off).toEqual([]);
    expect(toggleResourceKinds(off, RESOURCE_KINDS)).toEqual([
      ...RESOURCE_KINDS,
    ]);
  });
});

describe('GrantGraph 组件', () => {
  const renderGraph = (viewerId?: string) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={client}>
        <div style={{ width: 960, height: 700 }}>
          <GrantGraph tenantId="t1" viewerId={viewerId} />
        </div>
      </QueryClientProvider>,
    );
  };

  beforeEach(() => {
    mockedGraph.mockReset();
    mockedGraph.mockResolvedValue({ data: { data: payload() } });
  });

  it('画出三列节点与连线，并给出全局统计', async () => {
    renderGraph();

    await waitFor(() =>
      expect(screen.getAllByTestId('graph-node')).toHaveLength(7),
    );
    expect(screen.getAllByTestId('graph-edge')).toHaveLength(3);
    expect(screen.getByTestId('graph-stat-members')).toHaveAttribute(
      'data-value',
      '2',
    );
    expect(screen.getByTestId('graph-stat-resources')).toHaveAttribute(
      'data-value',
      '2',
    );
    expect(screen.getByTestId('graph-stat-unconfigured')).toHaveAttribute(
      'data-value',
      '7',
    );
  });

  it('关掉「明确拒绝」图例后连线与统计同时变化', async () => {
    renderGraph();

    await waitFor(() =>
      expect(screen.getAllByTestId('graph-edge')).toHaveLength(3),
    );
    expect(screen.getByTestId('graph-stat-deny')).toHaveAttribute(
      'data-value',
      '1',
    );

    fireEvent.click(screen.getByTestId('graph-legend-edge-deny'));

    expect(screen.getAllByTestId('graph-edge')).toHaveLength(2);
    expect(screen.getByTestId('graph-legend-edge-deny')).toHaveAttribute(
      'data-on',
      'false',
    );
    expect(screen.getByTestId('graph-stat-deny')).toHaveAttribute(
      'data-value',
      '0',
    );
  });

  it('当前登录用户排在聚焦条第一位，点开能看到「属他所有」', async () => {
    renderGraph('u2');

    const chips = await screen.findAllByTestId(/^graph-focus-member-/);
    expect(chips[0]).toHaveAttribute('data-testid', 'graph-focus-member-u2');

    fireEvent.click(chips[0]);
    // 李四没有规则，只有 1 个自己创建的样例节点。
    expect(screen.getByTestId('graph-stat-focus-allow')).toHaveAttribute(
      'data-value',
      '0',
    );
    expect(screen.getByTestId('graph-stat-focus-owned')).toHaveAttribute(
      'data-value',
      '1',
    );
  });

  it('点资源节点进入聚焦，再点一次回到全部', async () => {
    renderGraph();

    const nodes = await screen.findAllByTestId('graph-node');
    const node = nodes.find(
      (el) => el.getAttribute('data-node-key') === 'dataset:kb2',
    );
    expect(node).toBeDefined();
    fireEvent.click(node!);
    // 资源视角：能到它的主体数，张伟被拒绝、风控部可编辑。
    expect(screen.getByTestId('graph-stat-focus-allow')).toHaveAttribute(
      'data-value',
      '1',
    );
    expect(screen.getByTestId('graph-stat-focus-deny')).toHaveAttribute(
      'data-value',
      '1',
    );

    fireEvent.click(node!);
    expect(screen.getByTestId('graph-stat-allow')).toBeInTheDocument();
  });

  // 控制柄的位移断言只看「前后差」，不绑死画布中心：jsdom 里容器尺寸随环境不同。
  const translateOf = (transform: string | null) => {
    const match = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(transform ?? '');
    return { x: Number(match?.[1] ?? 0), y: Number(match?.[2] ?? 0) };
  };

  const sceneOf = (container: HTMLElement) =>
    container.querySelector('[data-testid=grant-graph] svg > g') as SVGGElement;

  it('小手指拖动是 1:1 跟手的平移，松手后停止', async () => {
    const { container } = renderGraph();
    const handle = await screen.findByTestId('graph-pan-handle');
    const scene = sceneOf(container);
    const before = translateOf(scene.getAttribute('transform'));

    fireEvent.pointerDown(handle, {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    expect(handle).toHaveAttribute('data-dragging', 'true');
    fireEvent.pointerMove(handle, {
      pointerId: 1,
      clientX: 140,
      clientY: 120,
    });

    await waitFor(() => {
      const after = translateOf(scene.getAttribute('transform'));
      expect(after.x - before.x).toBe(40);
      expect(after.y - before.y).toBe(20);
    });

    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(handle).toHaveAttribute('data-dragging', 'false');
  });

  it('控制柄滚轮缩放，双击回到原位', async () => {
    renderGraph();
    const handle = await screen.findByTestId('graph-pan-handle');
    expect(handle).toHaveAttribute('data-scale', '1.00');

    fireEvent.wheel(handle, { deltaY: -200, clientX: 100, clientY: 100 });
    await waitFor(() =>
      expect(Number(handle.getAttribute('data-scale'))).toBeGreaterThan(1),
    );

    fireEvent.doubleClick(handle);
    await waitFor(() => expect(handle).toHaveAttribute('data-scale', '1.00'));
  });

  it('方向键平移，缩放封顶在上限', async () => {
    const { container } = renderGraph();
    const handle = await screen.findByTestId('graph-pan-handle');
    const scene = sceneOf(container);
    const before = translateOf(scene.getAttribute('transform'));

    fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true });
    await waitFor(() => {
      const after = translateOf(scene.getAttribute('transform'));
      expect(after.x - before.x).toBe(-48);
    });

    for (let i = 0; i < 20; i += 1) {
      fireEvent.keyDown(handle, { key: '+' });
    }
    await waitFor(() => expect(handle).toHaveAttribute('data-scale', '1.90'));
  });
});
