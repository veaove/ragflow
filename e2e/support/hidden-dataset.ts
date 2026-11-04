/**
 * 「别人看不到的库」不能写死。
 *
 * 目标环境是真实租户，管理员随时可能把某个库改成「全团队可见」——写死一个 id
 * 会让越权用例在数据变动后变成假红/假绿（曾经因为 07-帮助中心 被临时开成全团队，
 * 5 条与它相关的断言同时翻转）。这里改成从两份列表里求差集：
 * owner 看得到、member 看不到的第一个库，才是当下真正的「私有库」。
 */
import { request as playwrightRequest } from '@playwright/test';

import { BASE_URL, api, tokenOf } from './env';

export type DatasetRef = { id: string; name: string };

export const pickHiddenDataset = async (): Promise<DatasetRef> => {
  const client = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    const [ownerRes, memberRes] = await Promise.all([
      client.get(api.datasets, { headers: { Authorization: tokenOf('owner') } }),
      client.get(api.datasets, { headers: { Authorization: tokenOf('member') } }),
    ]);
    const owner = (((await ownerRes.json()).data ?? []) as DatasetRef[]).filter(Boolean);
    const member = new Set(
      (((await memberRes.json()).data ?? []) as DatasetRef[]).map((d) => d.id),
    );
    const hidden = owner.find((d) => !member.has(d.id));
    if (!hidden) {
      throw new Error(
        '当前租户没有 member 读不到的知识库：越权用例的数据前提失效（库被临时授权给全团队？），请恢复或改用专用测试库',
      );
    }
    return { id: hidden.id, name: hidden.name };
  } finally {
    await client.dispose();
  }
};
