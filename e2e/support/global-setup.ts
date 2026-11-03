import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { authFile } from './env';

/**
 * 跑用例前确保两个账号的 storageState 存在。
 *
 * 失效（token 被顶掉 / 会话过期）时用例会跳登录页，届时重跑 auth.mjs 即可；
 * 这里只在文件缺失时自动生成，避免每次跑测试都多发一次登录。
 */
export default function globalSetup() {
  const missing = (['owner', 'member'] as const).filter(
    (name) => !fs.existsSync(authFile(name)),
  );
  if (!missing.length) return;
  execFileSync(
    process.execPath,
    [path.resolve(__dirname, '..', 'scripts', 'auth.mjs')],
    { stdio: 'inherit' },
  );
}
