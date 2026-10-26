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

import { history } from '@/utils/simple-history-util';
import axios from 'axios';

import message from '@/components/ui/message';
import { Authorization } from '@/constants/authorization';
import i18n from '@/locales/config';
import { Routes } from '@/routes';
import api from '@/utils/api';
import authorizationUtil, {
  getAuthorization,
} from '@/utils/authorization-util';
import { convertTheKeysOfTheObjectToSnake } from '@/utils/common-util';
import { ResultCode, RetcodeMessage } from '@/utils/request';
import {
  adaptServiceDetail,
  adaptServiceList,
  GoServiceStatus,
} from './admin-service-adapter';

const request = axios.create({
  timeout: 300000,
});

request.interceptors.request.use((config) => {
  const data = convertTheKeysOfTheObjectToSnake(config.data);
  const params = convertTheKeysOfTheObjectToSnake(config.params) as any;

  const newConfig = { ...config, data, params };

  // @ts-ignore
  if (!newConfig.skipToken) {
    newConfig.headers.set(Authorization, getAuthorization());
  }

  return newConfig;
});

request.interceptors.response.use(
  (response) => {
    if (response.config.responseType === 'blob') {
      return response;
    }

    const { data } = response ?? {};

    if (data?.code === 100) {
      message.error(data?.message);
    } else if (data?.code === 401) {
      message.error(data?.message, {
        description: data?.message,
      });

      authorizationUtil.removeAll();
      history.push(Routes.Admin);
      window.location.reload();
    } else if (data?.code && data.code !== 0) {
      message.error(`${i18n.t('message.hint')}: ${data?.code}`, {
        description: data?.message,
      });
    }

    return response;
  },
  (error) => {
    const { response } = error;
    const { data } = response ?? {};

    if (error.message === 'Failed to fetch') {
      message.error({
        description: i18n.t('message.networkAnomalyDescription'),
        message: i18n.t('message.networkAnomaly'),
      });
    } else if (data?.code === 100) {
      message.error(data?.message);
    } else if (response.status === 401 || data?.code === 401) {
      message.error({
        message: data?.message || response.statusText,
        description:
          data?.message || RetcodeMessage[response?.status as ResultCode],
        duration: 3,
      });

      authorizationUtil.removeAll();
      history.push(Routes.Admin);
      window.location.reload();
    } else if (data?.code && data.code !== 0) {
      message.error({
        message: `${i18n.t('message.hint')}: ${data?.code}`,
        description: data?.message,
        duration: 3,
      });
    } else if (response.status) {
      message.error({
        message: `${i18n.t('message.requestError')} ${response.status}: ${response.config.url}`,
        description:
          RetcodeMessage[response.status as ResultCode] || response.statusText,
      });
    } else if (response.status === 413 || response?.status === 504) {
      message.error(RetcodeMessage[response?.status as ResultCode]);
    }

    throw error;
  },
);

const {
  adminLogin,
  adminLogout,
  adminListUsers,
  adminCreateUser,
  adminGetUserDetails,
  adminUpdateUserStatus,
  adminUpdateUserPassword,
  adminDeleteUser,
  adminListUserDatasets,
  adminListUserAgents,

  adminListServices,
  adminShowServiceDetails,

  adminListRoles,
  adminListRolesWithPermission,
  adminCreateRole,
  adminDeleteRole,
  adminUpdateRoleDescription,
  adminGetRolePermissions,
  adminAssignRolePermissions,
  adminRevokeRolePermissions,

  adminGetUserPermissions,
  adminUpdateUserRole,

  adminListResources,

  adminListWhitelist,
  adminCreateWhitelistEntry,
  adminUpdateWhitelistEntry,
  adminDeleteWhitelistEntry,
  adminImportWhitelist,

  adminGetSystemVersion,

  adminListSandboxProviders,
  adminGetSandboxProviderSchema,
  adminGetSandboxConfig,
  adminSetSandboxConfig,
  adminTestSandboxConnection,
} = api;

