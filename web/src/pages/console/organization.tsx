import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronRight,
  LucidePlus,
  LucideSearch,
} from 'lucide-react';
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
  createDepartment,
  deleteDepartment,
  fetchConsoleMembers,
  fetchDepartments,
  updateDepartment,
} from '@/services/console-service';

/**
 * 组织架构：左侧部门树，右侧所选部门的成员。
 *
 * 树用 adjacency list 一次取回、前端递归渲染 —— 租户组织层级很浅（通常 ≤3 层），
 * 不需要按层懒加载。
 */
export default function ConsoleOrganization() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: tenantInfo } = useFetchTenantInfo();
  const tenantId = tenantInfo?.tenant_id as string | undefined;

  const [selectedDept, setSelectedDept] = useState<string>('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [keywords, setKeywords] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string>('');
  const [parentId, setParentId] = useState<string>('');
  const [name, setName] = useState('');
  // 成员表走服务端分页（handler 支持 page/page_size，上限 200）。原来固定
  // `page_size: 200` 且没有分页条，成员超过 200 人时后面的直接被截断。
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data: deptData } = useQuery({
    queryKey: ['console/departments', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const res = await fetchDepartments(tenantId as string);
      return res?.data?.data ?? { departments: [] };
    },
  });
  const departments: DepartmentNode[] = deptData?.departments ?? [];

  const { data: memberData, isFetching } = useQuery({
    queryKey: [
      'console/members',
      tenantId,
      selectedDept,
      keywords,
      page,
      pageSize,
    ],
    enabled: !!tenantId,
    queryFn: async () => {
      const res = await fetchConsoleMembers(tenantId as string, {
        department_id: selectedDept || undefined,
        keywords: keywords || undefined,
        page,
        page_size: pageSize,
      });
      return res?.data?.data ?? { members: [], total: 0 };
    },
  });
  const members: ConsoleMember[] = memberData?.members ?? [];
  const total = memberData?.total ?? 0;

  // 切部门 / 改关键词都会让当前页偏移失效，回到第 1 页。
  useEffect(() => {
    setPage(1);
  }, [selectedDept, keywords]);

  const flat = useMemo(() => {
    const out: DepartmentNode[] = [];
    const walk = (nodes: DepartmentNode[]) => {
      nodes.forEach((n) => {
        out.push(n);
        if (n.children?.length) walk(n.children);
      });
    };
    walk(departments);
    return out;
  }, [departments]);

  const currentName = useMemo(() => {
    if (!selectedDept) return '全部成员';
    return flat.find((d) => d.id === selectedDept)?.name ?? '全部成员';
  }, [flat, selectedDept]);

  const openCreate = useCallback((parent: string) => {
    setEditingId('');
    setParentId(parent);
    setName('');
    setDialogOpen(true);
  }, []);

  const openEdit = useCallback((node: DepartmentNode) => {
    setEditingId(node.id);
    setParentId(node.parent_id);
    setName(node.name);
    setDialogOpen(true);
  }, []);

  const submit = useCallback(async () => {
    if (!tenantId) return;
    if (!name.trim()) return;
    if (editingId) {
      await updateDepartment(tenantId, editingId, { name: name.trim() });
    } else {
      await createDepartment(tenantId, {
        name: name.trim(),
        parent_id: parentId || undefined,
      });
    }
    setDialogOpen(false);
    queryClient.invalidateQueries({ queryKey: ['console/departments'] });
  }, [editingId, name, parentId, queryClient, tenantId]);

  const remove = useCallback(
    async (node: DepartmentNode) => {
      if (!tenantId) return;
      if (!window.confirm(`确定删除部门「${node.name}」？`)) return;
      try {
        await deleteDepartment(tenantId, node.id);
        if (selectedDept === node.id) setSelectedDept('');
        queryClient.invalidateQueries({ queryKey: ['console/departments'] });
      } catch {
        window.alert('该部门下还有子部门或成员，请先移走后再删除');
      }
    },
    [queryClient, selectedDept, tenantId],
  );

  const renderTree = (nodes: DepartmentNode[], depth = 0) =>
    nodes.map((node) => {
      const hasChildren = !!node.children?.length;
      const isOpen = expanded[node.id] ?? true;
      const active = selectedDept === node.id;
      return (
        <div key={node.id}>
          <div
            className={`group flex cursor-pointer items-center gap-1 rounded px-2 py-1.5 text-sm ${
              active
                ? 'bg-accent-primary/10 text-accent-primary'
                : 'text-text-primary hover:bg-background-second'
            }`}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            onClick={() => setSelectedDept(node.id)}
          >
            <span
              className="flex size-4 shrink-0 items-center justify-center"
              onClick={(e) => {
                e.stopPropagation();
                if (hasChildren) {
                  setExpanded((prev) => ({ ...prev, [node.id]: !isOpen }));
                }
              }}
            >
              {hasChildren ? (
                isOpen ? (
                  <ChevronDown className="size-3.5" />
                ) : (
                  <ChevronRight className="size-3.5" />
                )
              ) : (
                <span className="size-3.5" />
              )}
            </span>
            <span className="flex-1 truncate">{node.name}</span>
            <span className="text-xs text-text-secondary">
              {node.member_count || 0}
            </span>
            <span
              className="ml-1 hidden text-xs text-text-secondary group-hover:inline"
              onClick={(e) => {
                e.stopPropagation();
                openEdit(node);
              }}
            >
              编辑
            </span>
            <span
              className="ml-1 hidden text-xs text-state-error group-hover:inline"
              onClick={(e) => {
                e.stopPropagation();
                remove(node);
              }}
            >
              删除
            </span>
          </div>
          {hasChildren && isOpen && renderTree(node.children ?? [], depth + 1)}
        </div>
      );
    });

  return (
    <ConsoleGuard module="member">
      <section className="flex h-full flex-col p-5">
        <header className="mb-4">
          <h1 className="text-2xl font-medium text-text-primary">
            {t('console.organization')}
          </h1>
          <p className="mt-1 text-sm text-text-secondary">管理部门与成员归属</p>
        </header>

        <div className="flex min-h-0 flex-1 gap-4">
          {/* 部门树 */}
          <aside className="flex w-64 shrink-0 flex-col rounded-lg border border-border-default">
            <div className="flex items-center justify-between border-b border-border-default px-3 py-2">
              <span className="text-sm font-medium text-text-primary">
                部门列表
              </span>
              <Button
                variant="transparent"
                size="icon-sm"
                onClick={() => openCreate('')}
                title="新增部门"
              >
                <LucidePlus className="size-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto py-1">
              <div
                className={`mx-1 cursor-pointer rounded px-2 py-1.5 text-sm ${
                  selectedDept === ''
                    ? 'bg-accent-primary/10 text-accent-primary'
                    : 'text-text-primary hover:bg-background-second'
                }`}
                onClick={() => setSelectedDept('')}
              >
                全部成员
              </div>
              {renderTree(departments)}
            </div>
          </aside>

          {/* 成员表 */}
          <div className="flex min-w-0 flex-1 flex-col rounded-lg border border-border-default">
            <div className="flex items-center gap-3 border-b border-border-default px-4 py-2">
              <span className="text-sm font-medium text-text-primary">
                {currentName}
              </span>
              <span className="rounded bg-background-second px-1.5 py-0.5 text-xs text-text-secondary">
                {total} 人
              </span>
              <div className="relative ml-auto">
                <LucideSearch className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-secondary" />
                <Input
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder="搜索成员"
                  className="w-56 pl-8"
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              <Table scroll="page">
                <TableHeader>
                  <TableRow>
                    <TableHead>姓名</TableHead>
                    <TableHead>账号</TableHead>
                    <TableHead>岗位</TableHead>
                    <TableHead>角色</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>所属部门</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="py-10 text-center text-sm text-text-secondary"
                      >
                        {isFetching ? '…' : '该部门暂无成员'}
                      </TableCell>
                    </TableRow>
                  )}
                  {members.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="text-sm">
                        <div className="font-medium text-text-primary">
                          {m.nickname || '-'}
                        </div>
                        <div className="text-xs text-text-secondary">
                          {m.email}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-text-secondary">
                        {m.email}
                      </TableCell>
                      <TableCell className="text-xs">
                        {m.position || '-'}
                      </TableCell>
                      <TableCell className="text-xs">
                        {m.role_name || m.role || '-'}
                      </TableCell>
                      <TableCell className="text-xs">
                        <span
                          className={
                            m.status === '1'
                              ? 'rounded bg-green-50 px-1.5 py-0.5 text-green-700'
                              : 'rounded bg-background-second px-1.5 py-0.5 text-text-secondary'
                          }
                        >
                          {m.status === '1' ? '在职' : '停用'}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs">
                        {m.department_name || '未分配'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {total > 0 && (
              <div className="border-t border-border-default px-4 py-2">
                <RAGFlowPagination
                  current={page}
                  pageSize={pageSize}
                  total={total}
                  onChange={(next, nextSize) => {
                    setPage(next);
                    if (nextSize) setPageSize(nextSize);
                  }}
                />
              </div>
            )}
          </div>
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingId ? '编辑部门' : '新增部门'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <div className="mb-1 text-sm text-text-secondary">部门名称</div>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：零售业务部"
                />
              </div>
              {!editingId && parentId && (
                <div className="text-xs text-text-secondary">
                  上级部门：{flat.find((d) => d.id === parentId)?.name}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setDialogOpen(false)}>
                取消
              </Button>
              <Button onClick={submit}>保存</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    </ConsoleGuard>
  );
}
