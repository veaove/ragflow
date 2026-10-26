/**
 * 知识库启用/禁用 + 引用约束 —— 端到端验证
 *
 * 覆盖的行为：
 *   1. 新建知识库默认启用（enabled=true）
 *   2. 无引用时可以禁用，列表立刻反映 enabled=false
 *   3. 可以重新启用
 *   4. 被聊天应用绑定后，禁用被拒绝，且 references 能报出绑定方
 *   5. 解绑（删除聊天）后可以正常禁用
 *
 * 用法：node scripts/e2e_dataset_enable_verify.mjs
 * 环境：RF_BASE 可覆盖默认地址。
 */
import crypto from 'node:crypto';

const BASE_CANDIDATES = [
  process.env.RF_BASE,
  'http://172.30.20.51:9380',
  'http://172.30.20.51',
].filter(Boolean);

// 凭证一律走环境变量，不要硬编码到仓库里：
//   RF_EMAIL=... RF_PASSWORD=... node scripts/<this-file>
const EMAIL = process.env.RF_EMAIL || '';
const PASSWORD = process.env.RF_PASSWORD || '';
if (!EMAIL || !PASSWORD) {
  console.error('缺少 RF_EMAIL / RF_PASSWORD 环境变量');
  process.exit(1);
}

const PUB_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArq9XTUSeYr2+N1h3Afl/z8Dse/2yD0ZGrKwx+EEEcdsBLca9Ynmx3nIB5obmLlSfmskLpBo0UACBmB5rEjBp2Q2f3AG3Hjd4B+gNCG6BDaawuDlgANIhGnaTLrIqWrrcm4EMzJOnAOI1fgzJRsOOUEfaS318Eq9OVO3apEyCCt0lOQK6PuksduOjVxtltDav+guVAA068NrPYmRNabVKRNLJpL8w4D44sfth5RvZ3q9t+6RTArpEtc5sh5ChzvqPOzKGMXW83C95TxmXqpbK6olN4RevSfVjEAgCydH6HN6OhtOQEcnrU97r9H0iZOWwbw3pVrZiUkuRD1R56Wzs2wIDAQAB
-----END PUBLIC KEY-----`;

function encryptPassword(pwd) {
  const b64 = Buffer.from(pwd, 'utf8').toString('base64');
  const encrypted = crypto.publicEncrypt(
    { key: PUB_KEY, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(b64, 'utf8'),
  );
  return encrypted.toString('base64');
}

let BASE = BASE_CANDIDATES[0];
let failures = 0;

async function resolveBase() {
  for (const base of BASE_CANDIDATES) {
    try {
      const res = await fetch(`${base}/api/v1/system/healthz`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok || res.status === 401) {
        BASE = base;
        return true;
      }
    } catch {
      /* try next */
    }
  }
  return false;
}

async function call(method, path, { token, body } = {}) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = token;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}

function ok(label, cond, extra = '') {
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures += 1;
  return cond;
}

async function findDataset(token, name) {
  const list = await call('GET', `/api/v1/datasets?keywords=${encodeURIComponent(name)}&page=1&page_size=10`, { token });
  const items = list.json?.data ?? [];
  return items.find((d) => d.name === name);
}

async function main() {
  if (!(await resolveBase())) {
    console.error('❌ 无法连接后端：' + BASE_CANDIDATES.join(', '));
    process.exit(1);
  }
  console.log(`BASE = ${BASE}`);

  const login = await call('POST', '/api/v1/auth/login', {
    body: { email: EMAIL, password: encryptPassword(PASSWORD) },
  });
  const token =
    login.headers.get('authorization') || login.headers.get('Authorization');
  if (!ok('1. 登录', !!token, `code=${login.json?.code}`)) process.exit(1);

  const stamp = Date.now();
  const kbName = `e2e-enable-${stamp}`;
  const chatName = `e2e-enable-chat-${stamp}`;
  let kbId = null;
  let chatId = null;

  try {
    // 复用已有知识库的 embedding_model / parser_id，避免模型与解析器校验差异。
    const seed = await call('GET', '/api/v1/datasets?page=1&page_size=1', { token });
    const embeddingModel = seed.json?.data?.[0]?.embedding_model;
    const parserId = seed.json?.data?.[0]?.parser_id || 'naive';
    if (!embeddingModel) {
      console.error('❌ 没有可复用的 embedding_model，无法建库');
      process.exit(1);
    }

    const created = await call('POST', '/api/v1/datasets', {
      token,
      // parse_type=1 表示内置解析器（parser_id），2 表示数据管道（pipeline_id）。
      body: {
        name: kbName,
        embedding_model: embeddingModel,
        parse_type: 1,
        parser_id: parserId,
      },
    });
    kbId = created.json?.data?.id;
    if (!ok('2. 创建知识库', !!kbId, `code=${created.json?.code} ${created.json?.message || ''}`)) {
      return;
    }
    ok('2b. 新建知识库默认启用', created.json?.data?.enabled === true,
      `enabled=${created.json?.data?.enabled}`);

    // ── 无引用：可以禁用 ──
    const disable = await call('PUT', `/api/v1/datasets/${kbId}`, {
      token,
      body: { enabled: false },
    });
    ok('3. 无引用时可禁用', disable.json?.code === 0,
      `code=${disable.json?.code} ${disable.json?.message || ''}`);

    let listed = await findDataset(token, kbName);
    ok('4. 列表反映 enabled=false', listed?.enabled === false,
      `enabled=${listed?.enabled}`);

    const enable = await call('PUT', `/api/v1/datasets/${kbId}`, {
      token,
      body: { enabled: true },
    });
    ok('5. 可重新启用', enable.json?.code === 0, `code=${enable.json?.code}`);
    listed = await findDataset(token, kbName);
    ok('5b. 列表反映 enabled=true', listed?.enabled === true,
      `enabled=${listed?.enabled}`);

    // ── 绑定到聊天应用 ──
    const chat = await call('POST', '/api/v1/chats', {
      token,
      body: { name: chatName, kb_ids: [kbId] },
    });
    chatId = chat.json?.data?.id;
    if (!ok('6. 创建聊天应用并绑定知识库', !!chatId,
      `code=${chat.json?.code} ${chat.json?.message || ''}`)) {
      return;
    }

    const refs = await call('GET', `/api/v1/datasets/${kbId}/references`, { token });
    const refList = refs.json?.data?.references ?? [];
    const bound = refList.some((r) => r.id === chatId);
    ok('7. references 报出绑定方', bound,
      `status=${refs.status} count=${refList.length} → ${refList.map((r) => `${r.kind}:${r.name}`).join(', ')}`);

    const blocked = await call('PUT', `/api/v1/datasets/${kbId}`, {
      token,
      body: { enabled: false },
    });
    ok('8. 被引用时禁用被拒绝', blocked.json?.code !== 0,
      `code=${blocked.json?.code} msg=${String(blocked.json?.message || '').slice(0, 100)}`);
    const blockedRefs = blocked.json?.data?.references ?? [];
    ok('8b. 拒绝响应带出绑定明细', blockedRefs.length > 0,
      `references=${blockedRefs.length}`);

    listed = await findDataset(token, kbName);
    ok('8c. 列表状态未被误改', listed?.enabled === true,
      `enabled=${listed?.enabled}`);

    // ── 解绑后可以禁用 ──
    const delChat = await call('DELETE', `/api/v1/chats/${chatId}`, { token });
    ok('9. 解绑（删除聊天）', delChat.json?.code === 0, `code=${delChat.json?.code}`);
    chatId = null;

    const disableAfterUnbind = await call('PUT', `/api/v1/datasets/${kbId}`, {
      token,
      body: { enabled: false },
    });
    ok('10. 解绑后可禁用', disableAfterUnbind.json?.code === 0,
      `code=${disableAfterUnbind.json?.code} ${disableAfterUnbind.json?.message || ''}`);
  } finally {
    // 清理：先还原启用状态再删除，避免留半状态数据。
    if (chatId) {
      await call('DELETE', `/api/v1/chats/${chatId}`, { token }).catch(() => {});
    }
    if (kbId) {
      await call('PUT', `/api/v1/datasets/${kbId}`, { token, body: { enabled: true } }).catch(() => {});
      const del = await call('DELETE', '/api/v1/datasets', { token, body: { ids: [kbId] } }).catch(() => null);
      console.log(`\n清理：知识库 ${kbName} → ${del?.json?.code === 0 ? '已删除' : '请手工检查'}`);
    }
  }

  console.log(
    failures === 0
      ? '\n全部用例通过'
      : `\n有 ${failures} 个用例失败`,
  );
  process.exit(failures === 0 ? 0 : 2);
}

main().catch((err) => {
  console.error('❌ 脚本异常:', err);
  process.exit(1);
});