type ResponseData<D = NonNullable<unknown>> = {
  code: number;
  message: string;
  data: D;
};

export const login = (params: {
  email: string;
  password: string;
  /** 图形验证码：captcha_id 由 GET /auth/captcha 下发，captcha 是用户输入的字符。 */
  captcha_id?: string;
  captcha?: string;
}) => request.post<ResponseData<AdminService.LoginData>>(adminLogin, params);

/** 登录页图形验证码：一次性消费，60 秒有效。与前台登录页同一个接口。 */
export const getCaptcha = () =>
  request.get<ResponseData<{ captcha_id: string; captcha_image: string }>>(
    '/api/v1/auth/captcha',
  );
export const logout = () => request.post<ResponseData<boolean>>(adminLogout);
export const listUsers = () =>
  request.get<ResponseData<AdminService.ListUsersItem[]>>(adminListUsers, {});

export interface TenantListItem {
  id: string;
  name: string;
  member_count: number;
  kb_count: number;
  agent_count: number;
  status: string;
  /** 租户启停开关。与 status（软删除标记）无关：停用后记录仍在，但拒绝访问。 */
  enabled: boolean;
  create_date: number;
}

/** 平台租户列表（含成员/知识库/智能体计数）。 */
export const listTenants = (params: {
  page?: number;
  page_size?: number;
  keyword?: string;
  status?: string;
  /** '1' 只看启用 / '0' 只看停用 / 空 全部 */
  enabled?: string;
}) =>
  request.get<ResponseData<{ list: TenantListItem[]; total: number }>>(
    api.adminListTenants,
    { params },
  );

/** 新建租户，并把指定邮箱的用户设为管理员（不自动建账号）。 */
export const createTenant = (name: string, ownerEmail: string) =>
  request.post<ResponseData<{ id: string; name: string; owner_email: string }>>(
    api.adminCreateTenant,
    { name, owner_email: ownerEmail },
  );

/** 删除前置检查：租户名下的数据资产盘点。blocking 为真且 count>0 时禁止删除。 */
export interface TenantAssetItem {
  key: string;
  label: string;
  count: number;
  blocking: boolean;
}

/** 盘点某租户的数据资产（删除前用它决定「能删」还是「先清理」）。 */
export const getTenantResourceSummary = (tenantId: string) =>
  request.get<ResponseData<TenantAssetItem[]>>(
    `${api.adminListTenants}/${tenantId}/resource-summary`,
    {},
  );

/**
 * 启用 / 停用租户。
 *
 * 停用后该租户下所有用户都无法访问该租户（后端接口级拦截），
 * 但数据全部保留，重新启用即恢复。
 */
export const setTenantEnabled = (tenantId: string, enabled: boolean) =>
  request.put<ResponseData<{ id: string; enabled: boolean }>>(
    `${api.adminListTenants}/${tenantId}/enabled`,
    { enabled },
  );

/**
 * 修改租户名称。
 *
 * 名称只有一处真值（后端 tenant.name），改完列表与成员侧看到的租户名同步生效。
 */
export const updateTenantName = (tenantId: string, name: string) =>
  request.put<ResponseData<{ id: string; name: string }>>(
    `${api.adminListTenants}/${tenantId}/name`,
    { name },
  );

/**
 * 删除租户。
 *
 * 有数据资产时后端返回 code!=0，并把盘点结果放在 data 里，
 * 调用方据此渲染「请先清理」清单。
 */
export const deleteTenant = (tenantId: string) =>
  request.delete<ResponseData<{ id: string } | TenantAssetItem[] | null>>(
    `${api.adminListTenants}/${tenantId}`,
  );

export interface TenantResourceItem {
  id: string;
  /** 列表主列：成员是昵称（没昵称则邮箱），知识库 / 画布是名称。 */
  name: string;
  /** 右侧摘要，保留给不按列渲染的场景。 */
  extra: string;
  /**
   * 「一列一个值」的明细，按资源类型给不同的键：
   *   members -> email / role / status / last_login / joined
   *   kbs     -> docs / chunks / parser / embedding / status / creator / created / updated
   *   agents  -> category / created
   * 文本（角色、状态、时间）后端已经格式化好，前端只负责排版。
   */
  cells?: Record<string, string>;
}

