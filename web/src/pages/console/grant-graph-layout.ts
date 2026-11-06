import {
  GrantGraph,
  GrantGraphMember,
  GrantGraphTeam,
} from '@/services/console-service';

/**
 * 授权图谱的模型与布局（纯函数，不碰 DOM）。
 *
 * 为什么固定三列而不是力导向：权限关系本质是「谁连到谁」，位置稳定比好看重要
 * ——力导向每次跑出来的形状都不一样，管理员没法形成空间记忆。所以
 * 成员（左）→ 团队（中）→ 资源（右）三列固定，只按数量分配纵向位置。
 */

export type GraphNodeKind =
  | 'member'
  | 'team'
  | 'dataset'
  | 'chat'
  | 'search_app'
  | 'canvas'
  | 'memory'
  | 'document';

export type GraphEdgeType = 'allow' | 'deny' | 'team';

/** 「全团队」在团队列里的固定键：它是 subject_kind=team 又没有 id 的那一条。 */
export const ALL_TEAM_KEY = '__team__';

export interface GraphKindMeta {
  label: string;
  color: string;
  /** 是否属于「资源」这一合集（图例与统计里的「资源」开关管这一组）。 */
  resource: boolean;
}

/**
 * 颜色只给资源类型；成员与团队刻意用中性色。
 *
 * 否则「成员是蓝的、知识问答也是蓝的」，一眼分不清哪个是找人的、哪个是找资源的。
 */
export const KIND_META: Record<GraphNodeKind, GraphKindMeta> = {
  member: { label: '成员', color: '#64748b', resource: false },
  team: { label: '团队', color: '#a16207', resource: false },
  dataset: { label: '知识库', color: '#7c3aed', resource: true },
  chat: { label: '知识问答', color: '#2563eb', resource: true },
  search_app: { label: '知识搜索', color: '#0d9488', resource: true },
  canvas: { label: '智能体', color: '#ea580c', resource: true },
  memory: { label: '记忆中心', color: '#16a34a', resource: true },
  document: { label: '文件', color: '#78716c', resource: true },
};

export const RESOURCE_KINDS: GraphNodeKind[] = [
  'dataset',
  'chat',
  'search_app',
  'canvas',
  'memory',
  'document',
];

export interface GraphNode {
  key: string;
  kind: GraphNodeKind;
  label: string;
  /** 次要行：成员显示部门，资源显示类型名，未配置的样例写「未配置授权」。 */
  sub: string;
  /** 该节点上出现的授权摘要，供 hover 显示。 */
  title: string;
  unconfigured?: boolean;
  /** 知识库的「N 项例外」。 */
  exceptionCount?: number;
}

export interface GraphEdge {
  key: string;
  /** from 是成员或团队节点键；to 是资源节点键。 */
  from: string;
  to: string;
  subject: 'member' | 'team';
  effect: 'allow' | 'deny';
  /** 边类型：团队带来的授权单列一类，其余按 allow / deny。 */
  type: GraphEdgeType;
  permission: string;
  subjectName: string;
  resourceName: string;
}

export interface GraphModel {
  members: GraphNode[];
  teams: GraphNode[];
  resources: GraphNode[];
  edges: GraphEdge[];
  stats: {
    visible: number;
    configured: number;
    unconfigured: number;
    truncated: boolean;
  };
  /** 图上真正出现的资源类型，供图例只列需要的项。 */
  kindsInUse: GraphNodeKind[];
  /** 成员 → 团队的隶属关系，只作为背景虚线。 */
  memberships: { member: string; team: string }[];
}

const trim = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const resourceKey = (kind: string, id: string) => `${kind}:${id}`;

const effectOf = (effect?: string): 'allow' | 'deny' =>
  trim(effect).toLowerCase() === 'deny' ? 'deny' : 'allow';

const isResourceKind = (kind: string): kind is GraphNodeKind =>
  (RESOURCE_KINDS as string[]).includes(kind);

