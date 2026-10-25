import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LucideSearch } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
  ConsoleRole,
  DepartmentNode,
  fetchConsoleMembers,
  fetchConsoleRoles,
  fetchDepartments,
  removeConsoleMember,
  updateConsoleMember,
} from '@/services/console-service';

const PAGE_SIZE = 20;

/**
 * 用户管理：租户内全部成员，可按部门 / 角色 / 状态筛选并编辑归属。
 *
 * 与「组织架构」的区别：那边从部门视角看人，这边从人视角看归属，
 * 所以这里默认不带部门过滤。
 */
export default function ConsoleMembers() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: tenantInfo } = useFetchTenantInfo();
  const tenantId = tenantInfo?.tenant_id as string | undefined;

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [keywords, setKeywords] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [roleId, setRoleId] = useState('');
  const [status, setStatus] = useState('');

  const [editing, setEditing] = useState<ConsoleMember | null>(null);
  const [form, setForm] = useState({
    department_id: '',
    position: '',
    role_id: '',
    status: '1',
  });

  const { data: deptData } = useQuery({
    queryKey: ['console/departments', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const res = await fetchDepartments(tenantId as string);
      return res?.data ?? { departments: [] };
    },
  });
  const departments: DepartmentNode[] = deptData?.departments ?? [];

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

  const { data: roleData } = useQuery({
    queryKey: ['console/roles', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const res = await fetchConsoleRoles(tenantId as string);
      return res?.data ?? { roles: [], modules: [] };
    },
  });
  const roles: ConsoleRole[] = roleData?.roles ?? [];

  const { data, isFetching } = useQuery({
    queryKey: [
      'console/members',
      tenantId,
      page,
      pageSize,
      keywords,
      departmentId,
      roleId,
      status,
    ],
    enabled: !!tenantId,
    queryFn: async () => {
      const res = await fetchConsoleMembers(tenantId as string, {
        page,
        page_size: pageSize,
        keywords: keywords || undefined,
        department_id: departmentId || undefined,
        role_id: roleId || undefined,
        status: status || undefined,
      });
      return res?.data ?? { members: [], total: 0 };
    },
  });
  const members: ConsoleMember[] = data?.members ?? [];
  const total = data?.total ?? 0;

  const openEdit = useCallback((m: ConsoleMember) => {
    setEditing(m);
    setForm({
      department_id: m.department_id || '',
      position: m.position || '',
      role_id: m.role_id || '',
      status: m.status || '1',
    });
  }, []);

  const submit = useCallback(async () => {
    if (!tenantId || !editing) return;
    await updateConsoleMember(tenantId, editing.id, {
      department_id: form.department_id,
      position: form.position,
      role_id: form.role_id,
      status: form.status,
    });
    setEditing(null);
    queryClient.invalidateQueries({ queryKey: ['console/members'] });
    queryClient.invalidateQueries({ queryKey: ['console/departments'] });
  }, [editing, form, queryClient, tenantId]);

  const remove = useCallback(
    async (m: ConsoleMember) => {
      if (!tenantId) return;
      if (!window.confirm(`确定移除成员「${m.nickname || m.email}」？`)) return;
      try {
        await removeConsoleMember(tenantId, m.id);
        queryClient.invalidateQueries({ queryKey: ['console/members'] });
      } catch {
        window.alert('移除失败：只有租户管理员可以移除成员');
      }
    },
    [queryClient, tenantId],
  );

  return (
    <section className="flex h-full flex-col p-5">
      <header className="mb-4">
        <h1 className="text-2xl font-medium text-text-primary">
          {t('console.members')}
        </h1>
        <p className="mt-1 text-sm text-text-secondary">共 {total} 位成员</p>
      </header>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <LucideSearch className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-secondary" />
          <Input
            value={keywords}
            onChange={(e) => {
              setKeywords(e.target.value);
              setPage(1);
            }}
            placeholder="搜索姓名/邮箱"
            className="w-56 pl-8"
          />
        </div>

        <select
          value={departmentId}
          onChange={(e) => {
            setDepartmentId(e.target.value);
            setPage(1);
          }}
          className="h-9 rounded-md border border-border-default bg-bg-base px-3 text-sm text-text-primary outline-none"
        >
          <option value="">全部部门</option>
          {flatDepts.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>

        <select
          value={roleId}
          onChange={(e) => {
            setRoleId(e.target.value);
            setPage(1);
          }}
          className="h-9 rounded-md border border-border-default bg-bg-base px-3 text-sm text-text-primary outline-none"
        >
          <option value="">全部角色</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>

        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="h-9 rounded-md border border-border-default bg-bg-base px-3 text-sm text-text-primary outline-none"
        >
          <option value="">全部状态</option>
          <option value="1">在职</option>
          <option value="0">停用</option>
        </select>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <Table rootClassName="max-h-[calc(100vh-260px)]">
          <TableHeader>
            <TableRow>
              <TableHead>姓名</TableHead>
              <TableHead>所属部门</TableHead>
              <TableHead>岗位</TableHead>
              <TableHead>角色</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>加入时间</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-10 text-center text-sm text-text-secondary"
                >
                  {isFetching ? '…' : '暂无成员'}
                </TableCell>
              </TableRow>
            )}
            {members.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="text-sm">
                  <div className="font-medium text-text-primary">
                    {m.nickname || '-'}
                  </div>
                  <div className="text-xs text-text-secondary">{m.email}</div>
                </TableCell>
                <TableCell className="text-xs">
                  {m.department_name || '未分配'}
                </TableCell>
                <TableCell className="text-xs">{m.position || '-'}</TableCell>
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
                <TableCell className="whitespace-nowrap text-xs text-text-secondary">
                  {m.create_time
                    ? new Date(m.create_time).toLocaleDateString()
                    : '-'}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs">
                  <button
                    type="button"
                    className="mr-3 text-accent-primary hover:underline"
                    onClick={() => openEdit(m)}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    className="text-state-error hover:underline"
                    onClick={() => remove(m)}
                  >
                    移除
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑成员</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-text-secondary">
              {editing?.nickname} · {editing?.email}
            </div>
            <div>
              <div className="mb-1 text-sm text-text-secondary">所属部门</div>
              <select
                value={form.department_id}
                onChange={(e) =>
                  setForm((f) => ({ ...f, department_id: e.target.value }))
                }
                className="h-9 w-full rounded-md border border-border-default bg-bg-base px-3 text-sm text-text-primary outline-none"
              >
                <option value="">未分配</option>
                {flatDepts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="mb-1 text-sm text-text-secondary">岗位</div>
              <Input
                value={form.position}
                onChange={(e) =>
                  setForm((f) => ({ ...f, position: e.target.value }))
                }
                placeholder="例如：销售主管"
              />
            </div>
            <div>
              <div className="mb-1 text-sm text-text-secondary">角色</div>
              <select
                value={form.role_id}
                onChange={(e) =>
                  setForm((f) => ({ ...f, role_id: e.target.value }))
                }
                className="h-9 w-full rounded-md border border-border-default bg-bg-base px-3 text-sm text-text-primary outline-none"
              >
                <option value="">跟随成员类型（默认）</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="mb-1 text-sm text-text-secondary">状态</div>
              <select
                value={form.status}
                onChange={(e) =>
                  setForm((f) => ({ ...f, status: e.target.value }))
                }
                className="h-9 w-full rounded-md border border-border-default bg-bg-base px-3 text-sm text-text-primary outline-none"
              >
                <option value="1">在职</option>
                <option value="0">停用</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              取消
            </Button>
            <Button onClick={submit}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