/** 查看某租户下的成员 / 知识库 / 智能体明细。 */
export const listTenantResources = (
  tenantId: string,
  type: 'members' | 'kbs' | 'agents',
) =>
  request.get<ResponseData<TenantResourceItem[]>>(
    `${api.adminListTenants}/${tenantId}/resources`,
    { params: { type } },
  );

/** 把指定用户设为租户超管（原超管降级为普通成员）。 */
export const setTenantOwner = (tenantId: string, userEmail: string) =>
  request.put<ResponseData<{ tenant_id: string; owner_email: string }>>(
    `${api.adminListTenants}/${tenantId}/owner`,
    { user_email: userEmail },
  );

/** 一条「某租户正在使用某模型」的事实。 */
export interface ModelReference {
  tenant_id: string;
  tenant_name: string;
  provider_name: string;
  /** 租户给该厂商起的接入实例名，可能为空（历史 tenant_llm 数据没有实例概念）。 */
  instance_name: string;
  /** chat / embedding / asr / vision / rerank / tts / ocr / unknown */
  model_type: string;
  status: string;
  /** tenant_model = 现行模型配置，tenant_llm = 历史表 */
  source: 'tenant_model' | 'tenant_llm';
}

/** 平台模型目录的一行 + 引用汇总。 */
export interface PlatformModelItem {
  llm_name: string;
  llm_factory: string;
  model_types: string[];
  context_length: number | null;
  max_output: number | null;
  /** false 表示租户自建 provider 添加的模型，平台目录里没有 */
  in_catalog: boolean;
  reference_count: number;
  tenant_count: number;
  references: ModelReference[];
}

export interface PlatformModelSummary {
  model_total: number;
  factory_total: number;
  referenced_model_total: number;
  tenant_total: number;
  tenant_with_model_total: number;
}

export interface ModelFactorySummary {
  name: string;
  model_count: number;
  referenced_count: number;
}

export interface ModelTypeSummary {
  value: string;
  count: number;
}

export interface PlatformModelPage {
  list: PlatformModelItem[];
  total: number;
  summary: PlatformModelSummary;
  factories: ModelFactorySummary[];
  model_types: ModelTypeSummary[];
}

/**
 * 平台模型目录 + 各租户引用情况。
 *
 * 目录来自二进制里的 conf/models（不落库），因此筛选和分页都在服务端做；
 * 前端只负责把 filters 原样带上。
 */
export const listPlatformModels = (params: {
  page?: number;
  page_size?: number;
  keyword?: string;
  model_type?: string;
  factory?: string;
  /** '1' 只看被租户引用过的模型 */
  referenced?: string;
}) =>
  request.get<ResponseData<PlatformModelPage>>(api.adminListPlatformModels, {
    params,
  });

export const createUser = (email: string, password: string, tenantId: string) =>
  request.post<ResponseData<boolean>>(adminCreateUser, {
    username: email,
    password,
    tenant_id: tenantId,
  });

export const grantSuperuser = (email: string) =>
  request.put<ResponseData<void>>(api.adminSetSuperuser(email));

export const revokeSuperuser = (email: string) =>
  request.delete<ResponseData<void>>(api.adminSetSuperuser(email));

export const getUserDetails = (email: string) =>
  request.get<ResponseData<[AdminService.UserDetail]>>(
    adminGetUserDetails(email),
  );
export const listUserDatasets = (email: string) =>
  request.get<ResponseData<AdminService.ListUserDatasetItem[]>>(
    adminListUserDatasets(email),
  );
export const listUserAgents = (email: string) =>
  request.get<ResponseData<AdminService.ListUserAgentItem[]>>(
    adminListUserAgents(email),
  );
