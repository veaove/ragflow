/**
 * 端到端验证脚本：Dify Workflow/Chatflow 移植
 * 流程：登录 → 创建 workflow → 配 DSL(Begin→End) → 发布 → 建 API Key → 调用 API
 * 用法：node e2e_workflow_verify.mjs
 */
import crypto from 'node:crypto';

const BASE = 'http://172.30.20.51:9380';
// 凭证一律走环境变量，不要硬编码到仓库里：
//   RF_EMAIL=... RF_PASSWORD=... node scripts/<this-file>
const EMAIL = process.env.RF_EMAIL || '';
const PASSWORD = process.env.RF_PASSWORD || '';
if (!EMAIL || !PASSWORD) {
  console.error('缺少 RF_EMAIL / RF_PASSWORD 环境变量');
  process.exit(1);
}

// 与 web/src/utils/index.ts 一致的 RSA 公钥
const PUB_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArq9XTUSeYr2+N1h3Afl/z8Dse/2yD0ZGrKwx+EEEcdsBLca9Ynmx3nIB5obmLlSfmskLpBo0UACBmB5rEjBp2Q2f3AG3Hjd4B+gNCG6BDaawuDlgANIhGnaTLrIqWrrcm4EMzJOnAOI1fgzJRsOOUEfaS318Eq9OVO3apEyCCt0lOQK6PuksduOjVxtltDav+guVAA068NrPYmRNabVKRNLJpL8w4D44sfth5RvZ3q9t+6RTArpEtc5sh5ChzvqPOzKGMXW83C95TxmXqpbK6olN4RevSfVjEAgCydH6HN6OhtOQEcnrU97r9H0iZOWwbw3pVrZiUkuRD1R56Wzs2wIDAQAB
-----END PUBLIC KEY-----`;

// 前端逻辑：Base64(password) → RSA 加密
function encryptPassword(pwd) {
  const b64 = Buffer.from(pwd, 'utf8').toString('base64');
  const encrypted = crypto.publicEncrypt(
    { key: PUB_KEY, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(b64, 'utf8')
  );
  return encrypted.toString('base64');
}

async function call(method, path, { body, token, headers = {} } = {}) {
  const h = { 'Content-Type': 'application/json', ...headers };
  if (token) h['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, headers: res.headers };
}

function ok(label, cond, extra = '') {
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`);
  return cond;
}

