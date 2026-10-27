/*
 *  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LucidePencil, LucidePlus, LucideSearch } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RAGFlowPagination } from '@/components/ui/ragflow-pagination';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  createTenant,
  deleteTenant,
  getTenantResourceSummary,
  listTenantResources,
  listTenants,
  listUsers,
  setTenantEnabled,
  setTenantOwner,
  type TenantAssetItem,
  updateTenantName,
} from '@/services/admin-service';

type ResourceType = 'members' | 'kbs' | 'agents';

/**
 * 明细弹窗的列定义。
 *
 * 列由「类型」决定，值全部来自后端的 `cells`——角色/状态/时间在后端就
 * 定好格式了，这里只把英文枚举翻成中文、空值补「—」。
 * 第一列（名称）固定由 `item.name` 渲染，不在此表里。
 */
const RESOURCE_COLUMNS: Record<
  ResourceType,
  {
    firstColumn: string;
    /** 弹窗宽度：列多了 max-w-xl 会把每一列都挤到换行。 */
    width: string;
    columns: { key: string; label: string }[];
  }
> = {
  members: {
    firstColumn: '成员',
    width: 'max-w-3xl',
    // 邮箱不做独立列：没昵称时它就是成员列本身，做成两列会并排重复一遍。
    // 有昵称时以副行显示在主行下面（见下面的明细表格）。
    columns: [
      { key: 'role', label: '角色' },
      { key: 'status', label: '状态' },
      { key: 'last_login', label: '最近登录' },
      { key: 'joined', label: '加入时间' },
    ],
  },
  kbs: {
    firstColumn: '知识库',
    width: 'max-w-5xl',
    // 这几列回答的是「有多大 / 怎么切的 / 用哪个模型 / 能不能用 / 谁建的」，
    // 排查检索效果时基本都从这几项开始看。
    columns: [
      { key: 'docs', label: '文件数' },
      { key: 'chunks', label: '分块数' },
      { key: 'parser', label: '解析方法' },
      { key: 'embedding', label: '嵌入模型' },
      { key: 'status', label: '状态' },
      { key: 'creator', label: '创建人' },
      { key: 'created', label: '创建时间' },
      { key: 'updated', label: '更新时间' },
    ],
  },
  agents: {
    firstColumn: '名称',
    width: 'max-w-3xl',
    columns: [
      { key: 'category', label: '类型' },
      { key: 'created', label: '创建时间' },
    ],
  },
};

/** user_tenant.role 的展示名。 */
const ROLE_LABELS: Record<string, string> = {
  owner: '拥有者',
  admin: '管理员',
  normal: '成员',
  invite: '待接受',
};

/**
 * 状态列的展示名。后端给的是归一化后的英文枚举：
 * 账号给 active/disabled（status 与 is_active 合并判断），
 * 知识库给 enabled/disabled（业务开关，不是软删除标记）。
 */
const STATUS_LABELS: Record<string, string> = {
  active: '正常',
  enabled: '已启用',
  disabled: '已停用',
};

/** 把某一个 cells 值翻成展示文案；空值统一显示「—」，避免表格出现空洞。 */
function resourceCellText(key: string, raw?: string) {
  const value = raw ?? '';
  if (!value) return '—';
  if (key === 'role') return ROLE_LABELS[value] ?? value;
  if (key === 'status') return STATUS_LABELS[value] ?? value;
  return value;
}