export const updateUserStatus = (email: string, status: 'on' | 'off') =>
  request.put(adminUpdateUserStatus(email), { activate_status: status });
export const updateUserPassword = (email: string, password: string) =>
  request.put(adminUpdateUserPassword(email), { new_password: password });
export const deleteUser = (email: string) =>
  request.delete(adminDeleteUser(email));

export const listServices = async () => {
  const { data } =
    await request.get<
      ResponseData<AdminService.ListServicesItem[] | GoServiceStatus[]>
    >(adminListServices);
  return data.code === 0 ? adaptServiceList(data.data) : [];
};
export const showServiceDetails = async (serviceId: number | string) => {
  const { data } = await request.get<
    ResponseData<AdminService.ServiceDetail | GoServiceStatus>
  >(adminShowServiceDetails(encodeURIComponent(String(serviceId))));
  return data.code === 0 ? adaptServiceDetail(data.data) : undefined;
};

export const createRole = (params: {
  roleName: string;
  description?: string;
}) =>
  request.post<ResponseData<AdminService.RoleDetail>>(adminCreateRole, params);
export const updateRoleDescription = (role: string, description: string) =>
  request.put<ResponseData<AdminService.RoleDetail>>(
    adminUpdateRoleDescription(role),
    { description },
  );
export const deleteRole = (role: string) =>
  request.delete<ResponseData<ResponseData<never>>>(adminDeleteRole(role));
export const listRoles = () =>
  request.get<
    ResponseData<{ roles: AdminService.ListRoleItem[]; total: number }>
  >(adminListRoles);
export const listRolesWithPermission = () =>
  request.get<
    ResponseData<{
      roles: AdminService.ListRoleItemWithPermission[];
      total: number;
    }>
  >(adminListRolesWithPermission);
export const getRolePermissions = (role: string) =>
  request.get<ResponseData<AdminService.RoleDetailWithPermission>>(
    adminGetRolePermissions(role),
  );
export const assignRolePermissions = (
  role: string,
  permissions: Partial<AdminService.AssignRolePermissionsInput>,
) =>
  request.post<ResponseData<never>>(adminAssignRolePermissions(role), {
    new_permissions: permissions,
  });
export const revokeRolePermissions = (
  role: string,
  permissions: Partial<AdminService.RevokeRolePermissionInput>,
) =>
  request.delete<ResponseData<never>>(adminRevokeRolePermissions(role), {
    data: { revoke_permissions: permissions },
  });

export const updateUserRole = (username: string, role: string) =>
  request.put<ResponseData<never>>(adminUpdateUserRole(username), {
    role_name: role,
  });
export const getUserPermissions = (username: string) =>
  request.get<ResponseData<AdminService.UserDetailWithPermission>>(
    adminGetUserPermissions(username),
  );
export const listResources = () =>
  request.get<ResponseData<AdminService.ResourceType>>(adminListResources);

export const listWhitelist = () =>
  request.get<
    ResponseData<{
      total: number;
      white_list: AdminService.ListWhitelistItem[];
    }>
  >(adminListWhitelist);

export const createWhitelistEntry = (email: string) =>
  request.post<ResponseData<never>>(adminCreateWhitelistEntry, { email });

export const updateWhitelistEntry = (id: number, email: string) =>
  request.put<ResponseData<never>>(adminUpdateWhitelistEntry(id), { email });

export const deleteWhitelistEntry = (email: string) =>
  request.delete<ResponseData<never>>(adminDeleteWhitelistEntry(email));

export const importWhitelistFromExcel = (file: File) => {
  const fd = new FormData();

  fd.append('file', file);

  return request.post<ResponseData<never>>(adminImportWhitelist, fd);
};

export const getSystemVersion = () =>
  request.get<ResponseData<{ version: string }>>(adminGetSystemVersion);

/**
 * 平台运营概览：租户/成员/知识库等总量与近 30 天趋势。
 *
 * 管理端专用（走 admin 网关 9381），没有对应的租户侧接口，故路径直接写死，
 * 不进 `api.ts` 的接口表。
 */
