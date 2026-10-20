/**
 * 变更中心勾选 + 按选中项发布/放弃/测试对比 —— 端到端验证
 *
 * 覆盖本次「列表勾选 + 选中作用域」的核心语义（scope 过滤）：
 *
 *   1. 全量 diff 包含 2 个 chunk 的相似问 + 1 组同义词
 *   2. 测试对比带 scope（只选 chunk A）→ affected_chunk_count 只反映 A
 *   3. 选中发布（scope = chunk A）→ A 生效、B 与同义词组仍在待生效区
 *   4. 放弃选中（scope = chunk B）→ B 被放弃、同义词组仍在待生效区
 *   5. 无 scope 的 publish/discard 仍为整集（向后兼容）
 *
 * 用法：node scripts/e2e_change_center_scope_verify.mjs
 */
import crypto from 'node:crypto';

const BASE_CANDIDATES = [
  process.env.RF_BASE,
  'http://47.99.241.190:9380',
  'http://47.99.241.190',
].filter(Boolean);

async function resolveBase() {
  for (const base of BASE_CANDIDATES) {
    try {
      const res = await fetch(`${base}/api/v1/system/healthz`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        console.log(`(使用入口: ${base})`);
        return base;
      }
    } catch {
      // try next
    }
  }
  console.log(`(所有入口不可达，回退到: ${BASE_CANDIDATES[0]})`);
  return BASE_CANDIDATES[0];
}

let BASE = BASE_CANDIDATES[0];
// 凭证一律走环境变量，不要硬编码到仓库里：
//   RF_EMAIL=... RF_PASSWORD=... node scripts/<this-file>
const EMAIL = process.env.RF_EMAIL || '';
const PASSWORD = process.env.RF_PASSWORD || '';
if (!EMAIL || !PASSWORD) {
  console.error('缺少 RF_EMAIL / RF_PASSWORD 环境变量');
  process.exit(1);
}

