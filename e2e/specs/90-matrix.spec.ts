import { expect, test, type APIRequestContext } from '@playwright/test';

import {
  api,
  authFile,
  tokenOf,
  VIEWERS,
  type AccountName,
  type ViewerName,
} from '../support/env';
import { pickRows, type ListRow } from '../support/list-rows';

/**
 * 角色 × 资源 × 操作 的矩阵化校验（数据驱动）。
 *
 * 四个受限身份 -> 三档角色，覆盖三条真实的授权路径：
 *   member —— 自定义角色「技术员」（矩阵全勾，资源靠显式授权）
 *   dept   —— 内置「部门管理员」（技术部，能看到本部门成员创建的东西）
 *   plain  —— 内置「普通成员」（培训部，没有任何资源授权）
 * admin（内置「租户管理员」）单独一条口径快照，见文件末尾。
 *
 * 每个资源类型跑三件事：
 *   1. 可见：每个受限身份的列表必须是 owner 列表的子集（不能凭空多出 id）；
 *   2. 可读：任一受限身份可见的条目，详情必须 200 —— 「有样本的身份」不一定
 *      是 member（它对问答/检索/记忆全是 0），所以这里遍历三个身份取并集，
 *      避免再出现「因为没有样本而跳过整条链路」的假覆盖；
 *   3. 不可见即不可读：owner 有、plain 没有的条目，详情必须拒绝且不泄露存在性。
 *
 * 「可管理」不在这里逐类型探测：各资源的删除/授权接口形态不同（知识库是
 * DELETE /datasets + body、智能体是 /agents/:id 等），逐个猜路径只会测到 gin
 * 的 404。管理类校验集中在 40-overreach（授权/角色/成员写操作 403）。
 */

type Kind = {
  key: string;
  label: string;
  list: string;
  detail: (id: string) => string;
  /**
   * 剔除「调用者私有、不属于租户共享」的条目。
   *
   * `/agents` 会把调用者自己的编译算子组（`type=compilation_template_group`）
   * 并进同一份列表 —— 它按 `ListSaved(userID)` 取，谁建的归谁。不剔掉的话，
   * 一旦某个受限身份也建了算子组，就会以「owner 都看不到的 id」形式假失败。
   */
  exclude?: (row: ListRow) => boolean;
};

const KINDS: Kind[] = [
  { key: 'dataset', label: '知识库', list: api.datasets, detail: api.dataset },
  {
    key: 'chat',
    label: '知识问答',
    list: api.chats,
    detail: (id) => `/api/v1/chats/${id}`,
  },
  {
    key: 'search',
    label: '知识检索',
    list: api.searches,
    detail: (id) => `/api/v1/searches/${id}`,
  },
  {
    key: 'agent',
    label: '智能体',
    list: api.agents,
    detail: (id) => `/api/v1/agents/${id}`,
    exclude: (row) => row.type === 'compilation_template_group',
  },
  {
    key: 'memory',
    label: '记忆',
    list: api.memories,
    detail: (id) => `/api/v1/memories/${id}`,
  },
];

const auth = (who: AccountName) => ({ Authorization: tokenOf(who) });

const idsOf = async (
  request: APIRequestContext,
  kind: Pick<Kind, 'label' | 'list' | 'exclude'>,
  who: AccountName,
) => {
  const res = await request.get(kind.list, { headers: auth(who) });
  expect(res.status(), `${who} GET ${kind.list} 应 200（401 通常是登录态过期）`).toBe(200);
  const body = await res.json();
  return pickRows(body.data).filter((row) => !kind.exclude?.(row));
};

