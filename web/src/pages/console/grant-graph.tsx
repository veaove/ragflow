import { useQuery } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  GrantGraph as GrantGraphData,
  fetchGrantGraph,
} from '@/services/console-service';

import { GrantKeys } from './grant-keys';
import {
  GraphEdge,
  GraphEdgeType,
  GraphFilter,
  GraphFocus,
  GraphNodeKind,
  KIND_META,
  PositionedNode,
  RESOURCE_KINDS,
  buildGraphModel,
  computeVisibility,
  defaultFilter,
  edgePath,
  focusStats,
  layoutGraph,
  subjectStats,
  toggleResourceKinds,
  toggleValue,
} from './grant-graph-layout';

interface GrantGraphProps {
  tenantId: string;
}

const EDGE_COLOR: Record<GraphEdgeType, string> = {
  allow: '#639922',
  deny: '#e24b4a',
  team: '#9ca3af',
};

/**
 * 这个统计的口径是「自己没有规则」，不是「没人管」。
 *
 * 绝大多数文件本来就不单独授权，而是继承所在知识库的可见范围 —— 把它们叫「未配置」
 * 会让人以为这些资源没人负责，也让「可见 198 但图上只有 14 个点」显得像 bug。
 */
const UNCONFIGURED_LABEL = '未单独授权';
const UNCONFIGURED_HINT =
  '这些资源自己没有规则；多数文件继承所在知识库的可见范围，仍会随库一起被授权';

const truncate = (label: string, compact: boolean): string => {
  const limit = compact ? 7 : 10;
  return label.length > limit ? `${label.slice(0, limit)}…` : label;
};

/**
 * 授权图谱：第三个视角，把「谁 −→ 哪个资源」摊平在一张图上。
 *
 * 列表视图有两个天花板：一屏只能看一个主体，而且只显示「有权限的」。图谱回答的
 * 是「谁和谁有关系」——尤其能看见三种「权限外」的区别：明确拒绝（红边）、
 * 本层无授权（灰点、无连线）、未单独授权（虚线灰框 / 只进统计）。
 *
 * 布局固定三列而不是力导向：位置稳定比好看重要，管理员要能形成空间记忆。
 */
