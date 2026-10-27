import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LucidePencil, LucidePlus, LucideShield, LucideShieldCheck } from 'lucide-react';
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
  AuditEntry,
  ConsoleRole,
  RolePermissionRow,
  createConsoleRole,
  deleteConsoleRole,
  fetchConsoleAudits,
  fetchConsoleRoles,
  saveConsolePermissions,
  updateConsoleRole,
} from '@/services/console-service';

/** 矩阵行的中文名。后端只回 module key，文案在前端维护。 */
const MODULE_LABELS: Record<string, string> = {
  // 顺序与后端 dao.ConsoleModules 一致
  overview: '总览',
  dataset: '知识库',
  chat: '知识问答',
  search: '知识搜索',
  agent: '智能体',
  studio: '工作室',
  memory: '记忆',
  qc_rule: '质检规则',
  qc_realtime: '实时质检',
  qc_hit: '命中记录',
  qc_config: '质检系统配置',
  file: '文件管理',
  organization: '组织架构',
  member: '用户管理',
  role: '角色管理',
  grant: '资源授权',
  model: '模型配置',
  datasource: '数据源',
  channel: '聊天渠道',
  mcp: 'MCP',
  apikey: 'API',
  team: '团队管理',
  quota: '配额用量',
  audit: '审计日志',
  security: '安全设置',
};

const ACTION_COLUMNS: { key: keyof RolePermissionRow; label: string }[] = [
  { key: 'can_view', label: '查看' },
  { key: 'can_create', label: '创建' },
  { key: 'can_edit', label: '编辑' },
  { key: 'can_delete', label: '删除' },
  { key: 'can_manage', label: '管理' },
];

/** 审计里的动作 / 对象 → 中文，仅用于展示。 */
const ACTION_LABELS: Record<string, string> = {
  create: '创建',
  update: '修改',
  delete: '删除',
};

const OBJECT_LABELS: Record<string, string> = {
  role: '角色',
  role_permission: '权限矩阵',
  member: '成员',
  member_password: '密码重置',
  resource_grant: '资源授权',
};

/** 把后端矩阵补齐成「每个模块一行」，缺失模块视为全 false。 */
function normalizeMatrix(
  modules: string[],
  rows: RolePermissionRow[],
): RolePermissionRow[] {
  const byModule = new Map(rows.map((r) => [r.module, r]));
  return modules.map((module) => {
    const found = byModule.get(module);
    return found
      ? { ...found }
      : {
          module,
          can_view: false,
          can_create: false,
          can_edit: false,
          can_delete: false,
          can_manage: false,
        };
  });
}

/**
 * 角色权限：左侧角色列表，右侧模块 × 动作矩阵。
 *
 * 三个内置角色（租户管理员 / 部门管理员 / 普通成员）可编辑，与自定义角色
 * 共用同一套权限引擎。is_builtin 仅用于 UI 分类显示，不影响可编辑性。
 */
