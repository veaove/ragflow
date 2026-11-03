/**
 * 探测脚本：用已生成的 storageState 打开各模块，输出页面事实（不含断言）。
 * 用途：写用例前确认选择器与实际可见资源，不被猜测误导。
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.E2E_BASE_URL || 'http://172.30.20.51';
const OUT = path.resolve('probe-out');
fs.mkdirSync(OUT, { recursive: true });

const ACCOUNTS = ['owner', 'member'];
const PAGES = [
  ['kb-list', '/datasets'],
  ['chats', '/chats'],
  ['searches', '/searches'],
  ['agents', '/agents'],
  ['memories', '/memories'],
  ['qc', '/qc'],
  ['grants', '/console/grants'],
  ['roles', '/console/roles'],
  ['members', '/console/members'],
];

const browser = await chromium.launch();
for (const name of ACCOUNTS) {
  const ctx = await browser.newContext({
    storageState: path.resolve('.auth', `${name}.json`),
    viewport: { width: 1600, height: 1000 },
  });
  const page = await ctx.newPage();
  const apiErrors = [];
  page.on('response', (res) => {
    const url = res.url();
    if (url.includes('/api/v1/') && res.status() >= 400) {
      apiErrors.push(`${res.status()} ${url.replace(BASE, '')}`);
    }
  });

  for (const [label, url] of PAGES) {
    await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2500);
    const body = await page.locator('main, #root').first().innerText();
    fs.writeFileSync(`${OUT}/${name}-${label}.txt`, body);
    await page.screenshot({ path: `${OUT}/${name}-${label}.png`, fullPage: false });
    console.log(
      `[${name}] ${label} url=${page.url().replace(BASE, '')} len=${body.length}`,
    );
    console.log(`    ${JSON.stringify(body.replace(/\s+/g, ' ').slice(0, 500))}`);
  }
  console.log(`[${name}] api>=400: ${JSON.stringify([...new Set(apiErrors)].slice(0, 20))}`);
  await ctx.close();
}
await browser.close();
console.log('probe done');
