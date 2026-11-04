/**
 * 登录/改密表单共用的 RSA 封装。
 *
 * 服务端用 `common.DecryptPassword` 解这个信封，前端 `web/src/utils/index.ts`
 * 的 `rsaPsw` 是同一套算法：RSA/PKCS1 + base64(password) 后再加密。
 * 三处（前端、auth.mjs、seed 脚本）必须保持一致，所以只在这里留一份。
 */
import crypto from 'node:crypto';

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArq9XTUSeYr2+N1h3Afl/
z8Dse/2yD0ZGrKwx+EEEcdsBLca9Ynmx3nIB5obmLlSfmskLpBo0UACBmB5rEjBp
2Q2f3AG3Hjd4B+gNCG6BDaawuDlgANIhGnaTLrIqWrrcm4EMzJOnAOI1fgzJRsOO
UEfaS318Eq9OVO3apEyCCt0lOQK6PuksduOjVxtltDav+guVAA068NrPYmRNabVKR
NLJpL8w4D44sfth5RvZ3q9t+6RTArpEtc5sh5ChzvqPOzKGMXW83C95TxmXqpbK6
olN4RevSfVjEAgCydH6HN6OhtOQEcnrU97r9H0iZOWwbw3pVrZiUkuRD1R56Wzs2w
IDAQAB
-----END PUBLIC KEY-----`;

export const rsaPsw = (password) =>
  crypto
    .publicEncrypt(
      { key: PUBLIC_KEY, padding: crypto.constants.RSA_PKCS1_PADDING },
      Buffer.from(Buffer.from(password, 'utf8').toString('base64'), 'utf8'),
    )
    .toString('base64');

/**
 * 随机强口令：大小写 + 数字 + 符号，长度 20。
 * 服务端策略（`security.Settings.CheckPassword`）只强制大小写与数字，
 * 符号是 UI 建议但不强制；这里仍加上，避免以后策略收紧时脚本失效。
 */
export const randomPassword = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(16);
  let core = '';
  for (const b of bytes) core += alphabet[b % alphabet.length];
  // 固定前缀保证复杂度判定一定命中三类字符，不受随机结果影响。
  return `E2e-${core}aZ9!`;
};
