import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LucidePlus, LucideSearch, LucideX } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ConsoleGuard } from '@/components/console-guard';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

type GrantKind = 'dataset' | 'canvas' | 'memory';

const KIND_TABS: { key: GrantKind; label: string }[] = [
  { key: 'dataset', label: '知识库' },
  { key: 'canvas', label: '智能体' },
  { key: 'memory', label: '记忆' },
];

const PAGE_SIZE = 20;

/** 旧二值字段的可读名，用于没有显式规则时的回退展示。 */
function defaultScopeLabel(scope: string) {
  if (scope === 'team') return '全团队（默认）';
  return '仅自己（默认）';
}

/**
 * 资源授权：按资源类型列出可授权的资源，并编辑「谁可以看」。
 *
 * 语义要点：这里配置的是**显式授权**，它覆盖 `permission` 字段的默认二值语义。
 * 清空所有规则即回到默认（仅自己 / 全团队），后端据此决定是否落库。
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

  const [editing, setEditing] = useState<GrantResource | null>(null);
  const [draft, setDraft] = useState<GrantSubject[]>([]);
  const [addKind, setAddKind] = useState<'department' | 'user'>('department');
  const [addId, setAddId] = useState('');
  // 新添加的授权给什么级别。默认只读：给编辑权应当是显式动作。
  const [addPermission, setAddPermission] = useState<'read' | 'edit'>('read');

  const { data: deptData } = useQuery({
    queryKey: ['console/departments', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const res = await fetchDepartments(tenantId as string);
      return res?.data?.data ?? { departments: [] };
    },
  });
  const departments: DepartmentNode[] = deptData?.departments ?? [];

  const { data: memberData } = useQuery({
    queryKey: ['console/members-for-grant', tenantId],
    enabled: !!tenantId,
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

  const { data, isFetching } = useQuery({
    queryKey: ['console/grants', tenantId, kind, page, pageSize, keywords],
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

  // 切换 tab 时回到第一页，避免停在越界页码。
  useEffect(() => {
    setPage(1);
  }, [kind]);

  const openEdit = useCallback((row: GrantResource) => {
    setEditing(row);
    setDraft(row.grants ?? []);
    setAddKind('department');
    setAddId('');
  }, []);

  const addSubject = useCallback(() => {
    if (addKind === 'department') {
      const dept = flatDepts.find((d) => d.id === addId);
      if (!dept) return;
      setDraft((prev) =>
        prev.some((s) => s.kind === 'department' && s.id === dept.id)
          ? prev
          : [...prev, { kind: 'department', id: dept.id, name: dept.name.trim(), permission: addPermission }],
      );
    } else {
      const member = members.find((m) => m.id === addId);
      if (!member) return;
      setDraft((prev) =>
        prev.some((s) => s.kind === 'user' && s.id === member.id)
          ? prev
          : [
              ...prev,
              {
                kind: 'user',
                id: member.id,
                name: member.nickname || member.email,
              },
            ],
      );
    }
    setAddId('');
  }, [addId, addKind, addPermission, flatDepts, members]);

  const addTeam = useCallback(() => {
    setDraft((prev) =>
      prev.some((s) => s.kind === 'team')
        ? prev
        : [...prev, { kind: 'team', id: '', name: '全团队', permission: addPermission }],
    );
  }, [addPermission]);

  const save = useCallback(async () => {
    if (!tenantId || !editing) return;
    await setGrants(tenantId, kind, editing.resource_id, draft);
    setEditing(null);
    queryClient.invalidateQueries({ queryKey: ['console/grants'] });
  }, [draft, editing, kind, queryClient, tenantId]);

  return (
    <ConsoleGuard module="role">
      <section className="flex h-full flex-col p-5">
      <header className="mb-4">
        <h1 className="text-2xl font-medium text-text-primary">
          {t('console.grants')}
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          配置知识库、智能体、记忆的可见范围
        </p>
      </header>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-md bg-background-second p-1">
          {KIND_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setKind(tab.key)}
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
            onChange={(e) => {
              setKeywords(e.target.value);
              setPage(1);
            }}
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
              <TableRow key={row.resource_id}>
                <TableCell className="text-sm text-text-primary">
                  {row.resource_name || '-'}
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
                    onClick={() => openEdit(row)}
                  >
                    设置
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-end pt-3">
        <RAGFlowPagination
          total={total}
          current={page}
          pageSize={pageSize}
          onChange={(nextPage: number, nextSize: number) => {
            setPage(nextPage);
            setPageSize(nextSize);
          }}
        />
      </div>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>设置可见范围</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="text-sm text-text-secondary">
              {editing?.resource_name}
              {editing && !draft.length && (
                <span className="ml-2 text-xs">
                  （未设置显式授权，按默认：{defaultScopeLabel(editing.default_scope)}）
                </span>
              )}
            </div>

            <div>
              <div className="mb-1 text-sm text-text-secondary">已授权</div>
              <div className="flex min-h-9 flex-wrap items-center gap-2 rounded-md border border-border-default p-2">
                {draft.length === 0 && (
                  <span className="text-xs text-text-secondary">
                    暂无，默认按「{defaultScopeLabel(editing?.default_scope ?? '')}」
                  </span>
                )}
                {draft.map((g, idx) => (
                  <span
                    key={`${g.kind}-${g.id}-${idx}`}
                    className="flex items-center gap-1 rounded bg-accent-primary/10 px-2 py-0.5 text-xs text-accent-primary"
                  >
                    {g.name}
                    {/* 点一下在「可查看 / 可编辑」之间切换：授权列表通常很短，
                        为每次都开一个下拉不值当。 */}
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((prev) =>
                          prev.map((item, i) =>
                            i === idx
                              ? {
                                  ...item,
                                  permission:
                                    item.permission === 'edit' ? 'read' : 'edit',
                                }
                              : item,
                          ),
                        )
                      }
                      className="rounded bg-accent-primary/15 px-1 hover:bg-accent-primary/25"
                      title="点击切换权限级别"
                    >
                      {g.permission === 'edit' ? '可编辑' : '可查看'}
                    </button>
                    <LucideX
                      className="size-3 cursor-pointer"
                      onClick={() =>
                        setDraft((prev) => prev.filter((_, i) => i !== idx))
                      }
                    />
                  </span>
                ))}
              </div>
            </div>

            <div className="flex items-end gap-2">
              <div className="flex-1">
                <div className="mb-1 text-sm text-text-secondary">添加</div>
                <div className="flex gap-2">
                  <select
                    value={addKind}
                    onChange={(e) => {
                      setAddKind(e.target.value as 'department' | 'user');
                      setAddId('');
                    }}
                    className="h-9 rounded-md border border-border-default bg-bg-base px-2 text-sm text-text-primary outline-none"
                  >
                    <option value="department">指定部门</option>
                    <option value="user">指定成员</option>
                  </select>
                  <select
                    value={addId}
                    onChange={(e) => setAddId(e.target.value)}
                    className="h-9 min-w-0 flex-1 rounded-md border border-border-default bg-bg-base px-2 text-sm text-text-primary outline-none"
                  >
                    <option value="">请选择…</option>
                    {addKind === 'department'
                      ? flatDepts.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))
                      : members.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.nickname || m.email}
                          </option>
                        ))}
                  </select>
                </div>
              </div>
              <select
                value={addPermission}
                onChange={(e) =>
                  setAddPermission(e.target.value as 'read' | 'edit')
                }
                className="h-9 rounded-md border border-border-default bg-bg-base px-2 text-sm text-text-primary outline-none"
                title="授予的权限级别"
              >
                <option value="read">可查看</option>
                <option value="edit">可编辑</option>
              </select>
              <Button variant="secondary" onClick={addSubject} disabled={!addId}>
                <LucidePlus className="mr-1 size-4" />
                添加
              </Button>
            </div>

            <p className="text-xs text-text-secondary">
              可查看：能看到并使用该资源，但不能修改内容、不能删除、不能再授权；
              可编辑：可以修改内容、删除资源。
            </p>

            <div>
              <Button
                variant="secondary"
                className="h-8"
                onClick={addTeam}
                disabled={draft.some((s) => s.kind === 'team')}
              >
                开放给全团队
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              取消
            </Button>
            <Button onClick={save}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </section>
    </ConsoleGuard>
  );
}