export function GrantGraph({ tenantId }: GrantGraphProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 960, height: 560 });
  const [barHeight, setBarHeight] = useState(78);
  const [focus, setFocus] = useState<GraphFocus>(null);

  const { data, isFetching, isError } = useQuery({
    queryKey: GrantKeys.graph(tenantId),
    enabled: !!tenantId,
    queryFn: async () => {
      const res = await fetchGrantGraph(tenantId);
      return res?.data?.data as GrantGraphData;
    },
  });

  const model = useMemo(() => buildGraphModel(data), [data]);

  // null = 还没动过图例，直接用默认值。不要一挂载就 setState 成默认值：那会先
  // 画一帧「资源类型还没进过滤集合」的图，资源列闪一下才出现。
  const [filter, setFilter] = useState<GraphFilter | null>(null);
  const activeFilter = useMemo(
    () => filter ?? defaultFilter(model),
    [filter, model],
  );

  // 动过图例之后，数据里新出现的资源类型要补进去，否则新类型的节点默认被隐藏，
  // 看起来像"图谱漏了东西"。
  useEffect(() => {
    setFilter((prev) =>
      prev
        ? { ...prev, nodes: [...new Set([...prev.nodes, ...model.kindsInUse])] }
        : prev,
    );
  }, [model.kindsInUse]);

  // 画布尺寸跟着容器走：图谱是"一屏摊平"，不是固定尺寸的画。
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setSize((prev) =>
        Math.abs(prev.width - rect.width) < 2 &&
        Math.abs(prev.height - rect.height) < 2
          ? prev
          : { width: rect.width, height: rect.height },
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(
    () => layoutGraph(model, { ...size, barHeight }),
    [model, size, barHeight],
  );

  // 底部横条在窄窗口会换行（1 行 39px、2 行 77px），固定估算必然压住节点。
  // 渲染后实测一次，差异超过 6px 才重排，避免来回抖动。
  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const real = el.offsetHeight + 12;
    if (Math.abs(real - barHeight) > 6) setBarHeight(real);
  }, [barHeight, model, activeFilter, focus]);

  const visibility = useMemo(
    () => computeVisibility(model, layout, activeFilter, focus),
    [model, layout, activeFilter, focus],
  );

  const positionOf = useMemo(() => {
    const map = new Map<string, PositionedNode>();
    for (const node of [
      ...layout.members,
      ...layout.teams,
      ...layout.resources,
    ]) {
      map.set(node.key, node);
    }
    return map;
  }, [layout]);

  const pick = useCallback((next: GraphFocus) => {
    setFocus((prev) =>
      prev && next && prev.kind === next.kind && prev.key === next.key
        ? null
        : next,
    );
  }, []);

  const toggleEdge = useCallback(
    (type: GraphEdgeType) => {
      setFilter((prev) => {
        const base = prev ?? defaultFilter(model);
        return { ...base, edges: toggleValue(base.edges, type) };
      });
    },
    [model],
  );

  const toggleNode = useCallback(
    (kind: GraphNodeKind) => {
      setFilter((prev) => {
        const base = prev ?? defaultFilter(model);
        return {
          ...base,
          // 「资源」是 6 类合集：全开时点一下全关，否则全开。
          nodes:
            kind === 'dataset'
              ? toggleResourceKinds(base.nodes, RESOURCE_KINDS)
              : toggleValue(base.nodes, kind),
        };
      });
    },
    [model],
  );

  const focusedEdges = useMemo(() => {
    if (!focus) return [];
    return model.edges.filter((edge) => visibility.edges.has(edge.key));
  }, [focus, model.edges, visibility]);

  const resourceNodes = layout.resources;

  // 聚焦对象可能落在三列中的任意一列，统一按 kind 去对应列里找。
  const focusNode = useMemo(() => {
    if (!focus) return undefined;
    const column =
      focus.kind === 'member'
        ? layout.members
        : focus.kind === 'team'
          ? layout.teams
          : layout.resources;
    return column.find((node) => node.key === focus.key);
  }, [focus, layout]);

  // 成员 / 团队视角看「他能到哪些资源」，资源视角看「谁能到它」——两个方向，
  // 不能共用一个分母（前者分母是资源数，后者分母是主体数）。
  const focusScopeStats = useMemo(
    () =>
      focus && focus.kind !== 'resource'
        ? focusStats(focusedEdges, resourceNodes.length)
        : null,
    [focus, focusedEdges, resourceNodes.length],
  );
  const focusSubjectStats = useMemo(
    () => (focus?.kind === 'resource' ? subjectStats(focusedEdges) : null),
    [focus, focusedEdges],
  );

  // 全局统计只数「此刻画在图上的」：图例关掉拒绝边，这里的拒绝数就得跟着变 0，
  // 否则图例和数字各说各话。
  const shownEdgeStats = useMemo(() => {
    let allow = 0;
    let deny = 0;
    for (const edge of model.edges) {
      if (!visibility.edges.has(edge.key)) continue;
      if (edge.type === 'deny') deny += 1;
      else if (edge.type === 'allow') allow += 1;
    }
    return { allow, deny };
  }, [model.edges, visibility.edges]);

  const shownMemberCount = useMemo(
    () =>
      layout.members.filter((node) => visibility.nodes.has(node.key)).length,
    [layout.members, visibility.nodes],
  );
  const shownResourceCount = useMemo(
    () =>
      layout.resources.filter(
        (node) => visibility.nodes.has(node.key) && !node.unconfigured,
      ).length,
    [layout.resources, visibility.nodes],
  );

  const renderEdge = (edge: GraphEdge) => {
    if (!visibility.edges.has(edge.key)) return null;
    const from = positionOf.get(edge.from);
    const to = positionOf.get(edge.to);
    if (!from || !to) return null;
    const active =
      !focus ||
      edge.from === focus.key ||
      edge.to === focus.key ||
      (focus.kind === 'member' && edge.subject === 'team');
    return (
      <path
        key={edge.key}
        data-testid="graph-edge"
        data-edge-type={edge.type}
        data-effect={edge.effect}
        d={edgePath(from, to)}
        fill="none"
        stroke={EDGE_COLOR[edge.type]}
        strokeWidth={active ? 1.9 : 1.4}
        strokeDasharray={edge.type === 'team' ? '5 3' : undefined}
        opacity={active ? 0.9 : 0.28}
      >
        <title>
          {`${edge.subjectName} → ${edge.resourceName} · ${edge.effect === 'deny' ? '拒绝' : '允许'} · ${edge.permission === 'read' ? '只读' : '可编辑'}`}
        </title>
      </path>
    );
  };

  const renderNode = (node: PositionedNode) => {
    if (!visibility.nodes.has(node.key)) return null;
    const meta = KIND_META[node.kind];
    const dim = visibility.dimmed.has(node.key);
    const on =
      !!focus &&
      ((focus.kind === 'member' && node.key === focus.key) ||
        (focus.kind === 'team' && node.key === focus.key) ||
        (focus.kind === 'resource' && node.key === focus.key));
    const filled = on;
    const bare = !!node.unconfigured;
    const stroke = bare ? '#c9c8c2' : meta.color;
    const textColor = bare ? '#9a998f' : filled ? '#ffffff' : meta.color;
    const height = layout.nodeHeight;

    return (
      <g
        key={node.key}
        data-testid="graph-node"
        data-node-kind={node.kind}
        data-node-key={node.key}
        opacity={dim ? 0.32 : 1}
        className="cursor-pointer"
        onClick={() =>
          pick({
            kind:
              node.kind === 'member'
                ? 'member'
                : node.kind === 'team'
                  ? 'team'
                  : 'resource',
            key: node.key,
          })
        }
      >
        <title>{node.title}</title>
        <rect
          x={node.x - node.width / 2}
          y={node.y - height / 2}
          width={node.width}
          height={height}
          rx={9}
          fill={filled ? meta.color : '#ffffff'}
          stroke={stroke}
          strokeWidth={filled ? 0 : 1.4}
          strokeDasharray={bare ? '4 3' : undefined}
        />
        <text
          x={node.x}
          y={node.y + (layout.compact ? -1 : -2)}
          fontSize={layout.compact ? 9.5 : 12}
          fill={textColor}
          textAnchor="middle"
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          {truncate(node.label, layout.compact)}
        </text>
        <text
          x={node.x}
          y={node.y + (layout.compact ? 9 : 12)}
          fontSize={layout.compact ? 8 : 9.5}
          fill={filled ? 'rgba(255,255,255,.82)' : bare ? '#b9b8b1' : '#9a998f'}
          textAnchor="middle"
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          {node.exceptionCount && !node.unconfigured
            ? `${node.sub} · ${node.exceptionCount} 例外`
            : node.sub}
        </text>
      </g>
    );
  };

  const legendEdge = (type: GraphEdgeType, label: string, dashed?: boolean) => {
    const on = activeFilter.edges.includes(type);
    return (
      <button
        key={type}
        type="button"
        data-testid={`graph-legend-edge-${type}`}
        data-on={on ? 'true' : 'false'}
        onClick={() => toggleEdge(type)}
        title="点击显示 / 隐藏这类连线"
        className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs transition-opacity ${
          on ? 'text-text-primary' : 'text-text-secondary opacity-40'
        }`}
      >
        <span
          className="inline-block w-5 border-t"
          style={{
            borderColor: EDGE_COLOR[type],
            borderTopStyle: dashed ? 'dashed' : 'solid',
            borderTopWidth: 2,
          }}
        />
        {label}
      </button>
    );
  };

  const legendNode = (kind: GraphNodeKind) => {
    const on = activeFilter.nodes.includes(kind);
    return (
      <button
        key={kind}
        type="button"
        data-testid={`graph-legend-node-${kind}`}
        data-on={on ? 'true' : 'false'}
        onClick={() => toggleNode(kind)}
        title="点击显示 / 隐藏这类节点"
        className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs transition-opacity ${
          on ? 'text-text-primary' : 'text-text-secondary opacity-40'
        }`}
      >
        <span
          className="inline-block size-2.5 rounded-sm"
          style={{ backgroundColor: KIND_META[kind].color }}
        />
        {KIND_META[kind].label}
      </button>
    );
  };

  const stat = (
    label: string,
    value: number,
    dot: string,
    testId: string,
    onClick?: () => void,
    on?: boolean,
    hint?: string,
  ) => (
    <div
      key={label}
      data-testid={testId}
      data-value={value}
      onClick={onClick}
      title={hint}
      className={`flex items-center gap-1 text-xs ${onClick ? 'cursor-pointer' : ''} ${
        on === false ? 'opacity-40' : ''
      }`}
    >
      <span
        className="inline-block size-2 rounded-full"
        style={{ backgroundColor: dot }}
      />
      <span className="text-text-secondary">{label}</span>
      <b className="text-text-primary">{value}</b>
    </div>
  );

  const globalStats = (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-xs font-medium text-text-primary">全局</span>
      {stat(
        '允许',
        shownEdgeStats.allow,
        EDGE_COLOR.allow,
        'graph-stat-allow',
        () => toggleEdge('allow'),
        activeFilter.edges.includes('allow'),
      )}
      {stat(
        '拒绝',
        shownEdgeStats.deny,
        EDGE_COLOR.deny,
        'graph-stat-deny',
        () => toggleEdge('deny'),
        activeFilter.edges.includes('deny'),
      )}
      {stat(
        '成员',
        shownMemberCount,
        KIND_META.member.color,
        'graph-stat-members',
        () => toggleNode('member'),
        activeFilter.nodes.includes('member'),
      )}
      {stat(
        '资源',
        shownResourceCount,
        KIND_META.dataset.color,
        'graph-stat-resources',
        () => toggleNode('dataset'),
        RESOURCE_KINDS.every((kind) => activeFilter.nodes.includes(kind)),
      )}
      {stat(
        UNCONFIGURED_LABEL,
        model.stats.unconfigured,
        '#b9b8b1',
        'graph-stat-unconfigured',
        undefined,
        undefined,
        UNCONFIGURED_HINT,
      )}
    </div>
  );

  const scopeStats = (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-xs font-medium text-text-primary">
        {focusNode?.label ?? '主体'} 的权限范围
      </span>
      {stat(
        '可访问',
        focusScopeStats?.allow ?? 0,
        EDGE_COLOR.allow,
        'graph-stat-focus-allow',
      )}
      {stat(
        '被拒绝',
        focusScopeStats?.deny ?? 0,
        EDGE_COLOR.deny,
        'graph-stat-focus-deny',
      )}
      {stat(
        '本层无授权',
        focusScopeStats?.untouched ?? 0,
        '#d6d5cf',
        'graph-stat-focus-none',
      )}
      {/* 这一行不能省：它才是"绝大多数资源没人单独配规则"的唯一出处。 */}
      {stat(
        UNCONFIGURED_LABEL,
        model.stats.unconfigured,
        '#b9b8b1',
        'graph-stat-unconfigured',
        undefined,
        undefined,
        UNCONFIGURED_HINT,
      )}
    </div>
  );

  const subjectStatsBlock = (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-xs font-medium text-text-primary">
        {focusNode?.label ?? '资源'}
      </span>
      {stat(
        '可访问',
        focusSubjectStats?.allow ?? 0,
        EDGE_COLOR.allow,
        'graph-stat-focus-allow',
      )}
      {stat(
        '被拒绝',
        focusSubjectStats?.deny ?? 0,
        EDGE_COLOR.deny,
        'graph-stat-focus-deny',
      )}
    </div>
  );

  const empty = model.resources.length === 0 && model.members.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-border-default bg-bg-base">
      <div
        ref={containerRef}
        className="relative min-h-0 flex-1"
        data-testid="grant-graph"
      >
        {isFetching && (
          <div className="absolute left-3 top-3 z-10 text-xs text-text-secondary">
            加载中…
          </div>
        )}
        {isError && (
          <div className="absolute left-3 top-3 z-10 text-xs text-state-error">
            授权图谱加载失败
          </div>
        )}
        {empty && !isFetching && (
          <div className="flex h-full items-center justify-center text-sm text-text-secondary">
            当前租户没有可画的授权关系
          </div>
        )}

        {!empty && (
          <svg
            width={Math.max(320, size.width)}
            height={Math.max(240, size.height)}
            role="img"
            aria-label="授权图谱"
          >
            <g>
              {model.memberships.map((link) => {
                const from = positionOf.get(link.member);
                const to = positionOf.get(link.team);
                if (!from || !to) return null;
                if (
                  !visibility.nodes.has(from.key) ||
                  !visibility.nodes.has(to.key)
                ) {
                  return null;
                }
                return (
                  <path
                    key={`${link.member}->${link.team}`}
                    d={edgePath(from, to)}
                    fill="none"
                    stroke="#c9c8c2"
                    strokeWidth={1.2}
                    strokeDasharray="3 4"
                    opacity={0.45}
                  />
                );
              })}
            </g>
            <g>{model.edges.map(renderEdge)}</g>
            <g>
              {layout.resources.map(renderNode)}
              {layout.teams.map(renderNode)}
              {layout.members.map(renderNode)}
            </g>
          </svg>
        )}

        {/* 聚焦条：回答"现在我在看谁"。全部 + 前 4 个成员，够用且不占地方。 */}
        <div className="absolute left-2 top-1 flex flex-wrap items-center gap-1 rounded-md border border-border-default bg-bg-base/95 px-1.5 py-1 shadow-sm">
          <span className="px-1 text-xs text-text-secondary">聚焦</span>
          <button
            type="button"
            data-testid="graph-focus-all"
            onClick={() => setFocus(null)}
            className={`rounded px-2 py-0.5 text-xs ${
              focus ? 'text-text-secondary' : 'bg-accent-primary text-white'
            }`}
          >
            全部
          </button>
          {layout.members.slice(0, 4).map((m) => (
            <button
              key={m.key}
              type="button"
              data-testid={`graph-focus-member-${m.key.replace('member:', '')}`}
              onClick={() => pick({ kind: 'member', key: m.key })}
              className={`rounded px-2 py-0.5 text-xs ${
                focus?.kind === 'member' && focus.key === m.key
                  ? 'bg-accent-primary text-white'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* 图例与统计共用一份过滤状态：两个入口、一个真相。分开维护会出现
          「图例里已经隐藏了拒绝边、统计里还显示 7 条」，用户会以为统计坏了。 */}
      <div
        ref={barRef}
        className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border-default px-3 py-2"
      >
        <div className="flex flex-wrap items-center gap-1">
          {legendEdge('allow', '允许访问')}
          {legendEdge('deny', '明确拒绝')}
          {legendEdge('team', '团队授权', true)}
        </div>
        <div className="h-4 w-px bg-border-default" />
        <div className="flex flex-wrap items-center gap-1">
          {legendNode('member')}
          {legendNode('team')}
          {model.kindsInUse.map((kind) => legendNode(kind))}
        </div>
        <div className="ml-auto">
          {focus?.kind === 'resource'
            ? subjectStatsBlock
            : focus
              ? scopeStats
              : globalStats}
        </div>
      </div>
      {/* 一行口径说明：图上画的是「有授权记录的资源」，其余只在统计里。不写这句，
          「可见 198 但图上 14 个点」就会被当成漏画。 */}
      <div className="border-t border-border-default px-3 py-1 text-xs text-text-secondary">
        图上只画有授权记录的资源，另配少量「{UNCONFIGURED_LABEL}
        」样例；其余计入右下角统计
        {model.stats.truncated ? '（某类资源超过取数上限，是部分数据）' : ''}
      </div>
    </div>
  );
}

export default GrantGraph;
