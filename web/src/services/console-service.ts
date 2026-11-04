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
) =>
  request.post<ResponseData<DepartmentNode>>(api.tenantDepartments(tenantId), {
    data: body,
  });

export const updateDepartment = (
  tenantId: string,
  id: string,
  body: { name?: string; parent_id?: string; sort?: number },
) =>
  request.put<ResponseData<{ id: string }>>(
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
) =>
  request.get<ApiEnvelope<{ members: ConsoleMember[]; total: number }>>(
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
) =>
  request.put<ResponseData<{ user_id: string }>>(
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
) =>
  request.post<ResponseData<{ id: string }>>(api.tenantConsoleRoles(tenantId), {
    data: body,
  });

export const updateConsoleRole = (
  tenantId: string,
  id: string,
  body: { name?: string; description?: string },
) =>
  request.put<ResponseData<{ id: string }>>(
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
) =>
  request.put<ResponseData<{ id: string }>>(
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
  /**
   * 规则取向：allow 授予、deny 排除。
   *
   * 只有文件级授权支持 deny —— 库级的「不给」用清空授权表达，多一个入口
   * 只会让优先级无从解释。deny 压过同一资源上的任何 allow。
   */
  effect?: 'allow' | 'deny';
}

/**
 * 三级可见性（收窄语义）。
 *
 * - owner：仅资源所有者与平台超级管理员可见
 * - tenant_owner：资源所有者 + 本租户 owner / 管理员 + 平台超级管理员
 * - platform：同 tenant_owner，另供平台侧跨租户视图
 *
 * 普通成员不在任何一档里，要看到别人的资源必须逐人 / 逐部门授权。
 */
export type GrantVisibility = 'owner' | 'tenant_owner' | 'platform';

/** 一行资源 + 它当前的授权规则。 */
export interface GrantResource {
  resource_id: string;
  resource_name: string;
  owner_id: string;
  owner_name: string;
  /** 三级可见性；空串表示这类资源不参与三档（仅逐人授权）。 */
  visibility?: GrantVisibility | '';
  /** 旧二值语义：private（仅自己）/ team（全团队），保留给未升级的读法。 */
  default_scope: string;
  /** 能否写「排除」规则；由后端注册表决定。 */
  supports_deny?: boolean;
  grants: GrantSubject[];
  update_time: number;
}

/** 资源授权页的一个 Tab：由后端注册表给出，前端不再硬编码。 */
export interface GrantKindOption {
  kind: string;
  label: string;
  supports_visibility: boolean;
}

/** 后端登记的全部可授权资源类型（顺序即 Tab 顺序）。 */
export const fetchGrantKinds = (tenantId: string) =>
  request.get<ApiEnvelope<{ kinds: GrantKindOption[] }>>(
    api.tenantGrantKinds(tenantId),
  );

/** 写入三级可见性；不支持三档的资源会返回错误。 */
export const setGrantVisibility = (
  tenantId: string,
  kind: string,
  resourceId: string,
  visibility: GrantVisibility,
) =>
  request.put<
    ResponseData<{ resource_id: string; visibility: GrantVisibility }>
  >(api.tenantGrantVisibility(tenantId, kind, resourceId), {
    data: { visibility },
  });

export const fetchGrants = (
  tenantId: string,
  params: {
    kind: string;
    keywords?: string;
    page?: number;
    page_size?: number;
  },
) =>
  request.get<ApiEnvelope<{ resources: GrantResource[]; total: number }>>(
    api.tenantGrants(tenantId),
    { params },
  );

/**
 * 整体覆盖某个资源的授权规则。传空数组表示撤销所有显式规则，
 * 回到 `default_scope` 决定的默认可见性（文件级即回到继承知识库）。
 *
 * `parentId` 只在文件级（kind=document）时传，是文件所属的知识库 id。
 */
export const setGrants = (
  tenantId: string,
  kind: string,
  resourceId: string,
  subjects: GrantSubject[],
  parentId?: string,
) =>
  request.put<ResponseData<{ resource_id: string }>>(
    api.tenantGrant(tenantId, kind, resourceId),
    { data: parentId ? { subjects, parent_id: parentId } : { subjects } },
  );

/** 树上徽章的色调：后端只给语义，前端只取色。 */
export type GrantTone = 'owner' | 'visible' | 'exception' | 'inherit';

export interface GrantNodeSummary {
  tone: GrantTone;
  label: string;
}