export default function ConsoleRoles() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: tenantInfo } = useFetchTenantInfo();
  const tenantId = tenantInfo?.tenant_id as string | undefined;

  const [selectedId, setSelectedId] = useState<string>('');
  const [draft, setDraft] = useState<RolePermissionRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  // inline 重命名：哪个 role 处于编辑态 + 当前输入值
  const [renamingId, setRenamingId] = useState<string>('');
  const [renameValue, setRenameValue] = useState('');
  // 变更记录：点开才请求，避免每次进页面都拉审计。
  const [auditOpen, setAuditOpen] = useState(false);

  const { data: auditData } = useQuery({
    queryKey: ['console/audits', tenantId],
    enabled: !!tenantId && auditOpen,
    queryFn: async () => {
      const res = await fetchConsoleAudits({ page: 1, page_size: 100 });
      return res?.data?.data ?? [];
    },
  });

  /** 只保留权限相关的动作，其它审计（如智能体运行）不在这里展示。 */
  const PERMISSION_OBJECTS = [
    'role',
    'role_permission',
    'member',
    'member_password',
    'resource_grant',
  ];
  const audits: AuditEntry[] = (auditData ?? []).filter((a) =>
    PERMISSION_OBJECTS.includes(a.object_type),
  );

  const { data, isFetching } = useQuery({
    queryKey: ['console/roles', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const res = await fetchConsoleRoles(tenantId as string);
      return res?.data?.data ?? { roles: [], modules: [] };
    },
  });
  const roles: ConsoleRole[] = data?.roles ?? [];
  const modules: string[] = data?.modules ?? [];

  const selected = useMemo(
    () => roles.find((r) => r.id === selectedId),
    [roles, selectedId],
  );

  // 默认选中第一个角色，避免右侧空着。
  useEffect(() => {
    if (!selectedId && roles.length > 0) {
      setSelectedId(roles[0].id);
    }
  }, [roles, selectedId]);

  // 切角色时用后端矩阵重置草稿。
  useEffect(() => {
    if (selected) {
      setDraft(normalizeMatrix(modules, selected.permissions ?? []));
      setDirty(false);
    }
  }, [modules, selected]);

  const isSystemRole = selected?.is_system === true;

  const toggleCell = useCallback(
    (module: string, key: keyof RolePermissionRow) => {
      if (selected?.is_system) return;
      setDraft((rows) =>
        rows.map((row) =>
          row.module === module ? { ...row, [key]: !row[key] } : row,
        ),
      );
      setDirty(true);
    },
    [selected],
  );

  const toggleRow = useCallback(
    (module: string) => {
      if (selected?.is_system) return;
      setDraft((rows) => rows.map((row) => {
        if (row.module !== module) return row;
        const allOn = ACTION_COLUMNS.every((c) => row[c.key] === true);
        const next = allOn ? false : true;
        return {
          ...row,
          can_view: next,
          can_create: next,
          can_edit: next,
          can_delete: next,
          can_manage: next,
        };
      }));
      setDirty(true);
    },
    [selected],
  );

  const save = useCallback(async () => {
    if (!tenantId || !selected) return;
    if (selected.is_system) return;
    await saveConsolePermissions(tenantId, selected.id, draft);
    setDirty(false);
    queryClient.invalidateQueries({ queryKey: ['console/roles'] });
  }, [draft, queryClient, selected, tenantId]);

  const createRole = useCallback(async () => {
    if (!tenantId || !newName.trim()) return;
    try {
      await createConsoleRole(tenantId, {
        name: newName.trim(),
        description: newDesc.trim(),
      });
      setCreateOpen(false);
      setNewName('');
      setNewDesc('');
      queryClient.invalidateQueries({ queryKey: ['console/roles'] });
    } catch {
      window.alert('创建失败：角色名可能已存在');
    }
  }, [newDesc, newName, queryClient, tenantId]);

  const renameRole = useCallback(
    async (role: ConsoleRole, newName: string) => {
      if (!tenantId) return;
      const trimmed = newName.trim();
      if (!trimmed || trimmed === role.name) {
        setRenamingId('');
        return;
      }
      try {
        await updateConsoleRole(tenantId, role.id, { name: trimmed });
        setRenamingId('');
        queryClient.invalidateQueries({ queryKey: ['console/roles'] });
      } catch {
        window.alert('重命名失败：角色名可能已存在');
      }
    },
    [queryClient, tenantId],
  );

  const removeRole = useCallback(
    async (role: ConsoleRole) => {
      if (!tenantId) return;
      if (!window.confirm(`确定删除角色「${role.name}」？成员会回退为默认角色`))
        return;
      await deleteConsoleRole(tenantId, role.id);
      if (selectedId === role.id) setSelectedId('');
      queryClient.invalidateQueries({ queryKey: ['console/roles'] });
    },
    [queryClient, selectedId, tenantId],
  );

  const builtin = roles.filter((r) => r.is_builtin);
  const custom = roles.filter((r) => !r.is_builtin);

  const renderRoleItem = (role: ConsoleRole) => {
    const canRename = !role.is_system && !role.is_builtin;
    const isRenaming = renamingId === role.id;

    return (
      <div
        key={role.id}
        className={`group cursor-pointer rounded-md px-3 py-2 ${
          selectedId === role.id
            ? 'bg-accent-primary/10'
            : 'hover:bg-background-second'
        }`}
        onClick={() => !isRenaming && setSelectedId(role.id)}
      >
        <div className="flex items-center gap-2">
          {role.is_builtin ? (
            <LucideShieldCheck className="size-4 text-accent-primary shrink-0" />
          ) : (
            <LucideShield className="size-4 text-text-secondary shrink-0" />
          )}

          {isRenaming ? (
            <Input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={() => renameRole(role, renameValue)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  renameRole(role, renameValue);
                } else if (e.key === 'Escape') {
                  setRenamingId('');
                }
              }}
              className="h-7 flex-1 min-w-0 text-sm"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="text-sm font-medium text-text-primary truncate">
              {role.name}
            </span>
          )}

          {role.is_system && (
            <span className="rounded bg-state-warning/10 px-1 text-[10px] text-state-warning shrink-0">
              系统
            </span>
          )}
          {!role.is_system && role.is_builtin && (
            <span className="rounded bg-background-second px-1 text-[10px] text-text-secondary shrink-0">
              内置
            </span>
          )}
          {!role.is_builtin && (
            <span className="rounded bg-accent-primary/10 px-1 text-[10px] text-accent-primary shrink-0">
              自定义
            </span>
          )}

          {canRename && !isRenaming && (
            <button
              type="button"
              title="重命名"
              className="ml-auto opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-background-second transition-opacity shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                setRenamingId(role.id);
                setRenameValue(role.name);
              }}
            >
              <LucidePencil className="size-3.5 text-text-secondary" />
            </button>
          )}
        </div>
        {!isRenaming && (
          <div className="mt-0.5 truncate pl-6 text-xs text-text-secondary">
            {role.description || '—'}
          </div>
        )}
      </div>
    );
  };

  return (
    <ConsoleGuard module="role">
      <section className="flex h-full flex-col p-5">
      <header className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-medium text-text-primary">
            {t('console.roles')}
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            基于 RBAC 的细粒度权限管理
          </p>
        </div>
        <Button variant="secondary" onClick={() => setAuditOpen(true)}>
          变更记录
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 gap-4">
        <aside className="flex w-64 shrink-0 flex-col rounded-lg border border-border-default">
          <div className="flex items-center justify-between border-b border-border-default px-3 py-2">
            <span className="text-sm font-medium text-text-primary">
              角色列表
            </span>
            <Button
              variant="transparent"
              size="icon-sm"
              onClick={() => setCreateOpen(true)}
              title="新建角色"
            >
              <LucidePlus className="size-4" />
            </Button>
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            {builtin.length > 0 && (
              <div className="px-1 pb-1 text-xs text-text-secondary">内置角色</div>
            )}
            {builtin.map(renderRoleItem)}
            {custom.length > 0 && (
              <div className="px-1 pb-1 pt-3 text-xs text-text-secondary">
                自定义角色
              </div>
            )}
            {custom.map(renderRoleItem)}
            {roles.length === 0 && (
              <div className="py-8 text-center text-xs text-text-secondary">
                {isFetching ? '…' : '暂无角色'}
              </div>
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col rounded-lg border border-border-default">
          <div className="flex items-center gap-2 border-b border-border-default px-4 py-2">
            <span className="text-sm font-medium text-text-primary">
              权限配置 - {selected?.name ?? '未选择'}
            </span>
            {selected?.is_system && (
              <span className="rounded bg-state-warning/10 px-1.5 py-0.5 text-[10px] text-state-warning">
                系统（不可编辑）
              </span>
            )}
            {selected && !selected.is_system && selected.is_builtin && (
              <span className="rounded bg-background-second px-1.5 py-0.5 text-[10px] text-text-secondary">
                内置
              </span>
            )}
            {selected && !selected.is_system && !selected.is_builtin && (
              <button
                type="button"
                className="ml-auto text-xs text-state-error hover:underline"
                onClick={() => removeRole(selected)}
              >
                删除角色
              </button>
            )}
            {dirty && !selected?.is_system && (
              <Button className="ml-2 h-8" onClick={save}>
                保存
              </Button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>功能模块</TableHead>
                  <TableHead className="w-[70px] text-center">全选</TableHead>
                  {ACTION_COLUMNS.map((c) => (
                    <TableHead key={c.key} className="w-[70px] text-center">
                      {c.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {draft.map((row) => {
                  const allOn = ACTION_COLUMNS.every((c) => row[c.key] === true);
                  return (
                    <TableRow key={row.module}>
                      <TableCell className="text-sm text-text-primary">
                        {MODULE_LABELS[row.module] ?? row.module}
                      </TableCell>
                      <TableCell className="text-center">
                        <input
                          type="checkbox"
                          checked={allOn}
                          disabled={isSystemRole}
                          onChange={() => toggleRow(row.module)}
                        />
                      </TableCell>
                      {ACTION_COLUMNS.map((c) => (
                        <TableCell key={c.key} className="text-center">
                          <input
                            type="checkbox"
                            checked={row[c.key] === true}
                            disabled={isSystemRole}
                            onChange={() => toggleCell(row.module, c.key)}
                          />
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建角色</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <div className="mb-1 text-sm text-text-secondary">角色名称</div>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="例如：合规质检员"
              />
            </div>
            <div>
              <div className="mb-1 text-sm text-text-secondary">描述</div>
              <Input
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="一句话说明这个角色能做什么"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={createRole}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 权限变更记录：读写同一个 audit_log 表，这里只看权限相关的对象类型 */}
      <Dialog open={auditOpen} onOpenChange={setAuditOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>权限变更记录</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>操作人</TableHead>
                  <TableHead>动作</TableHead>
                  <TableHead>对象</TableHead>
                  <TableHead>IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {audits.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-8 text-center text-sm text-text-secondary"
                    >
                      暂无变更记录
                    </TableCell>
                  </TableRow>
                )}
                {audits.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="whitespace-nowrap text-xs text-text-secondary">
                      {a.create_time
                        ? new Date(a.create_time).toLocaleString()
                        : '-'}
                    </TableCell>
                    <TableCell className="text-xs">{a.operator || '-'}</TableCell>
                    <TableCell className="text-xs">
                      {ACTION_LABELS[a.action] ?? a.action}
                    </TableCell>
                    <TableCell className="text-xs">
                      {OBJECT_LABELS[a.object_type] ?? a.object_type}
                      {a.object_id ? (
                        <span className="ml-1 text-text-secondary">
                          {a.object_id.slice(0, 8)}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs text-text-secondary">
                      {a.ip_address || '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setAuditOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </section>
    </ConsoleGuard>
  );
}
