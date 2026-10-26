/**
 * 前端 UI 端到端检查（Playwright + Chromium）
 *
 * 为什么不能只看 HTTP 200：`pages/404.tsx` 会渲染整整一页「页面不存在」，
 * 状态码 200、控制台干净、body 非空 —— 只看状态码会把「路由没发版」判成绿。
 * 所以每个页面都要同时确认：不含 404 文案、不是登录页、含该页应有的文本。
 *
 * 用法：node e2e_web_ui.mjs
 * 环境变量：BASE（默认线上地址）、TOKEN（owner）、TOKEN_OUT（另一租户，用于守卫测试）
 */

import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://172.30.20.51';
const TOKEN = process.env.TOKEN;
const TOKEN_OUT = process.env.TOKEN_OUT;

if (!TOKEN) { console.error('FATAL: 缺少 TOKEN'); process.exit(1); }

let pass = 0, fail = 0;
const failed = [];

function ck(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failed.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  FAIL  ${name}    ${detail}`); }
}

const b = await chromium.launch({ headless: true });

async function newCtx(token) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  if (token) {
    await ctx.addInitScript(([t]) => {
      localStorage.setItem('Authorization', t);
      localStorage.setItem('token', t);
    }, [token]);
  }
  return ctx;
}

/** 打开页面并返回可判定的快照 */
async function snap(page, path) {
  const errors = [];
  const onErr = (m) => { if (m.type() === 'error') errors.push(m.text()); };
  page.on('console', onErr);
  let status = 0;
  try {
    const resp = await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 40000 });
    status = resp ? resp.status() : 0;
  } catch {
    status = -1;
  }
  await page.waitForTimeout(1200);
  const text = await page.innerText('body').catch(() => '');
  page.off('console', onErr);
  return { status, text, url: page.url(), errors };
}

const NOT_FOUND = /页面不存在|Page not found|404/i;
const IS_LOGIN = /登录|Sign in|Sign In/i;

console.log('==============================================');
console.log(' 前端 UI 端到端检查  ' + new Date().toISOString());
console.log(' ' + BASE);
console.log('==============================================');

// ── U. 未登录行为 ─────────────────────────────────────────────────────────
console.log('\n[U] 未登录与鉴权');
{
  const ctx = await newCtx(null);
  const page = await ctx.newPage();
  const s = await snap(page, '/');
  ck('U1 未登录访问首页跳转到登录页', IS_LOGIN.test(s.text), `url=${s.url}`);
  const s2 = await snap(page, '/console/roles');
  ck('U2 未登录访问控制台被拦截', IS_LOGIN.test(s2.text), `url=${s2.url}`);
  await ctx.close();
}

// ── V. owner 视角的页面渲染 ───────────────────────────────────────────────
console.log('\n[V] 页面渲染（owner）');
const ctxO = await newCtx(TOKEN);
const pageO = await ctxO.newPage();

const PAGES = [
  ['V1 首页', '/', /知识库|智能体|最近|欢迎/i],
  ['V2 知识库列表', '/datasets', /知识库|新建|数据集/i],
  ['V3 智能体列表', '/agents', /智能体|Agent|新建/i],
  ['V4 记忆', '/memory', /记忆|Memory/i],
  ['V5 文件管理', '/files', /文件|文件夹|上传/i],
  ['V6 组织架构', '/console/organization', /组织架构|部门/i],
  ['V7 用户管理', '/console/members', /成员|用户|邀请/i],
  ['V8 角色权限', '/console/roles', /角色|权限/i],
  ['V9 资源授权', '/console/grants', /授权|资源/i],
];

for (const [name, path, expect] of PAGES) {
  const s = await snap(pageO, path);
  const notLogin = !IS_LOGIN.test(s.text);
  const not404 = !NOT_FOUND.test(s.text);
  const hit = expect.test(s.text);
  ck(name, notLogin && not404 && hit,
    `login=${!notLogin} 404=${!not404} expect=${!hit} url=${s.url}`);
}

// ── W. 菜单与错误 ─────────────────────────────────────────────────────────
console.log('\n[W] 菜单渲染与运行时报错');
{
  const s = await snap(pageO, '/');
  const menuHits = ['知识库', '智能体', '记忆', '文件管理', '控制台'].filter((k) => s.text.includes(k));
  ck('W1 侧边栏核心菜单项齐全', menuHits.length >= 4, `命中 ${menuHits.length}/5：${menuHits.join(',')}`);
  ck('W2 首页无 JS 运行时错误', s.errors.length === 0, s.errors.slice(0, 2).join(' | '));

  const s404 = await snap(pageO, '/this-route-does-not-exist-e2e');
  ck('W3 未知路由显示 404 页（不是白屏）', NOT_FOUND.test(s404.text), `text=${s404.text.slice(0, 40)}`);
}

// ── X. 租户隔离 ───────────────────────────────────────────────────────────
// 前端只展示「当前登录用户的租户」，没有跨租户 URL 参数，所以不存在
// 「用 A 的 URL 看到 B 的数据」这种场景 —— 隔离由服务端保证。
// 这里验证另一租户用户能正常打开自己的 console（说明守卫生效：没有被
// 错误地拦成 403，也没有把别人的数据端上来）。
//
// 注：真正的「矩阵拦截」（role.view=false 的角色进不了角色页）需要构造
// 只读角色并绑定到成员才能验证，本次未覆盖，已记录为待补项。
console.log('\n[X] 租户隔离');
if (TOKEN_OUT) {
  const ctxX = await newCtx(TOKEN_OUT);
  const pageX = await ctxX.newPage();
  const s = await snap(pageX, '/console/roles');
  const rendered = !NOT_FOUND.test(s.text) && !IS_LOGIN.test(s.text);
  ck('X1 另一租户用户可正常打开自己的角色页', rendered, `url=${s.url}`);
  ck('X2 页面无 JS 运行时错误', s.errors.length === 0, s.errors.slice(0, 2).join(' | '));
  await ctxX.close();
} else {
  console.log('  SKIP  X1-X2（未提供 TOKEN_OUT）');
}

await ctxO.close();
await b.close();

console.log('\n==============================================');
console.log(` 合计：PASS=${pass}  FAIL=${fail}`);
if (fail) { console.log(' 失败用例：'); failed.forEach((f) => console.log('   - ' + f)); }
console.log('==============================================');
process.exit(fail ? 1 : 0);
