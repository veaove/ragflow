import api from '@/utils/api';
import request from '@/utils/request';

/**
 * 后端统一响应包。各 service 文件各自声明一份（`admin-service` 里的同名类型
 * 没有导出），保持零耦合。
 */
type ResponseData<D = NonNullable<unknown>> = {
  code: number;
  message: string;
  data: D;
};

/**
 * `request` 用的是 umi-request 的 `getResponse: true`：
 * 运行时 resolve 值是 `{ data: <响应体>, response }`，但 umi 的类型声明
 * 只写了业务类型，不含这层包裹。不加这个别名，页面里 `res.data.roles`
 * 会在运行时拿到 undefined —— 类型检查却是通过的，列表静默显示为空。
 */
type ApiEnvelope<D = NonNullable<unknown>> = { data: ResponseData<D> };

/** 部门树节点（后端已按 parent_id 组装好 children）。 */
export interface DepartmentNode {
  id: string;
  name: string;
  parent_id: string;
  member_count: number;
  children?: DepartmentNode[];
}

/** 成员行：租户归属 + 部门 + 角色一次查齐。 */
export interface ConsoleMember {
  id: string;
  nickname: string;
  email: string;
  department_id: string;
  department_name: string;
  position: string;
  role_id: string;
  role_name: string;
  /** 枚举角色 owner/admin/normal，与自定义角色并存。 */
  role: string;
  status: string;
  create_time: number;
}

/** 权限矩阵一行：模块 + 五个动作。 */
export interface RolePermissionRow {
  module: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_manage: boolean;
}

export interface ConsoleRole {
  id: string;
  name: string;
  description: string;
  is_builtin: boolean;
  /** 系统级内置角色（Owner）：完全不可编辑不可删除。is_system implies is_builtin。 */
  is_system?: boolean;
  member_count: number;
  permissions: RolePermissionRow[];
}

// ── 组织架构 ────────────────────────────────────────────────────────────────

export const fetchDepartments = (tenantId: string) =>
  request.get<ApiEnvelope<{ departments: DepartmentNode[] }>>(
    api.tenantDepartments(tenantId),
  );

export const createDepartment = (
  tenantId: string,
  body: { name: string; parent_id?: string; sort?: number },
) => request.post<ResponseData<DepartmentNode>>(
  api.tenantDepartments(tenantId),
  { data: body },
);

export const updateDepartment = (
  tenantId: string,
  id: string,
  body: { name?: string; parent_id?: string; sort?: number },
) => request.put<ResponseData<{ id: string }>>(
  api.tenantDepartment(tenantId, id),
  { data: body },
);

export const deleteDepartment = (tenantId: string, id: string) =>
  request.delete<ResponseData<{ id: string }>>(
    api.tenantDepartment(tenantId, id),
  );

// ── 成员 ────────────────────────────────────────────────────────────────────

export const fetchConsoleMembers = (
  tenantId: string,
  params: {
    page?: number;
    page_size?: number;
    keywords?: string;
    department_id?: string;
    role_id?: string;
    status?: string;
  },
) => request.get<ApiEnvelope<{ members: ConsoleMember[]; total: number }>>(
  api.tenantConsoleMembers(tenantId),
  { params },
);

export const updateConsoleMember = (
  tenantId: string,
  userId: string,
  body: {
    department_id?: string;
    position?: string;
    role_id?: string;
    status?: string;
    /** 账号昵称；传空串表示清空，列表回落到邮箱显示 */
    nickname?: string;
  },
) => request.put<ResponseData<{ user_id: string }>>(
  api.tenantConsoleMember(tenantId, userId),
  { data: body },
);

/** 移除成员：复用现有的 DELETE /tenants/:id/users（body 传 user_id）。 */
export const removeConsoleMember = (tenantId: string, userId: string) =>
  request.delete<ResponseData<unknown>>(api.tenantMembers(tenantId), {
    data: { user_id: userId },
  });

// ── 角色权限 ────────────────────────────────────────────────────────────────

export const fetchConsoleRoles = (tenantId: string) =>
  request.get<ApiEnvelope<{ roles: ConsoleRole[]; modules: string[] }>>(
    api.tenantConsoleRoles(tenantId),
  );

export const createConsoleRole = (
  tenantId: string,
  body: { name: string; description?: string; grant?: Record<string, string> },
) => request.post<ResponseData<{ id: string }>>(
  api.tenantConsoleRoles(tenantId),
  { data: body },
);

export const updateConsoleRole = (
  tenantId: string,
  id: string,
  body: { name?: string; description?: string },
) => request.put<ResponseData<{ id: string }>>(
  api.tenantConsoleRole(tenantId, id),
  { data: body },
);