/**
 * 把接口响应转成画图模型。
 *
 * 三条约束：
 * 1. 只画「有授权记录的资源」+ 服务端给的「未配置」样例，避免一屏几百条糊成一团；
 * 2. 指向不存在的成员的规则不画边（成员可能已离职），但资源照画 —— 规则本身仍是事实；
 * 3. 团队授权合并到中间列的团队节点，"哪个团队带来的"与"直接给的"必须能区分。
 */
export const buildGraphModel = (data?: GrantGraph | null): GraphModel => {
  if (!data) {
    return {
      members: [],
      teams: [],
      resources: [],
      edges: [],
      stats: { visible: 0, configured: 0, unconfigured: 0, truncated: false },
      kindsInUse: [],
      memberships: [],
    };
  }

  const memberNodes: GraphNode[] = (data.members ?? []).map(
    (m: GrantGraphMember) => ({
      key: `member:${m.id}`,
      kind: 'member',
      label: trim(m.name) || trim(m.email) || m.id,
      sub: trim(m.department_name) || '成员',
      title: [trim(m.name), trim(m.email), trim(m.department_name)]
        .filter(Boolean)
        .join(' · '),
    }),
  );

  const memberKeys = new Set(memberNodes.map((node) => node.key));

  const teamNodes: GraphNode[] = (data.teams ?? []).map(
    (t: GrantGraphTeam) => ({
      key: t.kind === 'team' ? `team:${ALL_TEAM_KEY}` : `team:${t.id}`,
      kind: 'team',
      label: trim(t.name) || '团队',
      sub: t.kind === 'team' ? '全团队' : '部门',
      title: trim(t.name),
    }),
  );

  const teamKeys = new Set(teamNodes.map((node) => node.key));

  const resourceNodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const kindsInUse = new Set<GraphNodeKind>();

  for (const res of data.resources ?? []) {
    const kind: GraphNodeKind = isResourceKind(res.kind)
      ? res.kind
      : 'document';
    const key = resourceKey(kind, res.id);
    const exceptionCount = res.exception_count ?? 0;
    kindsInUse.add(kind);
    resourceNodes.push({
      key,
      kind,
      label: trim(res.name) || res.id,
      sub: res.unconfigured ? '未单独授权' : KIND_META[kind].label,
      title: [
        trim(res.name),
        KIND_META[kind].label,
        exceptionCount > 0 ? `${exceptionCount} 项例外` : '',
        trim(res.owner_name) ? `所有者 ${trim(res.owner_name)}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
      unconfigured: !!res.unconfigured,
      exceptionCount,
    });

    if (res.unconfigured) continue;

    for (const grant of res.grants ?? []) {
      const subjectKind = trim(grant.kind);
      const subjectId = trim(grant.id);
      const from =
        subjectKind === 'user'
          ? `member:${subjectId}`
          : subjectKind === 'team'
            ? `team:${ALL_TEAM_KEY}`
            : subjectKind === 'department'
              ? `team:${subjectId}`
              : '';
      if (!from) continue;
      // 成员可能已经不在租户里：边画不出来，规则本身不丢（资源节点还在）。
      if (subjectKind === 'user' && !memberKeys.has(from)) continue;
      if (subjectKind !== 'user' && !teamKeys.has(from)) continue;

      const effect = effectOf(grant.effect);
      edges.push({
        key: [from, key, subjectKind, subjectId, effect].join('|'),
        from,
        to: key,
        subject: subjectKind === 'user' ? 'member' : 'team',
        effect,
        // 团队授权（全团队 / 部门）单列一类：它不是"直接给这个人"的。
        type: subjectKind === 'user' ? effect : 'team',
        permission: trim(grant.permission) === 'read' ? 'read' : 'edit',
        subjectName:
          trim(grant.name) || (subjectKind === 'team' ? '全团队' : subjectId),
        resourceName: trim(res.name) || res.id,
      });
    }
  }

  const memberships: { member: string; team: string }[] = [];
  for (const member of data.members ?? []) {
    const deptId = trim(member.department_id);
    if (!deptId) continue;
    const teamKey = `team:${deptId}`;
    if (!teamKeys.has(teamKey)) continue;
    memberships.push({ member: `member:${member.id}`, team: teamKey });
  }

  const stats = data.stats ?? { visible: 0, configured: 0, unconfigured: 0 };
  return {
    members: memberNodes,
    teams: teamNodes,
    resources: resourceNodes,
    edges,
    stats: {
      visible: stats.visible ?? 0,
      configured: stats.configured ?? 0,
      unconfigured: stats.unconfigured ?? 0,
      truncated: !!stats.truncated,
    },
    kindsInUse: RESOURCE_KINDS.filter((kind) => kindsInUse.has(kind)),
    memberships,
  };
};

/**
 * 把一组节点在 [top, bottom] 里均分（只有一个时居中）。
 *
 * 泛型的写法必须是函数声明：测试的 transform 把 .ts 也当 tsx 解析，
 * `const f = <T extends X>(…)` 里的 `<T` 会被当成 JSX 开标签。
 */
export function spread<T extends { key: string }>(
  items: T[],
  top: number,
  bottom: number,
): (T & { y: number })[] {
  const n = items.length;
  return items.map((item, index) => ({
    ...item,
    y: n <= 1 ? (top + bottom) / 2 : top + ((bottom - top) * index) / (n - 1),
  }));
}

export interface PackOptions {
  top: number;
  bottom: number;
  nodeHeight: number;
  /** 类型组之间的空隙：同类聚拢后，扫描时能一片一片看。 */
  groupGap: number;
  maxStep: number;
}

/**
 * 资源列：同类聚拢 + 组间留空隙。
 *
 * 步长按数量均分，但组间空隙会让累加结果溢出底部，所以最后统一按比例夹紧到
 * [top, bottom] —— 否则最后一个节点会被底部横条压住。
 */
export function packResources<T extends { key: string; kind: GraphNodeKind }>(
  items: T[],
  options: PackOptions,
): (T & { y: number })[] {
  const { top, bottom, nodeHeight, groupGap, maxStep } = options;
  if (items.length === 0) return [];
  const span = Math.max(0, bottom - top);
  const step = Math.max(
    nodeHeight + 5,
    Math.min(maxStep, span / Math.max(1, items.length)),
  );
  const out: (T & { y: number })[] = [];
  let y = top;
  let lastKind: GraphNodeKind | null = null;
  for (const item of items) {
    if (lastKind && item.kind !== lastKind) y += groupGap;
    out.push({ ...item, y });
    y += step;
    lastKind = item.kind;
  }
  const lastY = out[out.length - 1]?.y ?? top;
  if (lastY > bottom) {
    const k = span === 0 ? 0 : (bottom - top) / Math.max(1, lastY - top);
    out.forEach((node) => {
      node.y = top + (node.y - top) * k;
    });
  }
  return out;
}

export interface GraphLayoutInput {
  width: number;
  height: number;
  /** 底部横条实测高度：窄窗口会换行（1 行 39px / 2 行 77px），不能写死。 */
  barHeight: number;
}

export interface PositionedNode extends GraphNode {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GraphLayout {
  columnX: { member: number; team: number; resource: number };
  nodeWidth: { member: number; team: number; resource: number };
  nodeHeight: number;
  compact: boolean;
  members: PositionedNode[];
  teams: PositionedNode[];
  resources: PositionedNode[];
}

/** 窗口矮于这个高度就切紧凑模式：13 个资源 × 36px 在 550px 高里必然重叠。 */
export const COMPACT_HEIGHT = 660;

export const layoutGraph = (
  model: GraphModel,
  { width, height, barHeight }: GraphLayoutInput,
): GraphLayout => {
  const compact = height < COMPACT_HEIGHT;
  const nodeHeight = compact ? 23 : 36;
  const nodeWidth = compact
    ? { member: 108, team: 92, resource: 158 }
    : { member: 132, team: 108, resource: 190 };
  const safeWidth = Math.max(320, width);
  const columnX = {
    member: compact ? 66 : 80,
    team: Math.min(compact ? 300 : 380, safeWidth * 0.42),
    resource: Math.max(compact ? 240 : 300, safeWidth - (compact ? 100 : 120)),
  };

  const availableBottom = Math.max(80, height - barHeight);
  const members = spread(
    model.members,
    compact ? 46 : 60,
    Math.max(70, availableBottom - 30),
  );
  const teams = spread(
    model.teams,
    Math.max(80, availableBottom * 0.24),
    Math.max(100, availableBottom * 0.76),
  );
  const resources = packResources(model.resources, {
    top: compact ? 42 : 56,
    bottom: Math.max(80, availableBottom - 12),
    nodeHeight,
    groupGap: compact ? 8 : 14,
    maxStep: compact ? 40 : 56,
  });

  const place = (
    nodes: (GraphNode & { y: number })[],
    x: number,
    nodeKindWidth: number,
  ): PositionedNode[] =>
    nodes.map((node) => ({
      ...node,
      x,
      width: nodeKindWidth,
      height: nodeHeight,
      // 节点用中心点定位，和 svg 的 text-anchor=middle 对齐。
      y: node.y,
    }));

  return {
    columnX,
    nodeWidth,
    nodeHeight,
    compact,
    members: place(members, columnX.member, nodeWidth.member),
    teams: place(teams, columnX.team, nodeWidth.team),
    resources: place(resources, columnX.resource, nodeWidth.resource),
  };
};

/** 边的端点：左侧节点取右边缘，右侧资源取左边缘，中间用三次贝塞尔。 */
export const edgePath = (
  from: { x: number; y: number; width: number },
  to: { x: number; y: number; width: number },
): string => {
  const x1 = from.x + from.width / 2;
  const y1 = from.y;
  const x2 = to.x - to.width / 2;
  const y2 = to.y;
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
};

export interface GraphFilter {
  edges: GraphEdgeType[];
  nodes: GraphNodeKind[];
}

export const defaultFilter = (model: GraphModel): GraphFilter => ({
  edges: ['allow', 'deny', 'team'],
  nodes: ['member', 'team', ...model.kindsInUse],
});

export type GraphFocus =
  | { kind: 'member'; key: string }
  | { kind: 'team'; key: string }
  | { kind: 'resource'; key: string }
  | null;

export interface GraphVisibility {
  /** 可见边的 key 集合；聚焦时只有相关边在内。 */
  edges: Set<string>;
  /** 可见节点键；当节点类型被过滤掉时不在内。 */
  nodes: Set<string>;
  /** 聚焦时应该变暗的节点。 */
  dimmed: Set<string>;
}

/**
 * 一次算出「画哪些边 / 画哪些点 / 哪些点变暗」。
 *
 * 两条硬规则（原型里踩过）：
 * - 端点被过滤掉时连线必须一起消失，否则留下成片悬空线；
 * - 过滤只影响画不画，不改布局坐标 —— 否则每勾一次都重排，空间记忆就废了。
 */
export const computeVisibility = (
  model: GraphModel,
  layout: GraphLayout,
  filter: GraphFilter,
  focus: GraphFocus,
): GraphVisibility => {
  const nodeKindOf = new Map<string, GraphNodeKind>();
  for (const node of [
    ...layout.members,
    ...layout.teams,
    ...layout.resources,
  ] as PositionedNode[]) {
    nodeKindOf.set(node.key, node.kind);
  }

  const nodeEnabled = (key: string): boolean => {
    const kind = nodeKindOf.get(key);
    return !!kind && filter.nodes.includes(kind);
  };

  const memberTeams = new Map<string, Set<string>>();
  for (const link of model.memberships) {
    const set = memberTeams.get(link.member) ?? new Set<string>();
    set.add(link.team);
    memberTeams.set(link.member, set);
  }

  const focusMatch = (edge: GraphEdge): boolean => {
    if (!focus) return true;
    if (focus.kind === 'member') {
      if (edge.from === focus.key) return true;
      // 他所在团队带来的边也算「他能到」。
      return (
        edge.subject === 'team' && !!memberTeams.get(focus.key)?.has(edge.from)
      );
    }
    if (focus.kind === 'team') return edge.from === focus.key;
    return edge.to === focus.key;
  };

  const visibleEdges = new Set<string>();
  const activeTargets = new Set<string>();
  const activeSources = new Set<string>();
  for (const edge of model.edges) {
    if (!filter.edges.includes(edge.type)) continue;
    if (!nodeEnabled(edge.from) || !nodeEnabled(edge.to)) continue;
    if (!focusMatch(edge)) continue;
    visibleEdges.add(edge.key);
    activeTargets.add(edge.to);
    activeSources.add(edge.from);
  }

  const visibleNodes = new Set<string>();
  for (const key of nodeKindOf.keys()) {
    if (nodeEnabled(key)) visibleNodes.add(key);
  }

  const dimmed = new Set<string>();
  if (focus) {
    // 「相关」= 落在这几条连线上的节点。三种聚焦方向共用这一条规则，不再按
    // kind 逐列判断：同样的关系，换个视角看不该有的亮、有的暗。
    const touched = new Set<string>([...activeSources, ...activeTargets]);
    if (focus.kind === 'team') {
      // 团队聚焦时，团队里的成员才是这条授权的实际受益人，跟着留亮。
      for (const [member, teams] of memberTeams) {
        if (teams.has(focus.key)) touched.add(member);
      }
    }
    for (const node of [
      ...layout.members,
      ...layout.teams,
      ...layout.resources,
    ] as PositionedNode[]) {
      if (!visibleNodes.has(node.key)) continue;
      if (node.key === focus.key) continue;
      if (!touched.has(node.key)) dimmed.add(node.key);
    }
  }

  return { edges: visibleEdges, nodes: visibleNodes, dimmed };
};

export interface FocusStats {
  /** 聚焦成员：他能到的资源数。 */
  allow: number;
  /** 被明确拒绝的资源数（deny 优先于 allow）。 */
  deny: number;
  /** 图上有、但对他没有规则的资源数（本层无授权）。 */
  untouched: number;
}

/** 聚焦某个主体时的统计：deny 优先，先把从 allow 集合里剔掉。 */
export const focusStats = (
  edges: GraphEdge[],
  resourceCount: number,
): FocusStats => {
  const allow = new Set<string>();
  const deny = new Set<string>();
  for (const edge of edges) {
    if (edge.effect === 'deny') deny.add(edge.to);
    else allow.add(edge.to);
  }
  deny.forEach((key) => allow.delete(key));
  return {
    allow: allow.size,
    deny: deny.size,
    untouched: Math.max(0, resourceCount - allow.size - deny.size),
  };
};

/** 聚焦某个资源时的统计：谁到得了它。同一主体 deny 优先于 allow。 */
export interface SubjectStats {
  allow: number;
  deny: number;
}

export const subjectStats = (edges: GraphEdge[]): SubjectStats => {
  const allow = new Set<string>();
  const deny = new Set<string>();
  for (const edge of edges) {
    if (edge.effect === 'deny') deny.add(edge.from);
    else allow.add(edge.from);
  }
  deny.forEach((key) => allow.delete(key));
  return { allow: allow.size, deny: deny.size };
};

export function toggleValue<T>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((item) => item !== value)
    : [...list, value];
}

/** 资源图例是「6 类合集」：全开时点一下全关，否则全开。 */
export const toggleResourceKinds = (
  nodes: GraphNodeKind[],
  kinds: GraphNodeKind[],
): GraphNodeKind[] =>
  kinds.every((kind) => nodes.includes(kind))
    ? nodes.filter((node) => !kinds.includes(node))
    : [...new Set([...nodes, ...kinds])];
