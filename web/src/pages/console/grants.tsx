import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LucideSearch } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ConsoleGuard } from '@/components/console-guard';
import { useConsolePermissions } from '@/hooks/use-console-permissions';
import { Input } from '@/components/ui/input';
import { RAGFlowPagination } from '@/components/ui/ragflow-pagination';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useFetchTenantInfo } from '@/hooks/use-user-setting-request';
import {
  ConsoleMember,
  DepartmentNode,
  GrantExceptionItem,
  GrantKindOption,
  GrantResource,
  GrantSubject,
  GrantTreeNode,
  GrantVisibility,
  fetchConsoleMembers,
  fetchDepartments,
  fetchGrantKinds,
  fetchGrantTree,
  fetchGrants,
  setGrants,
  setGrantVisibility,
} from '@/services/console-service';

import { GrantChips } from './grant-chip';
import { GrantDetailPanel } from './grant-detail-panel';
import { GrantGraph } from './grant-graph';
import {
  GrantDialog,
  GrantTarget,
  VISIBILITY_OPTIONS,
  defaultScopeLabel,
} from './grant-dialog';
import { GrantKeys } from './grant-keys';
import { GrantMemberView } from './grant-member-view';
import { GrantTree, findGrantNode, findGrantNodePath } from './grant-tree';

type GrantKind = string;

/**
 * 后端 grant-kinds 不可用时的兜底清单。正常情况下 Tab 全部由接口给出
 *（知识库 / 知识问答 / 知识搜索 / 智能体 / 记忆中心 / 文件 / 文件夹 / …），
 * 这里只保证老后端上页面不至于空掉。
 */
const FALLBACK_KINDS: GrantKindOption[] = [
  { kind: 'dataset', label: '知识库', supports_visibility: true },
  { kind: 'chat', label: '知识问答', supports_visibility: true },
  { kind: 'search_app', label: '知识搜索', supports_visibility: true },
  { kind: 'canvas', label: '智能体', supports_visibility: true },
  { kind: 'memory', label: '记忆中心', supports_visibility: true },
];

/** 有层级、走「树 + 详情」布局的资源类型。其余类型继续用平铺列表。 */
const HIERARCHICAL_KINDS = new Set(['dataset', 'file']);

const PAGE_SIZE = 20;

interface ResourceRowProps {
  row: GrantResource;
  kindLabel: string;
  supportsVisibility: boolean;
  onEdit: (row: GrantResource) => void;
  onVisibilityChange: (row: GrantResource, next: GrantVisibility) => void;
}

