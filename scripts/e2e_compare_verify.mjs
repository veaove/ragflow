/**
 * 同义词 / 相似问 测试对比 2.0 —— 端到端验证
 *
 * 覆盖技术详设 8.2 的场景（当前服务器未配置 rerank 模型，因此
 * 「有 rerank 时相似问精确」这一条以能力上报的正确性来验证，
 * 真实相似问召回提升需配置 rerank 后另测）：
 *
 *   A. 空变更集      → diff 全零、capability 如实报告无 rerank
 *   B. 加同义词      → synonym_simulated=true，对比可跑
 *   C. 加相似问      → affected_chunk_count>0，similar_q_simulated=false + 原因
 *   D. 无重叠相似问  → skipped_similar_count 计数正确
 *
 * 用法：node scripts/e2e_compare_verify.mjs
 */
import crypto from 'node:crypto';

// 直连 API（9380）优先，不通则回落 nginx 反代（80）。
// 安全组放行情况会变，写死任一个都会在改配置后突然跑不通。
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
      // try the next candidate
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

  // ── 选一个有 chunk 的中文数据集 ──
  const dsRes = await fetch(`${BASE}/api/v1/datasets?page=1&page_size=50`, {
    headers: auth(token),
  });
  const dsJson = await dsRes.json();
  const datasets = dsJson.data ?? [];
  const target =
    datasets.find((d) => d.name?.includes('华夏基金') && d.chunk_count > 10) ??
    datasets.find((d) => d.chunk_count > 0);
  check('找到可用数据集', !!target, target ? `${target.name} (${target.chunk_count} chunks)` : '');
  if (!target) process.exit(1);
  const datasetId = target.id;

  // ── 变更集 ──
  const csRes = await fetch(
    `${BASE}/api/v1/datasets/${datasetId}/change-sets`,
    { method: 'POST', headers: auth(token), body: JSON.stringify({}) },
  );
  const csJson = await csRes.json();
  const changeSetId = csJson?.data?.id;
  check('创建变更集', !!changeSetId, changeSetId?.slice(0, 8) ?? csJson?.message);
  if (!changeSetId) process.exit(1);

  const compare = async (question, extra = {}) => {
    const r = await fetch(
      `${BASE}/api/v1/datasets/${datasetId}/change-sets/${changeSetId}/retrieval-compare`,
      {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({
          dataset_ids: [datasetId],
          question,
          top_k: 5,
          similarity_threshold: 0.05,
          page: 1,
          size: 5,
          ...extra,
        }),
      },
    );
    return r.json();
  };

  const QUESTION = '华夏基金 申购费率是多少';

  // ── 场景 A：空变更集 ──
  console.log('\n=== A. 空变更集（应无差异 + 能力如实上报）===');
  const a = await compare(QUESTION);
  check('对比接口返回 code=0', a.code === 0, `code=${a.code} ${a.message ?? ''}`);
  const ad = a.data;
  if (ad) {
    check('返回 baseline 与 candidate', !!ad.baseline && !!ad.candidate,
      `baseline=${ad.baseline?.hits?.length} candidate=${ad.candidate?.hits?.length}`);
    const s = ad.diff?.summary;
    check('空变更集 diff 全零',
      s && s.added_count === 0 && s.removed_count === 0 &&
      s.reordered_count === 0 && s.score_changed_count === 0,
      s ? `added=${s.added_count} removed=${s.removed_count} reordered=${s.reordered_count}` : 'no summary');
    check('synonym_simulated=true（同义词恒可精确模拟）', ad.capability?.synonym_simulated === true);
    check('无 rerank 时 similar_q_simulated=false', ad.capability?.similar_q_simulated === false,
      `reasons=${JSON.stringify(ad.capability?.unsolved_reasons)}`);
    check('无 rerank 时给出 no_rerank_model 原因',
      (ad.capability?.unsolved_reasons ?? []).includes('no_rerank_model'));
    check('两侧耗时已记录',
      typeof ad.baseline?.took_ms === 'number' && typeof ad.candidate?.took_ms === 'number',
      `${ad.baseline?.took_ms}ms / ${ad.candidate?.took_ms}ms`);
  }

  // ── 场景 B：加同义词 ──
  console.log('\n=== B. 新增同义词组 ===');
  const synRes = await fetch(
    `${BASE}/api/v1/datasets/${datasetId}/synonym-groups`,
    {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({
        name: 'e2e-compare-申购费率',
        domain: 'fund',
        scope: 'kb',
        group_type: 'synonym',
        remark: 'e2e 对比测试',
        words: [{ word: '申购费率', is_primary: true }, { word: '认购费率' }],
        change_set_id: changeSetId,
      }),
    },
  );
  const synJson = await synRes.json();
  check('同义词组创建进变更集', synJson.code === 0, `code=${synJson.code} ${synJson.message ?? ''}`);

  const b = await compare(QUESTION);
  check('加同义词后对比仍 code=0', b.code === 0, `code=${b.code}`);
  if (b.code === 0) {
    check('加同义词后 synonym_simulated 仍为 true', b.data?.capability?.synonym_simulated === true);
    // 同义词只影响 query 字符串；在无 rerank 的引擎融合路径下也可能命中，
    // 因此这里不断言必须有 diff，只断言结果自洽（两侧都返回了结构）。
    check('两侧结果结构完整',
      Array.isArray(b.data?.baseline?.hits) && Array.isArray(b.data?.candidate?.hits),
      `baseline=${b.data?.baseline?.hits?.length} candidate=${b.data?.candidate?.hits?.length}`);
    console.log(`   平均分变化: ${b.data?.diff?.summary?.avg_delta_on_common}`);
  }

  // ── 场景 C/D：加相似问（一条重叠、一条无关）──
  console.log('\n=== C/D. 新增相似问（无 rerank 应如实报不可模拟）===');
  const pieces = QUESTION.replace(/[?？]/g, '')
    .split(/[\s,，。]+/)
    .filter((x) => x.length >= 2);
  const overlapWord = pieces[0] ?? '华夏';

  // 找一个真实 chunk 作为载体
  const chunkRes = await fetch(
    `${BASE}/api/v1/datasets/${datasetId}/documents?page=1&page_size=1`,
    { headers: auth(token) },
  );
  const chunkJson = await chunkRes.json();
  const docId = chunkJson?.data?.docs?.[0]?.id;

  if (docId) {
    const chunkListRes = await fetch(
      `${BASE}/api/v1/datasets/${datasetId}/documents/${docId}/chunks?page=1&page_size=1`,
      { headers: auth(token) },
    );
    const chunkListJson = await chunkListRes.json();
    // The chunk payload names the identifier `chunk_id`, not `id`.
    const chunkId =
      chunkListJson?.data?.chunks?.[0]?.chunk_id ??
      chunkListJson?.data?.chunks?.[0]?.id;

    if (chunkId) {
      const sqRes = await fetch(
        `${BASE}/api/v1/datasets/${datasetId}/change-sets/similar-questions`,
        {
          method: 'POST',
          headers: auth(token),
          body: JSON.stringify({
            change_set_id: changeSetId,
            document_id: docId,
            chunk_id: chunkId,
            // 第一条与 query 有词项重叠，第二条完全无关（应被跳过）
            questions: [`${overlapWord}的申购费率说明`, '火星探测器的燃料配方'],
            origin: 'manual',
          }),
        },
      );
      const sqJson = await sqRes.json();
      check('相似问已加入变更集', sqJson.code === 0, `code=${sqJson.code} ${sqJson.message ?? ''}`);

      const c = await compare(QUESTION);
      check('加相似问后对比仍 code=0', c.code === 0, `code=${c.code} ${c.message ?? ''}`);
      if (c.code === 0) {
        const cap = c.data?.capability;
        check('affected_chunk_count > 0', (cap?.affected_chunk_count ?? 0) > 0,
          `affected=${cap?.affected_chunk_count}`);
        check('与 query 无词项重叠的相似问被跳过', (cap?.skipped_similar_count ?? 0) >= 1,
          `skipped=${cap?.skipped_similar_count}`);
        check('无 rerank 时明确告知相似问不可模拟',
          cap?.similar_q_simulated === false &&
          (cap?.unsolved_reasons ?? []).includes('no_rerank_model'));
      }
    } else {
      console.log('⚠ 未找到 chunk，跳过 C/D 场景');
    }
  } else {
    console.log('⚠ 未找到文档，跳过 C/D 场景');
  }

  // ── 清理：丢弃变更集 ──
  const discardRes = await fetch(
    `${BASE}/api/v1/datasets/${datasetId}/change-sets/discard`,
    {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ change_set_id: changeSetId }),
    },
  );
  const discardJson = await discardRes.json();
  check('清理变更集', discardJson.code === 0, `code=${discardJson.code}`);

  console.log(`\n─────────────\n通过 ${pass} · 失败 ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('E2E 异常:', e);
  process.exit(1);
});
