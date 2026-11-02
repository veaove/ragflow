import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LucideChevronRight, LucideSearch } from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
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
  GrantResource,
  GrantSubject,
  fetchConsoleMembers,
  fetchDepartments,
  fetchGrants,
  setGrants,
} from '@/services/console-service';

import { GrantDialog, GrantTarget, defaultScopeLabel } from './grant-dialog';
import { GrantDocumentRows } from './grant-document-rows';
import { GrantKeys } from './grant-keys';

type GrantKind = 'dataset' | 'canvas' | 'memory';

const KIND_TABS: { key: GrantKind; label: string }[] = [
  { key: 'dataset', label: '知识库' },
  { key: 'canvas', label: '智能体' },
  { key: 'memory', label: '记忆中心' },
];

const PAGE_SIZE = 20;

interface ResourceRowProps {
  row: GrantResource;
  kind: GrantKind;
  expanded: boolean;
  onToggle: (resourceId: string) => void;
  onEdit: (row: GrantResource) => void;
}

/** 资源行。知识库行可展开，展开后下面接它自己的文件列表。 */
function ResourceRow({
  row,
  kind,
  expanded,
  onToggle,
  onEdit,
}: ResourceRowProps) {
  const handleToggle = useCallback(() => {
    onToggle(row.resource_id);
  }, [onToggle, row.resource_id]);

  const handleEdit = useCallback(() => {
    onEdit(row);
  }, [onEdit, row]);

  return (
    <TableRow>
      <TableCell className="text-sm text-text-primary">
        {kind === 'dataset' ? (
          <button
            type="button"
            onClick={handleToggle}
            className="flex items-center gap-1.5 text-left"
            title={expanded ? '收起文件列表' : '展开文件列表'}
          >
            <LucideChevronRight
              className={`size-4 shrink-0 text-text-secondary transition-transform ${
                expanded ? 'rotate-90' : ''
              }`}
            />
            <span>{row.resource_name || '-'}</span>
          </button>
        ) : (
          row.resource_name || '-'
        )}
      </TableCell>
      <TableCell className="text-xs text-text-secondary">
        {KIND_TABS.find((x) => x.key === kind)?.label}
      </TableCell>
      <TableCell className="text-xs">
        {row.owner_name || row.owner_id || '-'}
      </TableCell>
      <TableCell className="text-xs">
        {row.grants?.length ? (
          <div className="flex flex-wrap gap-1">
            {row.grants.map((g, idx) => (
              <span
                key={`${g.kind}-${g.id}-${idx}`}
                className="rounded bg-accent-primary/10 px-1.5 py-0.5 text-accent-primary"
              >
                {g.name}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-text-secondary">
            {defaultScopeLabel(row.default_scope)}
          </span>
        )}
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

/**
 * 资源授权：按资源类型列出可授权的资源，并编辑「谁可以看」。
 *
 * 语义要点：这里配置的是**显式授权**，它覆盖 `permission` 字段的默认二值语义。
 * 清空所有规则即回到默认（仅自己 / 全团队），后端据此决定是否落库。
 *
 * 知识库行可以展开到文件级：文件没有规则时继承知识库的可见范围，一旦设置了
 * 自己的规则（允许 / 拒绝），该文件就只看这份规则。
 */
export default function ConsoleGrants() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: tenantInfo } = useFetchTenantInfo();
  const tenantId = tenantInfo?.tenant_id as string | undefined;

  const [kind, setKind] = useState<GrantKind>('dataset');
  const [keywords, setKeywords] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [expandedId, setExpandedId] = useState('');

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

  // 下拉选项直接派生：数组本身来自已缓存的查询结果，这里再包一层 useMemo
  // 只会让依赖项多出一个每次渲染都变的 `members`。
  const subjectOptions = {
    departments: flatDepts,
    members: members.map((m) => ({ id: m.id, name: m.nickname || m.email })),
  };

  const { data, isFetching } = useQuery({
    queryKey: GrantKeys.resources(
      tenantId ?? '',
      kind,
      page,
      pageSize,
      keywords,
    ),
    enabled: !!tenantId,
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
  const resources: GrantResource[] = data?.resources ?? [];
  const total = data?.total ?? 0;

  // 切换 tab / 搜索时回到第一页并收起展开行，避免页码与展开内容错位。
  useEffect(() => {
    setPage(1);
    setExpandedId('');
  }, [kind]);

  useEffect(() => {
    setExpandedId('');
  }, [keywords]);

  const handleToggleExpand = useCallback((resourceId: string) => {
    setExpandedId((prev) => (prev === resourceId ? '' : resourceId));
  }, []);

  // 用按钮的 value 传 tab key，避免在 JSX 里为每个 tab 写一个闭包。
  const handleKindChange = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      setKind(e.currentTarget.value as GrantKind);
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

  const handleEditResource = useCallback(
    (row: GrantResource) => {
      setEditing({
        kind,
        resourceId: row.resource_id,
        name: row.resource_name || '未命名资源',
        grants: row.grants ?? [],
        defaultScope: row.default_scope,
      });
    },
    [kind],
  );

  const handleCloseDialog = useCallback(() => {
    setEditing(null);
  }, []);

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
      queryClient.invalidateQueries({ queryKey: GrantKeys.resourcesRoot });
      if (target.kind === 'document') {
        queryClient.invalidateQueries({ queryKey: GrantKeys.documentsRoot });
      }
    },
    [queryClient, tenantId],
  );

  return (
    <ConsoleGuard>
      <section className="flex h-full flex-col p-5">
        <header className="mb-4">
          <h1 className="text-2xl font-medium text-text-primary">
            {t('console.grants')}
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            配置知识库、智能体、记忆中心的可见范围；知识库可展开到单个文件
          </p>
        </header>

        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="flex gap-1 rounded-md bg-background-second p-1">
            {KIND_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                value={tab.key}
                onClick={handleKindChange}
                className={`rounded px-3 py-1 text-sm ${
                  kind === tab.key
                    ? 'bg-bg-base text-text-primary shadow-sm'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative ml-auto">
            <LucideSearch className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-secondary" />
            <Input
              value={keywords}
              onChange={handleKeywordsChange}
              placeholder="搜索资源名称"
              className="w-56 pl-8"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
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
                <Fragment key={row.resource_id}>
                  <ResourceRow
                    row={row}
                    kind={kind}
                    expanded={expandedId === row.resource_id}
                    onToggle={handleToggleExpand}
                    onEdit={handleEditResource}
                  />
                  {kind === 'dataset' && expandedId === row.resource_id && (
                    <GrantDocumentRows
                      tenantId={tenantId as string}
                      dataset={{
                        resourceId: row.resource_id,
                        name: row.resource_name,
                        defaultScope: row.default_scope,
                      }}
                      onEdit={setEditing}
                    />
                  )}
                </Fragment>
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
