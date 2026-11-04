import { expect, test } from '@playwright/test';

import { IDENTITIES, api, authFile, tokenOf } from '../support/env';

const TID = IDENTITIES.owner.tenantId;

/**
 * 文件级「排除」的端到端链路 —— **会写数据，默认不跑**。
 *
 *   E2E_ALLOW_WRITE=1 npx playwright test specs/87-file-deny.spec.ts
 *
 * 流程：建临时库 → 传 2 个 txt → 库级给全团队可编辑（member 能看库、能看两个文件）
 *      → 对第 2 个文件加「member 不可见」→ member 的文件列表里少一个
 *      → 删库收尾。
 *
 * 库内文件的 deny 是既有能力（`document_scope.go`），这条用例补的是「配置界面
 * 之外、接口层真的生效」这一环 —— 之前只验证过 supports_deny 标记。
 */
test.describe('文件级排除 · 正向链路', () => {
  test.skip(
    !process.env.E2E_ALLOW_WRITE,
    '写用例：需要 E2E_ALLOW_WRITE=1 显式开启（会建库、传文件、删库）',
  );

  test.use({ storageState: authFile('owner') });

  const ownerHeaders = () => ({ Authorization: tokenOf('owner') });
  const memberHeaders = () => ({ Authorization: tokenOf('member') });

  let kbID = '';
  let memberID = '';
  let docs: { id: string; name: string }[] = [];
  const kbName = `E2E-文件排除-${Date.now()}`;

  test.beforeAll(async ({ request }) => {
    const list = await (await request.get(api.datasets, { headers: ownerHeaders() })).json();
    const sample = (list.data as { embedding_model?: string }[]).find((d) => d.embedding_model);
    expect(sample?.embedding_model, '租户里没有可借用的 embedding_model').toBeTruthy();

    const created = await (
      await request.post(api.datasets, {
        headers: { ...ownerHeaders(), 'Content-Type': 'application/json' },
        data: {
          name: kbName,
          embedding_model: sample!.embedding_model,
          parser_id: 'general',
          parse_type: 1,
        },
      })
    ).json();
    expect(created.code, `建库失败：${created.message}`).toBe(0);
    kbID = created.data.id;

    // 传两个小文本文件（type=local 表示本地上传）。
    const uploaded = await (
      await request.post(`/api/v1/datasets/${kbID}/documents`, {
        headers: ownerHeaders(),
        multipart: {
          type: 'local',
          file: {
            name: 'e2e-deny-a.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('第一个文件：允许成员查看。'),
          },
        },
      })
    ).json();
    expect(uploaded.code, `上传失败：${uploaded.message}`).toBe(0);

    const second = await (
      await request.post(`/api/v1/datasets/${kbID}/documents`, {
        headers: ownerHeaders(),
        multipart: {
          type: 'local',
          file: {
            name: 'e2e-deny-b.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('第二个文件：将被排除。'),
          },
        },
      })
    ).json();
    expect(second.code, `第二次上传失败：${second.message}`).toBe(0);

    const me = await (await request.get('/api/v1/users/me', { headers: memberHeaders() })).json();
    memberID = me.data.id;

    // 库级：全团队可编辑，member 才能进得来。
    const granted = await (
      await request.put(api.setGrants(TID, 'dataset', kbID), {
        headers: { ...ownerHeaders(), 'Content-Type': 'application/json' },
        data: {
          subjects: [{ kind: 'team', id: '', permission: 'edit', effect: 'allow' }],
        },
      })
    ).json();
    expect(granted.code, `库级授权失败：${granted.message}`).toBe(0);
  });

  test.afterAll(async ({ request }) => {
    if (!kbID) return;
    const res = await request.delete(api.datasets, {
      headers: { ...ownerHeaders(), 'Content-Type': 'application/json' },
      data: { ids: [kbID] },
    });
    const body = await res.json();
    if (body.code !== 0) {
      console.error(`[87] 临时知识库未删除，请手工清理：${kbID} (${kbName})`);
    }
  });

  test('库内两个文件对 member 都可见', async ({ request }) => {
    const res = await request.get(`/api/v1/datasets/${kbID}/documents?page_size=50`, {
      headers: memberHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const rows = (body.data?.docs ?? body.data?.documents ?? body.data ?? []) as {
      id: string;
      name: string;
    }[];
    docs = rows.filter(Boolean);
    test.info().annotations.push({
      type: 'counts',
      description: `member 可见文件数=${docs.length}`,
    });
    expect(docs.length, 'member 应能看到库内 2 个文件').toBe(2);
  });

  test('给第 2 个文件加排除 → member 只剩 1 个，owner 仍是 2 个', async ({
    request,
  }) => {
    expect(docs.length, '依赖上一条用例拿到的文件列表').toBe(2);
    const target = docs.find((d) => d.name.includes('b.txt')) ?? docs[1];

    const denied = await (
      await request.put(api.setGrants(TID, 'document', target.id), {
        headers: { ...ownerHeaders(), 'Content-Type': 'application/json' },
        data: {
          // 文件级必须带所属知识库：parent_id 在 body 里，不是 query。
          parent_id: kbID,
          subjects: [
            { kind: 'user', id: memberID, permission: 'read', effect: 'deny' },
          ],
        },
      })
    ).json();
    expect(denied.code, `文件级排除写入失败：${denied.message}`).toBe(0);

    const memberList = await (
      await request.get(`/api/v1/datasets/${kbID}/documents?page_size=50`, {
        headers: memberHeaders(),
      })
    ).json();
    const memberRows = (memberList.data?.docs ?? memberList.data?.documents ?? memberList.data ?? []) as {
      id: string;
    }[];
    expect(memberRows.length, '被排除的文件不应出现在 member 的文件列表').toBe(1);
    expect(memberRows.map((r) => r.id)).not.toContain(target.id);

    // 对照：owner 不受影响（排除只作用于被点名的成员）。
    const ownerList = await (
      await request.get(`/api/v1/datasets/${kbID}/documents?page_size=50`, {
        headers: ownerHeaders(),
      })
    ).json();
    const ownerRows = (ownerList.data?.docs ?? ownerList.data?.documents ?? ownerList.data ?? []) as {
      id: string;
    }[];
    expect(ownerRows.length, 'owner 应仍能看到 2 个文件').toBe(2);
  });
});