async function main() {
  // ── 1. 登录（token 在 authorization 响应头，不在 body）──
  const login = await call('POST', '/api/v1/auth/login', {
    body: { email: EMAIL, password: encryptPassword(PASSWORD) },
  });
  const token = login.headers.get('authorization') || login.headers.get('Authorization');
  if (!ok('1. 登录', !!token, `code=${login.json?.code} msg=${login.json?.message || ''}`)) {
    console.log('   响应:', JSON.stringify(login.json).slice(0, 300));
    process.exit(1);
  }
  console.log(`   用户: ${login.json?.data?.nickname} (superuser=${login.json?.data?.is_superuser})`);
  console.log(`   token: ${String(token).slice(0, 28)}...`);

  // ── 2. 创建 workflow_canvas（必须带 DSL，见前端 initialEmptyDsl）──
  const title = 'E2E验证-Workflow-' + Date.now();
  const makeDsl = (withEnd = true) => ({
    schema_version: 1,
    components: {
      begin: {
        obj: {
          component_name: 'Begin',
          params: { inputs: [{ type: 'paragraph', name: 'query', optional: false, value: '' }] },
        },
        downstream: withEnd ? ['end'] : [],
        upstream: [],
      },
      ...(withEnd
        ? {
            end: {
              obj: {
                component_name: 'End',
                params: { outputs: { broadcast_text: { type: 'string', value: '{sys.query}' } } },
              },
              downstream: [],
              upstream: ['begin'],
            },
          }
        : {}),
    },
    path: {}, history: [], memory: null, retrieval: {}, globals: null,
  });
  const dsl = makeDsl(true);

  const create = await call('POST', '/api/v1/agents', {
    token,
    body: { title, canvas_category: 'workflow_canvas', dsl },
  });
  const canvasId = create.json?.data?.id;
  if (!ok('2. 创建 workflow_canvas', !!canvasId,
      `code=${create.json?.code} ${create.json?.message || ''} category=${create.json?.data?.canvas_category || ''}`)) {
    console.log('   响应:', JSON.stringify(create.json).slice(0, 300));
    process.exit(1);
  }
  console.log(`   canvas_id: ${canvasId}, category: ${create.json?.data?.canvas_category}`);

  // ── 2b. 发布校验：缺 End 的 workflow 应被拒绝 ──
  const badCanvas = await call('POST', '/api/v1/agents', {
    token,
    body: {
      title: title + '-无End',
      canvas_category: 'workflow_canvas',
      dsl: makeDsl(false),
    },
  });
  const badId = badCanvas.json?.data?.id;
  if (badId) {
    const badPub = await call('POST', `/api/v1/agents/${badId}/publish`, {
      token, body: { dsl: makeDsl(false) },
    });
    const rejected = badPub.json?.code !== 0;
    ok('2b. 发布校验拒绝无 End 的 Workflow', rejected,
        `code=${badPub.json?.code} msg=${String(badPub.json?.message || '').slice(0, 120)}`);
    await call('DELETE', `/api/v1/agents/${badId}`, { token });
  } else {
    ok('2b. 发布校验拒绝无 End 的 Workflow', false, '创建失败');
  }

  // ── 4. 发布（触发 validatePublish：必须恰好一个 End）──
  const pub = await call('POST', `/api/v1/agents/${canvasId}/publish`, { token, body: { dsl } });
  const pubOk = ok('4. 发布（形态校验通过）', pub.json?.code === 0,
      `code=${pub.json?.code} ${pub.json?.message || ''} version_seq=${pub.json?.data?.version_seq ?? '-'}`);
  if (!pubOk) {
    console.log('   发布失败响应:', JSON.stringify(pub.json).slice(0, 400));
  } else {
    console.log(`   version_seq: ${pub.json?.data?.version_seq}, release: ${pub.json?.data?.release}`);
  }

  // ── 5. 版本列表（验证 AlwaysCreate 追加不可变快照）──
  const versions = await call('GET', `/api/v1/agents/${canvasId}/versions`, { token });
  const vList = versions.json?.data || [];
  ok('5. 版本列表', Array.isArray(vList) && vList.length > 0, `共 ${vList.length} 个版本, version_seq=${vList[0]?.version_seq}`);

  // ── 6. 创建 API Key ──
  const keyResp = await call('POST', `/api/v1/apps/${canvasId}/api-keys`, { token });
  const apiKey = keyResp.json?.data?.key;
  ok('6. 创建 API Key', !!apiKey, `key=${apiKey ? apiKey.slice(0, 16) + '...' : JSON.stringify(keyResp.json).slice(0, 200)}`);

  if (!apiKey) {
    console.log('\n⚠️  API Key 创建失败，后续调用跳过');
    return;
  }

  // ── 7. 调用 Workflow API（blocking）──
  const run = await call('POST', `/api/v1/workflows/${canvasId}/run`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    body: { inputs: {}, query: '我要赎回基金', response_mode: 'blocking' },
  });
  const runData = run.json?.data || {};
  console.log(`   run 响应: ${JSON.stringify(run.json).slice(0, 300)}`);
  ok('7. Workflow API blocking 调用', run.status === 200 && run.json?.code === 0,
      `http=${run.status} code=${run.json?.code}`);
  ok('7b. 返回 run_id', !!runData.run_id, `run_id=${runData.run_id || '(空)'}`);
  ok('7c. 返回 End 节点输出', runData.outputs && Object.keys(runData.outputs).length > 0,
      `outputs=${JSON.stringify(runData.outputs)}`);
  ok('7d. 运行状态为 succeeded', runData.status === 'succeeded', `status=${runData.status}`);

  // ── 8. async 应被拒绝（V1.0 不支持）──
  const asyncResp = await call('POST', `/api/v1/workflows/${canvasId}/run`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    body: { inputs: {}, response_mode: 'async' },
  });
  const asyncRejected = asyncResp.json?.code !== 0 &&
      JSON.stringify(asyncResp.json).includes('RESPONSE_MODE_NOT_SUPPORTED');
  ok('8. async 被拒绝（V1.0 降级）', asyncRejected,
      `code=${asyncResp.json?.code} msg=${asyncResp.json?.message || ''}`);

  // ── 9. 幂等：同 Idempotency-Key 重复调用 ──
  const idem1 = await call('POST', `/api/v1/workflows/${canvasId}/run`, {
    headers: { Authorization: `Bearer ${apiKey}`, 'Idempotency-Key': `e2e-${Date.now()}` },
    body: { inputs: {}, query: '幂等测试', response_mode: 'blocking' },
  });
  ok('9. 带 Idempotency-Key 调用', idem1.json?.code === 0, `code=${idem1.json?.code}`);

  // ── 10. 无效 Key 被拒 ──
  const badKey = await call('POST', `/api/v1/workflows/${canvasId}/run`, {
    headers: { Authorization: 'Bearer wf-sk-invalid-key-xxx' },
    body: { inputs: {}, response_mode: 'blocking' },
  });
  ok('10. 无效 API Key 被拒', badKey.json?.code !== 0 || badKey.status === 401,
      `http=${badKey.status} code=${badKey.json?.code}`);

  // ── 11. 形态不匹配：用 Workflow API 调 agent 类型 ──
  console.log('\n--- 清理 ---');
  console.log(`   测试 canvas_id: ${canvasId}（可在 UI 手动删除）`);
}

main().catch((e) => {
  console.error('脚本异常:', e.message);
  process.exit(1);
});