/** 无层级资源的一行：平铺列表里只回答「给了谁」。 */
function ResourceRow({
  row,
  kindLabel,
  supportsVisibility,
  onEdit,
  onVisibilityChange,
}: ResourceRowProps) {
  const handleEdit = useCallback(() => {
    onEdit(row);
  }, [onEdit, row]);

  const handleVisibilityChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onVisibilityChange(row, e.target.value as GrantVisibility);
    },
    [onVisibilityChange, row],
  );

  return (
    <TableRow>
      <TableCell className="text-sm text-text-primary">
        {row.resource_name || '-'}
      </TableCell>
      <TableCell className="text-xs text-text-secondary">{kindLabel}</TableCell>
      <TableCell className="text-xs">
        {row.owner_name || row.owner_id || '-'}
      </TableCell>
      <TableCell className="text-xs">
        <div className="flex flex-col gap-1">
          {row.visibility ? (
            <select
              value={row.visibility}
              onChange={handleVisibilityChange}
              disabled={!supportsVisibility}
              title="可见范围：收窄档位，普通成员需逐人授权"
              className="w-36 rounded border border-border-default bg-bg-base px-1.5 py-0.5 text-xs text-text-primary"
            >
              {VISIBILITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : null}
          {row.grants?.length ? (
            <GrantChips grants={row.grants} />
          ) : row.visibility ? null : (
            <span className="text-text-secondary">
              {defaultScopeLabel(row.default_scope)}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs">
        <button
          type="button"
          className="text-accent-primary hover:underline"
          onClick={handleEdit}
        >
          设置
        </button>
      </TableCell>
    </TableRow>
  );
}

type GrantView = 'resource' | 'member' | 'graph';

/**
 * 资源授权：配置「谁能看」。
 *
 * 三种视角共用同一份数据：按资源回答「这个库给了谁」，按成员回答「他为什么能
 * 看」，图谱回答「谁和谁有关系」。有层级的资源（知识库 / 文件管理）走左侧树 +
 * 右侧详情：树只画骨架和每层摘要，文件不进树、集中在「子项例外」里，避免几十
 * 层嵌套下拉。
 */
export default function ConsoleGrants() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: tenantInfo } = useFetchTenantInfo();
  const tenantId = tenantInfo?.tenant_id as string | undefined;

  const [kind, setKind] = useState<GrantKind>('dataset');
  const [view, setView] = useState<GrantView>('resource');
  const [keywords, setKeywords] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [selectedNodeId, setSelectedNodeId] = useState('');

  const [editing, setEditing] = useState<GrantTarget | null>(null);

  // 部门树 / 成员列表分别归「组织架构」「用户管理」模块。只授了「资源授权」
  // 的角色不该为了选主体而吃两个 403 —— 各自无权限时跳过请求，下拉留空。
  const { canView } = useConsolePermissions();

  const { data: deptData } = useQuery({
    queryKey: ['console/departments', tenantId],
    enabled: !!tenantId && canView('organization'),
    queryFn: async () => {
      const res = await fetchDepartments(tenantId as string);
      return res?.data?.data ?? { departments: [] };
    },
  });
  const departments: DepartmentNode[] = deptData?.departments ?? [];

  const { data: memberData } = useQuery({
    queryKey: ['console/members-for-grant', tenantId],
    enabled: !!tenantId && canView('member'),
    queryFn: async () => {
      const res = await fetchConsoleMembers(tenantId as string, {
        page: 1,
        page_size: 200,
      });
      return res?.data?.data ?? { members: [], total: 0 };
    },
  });
  const members: ConsoleMember[] = memberData?.members ?? [];

  const flatDepts = useMemo(() => {
    const out: { id: string; name: string }[] = [];
    const walk = (nodes: DepartmentNode[], depth = 0) => {
      nodes.forEach((n) => {
        out.push({ id: n.id, name: `${'　'.repeat(depth)}${n.name}` });
        if (n.children?.length) walk(n.children, depth + 1);
      });
    };
    walk(departments);
    return out;
  }, [departments]);

  const subjectOptions = {
    departments: flatDepts,
    members: members.map((m) => ({ id: m.id, name: m.nickname || m.email })),
  };

  // Tab 清单来自后端注册表：新增一类可授权资源只需后端登记，前端自动出现。
  const { data: kindData } = useQuery({
    queryKey: ['console/grant-kinds', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const res = await fetchGrantKinds(tenantId as string);
      return res?.data?.data ?? { kinds: [] as GrantKindOption[] };
    },
  });
  const kinds: GrantKindOption[] =
    kindData?.kinds?.length ? kindData.kinds : FALLBACK_KINDS;
  const activeKind = kinds.find((x) => x.kind === kind);
  const kindLabel = activeKind?.label ?? '';
  const supportsVisibility = activeKind?.supports_visibility ?? false;
  const hierarchical = HIERARCHICAL_KINDS.has(kind);

  // 有层级的资源走树；平铺列表只给没有父子关系的类型用。
  const { data: treeData, isFetching: treeFetching } = useQuery({
    queryKey: GrantKeys.tree(tenantId ?? '', kind, keywords),
    enabled: !!tenantId && hierarchical && view === 'resource',
    queryFn: async () => {
      const res = await fetchGrantTree(tenantId as string, {
        kind,
        keywords: keywords || undefined,
      });
      return (
        res?.data?.data ?? {
          kind,
          label: kindLabel,
          nodes: [] as GrantTreeNode[],
          total: 0,
          file_total: 0,
          exception_total: 0,
        }
      );
    },
  });
  const nodes = useMemo<GrantTreeNode[]>(
    () => treeData?.nodes ?? [],
    [treeData],
  );

  const { data, isFetching } = useQuery({
    queryKey: GrantKeys.resources(
      tenantId ?? '',
      kind,
      page,
      pageSize,
      keywords,
    ),
    enabled: !!tenantId && !hierarchical,
    queryFn: async () => {
      const res = await fetchGrants(tenantId as string, {
        kind,
        keywords: keywords || undefined,
        page,
        page_size: pageSize,
      });
      return res?.data?.data ?? { resources: [], total: 0 };
    },
  });
  const resources = useMemo<GrantResource[]>(
    () => data?.resources ?? [],
    [data],
  );
  const total = data?.total ?? 0;

  // 选中节点由 id 记录，树刷新后按 id 找回；找不到时回落到第一个根节点。
  // 必须在整棵树里找：只比根节点的话，点子文件夹会落回第一个库。
  const selectedNode = useMemo(
    () => findGrantNode(nodes, selectedNodeId) ?? nodes[0],
    [nodes, selectedNodeId],
  );
  const trail = useMemo(
    () => (selectedNode ? findGrantNodePath(nodes, selectedNode.id) : []),
    [nodes, selectedNode],
  );
  // 最近的可授权祖先：知识库内的文件夹本身没有规则，面板要指回库上的授权。
  const inheritedFrom = useMemo(() => {
    for (let i = trail.length - 2; i >= 0; i -= 1) {
      if (trail[i].grants?.length) {
        return { node: trail[i], grants: trail[i].grants };
      }
    }
    return undefined;
  }, [trail]);

  // 切换 tab / 搜索时回到第一页并清掉选中节点，避免页码与展开内容错位。
  useEffect(() => {
    setPage(1);
    setSelectedNodeId('');
  }, [kind, keywords]);

  const handleKindChange = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      setKind(e.currentTarget.value as GrantKind);
    },
    [],
  );

  const handleViewChange = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      setView(e.currentTarget.value as GrantView);
    },
    [],
  );

  const handleKeywordsChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setKeywords(e.target.value);
      setPage(1);
    },
    [],
  );

  const handlePageChange = useCallback((nextPage: number, nextSize: number) => {
    setPage(nextPage);
    setPageSize(nextSize);
  }, []);

  const handleSelectNode = useCallback((node: GrantTreeNode) => {
    setSelectedNodeId(node.id);
  }, []);

  const handleEditResource = useCallback(
    (row: GrantResource) => {
      setEditing({
        kind,
        resourceId: row.resource_id,
        name: row.resource_name || '未命名资源',
        grants: row.grants ?? [],
        defaultScope: row.visibility || row.default_scope,
        scopeHint: `本层资源；其下子项未单独设置时继承这里的规则`,
        supportsDeny: row.supports_deny,
      });
    },
    [kind],
  );

  const handleCloseDialog = useCallback(() => {
    setEditing(null);
  }, []);

  const handleVisibilityChange = useCallback(
    async (row: GrantResource | GrantTreeNode, next: GrantVisibility) => {
      if (!tenantId) return;
      try {
        await setGrantVisibility(
          tenantId,
          kind,
          'resource_id' in row ? row.resource_id : row.id,
          next,
        );
      } finally {
        // 成功或失败都以服务端为准重新拉一次，避免下拉停在没保存成功的值上。
        queryClient.invalidateQueries({ queryKey: GrantKeys.resourcesRoot });
        queryClient.invalidateQueries({ queryKey: GrantKeys.treeRoot });
      }
    },
    [kind, queryClient, tenantId],
  );

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: GrantKeys.resourcesRoot });
    queryClient.invalidateQueries({ queryKey: GrantKeys.treeRoot });
    queryClient.invalidateQueries({ queryKey: GrantKeys.exceptionsRoot });
    queryClient.invalidateQueries({ queryKey: GrantKeys.subjectRoot });
    queryClient.invalidateQueries({ queryKey: GrantKeys.graphRoot });
  }, [queryClient]);

  const handleSubmit = useCallback(
    async (target: GrantTarget, subjects: GrantSubject[]) => {
      if (!tenantId) return;
      await setGrants(
        tenantId,
        target.kind,
        target.resourceId,
        subjects,
        target.parentId,
      );
      setEditing(null);
      invalidateAll();
    },
    [invalidateAll, tenantId],
  );

  const handleRemoveGrant = useCallback(
    async (target: GrantTarget, subject: GrantSubject) => {
      if (!tenantId) return;
      const next = (target.grants ?? []).filter(
        (g) => !(g.kind === subject.kind && g.id === subject.id),
      );
      await setGrants(
        tenantId,
        target.kind,
        target.resourceId,
        next,
        target.parentId,
      );
      invalidateAll();
    },
    [invalidateAll, tenantId],
  );

  // 取消例外 = 清空该子项的全部规则，它重新回到继承。
  const handleClearException = useCallback(
    async (item: GrantExceptionItem) => {
      if (!tenantId) return;
      await setGrants(
        tenantId,
        item.grant_kind,
        item.resource_id,
        [],
        item.parent_grant_id,
      );
      invalidateAll();
    },
    [invalidateAll, tenantId],
  );

  return (
    <ConsoleGuard>
      <section className="flex h-full flex-col p-5">
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-medium text-text-primary">
              {t('console.grants')}
            </h1>
            <p className="mt-1 text-sm text-text-secondary">
              知识库与文件管理的授权按层级展示：每层只回答「给了谁」和「哪些子项
              例外」，可见范围分「仅所有者 / 租户管理层 / 平台管理员」三档，普通
              成员需逐人授权；图谱把成员、团队、资源摊平在一张图上，看清谁和谁
              有关系
            </p>
          </div>
          <div className="flex shrink-0 gap-1 rounded-md bg-background-second p-1">
            {[
              { value: 'resource', label: '按资源' },
              { value: 'member', label: '按成员' },
              { value: 'graph', label: '授权图谱' },
            ].map((item) => (
              <button
                key={item.value}
                type="button"
                value={item.value}
                onClick={handleViewChange}
                className={`rounded px-3 py-1 text-sm ${
                  view === item.value
                    ? 'bg-bg-base text-text-primary shadow-sm'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </header>

        {/* 图谱一次画全 6 类资源，Tab 与搜索对它是死控件，不渲染。 */}
        {view !== 'graph' && (
          <div className="mb-3 flex flex-wrap items-end gap-3 border-b border-border-default">
            {/*
              用下划线而不是小胶囊：胶囊的选中色和页面底色太接近，十几个 sheet
              排在一起时根本看不出当前在哪一个。
            */}
            <div
              role="tablist"
              aria-label="资源类型"
              className="flex flex-wrap items-center gap-1"
            >
              {kinds.map((tab) => {
                const active = kind === tab.kind;
                return (
                  <button
                    key={tab.kind}
                    type="button"
                    role="tab"
                    value={tab.kind}
                    aria-selected={active}
                    onClick={handleKindChange}
                    className={`-mb-px border-b-2 px-3 pb-2 pt-1 text-sm transition-colors duration-150 ${
                      active
                        ? 'border-accent-primary font-medium text-accent-primary'
                        : 'border-transparent text-text-secondary hover:border-border-default hover:text-text-primary'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* 有层级的类型把搜索放进左栏，按资源宽度优先给树和详情面板。 */}
            {!hierarchical && (
              <div className="relative mb-1 ml-auto">
                <LucideSearch className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-secondary" />
                <Input
                  value={keywords}
                  onChange={handleKeywordsChange}
                  placeholder="搜索资源名称"
                  className="w-56 pl-8"
                />
              </div>
            )}
          </div>
        )}

        {/* 每个分支自己带 key + 淡入：切 sheet / 切视角时内容区明显换一片。 */}
        {view === 'graph' ? (
          <div
            key="graph"
            className="flex min-h-0 flex-1 animate-in flex-col fade-in-0 duration-200"
          >
            <GrantGraph tenantId={tenantId ?? ''} />
          </div>
        ) : view === 'member' ? (
          <div
            key="member"
            className="flex min-h-0 flex-1 animate-in flex-col fade-in-0 duration-200"
          >
            <GrantMemberView tenantId={tenantId ?? ''} members={members} />
          </div>
        ) : hierarchical ? (
          <div
            key={`tree-${kind}`}
            className="flex min-h-0 flex-1 animate-in gap-4 fade-in-0 duration-200"
          >
            <aside className="flex w-[320px] shrink-0 flex-col rounded-lg border border-border-default bg-bg-base">
              <div className="border-b border-border-default p-2">
                <div className="mb-1.5 flex items-center justify-between px-1 text-xs text-text-secondary">
                  <span>
                    资源（{treeData?.total ?? 0} 个
                    {kind === 'dataset' ? '库' : '目录'}）
                  </span>
                  <span>{treeData?.file_total ?? 0} 个文件</span>
                </div>
                <div className="relative">
                  <LucideSearch className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-text-secondary" />
                  <Input
                    value={keywords}
                    onChange={handleKeywordsChange}
                    placeholder="搜索资源或文件夹"
                    className="h-8 pl-7 text-xs"
                  />
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-1">
                <GrantTree
                  nodes={nodes}
                  selectedId={selectedNode?.id ?? ''}
                  onSelect={handleSelectNode}
                  emptyText={treeFetching ? '…' : '没有匹配的资源'}
                />
              </div>
            </aside>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border border-border-default bg-bg-base p-4">
              {selectedNode ? (
                // key 换掉即重挂：同一位置换内容时给一段淡入，点文件夹才不会
                // 显得「点了没反应」。
                <div
                  key={selectedNode.id}
                  className="animate-in fade-in-0 duration-150 slide-in-from-bottom-1"
                >
                  <GrantDetailPanel
                    tenantId={tenantId ?? ''}
                    kind={kind}
                    node={selectedNode}
                    trail={trail}
                    inheritedFrom={inheritedFrom}
                    onEdit={setEditing}
                    onRemove={handleRemoveGrant}
                    onClearException={handleClearException}
                    onVisibilityChange={handleVisibilityChange}
                  />
                </div>
              ) : (
                <p className="py-10 text-center text-sm text-text-secondary">
                  {treeFetching ? '…' : '左侧没有可授权的资源'}
                </p>
              )}
            </div>
          </div>
        ) : (
          <>
            <div
              key={`table-${kind}`}
              className="min-h-0 flex-1 animate-in overflow-auto fade-in-0 duration-200"
            >
              <Table rootClassName="max-h-[calc(100vh-280px)]">
                <TableHeader>
                  <TableRow>
                    <TableHead>资源名称</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>所有者</TableHead>
                    <TableHead>可见范围</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resources.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="py-10 text-center text-sm text-text-secondary"
                      >
                        {isFetching ? '…' : '暂无资源'}
                      </TableCell>
                    </TableRow>
                  )}
                  {resources.map((row) => (
                    <ResourceRow
                      key={row.resource_id}
                      row={row}
                      kindLabel={kindLabel}
                      supportsVisibility={supportsVisibility}
                      onEdit={handleEditResource}
                      onVisibilityChange={handleVisibilityChange}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-end pt-3">
              <RAGFlowPagination
                total={total}
                current={page}
                pageSize={pageSize}
                onChange={handlePageChange}
              />
            </div>
          </>
        )}

        <GrantDialog
          target={editing}
          options={subjectOptions}
          onClose={handleCloseDialog}
          onSubmit={handleSubmit}
        />
      </section>
    </ConsoleGuard>
  );
}