export const getOverview = () =>
  request.get<ResponseData<AdminService.PlatformOverview>>(
    '/api/v1/admin/overview',
  );

// Sandbox settings APIs
export const listSandboxProviders = () =>
  request.get<ResponseData<AdminService.SandboxProvider[]>>(
    adminListSandboxProviders,
  );

export const getSandboxProviderSchema = (providerId: string) =>
  request.get<ResponseData<Record<string, AdminService.SandboxConfigField>>>(
    adminGetSandboxProviderSchema(providerId),
  );

export const getSandboxConfig = (providerType?: string) =>
  request.get<ResponseData<AdminService.SandboxConfig>>(adminGetSandboxConfig, {
    params: { provider_type: providerType },
  });

export const setSandboxConfig = (params: {
  providerType: string;
  config: Record<string, unknown>;
}) =>
  request.post<ResponseData<AdminService.SandboxConfig>>(
    adminSetSandboxConfig,
    {
      provider_type: params.providerType,
      config: params.config,
    },
  );

export const testSandboxConnection = (params: {
  providerType: string;
  config: Record<string, unknown>;
}) =>
  request.post<
    ResponseData<{
      success: boolean;
      message: string;
      details?: {
        exit_code: number;
        execution_time: number;
        stdout: string;
        stderr: string;
      };
    }>
  >(adminTestSandboxConnection, {
    provider_type: params.providerType,
    config: params.config,
  });

// ── 平台审计 ────────────────────────────────────────────────────────────────

/** 一条平台审计记录（跨租户）。 */
export interface PlatformAuditItem {
  id: string;
  tenant_id: string;
  /** 租户名快照；租户被删或改名后历史仍可读。 */
  tenant_name?: string;
  operator: string;
  /**
   * 操作人的可读名（昵称优先，没昵称给邮箱）。后端在读取时解析。
   *
   * 审计表有两个写入方：管理后台中间件往 operator 写邮箱，智能体服务写的是
   * 裸 user id。解析不出来（账号已删）时为空，前端回落到 operator。
   */
  operator_name?: string;
  /** 模块 key：tenant / user / model / queue ... */
  object_type: string;
  action: string;
  /** success | failed */
  result?: string;
  ip_address?: string;
  method?: string;
  path?: string;
  create_time: number;
}

/** 平台审计日志列表。 */
export const listPlatformAudits = (params: {
  page?: number;
  page_size?: number;
  keywords?: string;
  module?: string;
  result?: string;
}) =>
  request.get<ResponseData<{ logs: PlatformAuditItem[]; total: number }>>(
    api.adminAudits,
    { params },
  );

/** 平台安全策略。字段与后端 security.Settings 一一对应。 */
export interface SecuritySettings {
  login: {
    method_password: boolean;
    method_sso: boolean;
    method_ldap: boolean;
    lock_enabled: boolean;
    lock_threshold: number;
    lock_minutes: number;
  };
  password: {
    min_length: number;
    complexity: boolean;
    expire_days: number;
  };
  session: {
    timeout_minutes: number;
    /** 是否允许同一账号在多端/多浏览器同时在线 */
    allow_concurrent: boolean;
  };
}

/** 读取安全策略。未保存过的字段由后端补默认值。 */
export const getSecuritySettings = () =>
  request.get<ResponseData<SecuritySettings>>(api.adminSecurity);

/** 保存安全策略（整体替换，返回保存后的全量）。 */
export const updateSecuritySettings = (settings: SecuritySettings) =>
  request.put<ResponseData<SecuritySettings>>(api.adminSecurity, settings);

/** 手动解除某个账号的登录失败锁定。 */
export const unlockUserLogin = (username: string) =>
  request.put<ResponseData<{ username: string; locked: boolean }>>(
    `${api.adminListUsers}/${encodeURIComponent(username)}/unlock`,
  );
