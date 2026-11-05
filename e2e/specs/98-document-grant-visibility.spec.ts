import { expect, test } from '@playwright/test';

import { IDENTITIES, RESOURCES, api, tokenOf } from '../support/env';
import { pickRows } from '../support/list-rows';

const TID = IDENTITIES.owner.tenantId;
const FOLDER_NAME = '综合部';

type TreeNode = {
  id: string;
  name: string;
  file_count: number;
  exception_count: number;
  children?: TreeNode[];
};

type ExceptionRow = {
  resource_id: string;
  resource_name: string;
  restricted: boolean;
  grants?: { kind: string; name: string; permission?: string; effect?: string }[];
};

const flatten = (nodes: TreeNode[]): TreeNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);

/**
 * 文件级「排除」的**信息面**：读不到的文件不能只藏内容 —— 名字、数量与授权关系
 * 同样不能出现。
 *
 * 2026-11-05 的现象：普通成员对「07-帮助中心 / 综合部 / 全触点分析产品功能说明书(1).docx」
 * 没有查看权限，却在资源授权页看到「1 例外」，在「全部文件」里看到这个文件与
 * 「和君测试(已排除)」的标记。原因是授权树与子项例外只按**库**收窄，没有按
 * 文件级名单制收窄：文件列表本身走 `DocumentVisibility`，这两处却漏了。
 *
 * 只读用例：文件 id 从真实租户里解析，不硬编码，换一批文件照样成立。
 */
test.describe('文件级排除 · 信息面', () => {
  test('读不到的文件不出现在授权树与子项例外里', async ({ request }) => {
    const get = async (path: string, who: 'owner' | 'member') => {
      const res = await request.get(path, { headers: { Authorization: tokenOf(who) } });
      expect(res.status(), `${who} GET ${path}`).toBe(200);
      const body = await res.json();
      expect(body.code, `${who} GET ${path}: ${body.message}`).toBe(0);
      return body.data;
    };

    // owner 侧的全量对照：成员的可见范围必须严格小于它，用例才不是空跑。
    const ownerTree = flatten((await get(api.grantTree(TID), 'owner')).nodes ?? []);
    const folder = ownerTree.find((node) => node.name === FOLDER_NAME);
    expect(folder, `租户里没有「${FOLDER_NAME}」文件夹`).toBeTruthy();

    const exceptionPath = (folderID: string) =>
      `${api.grantExceptions(TID)}?kind=dataset&dataset_id=${RESOURCES.privateKb.id}` +
      `&folder_id=${folderID}&all=1&page=1&page_size=200`;

    const ownerItems = (await get(exceptionPath(folder!.id), 'owner')).items as ExceptionRow[];
    const memberPage = await get(exceptionPath(folder!.id), 'member');
    const memberItems = memberPage.items as ExceptionRow[];

    // 成员看得到的库内文件：与「文件列表」同一份判定。
    const memberDocs = pickRows(
      await get(`${api.dataset(RESOURCES.privateKb.id)}/documents?page_size=200`, 'member'),
    );
    const memberVisible = new Set(memberDocs.map((row) => row.id));

    test.info().annotations.push({
      type: 'counts',
      description:
        `owner 例外=${ownerItems.length} 成员例外=${memberItems.length} ` +
        `成员可见文件=${memberVisible.size} 成员例外总数=${memberPage.exception_total}`,
    });

    // 数据前提：确实存在「owner 看得到、成员看不到」的例外文件。
    const hidden = ownerItems.filter((row) => !memberVisible.has(row.resource_id));
    expect(
      hidden.length,
      `「${FOLDER_NAME}」里没有成员读不到的例外文件，这条用例证明不了什么`,
    ).toBeGreaterThan(0);

    // 断言 1：子项例外只允许出现成员读得到的文件（名字与「已排除」规则都不外泄）。
    for (const row of memberItems) {
      expect(
        memberVisible.has(row.resource_id),
        `成员读不到 ${row.resource_name}，它不该出现在子项例外里（规则：${(row.grants ?? [])
          .map((g) => `${g.name}:${g.effect ?? 'allow'}:${g.permission ?? 'edit'}`)
          .join(',')}）`,
      ).toBe(true);
    }

    // 断言 2：授权树上的「N 例外」跟着同一份判定走，不能用数字承认「还有一个你看不到」。
    const memberFolder = flatten((await get(api.grantTree(TID), 'member')).nodes ?? []).find(
      (node) => node.id === folder!.id,
    );
    expect(memberFolder, `成员的授权树上没有「${FOLDER_NAME}」`).toBeTruthy();
    expect(
      memberFolder!.exception_count,
      `授权树「${FOLDER_NAME}」例外数应等于成员可见的例外文件数`,
    ).toBe(memberItems.length);
    expect(
      memberFolder!.file_count,
      `授权树「${FOLDER_NAME}」文件数不能把读不到的文件算进去`,
    ).toBeLessThanOrEqual(memberVisible.size);

    // 断言 3：「按成员」视角里也不能出现这些文件的名字。
    const members = pickRows(await get(api.members(TID), 'owner'));
    const member = members.find((row) => row.email === IDENTITIES.member.email);
    expect(member, `成员列表里没有 ${IDENTITIES.member.email}`).toBeTruthy();

    const ownGrants = await get(api.grantsBySubject(TID, member!.id), 'member');
    const hiddenNames = new Set(hidden.map((item) => item.resource_name));
    for (const row of ownGrants.rows as { resource_kind: string; resource_name: string }[]) {
      if (row.resource_kind !== 'document') continue;
      expect(
        hiddenNames.has(row.resource_name),
        `按成员视角泄露了读不到的文件：${row.resource_name}`,
      ).toBe(false);
    }
  });
});