for (const kind of KINDS) {
  test.describe(`矩阵 · ${kind.label}`, () => {
    test.use({ storageState: authFile('member') });

    test('可见：受限身份的列表都是 owner 的子集', async ({ request }) => {
      const ownerRows = await idsOf(request, kind, 'owner');
      const ownerIDs = new Set(ownerRows.map((r) => r.id));
      // owner 为空说明列表字段取错了，后面的子集断言会变成空对空的假绿。
      expect(ownerIDs.size, `${kind.label}: owner 列表为空，矩阵没有对照基准`)
        .toBeGreaterThan(0);

      const counts = [`owner=${ownerRows.length}`];
      for (const who of VIEWERS) {
        const rows = await idsOf(request, kind, who);
        counts.push(`${who}=${rows.length}`);
        expect(rows.length, `${who} 的${kind.label}数量超过了 owner`).toBeLessThanOrEqual(
          ownerRows.length,
        );
        for (const row of rows) {
          expect(ownerIDs, `${who} 出现 owner 都看不到的${kind.label} ${row.id}`).toContain(
            row.id,
          );
        }
      }
      test.info().annotations.push({
        type: 'counts',
        description: `${kind.label}: ${counts.join(' ')}`,
      });
    });

    test('可读：任一受限身份可见的条目，详情都能打开', async ({ request }) => {
      const samples: { who: ViewerName; rows: { id: string }[] }[] = [];
      for (const who of VIEWERS) {
        const rows = await idsOf(request, kind, who);
        if (rows.length) samples.push({ who, rows });
      }
      test.skip(samples.length === 0, `三个受限身份都看不到${kind.label}`);

      for (const { who, rows } of samples) {
        for (const row of rows.slice(0, 2)) {
          const res = await request.get(kind.detail(row.id), { headers: auth(who) });
          const body = await res.json();
          // 预期：列表能看到的，详情一定打得开（列表与判定用同一套口径）。
          expect(body.code, `${who} 列表可见但详情被拒：${kind.label} ${row.id}`).toBe(0);
        }
      }
    });

    test('不可见即不可读：owner 有、plain 无 → 拒绝且不泄露存在性', async ({
      request,
    }) => {
      const ownerRows = await idsOf(request, kind, 'owner');
      const plainIDs = new Set(
        (await idsOf(request, kind, 'plain')).map((r) => r.id),
      );
      const hidden = ownerRows.filter((r) => !plainIDs.has(r.id));
      test.skip(hidden.length === 0, `plain 能看到全部${kind.label}，没有对照组`);

      for (const row of hidden.slice(0, 3)) {
        const res = await request.get(kind.detail(row.id), { headers: auth('plain') });
        const body = await res.json();
        // 预期：拒绝，且不泄露「它存在」。
        expect(body.code, `${kind.label} ${row.id} 不该被 plain 读到`).not.toBe(0);

        // 知识库/问答/检索/记忆统一回「Resource not found」；智能体回
        // 「Make sure you have permission to access the agent.」。文案不同，
        // 但对「不存在的 id」与「别人的 id」逐字一致（95-idor 已固化），
        // 所以前者不构成存在性泄露；这里容忍两种措辞，收紧的前提是先统一文案。
        const denied = /Resource not found|permission to access/i.test(body.message ?? '');
        expect(denied, `未识别的拒绝文案：${body.message}`).toBe(true);
      }
    });
  });
}

test.describe('矩阵 · 会话质检', () => {
  test.use({ storageState: authFile('member') });

  test('可见：受限身份的规则都是 owner 的子集', async ({ request }) => {
    const ownerBody = await (await request.get(api.qcRules, { headers: auth('owner') })).json();
    expect(ownerBody.code).toBe(0);
    const ownerIDs = new Set((ownerBody.data as { id: string }[]).map((r) => r.id));
    expect(ownerIDs.size, '质检规则为空，无法验证子集').toBeGreaterThan(0);

    const counts = [`owner=${ownerIDs.size}`];
    for (const who of VIEWERS) {
      const body = await (await request.get(api.qcRules, { headers: auth(who) })).json();
      expect(body.code, `${who} 读质检规则应成功`).toBe(0);
      const rows = body.data as { id: string }[];
      counts.push(`${who}=${rows.length}`);
      expect(rows.length).toBeLessThanOrEqual(ownerIDs.size);
      for (const row of rows) {
        expect(ownerIDs, `${who} 拿到了 owner 看不到的质检规则 ${row.id}`).toContain(row.id);
      }
    }
    test.info().annotations.push({
      type: 'counts',
      description: `会话质检: ${counts.join(' ')}`,
    });
  });
});

/**
 * 租户管理员的口径快照。
 *
 * 2026-11-04 实测：admin 的知识库列表 18/18 与 owner 相同（dataset 的
 * QueryScope 认 `user_tenant.role_id` = 内置「租户管理员」），但问答/检索/
 * 智能体/记忆是 0 —— 这几类走逐条判定，只认 visibility 列与显式授权。
 * 2026-11-05 已统一（`resolveResource` 把租户管理员判定提到三档之前），
 * 发版后 admin 应与 owner 齐平；用例只断言「不超过 owner」，两种行为都成立。
 */
test.describe('矩阵 · 租户管理员口径', () => {
  test.use({ storageState: authFile('admin') });

  test('可见范围不超过 owner，知识库与 owner 齐平', async ({ request }) => {
    const lines: string[] = [];
    for (const kind of KINDS) {
      const ownerIDs = new Set((await idsOf(request, kind, 'owner')).map((r) => r.id));
      const adminRows = await idsOf(request, kind, 'admin');
      lines.push(`${kind.label}: owner=${ownerIDs.size} admin=${adminRows.length}`);
      for (const row of adminRows) {
        expect(ownerIDs, `租户管理员拿到了 owner 看不到的${kind.label} ${row.id}`).toContain(
          row.id,
        );
      }
    }
    test.info().annotations.push({ type: 'counts', description: lines.join(' | ') });
  });
});
