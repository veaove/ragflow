/**
 * 测试环境的账实与常量。
 *
 * 账号、租户、资源 ID 全部来自目标环境的真实数据（华夏基金租户），
 * 写死在用例里是为了让断言可读；数据被改名时先在 accounts.json / 本文件里
 * 更新，再跑 —— 不要在断言里用模糊匹配掩盖改名。
 */
import fs from 'node:fs';
import path from 'node:path';

export const BASE_URL = process.env.E2E_BASE_URL || 'http://172.30.20.51';

export type AccountName = 'owner' | 'member' | 'admin' | 'dept' | 'plain';

export const IDENTITIES: Record<
  AccountName,
  { name: string; email: string; tenantId: string; label: string }
> = {
  owner: {
    name: 'owner',
    email: '123456789@qq.com',
    tenantId: '8d5c79460d6c46efb58353c68d8bf729',
    label: '租户所有者（owner）',
  },
  member: {
    name: 'member',
    email: 'hjzd@hjzd.com',
    tenantId: '8d5c79460d6c46efb58353c68d8bf729',
    label: '普通成员（自定义角色「技术员」）',
  },
  // 以下三个由 scripts/seed-accounts.mjs 创建，口令只写 .auth/accounts.local.json。
  admin: {
    name: 'admin',
    email: 'e2e-admin@hjzd.com',
    tenantId: '8d5c79460d6c46efb58353c68d8bf729',
    label: '内置「租户管理员」（无部门）',
  },
  dept: {
    name: 'dept',
    email: 'e2e-dept@hjzd.com',
    tenantId: '8d5c79460d6c46efb58353c68d8bf729',
    label: '内置「部门管理员」（技术部）',
  },
  plain: {
    name: 'plain',
    email: 'e2e-plain@hjzd.com',
    tenantId: '8d5c79460d6c46efb58353c68d8bf729',
    label: '内置「普通成员」（培训部，无资源授权）',
  },
};

/** 矩阵里作为「受限身份」参与比对的三档角色。 */
export const VIEWERS = ['member', 'dept', 'plain'] as const;
export type ViewerName = (typeof VIEWERS)[number];

/** 华夏基金租户下用于断言的真实资源。 */
export const RESOURCES = {
  /** 18 个库里的一个，owner 独占（permission=me，无授权）。 */
  privateKb: {
    id: '56c2dfd33efe4a53a340ac81a56321d7',
    name: '07-帮助中心',
  },
  /** 显式授权给 member 的库（dataset grant）。 */
  grantedKb: {
    id: '1febaf3eee7e44e0b1052af560f40d30',
    name: '问数-示例SQL-fund_demo',
  },
  /** member 自己创建、permission=me 的库。 */
  memberOwnKb: {
    id: 'c9f2f30ca3494d9494aed5695f7150c8',
    name: '技术部(2)',
  },
  /** 授权给 member 的智能体（canvas grant）。 */
  grantedAgent: '问数助手·fund_demo',
  /** owner 独有的智能体，member 不应看到。 */
  privateAgent: '华小夏-IVR（按键菜单）',
  /** owner 独有的知识问答应用。 */
  privateChat: '基金咨询',
  /** owner 独有的知识搜索应用。 */
  privateSearch: '客服部智能检索',
  /** owner 独有的记忆。 */
  privateMemory: '华夏基金',
} as const;

/** 每个账号的登录态文件（由 scripts/auth.mjs 生成）。 */
export const authFile = (name: AccountName) =>
  path.resolve(__dirname, '..', '.auth', `${name}.json`);

/** 从 storageState 里取 Authorization 头，供接口级断言使用。 */
export const tokenOf = (name: AccountName): string => {
  const state = JSON.parse(fs.readFileSync(authFile(name), 'utf8')) as {
    origins: { localStorage: { name: string; value: string }[] }[];
  };
  const ls = Object.fromEntries(
    state.origins[0].localStorage.map((item) => [item.name, item.value]),
  );
  return ls.Authorization;
};

/** 控制台/资源接口前缀。 */
export const api = {
  datasets: '/api/v1/datasets',
  dataset: (id: string) => `/api/v1/datasets/${id}`,
  chats: '/api/v1/chats',
  searches: '/api/v1/searches',
  agents: '/api/v1/agents',
  memories: '/api/v1/memories',
  qcRules: '/api/v1/qc/rules',
  roles: (tenantId: string) => `/api/v1/tenants/${tenantId}/roles`,
  rolePermissions: (tenantId: string, roleId: string) =>
    `/api/v1/tenants/${tenantId}/roles/${roleId}/permissions`,
  members: (tenantId: string) => `/api/v1/tenants/${tenantId}/console/members`,
  member: (tenantId: string, userId: string) =>
    `/api/v1/tenants/${tenantId}/console/members/${userId}`,
  grantTree: (tenantId: string, kind = 'dataset') =>
    `/api/v1/tenants/${tenantId}/grant-tree?kind=${kind}`,
  grants: (tenantId: string, kind = 'dataset') =>
    `/api/v1/tenants/${tenantId}/grants?kind=${kind}`,
  grantExceptions: (tenantId: string) =>
    `/api/v1/tenants/${tenantId}/grant-exceptions`,
  grantsBySubject: (tenantId: string, subjectId: string, subjectKind = 'user') =>
    `/api/v1/tenants/${tenantId}/grants-by-subject?subject_kind=${subjectKind}&subject_id=${subjectId}`,
  /** 授权图谱：一次返回 members / teams / resources(+grants) / stats。 */
  grantGraph: (tenantId: string) => `/api/v1/tenants/${tenantId}/grant-graph`,
  datasetDocuments: (datasetId: string) => `/api/v1/datasets/${datasetId}/documents`,
  setGrants: (tenantId: string, kind: string, resourceId: string) =>
    `/api/v1/tenants/${tenantId}/grants/${kind}/${resourceId}`,
};
