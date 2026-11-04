/**
 * 为 `accounts.json` 里的每个测试身份产出 Playwright storageState。
 *
 * 为什么不能只用表单登录：登录接口强制图形验证码，答案只存在服务端
 * （Kvrocks 的 captcha:<id>，60 秒 TTL）。这里走「真接口 + 读一次验证码」：
 *
 *   1. GET  /api/v1/auth/captcha          -> captcha_id
 *   2. ssh  <测试机> 读 captcha:<id>       -> 验证码明文（仅测试环境）
 *   3. POST /api/v1/auth/login            -> Authorization 响应头 + access_token
 *
 * 生产环境没有 SSH 时，改用手工登录一次后导出 storageState（见 README）。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { rsaPsw } from './lib/rsa.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = path.resolve(HERE, '..', '.auth');
const ACCOUNTS_FILE = path.resolve(HERE, '..', 'accounts.json');
const CREDENTIALS_FILE = path.join(AUTH_DIR, 'accounts.local.json');

const BASE = process.env.E2E_BASE_URL || 'http://172.30.20.51';
const SSH_HOST = process.env.E2E_SSH_HOST || 'root@172.30.20.51';

// 最小 RESP 客户端：只为读一个验证码 key，避免给测试机装 redis-cli。
// 密码从测试机自己的 docker/.env 读，不经过本机。
const KV_GET_PY = [
  'import socket, sys',
  'key = sys.argv[1]',
  'pw = ""',
  'try:',
  '    for line in open("/root/ragflow/docker/.env", encoding="utf-8"):',
  '        if line.startswith("REDIS_PASSWORD="):',
  '            pw = line.split("=", 1)[1].strip()',
  '            break',
  'except OSError:',
  '    pass',
  's = socket.create_connection(("127.0.0.1", 6379), 5)',
  'f = s.makefile("rb")',
  'def send(*args):',
  '    out = ("*%d\\r\\n" % len(args)).encode()',
  '    for a in args:',
  '        b = a.encode()',
  '        out += b"$%d\\r\\n%s\\r\\n" % (len(b), b)',
  '    s.sendall(out)',
  'def reply():',
  '    head = f.readline().rstrip(b"\\r\\n")',
  '    if head.startswith(b"$"):',
  '        n = int(head[1:])',
  '        if n < 0:',
  '            return ""',
  '        body = f.read(n).decode()',
  '        f.read(2)',
  '        return body',
  '    return head.decode()',
  'if pw:',
  '    send("AUTH", pw)',
  '    reply()',
  'send("GET", key)',
  'sys.stdout.write(reply())',
].join('\n');

/** 从 Kvrocks 读一个 key（redis 协议，只走本地回环）。 */
const kvGet = (key) => {
  const encoded = Buffer.from(KV_GET_PY, 'utf8').toString('base64');
  const remote = `echo ${encoded} | base64 -d | python3 - ${key}`;
  const r = spawnSync('ssh', [SSH_HOST, remote], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(
      `读取验证码失败(${r.status}): ${(r.stderr || '').trim() || r.stdout}`,
    );
  }
  return (r.stdout || '').trim();
};

const login = async (account) => {
  const captchaRes = await fetch(`${BASE}/api/v1/auth/captcha`);
  const captchaJson = await captchaRes.json();
  const captchaId = captchaJson?.data?.captcha_id;
  if (!captchaId) {
    throw new Error(`captcha 下发失败: ${JSON.stringify(captchaJson)}`);
  }
  // 服务端把验证码明文写在这个 key 下（见 utility.CaptchaIDRedisKey）。
  const code = kvGet(`captcha:${captchaId}`);
  if (process.env.E2E_DEBUG_AUTH) {
    console.log(`[auth] captcha_id=${captchaId} code=${JSON.stringify(code)}`);
  }

  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: account.email,
      password: rsaPsw(account.password),
      captcha_id: captchaId,
      captcha: code,
    }),
  });
  const json = await res.json();
  if (json.code !== 0) {
    throw new Error(`登录失败(${json.code}): ${json.message}`);
  }
  const authorization = res.headers.get('authorization');
  if (!authorization) {
    throw new Error('响应头里没有 Authorization，无法复用会话');
  }
  return {
    authorization,
    token: json.data?.access_token,
    userInfo: {
      avatar: json.data?.avatar,
      name: json.data?.nickname,
      email: json.data?.email,
    },
    userId: json.data?.id,
  };
};

/**
 * 密码来源：环境变量优先，其次 `.auth/accounts.local.json`（seed 脚本写入，已 gitignore）。
 * `accounts.json` 只留身份描述，不放明文口令。
 */
const passwordOf = (account) => {
  const envKey = `E2E_${account.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_PASSWORD`;
  if (process.env[envKey]) return process.env[envKey];
  if (fs.existsSync(CREDENTIALS_FILE)) {
    const local = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
    const hit = local[account.name];
    if (hit?.password) return hit.password;
  }
  throw new Error(
    `${account.name} 没有可用密码：设置 ${envKey}，或先跑 node scripts/seed-accounts.mjs`,
  );
};

const main = async () => {
  const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  for (const account of accounts) {
    const session = await login({ ...account, password: passwordOf(account) });
    const state = {
      cookies: [],
      origins: [
        {
          origin: BASE,
          localStorage: [
            { name: 'Authorization', value: session.authorization },
            { name: 'token', value: session.token ?? '' },
            { name: 'userInfo', value: JSON.stringify(session.userInfo) },
            { name: 'lng', value: 'zh-Hans' },
          ],
        },
      ],
    };
    const file = path.join(AUTH_DIR, `${account.name}.json`);
    fs.writeFileSync(file, JSON.stringify(state, null, 2));
    console.log(
      `[auth] ${account.name} <${account.email}> ok -> ${path.relative(process.cwd(), file)}`,
    );
  }
};

await main();