/**
 * 资源树上的一行。
 *
 * 树只画层级骨架：知识库 → 文件夹，文件管理 → 文件夹 → 文件。文件不进知识库
 * 的树（一个库 44 个文件会把树撑爆），要逐项确认时走「子项例外」的查看全部。
 */
export interface GrantTreeNode {
  id: string;
  name: string;
  /** dataset / folder / file */
  node_kind: string;
  /** 可授权的 resource_kind；空串表示这一层不单独授权（知识库内的文件夹）。 */
  grant_kind?: string;
  parent_id?: string;
  /** 写文件级规则时要带上的所属知识库 id。 */
  parent_grant_id?: string;
  owner_name?: string;
  visibility?: GrantVisibility | '';
  supports_visibility: boolean;
  /** 能否写「排除」规则；由后端 grantDenyKinds 决定。 */
  supports_deny?: boolean;
  file_count: number;
  exception_count: number;
  summary: GrantNodeSummary;
  grants: GrantSubject[];
  children?: GrantTreeNode[];
}

export interface GrantTree {
  kind: string;
  label: string;
  nodes: GrantTreeNode[];
  total: number;
  file_total: number;
  exception_total: number;
}

export interface GrantExceptionItem {
  resource_id: string;
  resource_name: string;
  grant_kind: string;
  node_kind: string;
  /** 能否写「排除」规则（库内文件可以，文件管理的文件不可以）。 */
  supports_deny?: boolean;
  parent_grant_id?: string;
  /** 文件夹路径，用于区分同名文件。 */
  path?: string;
  suffix?: string;
  size?: number;
  restricted: boolean;
  grants: GrantSubject[];
}

export interface GrantExceptionPage {
  items: GrantExceptionItem[];
  total: number;
  file_total: number;
  exception_total: number;
}

/** 一次全部取回：树要一次画完，分页会退化成点一层查一次。 */
export const fetchGrantTree = (
  tenantId: string,
  params: { kind: string; keywords?: string },
) =>
  request.get<ApiEnvelope<GrantTree>>(api.tenantGrantTree(tenantId), {
    params,
  });

/** includeAll=true 用于「查看全部文件」，默认只返回有独立规则的子项。 */
export const fetchGrantExceptions = (
  tenantId: string,
  params: {
    kind: string;
    dataset_id?: string;
    folder_id?: string;
    keywords?: string;
    all?: boolean;
    page?: number;
    page_size?: number;
  },
) =>
  request.get<ApiEnvelope<GrantExceptionPage>>(
    api.tenantGrantExceptions(tenantId),
    {
      params: {
        ...params,
        all: params.all ? 1 : undefined,
      },
    },
  );

/** 一行可见来源：同一资源经不同路径到达同一个人时分多行。 */
export interface GrantSubjectRow {
  resource_kind: string;
  resource_id: string;
  resource_name: string;
  parent_name?: string;
  permission: 'read' | 'edit';
  effect: 'allow' | 'deny';
  via: 'direct' | 'department' | 'team';
  via_name?: string;
}

export interface GrantBySubjectResult {
  subject_kind: GrantSubject['kind'];
  subject_id: string;
  subject_name: string;
  rows: GrantSubjectRow[];
  direct: number;
  department: number;
  team: number;
}

export const fetchGrantsBySubject = (
  tenantId: string,
  params: { subject_kind?: string; subject_id: string },
) =>
  request.get<ApiEnvelope<GrantBySubjectResult>>(
    api.tenantGrantsBySubject(tenantId),
    { params },
  );

/** 移除成员后由管理员重置密码：password 需先用 rsaPsw 加密。 */
export const resetMemberPassword = (
  tenantId: string,
  userId: string,
  encryptedPassword: string,
) =>
  request.put<ResponseData<{ user_id: string }>>(
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
) =>
  request.post<ResponseData<unknown>>(api.tenantAddMember(tenantId), {
    data: body,
  });

// ── Owner 移交 ──────────────────────────────────────────────────────────────

/** 当前 owner 把权限移交给本租户内另一个成员。 */
export const transferTenantOwner = (tenantId: string, targetUserId: string) =>
  request.post<
    ResponseData<{
      tenant_id: string;
      new_owner_id: string;
      old_owner_id: string;
      old_owner_role: string;
    }>
  >(api.tenantTransferOwner(tenantId), { target_user_id: targetUserId });

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
  request.get<ApiEnvelope<MyPermissions>>(api.tenantMyPermissions(tenantId));

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
}) => request.get<ApiEnvelope<AuditEntry[]>>(api.audits, { params });
