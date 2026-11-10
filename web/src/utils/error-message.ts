/*
 *  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

/**
 * 把一次失败翻译成「原因类别 + 下一步该做什么」。
 *
 * 界面上不出现 HTTP 状态码、业务码、接口 URL、英文原文或堆栈——这些既解释不了
 * 问题，也帮不上用户。用户需要的是三件事：是我填错了、是权限、还是系统的问题，
 * 以及接下来该做什么。
 */
export type FailureCategory =
  | 'network'
  | 'auth'
  | 'permission'
  | 'notFound'
  | 'validation'
  | 'tooLarge'
  | 'conflict'
  | 'rateLimit'
  | 'server'
  | 'unknown';

export interface FailureNotice {
  category: FailureCategory;
  /** 标题：带上动作，例如「保存失败」。 */
  title: string;
  /** 说明：原因类别 + 可操作建议。 */
  description: string;
}

const CATEGORY_LABEL: Record<FailureCategory, string> = {
  network: '网络异常',
  auth: '登录状态已失效',
  permission: '权限不足',
  notFound: '无权限或内容不存在',
  validation: '提交内容有误',
  tooLarge: '文件或请求过大',
  conflict: '数据已被修改',
  rateLimit: '操作过于频繁',
  server: '服务暂时不可用',
  unknown: '未知错误',
};

const CATEGORY_ADVICE: Record<FailureCategory, string> = {
  network: '请求没有到达服务器。请检查网络连接后重试；若在公司内网，确认能正常访问系统地址。',
  auth: '请重新登录后再操作。若刚切换过账号或密码，重新登录即可恢复。',
  permission:
    '当前账号没有该操作的权限。请确认这条内容是否属于你，或联系内容所有者／本租户管理员在「角色权限」「资源授权」中授予相应权限。',
  notFound:
    '该内容可能已被删除，或当前账号没有修改它的权限。请刷新页面确认；若内容仍在，请联系内容所有者或本租户管理员授予「可编辑」权限。',
  validation: '请检查必填项和填写格式（如名称长度、数字范围）后重试。',
  tooLarge: '请压缩文件或分批提交后再试。',
  conflict: '这条内容已被其他操作修改。请刷新页面、确认最新内容后再提交。',
  rateLimit: '操作太频繁，请稍等片刻再试。',
  server:
    '后端服务暂时没有正常响应，通常稍后重试即可；若持续出现，请把操作时间告知管理员。',
  unknown: '请稍后重试；若问题持续，请把操作时间告知管理员，便于排查。',
};

const NETWORK_MESSAGE_PATTERNS = [
  /failed to fetch/i,
  /network ?error/i,
  /timeout/i,
  /econnaborted/i,
  /load failed/i,
];

/** 后端文案里带中文才可能是写给人看的；英文原文、堆栈一律不外露。 */
function isHumanMessage(message?: string) {
  return !!message && /[\u4e00-\u9fa5]/.test(message);
}

function pickCode(status?: number, code?: number) {
  if (typeof code === 'number' && code > 0) {
    return code;
  }
  return status;
}

/**
 * 归类失败原因。
 *
 * 只区分「用户能采取不同行动」的类别，不做更细的编码映射：同一个 404 在不同
 * 接口既可能是内容没了，也可能是无权访问，对用户来说处理方式相同。
 */
export function classifyFailure(input?: {
  status?: number;
  code?: number;
  message?: string;
}): FailureCategory {
  const message = input?.message ?? '';
  if (NETWORK_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))) {
    return 'network';
  }

  const code = pickCode(input?.status, input?.code);
  if (code === undefined) {
    // 有 message 但没有状态码，说明请求根本没拿到响应。
    return message ? 'network' : 'unknown';
  }

  switch (code) {
    case 1999: // 请求层在拿不到响应时自己填的码
      return 'network';
    case 401:
      return 'auth';
    case 403:
    case 108: // 业务码：无权限
      return 'permission';
    case 404:
      // 后端把「无权访问」收敛成 404，和「内容真的没了」共用这个码。
      return 'notFound';
    case 400:
    case 422:
    case 103: // 业务码：操作被后端按输入拒绝
      return 'validation';
    case 406:
    case 413:
      return 'tooLarge';
    case 409:
      return 'conflict';
    case 429:
      return 'rateLimit';
    case 500:
    case 502:
    case 503:
    case 504:
      return 'server';
    default:
      return 'unknown';
  }
}

/**
 * 生成一条可直接展示的失败提示。
 *
 * @param input 失败信息（HTTP 状态、业务码、原始 message 任填其一）
 * @param action 动作名，用于标题：「保存」→「保存失败」。默认「操作」。
 */
export function describeFailure(
  input?: { status?: number; code?: number; message?: string },
  action = '操作',
): FailureNotice {
  const category = classifyFailure(input);
  const parts = [`原因：${CATEGORY_LABEL[category]}。`, CATEGORY_ADVICE[category]];

  // 后端已经写成中文时，它比通用建议更具体（「同名文件已存在」「缺 xx 权限」），
  // 放在建议前面。英文原文、堆栈不进来。
  if (isHumanMessage(input?.message)) {
    parts.splice(1, 0, `${input?.message}。`);
  }

  return {
    category,
    title: `${action}失败`,
    description: parts.join(''),
  };
}

/** 登录态失效的提示：登录页会接管后续操作，这里只解释发生了什么。 */
export function describeSessionExpired(): FailureNotice {
  return {
    category: 'auth',
    title: '登录状态已失效',
    description: CATEGORY_ADVICE.auth,
  };
}

/** 从 HTTP 方法推断动作名，让提示能写成「保存失败」而不是干巴巴的「操作失败」。 */
export function actionLabelFromMethod(method?: string): string {
  switch ((method ?? '').toLowerCase()) {
    case 'get':
      return '加载';
    case 'delete':
      return '删除';
    case 'post':
    case 'put':
    case 'patch':
      return '保存';
    default:
      return '操作';
  }
}
