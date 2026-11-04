/**
 * 幂等创建 E2E 专用账号（租户管理员 / 部门管理员 / 普通成员）。
 *
 * 为什么要脚本而不是手工点：账号要能重复创建（换环境、被人删掉）、
 * 角色与部门要能对齐到当前租户，口令要随机且不进仓库。
 *
 * 流程（全部通过正式接口，不碰数据库）：
 *   1. POST /api/v1/users                              —— 注册（已存在则跳过注册）
 *   2. POST /api/v1/tenants/:id/members                —— 直接加入租户（不带邀请）
 *   3. PUT  /api/v1/tenants/:id/console/members/:uid   —— 绑定角色 / 部门
 *   4. PUT  /api/v1/tenants/:id/console/members/:uid/password —— 重置为本次随机口令
 *
 * 产物：`.auth/accounts.local.json`（已被 .gitignore 忽略），随后跑
 * `node scripts/auth.mjs` 生成登录态。
 *
 * 前置：`.auth/owner.json` 存在（先跑一次 auth.mjs）。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { randomPassword, rsaPsw } from './lib/rsa.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = path.resolve(HERE, '..', '.auth');
const CREDENTIALS_FILE = path.join(AUTH_DIR, 'accounts.local.json');
const OWNER_STATE = path.join(AUTH_DIR, 'owner.json');

const BASE = process.env.E2E_BASE_URL || 'http://172.30.20.51';
const TENANT = process.env.E2E_TENANT_ID || '8d5c79460d6c46efb58353c68d8bf729';

/** 三个身份对应的内置角色名与部门名，id 在运行时从接口解析，不写死。 */
const TARGETS = [
  {
    name: 'admin',
    email: 'e2e-admin@hjzd.com',
    nickname: 'E2E 租户管理员',
    roleName: '租户管理员',
    department: '',
  },
  {
    name: 'dept',
    email: 'e2e-dept@hjzd.com',
    nickname: 'E2E 部门管理员',
    roleName: '部门管理员',
    department: '技术部',
  },
  {
    name: 'plain',
    email: 'e2e-plain@hjzd.com',
    nickname: 'E2E 普通成员',
    roleName: '普通成员',
    department: '培训部',
  },
];

const ownerToken = () => {
  if (!fs.existsSync(OWNER_STATE)) {
    throw new Error('缺少 .auth/owner.json：先跑 node scripts/auth.mjs');
  }
  const state = JSON.parse(fs.readFileSync(OWNER_STATE, 'utf8'));
  const ls = Object.fromEntries(state.origins[0].localStorage.map((i) => [i.name, i.value]));
  return ls.Authorization;
};

const call = async (method, apiPath, { token, body } = {}) => {
  const res = await fetch(`${BASE}${apiPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { code: -1, message: text.slice(0, 200) };
  }
  return { status: res.status, ...json };
};

const fail = (step, res) => {
  throw new Error(`${step} 失败 (http ${res.status}, code ${res.code}): ${res.message}`);
};

const findMember = async (token, email) => {
  const res = await call('GET', `/api/v1/tenants/${TENANT}/console/members?page_size=200`, {
    token,
  });
  if (res.code !== 0) fail('查成员列表', res);
  return (res.data.members || []).find((m) => m.email === email);
};

const resolveRoleId = async (token, name) => {
  const res = await call('GET', `/api/v1/tenants/${TENANT}/roles`, { token });
  if (res.code !== 0) fail('查角色列表', res);
  const role = (res.data.roles || []).find((r) => r.name === name);
  if (!role) throw new Error(`租户里没有角色「${name}」`);
  return role.id;
};

const resolveDepartmentId = async (token, name) => {
  if (!name) return '';
  const res = await call('GET', `/api/v1/tenants/${TENANT}/departments`, { token });
  if (res.code !== 0) fail('查部门列表', res);
  const dept = (res.data.departments || []).find((d) => d.name === name);
  if (!dept) throw new Error(`租户里没有部门「${name}」`);
  return dept.id;
};

const register = async (target, password) => {
  const res = await call('POST', '/api/v1/users', {
    body: { email: target.email, password: rsaPsw(password), nickname: target.nickname },
  });
  if (res.code === 0) return 'created';
  if (/has already registered/i.test(res.message || '')) return 'exists';
  fail(`注册 ${target.email}`, res);
};

const main = async () => {
  const token = ownerToken();
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const local = fs.existsSync(CREDENTIALS_FILE)
    ? JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'))
    : {};

  for (const target of TARGETS) {
    const password = randomPassword();
    const state = await register(target, password);

    let member = await findMember(token, target.email);
    if (!member) {
      // 「租户管理员」等价 owner，添加接口明确拒绝；先用普通成员入租户，
      // 再由控制台编辑成员把 role_id 指到它（线上历史数据就是这么来的）。
      const addBody =
        target.roleName === '租户管理员'
          ? { email: target.email, role: 'normal' }
          : { email: target.email, role_id: await resolveRoleId(token, target.roleName) };
      const added = await call('POST', `/api/v1/tenants/${TENANT}/members`, {
        token,
        body: addBody,
      });
      if (added.code !== 0) fail(`加入租户 ${target.email}`, added);
      member = await findMember(token, target.email);
      if (!member) throw new Error(`${target.email} 加入租户后在成员列表里找不到`);
    }

    const roleId = await resolveRoleId(token, target.roleName);
    const departmentId = await resolveDepartmentId(token, target.department);
    const updated = await call(
      'PUT',
      `/api/v1/tenants/${TENANT}/console/members/${member.id}`,
      { token, body: { role_id: roleId, department_id: departmentId, status: '1' } },
    );
    if (updated.code !== 0) fail(`设置角色/部门 ${target.email}`, updated);

    const reset = await call(
      'PUT',
      `/api/v1/tenants/${TENANT}/console/members/${member.id}/password`,
      { token, body: { password: rsaPsw(password) } },
    );
    if (reset.code !== 0) fail(`重置口令 ${target.email}`, reset);

    local[target.name] = {
      email: target.email,
      password,
      userId: member.id,
      roleName: target.roleName,
      department: target.department,
    };
    console.log(
      `[seed] ${target.name} <${target.email}> ${state} 角色=${target.roleName} 部门=${
        target.department || '-'
      }`,
    );
  }

  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(local, null, 2), { mode: 0o600 });
  console.log(`[seed] 凭据写入 ${path.relative(process.cwd(), CREDENTIALS_FILE)}`);
  console.log('[seed] 下一步：node scripts/auth.mjs');

  if (process.argv.includes('--auth')) {
    const r = spawnSync(process.execPath, [path.join(HERE, 'auth.mjs')], { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  }
};

await main();
