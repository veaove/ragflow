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
  member_count: number;
  permissions: RolePermissionRow[];
}

// ── 组织架构 ────────────────────────────────────────────────────────────────

export const fetchDepartments = (tenantId: string) =>
  request.get<ResponseData<{ departments: DepartmentNode[] }>>(
    api.tenantDepartments(tenantId),
  );

export const createDepartment = (
  tenantId: string,
  body: { name: string; parent_id?: string; sort?: number },
) => request.post<ResponseData<DepartmentNode>>(
  api.tenantDepartments(tenantId),
  body,
);

export const updateDepartment = (
  tenantId: string,
  id: string,
  body: { name?: string; parent_id?: string; sort?: number },
) => request.put<ResponseData<{ id: string }>>(
  api.tenantDepartment(tenantId, id),
  body,
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
) => request.get<ResponseData<{ members: ConsoleMember[]; total: number }>>(
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
  },
) => request.put<ResponseData<{ user_id: string }>>(
  api.tenantConsoleMember(tenantId, userId),
  body,
);

/** 移除成员：复用现有的 DELETE /tenants/:id/users（body 传 user_id）。 */
export const removeConsoleMember = (tenantId: string, userId: string) =>
  request.delete<ResponseData<unknown>>(api.tenantMembers(tenantId), {
    data: { user_id: userId },
  });

// ── 角色权限 ────────────────────────────────────────────────────────────────

export const fetchConsoleRoles = (tenantId: string) =>
  request.get<ResponseData<{ roles: ConsoleRole[]; modules: string[] }>>(
    api.tenantConsoleRoles(tenantId),
  );

export const createConsoleRole = (
  tenantId: string,
  body: { name: string; description?: string; grant?: Record<string, string> },
) => request.post<ResponseData<{ id: string }>>(
  api.tenantConsoleRoles(tenantId),
  body,
);

export const updateConsoleRole = (
  tenantId: string,
  id: string,
  body: { name?: string; description?: string },
) => request.put<ResponseData<{ id: string }>>(
  api.tenantConsoleRole(tenantId, id),
  body,
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
  { permissions },
);

// ── 资源授权 ────────────────────────────────────────────────────────────────

/** 授权主体：全团队 / 某个部门 / 某个成员。 */
export interface GrantSubject {
  kind: 'team' | 'department' | 'user';
  id: string;
  name: string;
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
) => request.get<ResponseData<{ resources: GrantResource[]; total: number }>>(
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
  { subjects },
);

/** 移除成员后由管理员重置密码：password 需先用 rsaPsw 加密。 */
export const resetMemberPassword = (
  tenantId: string,
  userId: string,
  encryptedPassword: string,
) => request.put<ResponseData<{ user_id: string }>>(
  api.tenantConsoleMemberPassword(tenantId, userId),
  { password: encryptedPassword },
);

/**
 * 直接添加已注册用户为成员（无需对方接受邀请）。
 * role 走枚举 owner/admin/normal，与 user_tenant.role 一致。
 */
export const addTenantMember = (
  tenantId: string,
  body: { email: string; role?: string },
) => request.post<ResponseData<unknown>>(api.tenantAddMember(tenantId), body);

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
  request.get<ResponseData<MyPermissions>>(
    api.tenantMyPermissions(tenantId),
  );
