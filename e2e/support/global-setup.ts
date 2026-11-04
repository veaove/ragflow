import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { authFile, type AccountName } from './env';

const ACCOUNTS_FILE = path.resolve(__dirname, '..', 'accounts.json');

/** accounts.json 里的全部身份，与 auth.mjs 遍历的是同一份清单。 */
const identityNames = (): AccountName[] =>
  (JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8')) as { name: AccountName }[]).map(
    (a) => a.name,
  );

/**
 * 跑用例前确保每个身份的 storageState 存在。
 *
 * 失效（token 被顶掉 / 会话过期）时用例会跳登录页，届时重跑 auth.mjs 即可；
 * 这里只在文件缺失时自动生成，避免每次跑测试都多发一次登录。
 */
export default function globalSetup() {
  const missing = identityNames().filter((name) => !fs.existsSync(authFile(name)));
  if (!missing.length) return;
  execFileSync(
    process.execPath,
    [path.resolve(__dirname, '..', 'scripts', 'auth.mjs')],
    { stdio: 'inherit' },
  );
}