export const deleteConsoleRole = (tenantId: string, id: string) =>
  request.delete<ResponseData<{ id: string }>>(
    api.tenantConsoleRole(tenantId, id),
  );

export const saveConsolePermissions = (
  tenantId: string,
  id: string,
  permissions: RolePermissionRow[],
) => request.put<ResponseData<{ id: string }>>(
  api.tenantConsoleRolePermissions(tenantId, id),
  { data: { permissions } },
);

// ── 资源授权 ────────────────────────────────────────────────────────────────

/** 授权主体：全团队 / 某个部门 / 某个成员。 */
/**
 * 一次资源授权的授予对象。
 *
 * permission 是操作级别：
 *   read —— 只能查看（内容不可编辑、不可删除、不可再授权）
 *   edit —— 可以编辑、删除
 * 后端对空值按 edit 处理，兼容这个字段出现之前已存在的授权。
 */
export interface GrantSubject {
  kind: 'team' | 'department' | 'user';
  id: string;
  name: string;
  permission?: 'read' | 'edit';
}

/** 一行资源 + 它当前的授权规则。 */
export interface GrantResource {
  resource_id: string;
  resource_name: string;
  owner_id: string;
  owner_name: string;
  /** 旧二值语义：private（仅自己）/ team（全团队），没有显式规则时由它决定。 */
  default_scope: string;
  grants: GrantSubject[];
  update_time: number;
}

export const fetchGrants = (
  tenantId: string,
  params: {
    kind: 'dataset' | 'canvas' | 'memory';
    keywords?: string;
    page?: number;
    page_size?: number;
  },
) => request.get<ApiEnvelope<{ resources: GrantResource[]; total: number }>>(
  api.tenantGrants(tenantId),
  { params },
);

/**
 * 整体覆盖某个资源的授权规则。传空数组表示撤销所有显式规则，
 * 回到 `default_scope` 决定的默认可见性。
 */
export const setGrants = (
  tenantId: string,
  kind: 'dataset' | 'canvas' | 'memory',
  resourceId: string,
  subjects: GrantSubject[],
) => request.put<ResponseData<{ resource_id: string }>>(
  api.tenantGrant(tenantId, kind, resourceId),
  { data: { subjects } },
);

/** 移除成员后由管理员重置密码：password 需先用 rsaPsw 加密。 */
export const resetMemberPassword = (
  tenantId: string,
  userId: string,
  encryptedPassword: string,
) => request.put<ResponseData<{ user_id: string }>>(
  api.tenantConsoleMemberPassword(tenantId, userId),
  { data: { password: encryptedPassword } },
);

/**
 * 直接添加已注册用户为成员（无需对方接受邀请）。
 *
 * 两种方式二选一：
 * - `role`：枚举 normal / admin（不带 role_id）
 * - `role_id`：指定任意租户角色（含自定义），后端会据此推导枚举
 */
export const addTenantMember = (
  tenantId: string,
  body: { email: string; role?: string; role_id?: string },
) => request.post<ResponseData<unknown>>(api.tenantAddMember(tenantId), { data: body });

// ── Owner 移交 ──────────────────────────────────────────────────────────────

/** 当前 owner 把权限移交给本租户内另一个成员。 */
export const transferTenantOwner = (
  tenantId: string,
  targetUserId: string,
) => request.post<ResponseData<{
  tenant_id: string;
  new_owner_id: string;
  old_owner_id: string;
  old_owner_role: string;
}>>(api.tenantTransferOwner(tenantId), { target_user_id: targetUserId });

// ── 当前用户权限 ────────────────────────────────────────────────────────────

/** 当前用户在租户内的有效权限矩阵。 */
export interface MyPermissions {
  role: string;
  role_id: string;
  role_name: string;
  /** module -> 五个动作；未出现的模块视为"未配置"。 */
  modules: Record<string, RolePermissionRow>;
}

export const fetchMyPermissions = (tenantId: string) =>
  request.get<ApiEnvelope<MyPermissions>>(
    api.tenantMyPermissions(tenantId),
  );

// ── 权限变更记录 ────────────────────────────────────────────────────────────

/** 审计记录（权限相关的 object_type 由前端过滤）。 */
export interface AuditEntry {
  id: string;
  action: string;
  object_type: string;
  object_id: string;
  operator: string;
  result?: string;
  ip_address?: string;
  create_time: number;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export const fetchConsoleAudits = (params: {
  page?: number;
  page_size?: number;
  object_type?: string;
}) =>
  request.get<ApiEnvelope<AuditEntry[]>>(api.audits, { params });