const PUB = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArq9XTUSeYr2+N1h3Afl/z8Dse/2yD0ZGrKwx+EEEcdsBLca9Ynmx3nIB5obmLlSfmskLpBo0UACBmB5rEjBp2Q2f3AG3Hjd4B+gNCG6BDaawuDlgANIhGnaTLrIqWrrcm4EMzJOnAOI1fgzJRsOOUEfaS318Eq9OVO3apEyCCt0lOQK6PuksduOjVxtltDav+guVAA068NrPYmRNabVKRNLJpL8w4D44sfth5RvZ3q9t+6RTArpEtc5sh5ChzvqPOzKGMXW83C95TxmXqpbK6olN4RevSfVjEAgCydH6HN6OhtOQEcnrU97r9H0iZOWwbw3pVrZiUkuRD1R56Wzs2wIDAQAB
-----END PUBLIC KEY-----`;

let pass = 0;
let fail = 0;
function check(name, ok, extra = '') {
  if (ok) {
    pass++;
    console.log(`✅ ${name}${extra ? ' — ' + extra : ''}`);
  } else {
    fail++;
    console.log(`❌ ${name}${extra ? ' — ' + extra : ''}`);
  }
}

function encryptPassword(pwd) {
  const b64 = Buffer.from(pwd, 'utf8').toString('base64');
  return crypto
    .publicEncrypt(
      { key: PUB, padding: crypto.constants.RSA_PKCS1_PADDING },
      Buffer.from(b64, 'utf8'),
    )
    .toString('base64');
}

const H = { 'Content-Type': 'application/json' };
const auth = (t) => ({ ...H, Authorization: `Bearer ${t}` });

const post = async (path, token, body) => {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify(body),
  });
  return r.json();
};

const get = async (path, token) => {
  const r = await fetch(`${BASE}${path}`, { headers: auth(token) });
  return r.json();
};

async function main() {
  BASE = await resolveBase();

  // ── 登录 ──
  const lr = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ email: EMAIL, password: encryptPassword(PASSWORD) }),
  });
  const token = lr.headers.get('authorization');
  check('登录成功', !!token);
  if (!token) process.exit(1);

  // ── 选数据集（需至少 2 个 chunk，承载两个相似问）──
  const dsRes = await fetch(`${BASE}/api/v1/datasets?page=1&page_size=50`, {
    headers: auth(token),
  });
  const dsJson = await dsRes.json();
  const datasets = dsJson.data ?? [];
  const target =
    datasets.find((d) => d.name?.includes('华夏基金') && d.chunk_count > 10) ??
    datasets.find((d) => d.chunk_count >= 2);
  check('找到可用数据集', !!target, target ? `${target.name} (${target.chunk_count} chunks)` : '');
  if (!target) process.exit(1);
  const datasetId = target.id;

  // ── 取两个不同 chunk 作为 A / B ──
  const docRes = await fetch(
    `${BASE}/api/v1/datasets/${datasetId}/documents?page=1&page_size=10`,
    { headers: auth(token) },
  );
  const docJson = await docRes.json();
  const docs = docJson?.data?.docs ?? [];
  const chunks = [];
  for (const doc of docs) {
    const cl = await fetch(
      `${BASE}/api/v1/datasets/${datasetId}/documents/${doc.id}/chunks?page=1&page_size=5`,
      { headers: auth(token) },
    );
    const clJson = await cl.json();
    for (const c of clJson?.data?.chunks ?? []) {
      const cid = c.chunk_id ?? c.id;
      if (cid) chunks.push({ docId: doc.id, chunkId: cid });
      if (chunks.length >= 2) break;
    }
    if (chunks.length >= 2) break;
  }
  check('取到两个 chunk', chunks.length >= 2, `n=${chunks.length}`);
  if (chunks.length < 2) process.exit(1);
  const [A, B] = chunks;

  // ── 建变更集 ──
  const csJson = await post(`/api/v1/datasets/${datasetId}/change-sets`, token, {});
  const changeSetId = csJson?.data?.id;
  check('创建变更集', !!changeSetId, changeSetId?.slice(0, 8) ?? csJson?.message);
  if (!changeSetId) process.exit(1);

  // ── 暂存相似问 A、B ──
  const sqA = await post(
    `/api/v1/datasets/${datasetId}/change-sets/similar-questions`,
    token,
    {
      change_set_id: changeSetId,
      document_id: A.docId,
      chunk_id: A.chunkId,
      questions: ['e2e-scope-A 申购费率说明'],
      origin: 'manual',
    },
  );
  check('相似问 A 已暂存', sqA.code === 0, `code=${sqA.code}`);

  const sqB = await post(
    `/api/v1/datasets/${datasetId}/change-sets/similar-questions`,
    token,
    {
      change_set_id: changeSetId,
      document_id: B.docId,
      chunk_id: B.chunkId,
      questions: ['e2e-scope-B 赎回规则说明'],
      origin: 'manual',
    },
  );
  check('相似问 B 已暂存', sqB.code === 0, `code=${sqB.code}`);

  // ── 建同义词组进变更集 ──
  const synJson = await post(
    `/api/v1/datasets/${datasetId}/synonym-groups`,
    token,
    {
      name: 'e2e-scope-费率',
      domain: 'fund',
      scope: 'kb',
      group_type: 'synonym',
      remark: 'e2e scope 测试',
      words: [{ word: '申购费率', is_primary: true }, { word: '认购费率' }],
      change_set_id: changeSetId,
    },
  );
  check('同义词组已进变更集', synJson.code === 0, `code=${synJson.code}`);

  // ── 读 diff，提取 id ──
  const diffJson = await get(
    `/api/v1/datasets/${datasetId}/change-sets/${changeSetId}/diff`,
    token,
  );
  const diff = diffJson?.data ?? {};
  const sqIds = (diff.similar_questions ?? []).map((s) => s.chunk_id);
  const groupIds = (diff.synonyms ?? []).map((g) => g.group_id);
  check('diff 含 2 个相似问 chunk + 1 组同义词',
    sqIds.length === 2 && groupIds.length === 1,
    `sq=${sqIds.length} syn=${groupIds.length}`);

  // ── 2. 测试对比：scope 只选 chunk A ──
  console.log('\n=== 测试对比 · 选中 A ===');
  const cmpA = await post(
    `/api/v1/datasets/${datasetId}/change-sets/${changeSetId}/retrieval-compare`,
    token,
    {
      dataset_ids: [datasetId],
      question: '华夏基金 申购费率是多少',
      top_k: 5,
      similarity_threshold: 0.05,
      page: 1,
      size: 5,
      scope: { chunk_ids: [A.chunkId], group_ids: [] },
    },
  );
  check('选中 A 对比 code=0', cmpA.code === 0, `code=${cmpA.code} ${cmpA.message ?? ''}`);
  if (cmpA.code === 0) {
    const affected = cmpA.data?.capability?.affected_chunk_count ?? -1;
    check('affected_chunk_count 只反映选中范围(=1)', affected === 1, `affected=${affected}`);
  }

  // 全量对比：affected_chunk_count 应为 2
  console.log('\n=== 测试对比 · 全量 ===');
  const cmpAll = await post(
    `/api/v1/datasets/${datasetId}/change-sets/${changeSetId}/retrieval-compare`,
    token,
    {
      dataset_ids: [datasetId],
      question: '华夏基金 申购费率是多少',
      top_k: 5,
      similarity_threshold: 0.05,
      page: 1,
      size: 5,
    },
  );
  if (cmpAll.code === 0) {
    const affected = cmpAll.data?.capability?.affected_chunk_count ?? -1;
    check('全量对比 affected_chunk_count=2', affected === 2, `affected=${affected}`);
  }

  // ── 3. 选中发布：scope = chunk A ──
  console.log('\n=== 选中发布 · A ===');
  const pubA = await post(
    `/api/v1/datasets/${datasetId}/change-sets/publish`,
    token,
    { change_set_id: changeSetId, scope: { chunk_ids: [A.chunkId], group_ids: [] } },
  );
  check('选中发布 A code=0', pubA.code === 0, `code=${pubA.code} ${pubA.message ?? ''}`);
  const diffAfterPub = await get(
    `/api/v1/datasets/${datasetId}/change-sets/${changeSetId}/diff`,
    token,
  );
  const sqAfterPub = (diffAfterPub?.data?.similar_questions ?? []).map((s) => s.chunk_id);
  const synAfterPub = (diffAfterPub?.data?.synonyms ?? []).map((g) => g.group_id);
  check('发布后 A 已离开待生效、B 仍在',
    !sqAfterPub.includes(A.chunkId) && sqAfterPub.includes(B.chunkId),
    `剩余相似问=${sqAfterPub.length} 同义词=${synAfterPub.length}`);
  check('发布后同义词组仍在待生效（未选中未发布）',
    synAfterPub.length === 1, `syn=${synAfterPub.length}`);

  // 变更集仍在 active 列表（部分发布，未全部完成）
  const listJson = await get(`/api/v1/datasets/${datasetId}/change-sets`, token);
  const stillOpen = (listJson?.data ?? []).some((s) => s.id === changeSetId);
  check('部分发布后变更集仍在待生效列表', stillOpen === true);

  // ── 4. 放弃选中：scope = chunk B ──
  console.log('\n=== 放弃选中 · B ===');
  const disB = await post(
    `/api/v1/datasets/${datasetId}/change-sets/discard`,
    token,
    { change_set_id: changeSetId, scope: { chunk_ids: [B.chunkId], group_ids: [] } },
  );
  check('放弃选中 B code=0', disB.code === 0, `code=${disB.code} ${disB.message ?? ''}`);
  const diffAfterDis = await get(
    `/api/v1/datasets/${datasetId}/change-sets/${changeSetId}/diff`,
    token,
  );
  const sqAfterDis = (diffAfterDis?.data?.similar_questions ?? []).map((s) => s.chunk_id);
  const synAfterDis = (diffAfterDis?.data?.synonyms ?? []).map((g) => g.group_id);
  check('放弃后 B 已移除、无剩余相似问', sqAfterDis.length === 0, `sq=${sqAfterDis.length}`);
  check('放弃后同义词组仍在', synAfterDis.length === 1, `syn=${synAfterDis.length}`);

  // ── 5. 清理：整集放弃（无 scope，向后兼容）──
  console.log('\n=== 清理 · 整集放弃 ===');
  const discard = await post(
    `/api/v1/datasets/${datasetId}/change-sets/discard`,
    token,
    { change_set_id: changeSetId },
  );
  check('整集放弃 code=0（向后兼容）', discard.code === 0, `code=${discard.code}`);

  console.log(`\n─────────────\n通过 ${pass} · 失败 ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('E2E 异常:', e);
  process.exit(1);
});
