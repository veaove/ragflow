import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LucidePlus, LucideSearch } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
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
  ConsoleRole,
  DepartmentNode,
  addTenantMember,
  fetchConsoleMembers,
  fetchConsoleRoles,
  fetchDepartments,
  removeConsoleMember,
  resetMemberPassword,
  updateConsoleMember,
} from '@/services/console-service';
import { rsaPsw } from '@/utils/index';

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
    nickname: '',
    department_id: '',
    position: '',
    role_id: '',
    status: '1',
  });

  // 邀请成员：直接添加已注册用户，无邀请确认环节。
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  // 空值表示「普通成员（默认）」，非空则是 role_id（内置或自定义角色）。
  const [inviteRoleId, setInviteRoleId] = useState('');
  const [inviteError, setInviteError] = useState('');

  // 重置密码：前端用 rsaPsw 加密，后端解密后再哈希。
  const [pwTarget, setPwTarget] = useState<ConsoleMember | null>(null);
  const [pwValue, setPwValue] = useState('');
  const [pwError, setPwError] = useState('');

  const { data: deptData } = useQuery({
    queryKey: ['console/departments', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const res = await fetchDepartments(tenantId as string);
      return res?.data?.data ?? { departments: [] };
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
      return res?.data?.data ?? { roles: [], modules: [] };
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
      return res?.data?.data ?? { members: [], total: 0 };
    },
  });
  const members: ConsoleMember[] = data?.members ?? [];
  const total = data?.total ?? 0;

  const openEdit = useCallback((m: ConsoleMember) => {
    setEditing(m);
    setForm({
      nickname: m.nickname || '',
      department_id: m.department_id || '',
      position: m.position || '',
      role_id: m.role_id || '',
      status: m.status || '1',
    });
  }, []);

  const submit = useCallback(async () => {
    if (!tenantId || !editing) return;
    await updateConsoleMember(tenantId, editing.id, {
      nickname: form.nickname,
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

  const submitInvite = useCallback(async () => {
    if (!tenantId || !inviteEmail.trim()) return;
    setInviteError('');
    try {
      await addTenantMember(tenantId, {
        email: inviteEmail.trim(),
        // 选了角色就传 role_id（后端据此推导枚举），否则按默认普通成员。
        ...(inviteRoleId ? { role_id: inviteRoleId } : { role: 'normal' }),
      });
      setInviteOpen(false);
      setInviteEmail('');
      setInviteRoleId('');
      queryClient.invalidateQueries({ queryKey: ['console/members'] });
    } catch (e: any) {
      // 常见失败：邮箱未注册 / 调用者不是租户 owner / 已是成员。
      setInviteError(e?.message ?? '添加失败，请确认该邮箱已注册且未被添加');
    }
  }, [inviteEmail, inviteRoleId, queryClient, tenantId]);

  const submitPw = useCallback(async () => {
    if (!tenantId || !pwTarget) return;
    if (pwValue.length < 6) {
      setPwError('密码至少 6 位');
      return;
    }
    setPwError('');
    try {
      // JSEncrypt 加密失败时返回 false，兜底成空串让后端报"密码不能为空"，
      // 而不是把 false 塞进请求体。
      await resetMemberPassword(tenantId, pwTarget.id, rsaPsw(pwValue) || '');
      setPwTarget(null);
      setPwValue('');
      window.alert('密码已重置');
    } catch (e: any) {
      setPwError(e?.message ?? '重置失败');
    }
  }, [pwTarget, pwValue, tenantId]);

  return (
    <ConsoleGuard module="member">
      <section className="flex h-full flex-col p-5">
      <header className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-medium text-text-primary">
            {t('console.members')}
          </h1>
          <p className="mt-1 text-sm text-text-secondary">共 {total} 位成员</p>
        </div>
        <Button onClick={() => setInviteOpen(true)}>
          <LucidePlus className="mr-1 size-4" />
          邀请成员
        </Button>
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
                    className="mr-3 text-text-primary hover:underline"
                    onClick={() => {
                      setPwTarget(m);
                      setPwValue('');
                      setPwError('');
                    }}
                  >
                    重置密码
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
              {editing?.nickname || '未设置姓名'} · {editing?.email}
            </div>
            <div>
              <div className="mb-1 text-sm text-text-secondary">姓名</div>
              <Input
                value={form.nickname}
                onChange={(e) =>
                  setForm((f) => ({ ...f, nickname: e.target.value }))
                }
                placeholder="留空则显示邮箱"
                maxLength={100}
              />
              {editing?.nickname && form.nickname !== editing.nickname && (
                <p className="mt-1 text-xs text-text-secondary">
                  该昵称是账号级别的，改了之后此人在其它租户里的显示名也会一起变。
                </p>
              )}
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
      {/* 邀请成员：直接添加已注册用户，无需对方确认 */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>邀请成员</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <div className="mb-1 text-sm text-text-secondary">
                邮箱（须为已注册用户）
              </div>
              <Input
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="name@example.com"
              />
            </div>
            <div>
              <div className="mb-1 text-sm text-text-secondary">角色</div>
              <select
                value={inviteRoleId}
                onChange={(e) => setInviteRoleId(e.target.value)}
                className="h-9 w-full rounded-md border border-border-default bg-bg-base px-3 text-sm text-text-primary outline-none"
              >
                <option value="">普通成员（默认）</option>
                {roles
                  .filter((r) => r.name !== '租户管理员')
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </select>
              <div className="mt-1 text-xs text-text-secondary">
                「租户管理员」等同于租户所有者，不能通过邀请授予。
              </div>
            </div>
            {inviteError && (
              <div className="text-xs text-state-error">{inviteError}</div>
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setInviteOpen(false)}>
              取消
            </Button>
            <Button onClick={submitInvite}>添加</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 重置密码 */}
      <Dialog
        open={!!pwTarget}
        onOpenChange={(open) => !open && setPwTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重置密码</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-text-secondary">
              {pwTarget?.nickname} · {pwTarget?.email}
            </div>
            <div>
              <div className="mb-1 text-sm text-text-secondary">新密码</div>
              <Input
                type="password"
                value={pwValue}
                onChange={(e) => setPwValue(e.target.value)}
                placeholder="至少 6 位"
              />
            </div>
            {pwError && (
              <div className="text-xs text-state-error">{pwError}</div>
            )}
            <div className="text-xs text-text-secondary">
              密码由 RSA 加密后传输，服务端按与登录相同的格式存储。
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPwTarget(null)}>
              取消
            </Button>
            <Button onClick={submitPw}>确定</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </section>
    </ConsoleGuard>
  );
}