/** create_date 是毫秒时间戳，可能为 0（历史数据没写）。 */
function formatDate(ms?: number) {
  if (!ms) return '-';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 平台租户管理。
 *
 * 当前范围（按需求裁剪）：列表 + 统计 + 新建。
 * 不做：套餐版本、到期时间、配额/详情/停用/删除。
 *
 * 统计口径：成员数 / 知识库数 按 tenant_id 归属统计；智能体数只能按
 * user_canvas.user_id 统计（这张表没有 tenant_id，租户 id 就是 owner 的
 * user id），所以成员自己建的画布不计入，「智能体数」点开的明细里也
 * 只有 owner 名下的画布。
 */
export default function Tenants() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [keyword, setKeyword] = useState('');
  // 启停用筛选。原来的 status（软删除标记）对租户来说恒为 1，筛不出东西，
  // 这里改用真正的启停用列 enabled。
  const [enabledFilter, setEnabledFilter] = useState('');

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [error, setError] = useState('');

  // 点击「成员数 / 知识库数 / 智能体数」查看明细
  const [resourceDialog, setResourceDialog] = useState<{
    tenantId: string;
    tenantName: string;
    type: ResourceType;
  } | null>(null);

  const { data: resources, isFetching: resourcesLoading } = useQuery({
    queryKey: [
      'admin/tenant-resources',
      resourceDialog?.tenantId,
      resourceDialog?.type,
    ],
    enabled: !!resourceDialog,
    queryFn: async () => {
      const { data } = await listTenantResources(
        resourceDialog!.tenantId,
        resourceDialog!.type,
      );
      return data?.data ?? [];
    },
  });

  // 当前弹窗的列定义，弹窗宽度也由它决定（知识库列多，需要更宽）。
  const resourceLayout = resourceDialog
    ? RESOURCE_COLUMNS[resourceDialog.type]
    : null;

  const { data, isFetching } = useQuery({
    queryKey: ['admin/tenants', page, pageSize, keyword, enabledFilter],
    queryFn: async () => {
      const { data } = await listTenants({
        page,
        page_size: pageSize,
        keyword,
        enabled: enabledFilter,
      });
      return data?.data ?? { list: [], total: 0 };
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => createTenant(name.trim(), ownerEmail.trim()),
    onSuccess: ({ data }) => {
      if (data.code === 0) {
        setOpen(false);
        setName('');
        setOwnerEmail('');
        setError('');
        queryClient.invalidateQueries({ queryKey: ['admin/tenants'] });
      } else {
        setError(data.message ?? '创建失败');
      }
    },
    onError: (err: any) => {
      setError(err?.message ?? '创建失败');
    },
  });

  const handleKeywordChange = useCallback((value: string) => {
    setKeyword(value);
    setPage(1);
  }, []);

  // 设置超管：从用户列表里选一个
  const [ownerDialog, setOwnerDialog] = useState<{
    tenantId: string;
    tenantName: string;
  } | null>(null);
  const [newOwnerEmail, setNewOwnerEmail] = useState('');

  // 新建租户（选管理员）和设置超管都要选用户，所以常驻查询
  const { data: allUsers } = useQuery({
    queryKey: ['admin/users'],
    queryFn: async () => {
      const { data } = await listUsers();
      return (data?.data ?? []) as Array<{
        email: string;
        nickname?: string;
        is_superuser?: boolean;
        tenant_name?: string;
      }>;
    },
  });

  const setOwnerMutation = useMutation({
    mutationFn: async () =>
      setTenantOwner(ownerDialog!.tenantId, newOwnerEmail),
    onSuccess: ({ data }) => {
      if (data.code === 0) {
        setOwnerDialog(null);
        setNewOwnerEmail('');
        queryClient.invalidateQueries({ queryKey: ['admin/tenants'] });
      }
    },
  });

  // 重命名租户：名称只有一处真值（后端 tenant.name），改完全站同步。
  const [renameDialog, setRenameDialog] = useState<{
    tenantId: string;
    tenantName: string;
  } | null>(null);
  const [newName, setNewName] = useState('');
  const [renameError, setRenameError] = useState('');

  const renameMutation = useMutation({
    mutationFn: async () =>
      updateTenantName(renameDialog!.tenantId, newName.trim()),
    onSuccess: ({ data }) => {
      if (data.code === 0) {
        setRenameDialog(null);
        setNewName('');
        setRenameError('');
        queryClient.invalidateQueries({ queryKey: ['admin/tenants'] });
      } else {
        setRenameError(data.message ?? '重命名失败');
      }
    },
    onError: (err: any) => setRenameError(err?.message ?? '重命名失败'),
  });

  // 停用 / 启用确认
  const [toggleDialog, setToggleDialog] = useState<{
    tenantId: string;
    tenantName: string;
    enabled: boolean;
  } | null>(null);

  // 删除确认（先盘点数据资产，有阻断项就只让看不让删）
  const [deleteDialog, setDeleteDialog] = useState<{
    tenantId: string;
    tenantName: string;
  } | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [actionError, setActionError] = useState('');

  const { data: assets, isFetching: assetsLoading } = useQuery({
    queryKey: ['admin/tenant-assets', deleteDialog?.tenantId],
    enabled: !!deleteDialog,
    queryFn: async () => {
      const { data } = await getTenantResourceSummary(deleteDialog!.tenantId);
      return (data?.data ?? []) as TenantAssetItem[];
    },
  });

  // 有数据就不能删：删租户不会级联删业务表，只会在库里留下孤儿数据。
  const blockingItems = (assets ?? []).filter((a) => a.blocking && a.count > 0);

  const toggleMutation = useMutation({
    mutationFn: async () =>
      setTenantEnabled(toggleDialog!.tenantId, !toggleDialog!.enabled),
    onSuccess: ({ data }) => {
      if (data.code === 0) {
        setToggleDialog(null);
        setActionError('');
        queryClient.invalidateQueries({ queryKey: ['admin/tenants'] });
      } else {
        setActionError(data.message ?? '操作失败');
      }
    },
    onError: (err: any) => setActionError(err?.message ?? '操作失败'),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => deleteTenant(deleteDialog!.tenantId),
    onSuccess: ({ data }) => {
      if (data.code === 0) {
        setDeleteDialog(null);
        setActionError('');
        queryClient.invalidateQueries({ queryKey: ['admin/tenants'] });
      } else {
        setActionError(data.message ?? '删除失败');
      }
    },
    onError: (err: any) => setActionError(err?.message ?? '删除失败'),
  });

  const rows = data?.list ?? [];

  return (
    <>
      <div className="size-full min-w-0 overflow-auto px-5 py-4">
        <header className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h1 className="text-2xl font-medium text-text-primary">
            {t('admin.tenantManagement')}
          </h1>

          {/* 筛选 + 新建 */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-[240px]">
              <LucideSearch className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-disabled" />
              <Input
                value={keyword}
                onChange={(e) => handleKeywordChange(e.target.value)}
                placeholder="搜索租户名称"
                className="pl-9"
              />
            </div>
            <select
              value={enabledFilter}
              onChange={(e) => {
                setEnabledFilter(e.target.value);
                setPage(1);
              }}
              className="h-9 rounded-md border border-border-default bg-bg-base px-3 text-sm text-text-primary outline-none"
            >
              <option value="">全部状态</option>
              <option value="1">正常</option>
              <option value="0">已停用</option>
            </select>
            <Button onClick={() => setOpen(true)}>
              <LucidePlus className="mr-1 size-4" />
              新建租户
            </Button>
          </div>
        </header>

        {/* 列表 */}
        <Table rootClassName="max-h-[calc(100vh-240px)]">
          <TableHeader>
            <TableRow>
              <TableHead>租户名称</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>成员数</TableHead>
              <TableHead>知识库数</TableHead>
              <TableHead>智能体数</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="py-10 text-center text-sm text-text-secondary"
                >
                  {isFetching ? '加载中…' : '暂无租户'}
                </TableCell>
              </TableRow>
            )}
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium text-text-primary">
                  <div className="flex items-center gap-1.5">
                    <span className="min-w-0 truncate" title={row.name}>
                      {row.name}
                    </span>
                    <button
                      type="button"
                      title="重命名"
                      aria-label={`重命名租户 ${row.name}`}
                      onClick={() => {
                        setNewName(row.name);
                        setRenameError('');
                        setRenameDialog({
                          tenantId: row.id,
                          tenantName: row.name,
                        });
                      }}
                      className="shrink-0 rounded p-1 text-text-secondary transition-colors hover:bg-bg-base hover:text-text-primary"
                    >
                      <LucidePencil className="size-3.5" />
                    </button>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="text-text-primary">
                      {row.owner_name || '—'}
                    </span>
                    {row.owner_email && (
                      <span className="truncate text-xs text-text-secondary">
                        {row.owner_email}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <button
                    type="button"
                    onClick={() =>
                      setResourceDialog({
                        tenantId: row.id,
                        tenantName: row.name,
                        type: 'members',
                      })
                    }
                    className="text-text-primary underline-offset-2 hover:underline"
                  >
                    {row.member_count}
                  </button>
                </TableCell>
                <TableCell>
                  <button
                    type="button"
                    onClick={() =>
                      setResourceDialog({
                        tenantId: row.id,
                        tenantName: row.name,
                        type: 'kbs',
                      })
                    }
                    className="text-text-primary underline-offset-2 hover:underline"
                  >
                    {row.kb_count}
                  </button>
                </TableCell>
                <TableCell>
                  <button
                    type="button"
                    onClick={() =>
                      setResourceDialog({
                        tenantId: row.id,
                        tenantName: row.name,
                        type: 'agents',
                      })
                    }
                    className="text-text-primary underline-offset-2 hover:underline"
                  >
                    {row.agent_count}
                  </button>
                </TableCell>
                <TableCell>
                  <Badge variant={row.enabled ? 'success' : 'destructive'}>
                    {row.enabled ? '正常' : '已停用'}
                  </Badge>
                </TableCell>
                <TableCell className="text-text-secondary">
                  {formatDate(row.create_date)}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1 whitespace-nowrap">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setOwnerDialog({
                          tenantId: row.id,
                          tenantName: row.name,
                        })
                      }
                    >
                      设置超管
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setToggleDialog({
                          tenantId: row.id,
                          tenantName: row.name,
                          enabled: row.enabled,
                        })
                      }
                    >
                      {row.enabled ? '停用' : '启用'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setDeleteConfirmName('');
                        setDeleteDialog({
                          tenantId: row.id,
                          tenantName: row.name,
                        });
                      }}
                    >
                      删除
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="flex items-center justify-end pt-3">
          <RAGFlowPagination
            total={data?.total ?? 0}
            current={page}
            pageSize={pageSize}
            onChange={(nextPage, nextPageSize) => {
              setPage(nextPage);
              setPageSize(nextPageSize);
            }}
          />
        </div>
      </div>

      {/* 新建租户：不自动建账号，必须指定一个已有用户作为管理员 */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建租户</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label>租户名称</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：华夏基金"
                maxLength={100}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>管理员账户</Label>
              <select
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                className="h-9 rounded-md border border-border-default bg-bg-base px-3 text-sm text-text-primary outline-none"
              >
                <option value="">请选择用户</option>
                {(allUsers ?? []).map((user) => (
                  <option key={user.email} value={user.email}>
                    {user.email} · {user.nickname || '无昵称'} ·{' '}
                    {user.is_superuser ? '平台超管' : '普通用户'} ·{' '}
                    {user.tenant_name || '未分配租户'}
                  </option>
                ))}
              </select>
              <p className="text-xs text-text-secondary">
                不会自动创建账号。请先在「用户管理」里建好用户，再从这里选择。
              </p>
            </div>
            {error && <p className="text-sm text-text-primary">{error}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              onClick={() => {
                setError('');
                createMutation.mutate();
              }}
              disabled={
                !name.trim() || !ownerEmail.trim() || createMutation.isPending
              }
            >
              {createMutation.isPending ? '创建中…' : '确定'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 成员 / 知识库 / 智能体明细 */}
      <Dialog
        open={!!resourceDialog}
        onOpenChange={(next) => !next && setResourceDialog(null)}
      >
        <DialogContent className={resourceLayout?.width ?? 'max-w-3xl'}>
          <DialogHeader>
            <DialogTitle>
              {resourceDialog?.type === 'members'
                ? '成员列表'
                : resourceDialog?.type === 'kbs'
                  ? '知识库列表'
                  : '智能体列表'}
              {resourceDialog?.tenantName
                ? ` · ${resourceDialog.tenantName}`
                : ''}
            </DialogTitle>
          </DialogHeader>

          {resourcesLoading && (
            <p className="py-6 text-center text-sm text-text-secondary">
              加载中…
            </p>
          )}
          {!resourcesLoading && (resources?.length ?? 0) === 0 && (
            <p className="py-6 text-center text-sm text-text-secondary">
              暂无数据
            </p>
          )}

          {!resourcesLoading &&
            (resources?.length ?? 0) > 0 &&
            resourceDialog && (
              <div className="max-h-[420px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-bg-base">
                    <tr className="border-b border-border-default text-left text-xs text-text-secondary">
                      <th className="py-2 pr-4 font-normal">
                        {resourceLayout?.firstColumn}
                      </th>
                      {resourceLayout?.columns.map((col) => (
                        <th
                          key={col.key}
                          className="whitespace-nowrap py-2 pr-4 font-normal last:pr-0"
                        >
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {resources?.map((item) => {
                      // 昵称和邮箱都在时，邮箱降为副行；没有昵称时主行就是邮箱。
                      const email = item.cells?.email ?? '';
                      const subLine = email && email !== item.name ? email : '';
                      return (
                        <tr
                          key={item.id}
                          className="border-b border-border-default last:border-b-0"
                        >
                          <td className="py-2 pr-4">
                            <div className="max-w-[240px] truncate text-text-primary">
                              {item.name}
                            </div>
                            {subLine && (
                              <div className="max-w-[240px] truncate text-xs text-text-secondary">
                                {subLine}
                              </div>
                            )}
                          </td>
                          {resourceLayout?.columns.map((col) => (
                            <td
                              key={col.key}
                              className="whitespace-nowrap py-2 pr-4 text-text-secondary last:pr-0"
                            >
                              {resourceCellText(col.key, item.cells?.[col.key])}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
        </DialogContent>
      </Dialog>

      {/* 设置超管：从用户列表里选 */}
      <Dialog
        open={!!ownerDialog}
        onOpenChange={(next) => {
          if (!next) {
            setOwnerDialog(null);
            setNewOwnerEmail('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              设置超管
              {ownerDialog?.tenantName ? ` · ${ownerDialog.tenantName}` : ''}
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <Label>选择用户</Label>
            <select
              value={newOwnerEmail}
              onChange={(e) => setNewOwnerEmail(e.target.value)}
              className="h-9 rounded-md border border-border-default bg-bg-base px-3 text-sm text-text-primary outline-none"
            >
              <option value="">请选择</option>
              {(allUsers ?? []).map((user) => (
                <option key={user.email} value={user.email}>
                  {user.email} · {user.nickname || '无昵称'} ·{' '}
                  {user.is_superuser ? '平台超管' : '普通用户'} ·{' '}
                  {user.tenant_name || '未分配租户'}
                </option>
              ))}
            </select>
            <p className="text-xs text-text-secondary">
              原超管会降级为普通成员；该用户若还不在本租户，会被自动加入。
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setOwnerDialog(null);
                setNewOwnerEmail('');
              }}
            >
              取消
            </Button>
            <Button
              onClick={() => setOwnerMutation.mutate()}
              disabled={!newOwnerEmail || setOwnerMutation.isPending}
            >
              {setOwnerMutation.isPending ? '设置中…' : '确定'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* 重命名租户 */}
      <Dialog
        open={!!renameDialog}
        onOpenChange={(next) => {
          if (!next) {
            setRenameDialog(null);
            setNewName('');
            setRenameError('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              重命名租户
              {renameDialog?.tenantName ? ` · ${renameDialog.tenantName}` : ''}
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label>租户名称</Label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="例如：华夏基金"
              maxLength={100}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newName.trim()) {
                  setRenameError('');
                  renameMutation.mutate();
                }
              }}
            />
            <p className="text-xs text-text-secondary">
              改名后该租户下的所有成员看到的租户名称会同步变化，历史数据不受影响。
            </p>
            {renameError && (
              <p className="text-sm text-text-primary">{renameError}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRenameDialog(null);
                setNewName('');
                setRenameError('');
              }}
            >
              取消
            </Button>
            <Button
              onClick={() => {
                setRenameError('');
                renameMutation.mutate();
              }}
              disabled={!newName.trim() || renameMutation.isPending}
            >
              {renameMutation.isPending ? '保存中…' : '确定'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* 停用 / 启用确认 */}
      <Dialog
        open={!!toggleDialog}
        onOpenChange={(next) => {
          if (!next) {
            setToggleDialog(null);
            setActionError('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {toggleDialog?.enabled ? '停用' : '启用'}租户
              {toggleDialog?.tenantName ? ` · ${toggleDialog.tenantName}` : ''}
            </DialogTitle>
          </DialogHeader>

          <p className="text-sm text-text-secondary">
            {toggleDialog?.enabled
              ? '停用后该租户下所有用户都将无法访问该租户（含租户管理员），数据全部保留，重新启用即可恢复。'
              : '启用后该租户下的成员恢复正常访问。'}
          </p>
          {actionError && (
            <p className="text-sm text-text-primary">{actionError}</p>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setToggleDialog(null);
                setActionError('');
              }}
            >
              取消
            </Button>
            <Button
              onClick={() => {
                setActionError('');
                toggleMutation.mutate();
              }}
              disabled={toggleMutation.isPending}
            >
              {toggleMutation.isPending
                ? '处理中…'
                : toggleDialog?.enabled
                  ? '确认停用'
                  : '确认启用'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认：有数据资产时只展示清单，不允许删 */}
      <Dialog
        open={!!deleteDialog}
        onOpenChange={(next) => {
          if (!next) {
            setDeleteDialog(null);
            setDeleteConfirmName('');
            setActionError('');
          }
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              删除租户
              {deleteDialog?.tenantName ? ` · ${deleteDialog.tenantName}` : ''}
            </DialogTitle>
          </DialogHeader>

          {assetsLoading && (
            <p className="py-4 text-sm text-text-secondary">
              正在盘点该租户下的数据…
            </p>
          )}

          {!assetsLoading && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-text-primary">
                {blockingItems.length > 0
                  ? '该租户下仍有数据，请先清理后再删除：'
                  : '该租户下没有阻断性数据，可以删除。删除后成员关系会一并移除，且不可恢复。'}
              </p>

              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-default text-left text-xs text-text-secondary">
                    <th className="py-2 pr-4 font-normal">数据项</th>
                    <th className="py-2 pr-4 font-normal">数量</th>
                    <th className="py-2 font-normal">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {(assets ?? []).map((item) => {
                    const blocked = item.blocking && item.count > 0;
                    return (
                      <tr
                        key={item.key}
                        className="border-b border-border-default last:border-b-0"
                      >
                        <td className="py-2 pr-4 text-text-primary">
                          {item.label}
                        </td>
                        <td className="py-2 pr-4 text-text-primary">
                          {item.count}
                        </td>
                        <td className="py-2 text-text-secondary">
                          {item.count === 0
                            ? '无'
                            : blocked
                              ? '需先清理'
                              : '可随租户一起移除'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {blockingItems.length === 0 && (
                <div className="flex flex-col gap-2">
                  <Label>
                    请输入租户名称确认：
                    <span className="ml-1 text-text-primary">
                      {deleteDialog?.tenantName}
                    </span>
                  </Label>
                  <Input
                    value={deleteConfirmName}
                    onChange={(e) => setDeleteConfirmName(e.target.value)}
                    placeholder={deleteDialog?.tenantName ?? ''}
                  />
                </div>
              )}

              {actionError && (
                <p className="text-sm text-text-primary">{actionError}</p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteDialog(null);
                setDeleteConfirmName('');
                setActionError('');
              }}
            >
              取消
            </Button>
            <Button
              onClick={() => {
                setActionError('');
                deleteMutation.mutate();
              }}
              disabled={
                assetsLoading ||
                blockingItems.length > 0 ||
                deleteConfirmName.trim() !==
                  (deleteDialog?.tenantName ?? '').trim() ||
                deleteMutation.isPending
              }
            >
              {deleteMutation.isPending ? '删除中…' : '确认删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
