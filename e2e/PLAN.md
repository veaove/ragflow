# 权限与资源授权 E2E（Playwright）

目标：在真实租户（华夏基金，`172.30.20.51`）上验证角色矩阵、资源授权、资源可见范围三条链路，
以及普通成员的越权边界。**默认全部只读**，不创建、不修改、不删除业务数据。

## 目录

```
e2e/
├── accounts.json          # 两个测试账号（owner / member）
├── playwright.config.ts   # 单 worker、串行、失败留 trace
├── scripts/               # auth.mjs 生成登录态；probe.mjs 探页面事实
├── support/env.ts         # 账号、租户、真实资源 ID、接口前缀
├── support/global-setup.ts# .auth 缺失时自动跑 auth.mjs
├── support/hidden-dataset.ts # 「member 读不到的库」按数据求差集，不写死 id
└── specs/
    ├── 00-smoke.spec.ts        # 登录态、一级导航、未登录跳转
    ├── 10-role-matrix.spec.ts  # 角色列表、矩阵渲染、Owner 满格、D4/D5 回归
    ├── 20-grant.spec.ts        # 授权树层级、右栏联动、接口字段
    ├── 30-resource-scope.spec.ts # 六类资源的可见边界与接口计数
    ├── 40-overreach.spec.ts    # 越权 + D1/D2/D3 回归断言
    ├── 50-boundary.spec.ts     # 分页上下界、通配符、超长参数、越界 id
    ├── 60-invalid-input.spec.ts# 畸形 JSON、非法 kind、缺参、401/403
    ├── 70-keypaths.spec.ts     # 页面往返、角色切换、成员入口不串台
    ├── 80-exclude.spec.ts      # 资源级「排除」：supports_deny、入口、非法组合
    ├── 85-exclude-flow.spec.ts # 排除的正向链路（建/删临时库，需 E2E_ALLOW_WRITE=1）
    └── 90-matrix.spec.ts       # 角色×资源×操作 矩阵回归（数据驱动，五类资源 + 质检）
```

测试方案（范围、用例矩阵、验收标准）见 `docs/e2e-role-grant-test-plan.md`。

## 只读基线

- 写接口一律打**不存在的资源 id**（`does-not-exist-0001`）：权限层放行才会走到「资源不存在」，
  因此 403 能证明拦截生效，且不改任何数据。
- 已知缺陷用 `test.fixme` 或「断言当前行为」的 FINDING 用例固化，不写 `test.skip`，
  修复后用例变红提醒更新。
- 需要真正写入的用例必须显式开 `E2E_ALLOW_WRITE=1`，并先建后删。

## 已知缺陷

完整的场景覆盖清单、分级与未覆盖项见 `docs/e2e-permission-report.md`；下表只留演进记录。

| # | 缺陷 | 证据 | 处理 | 修复 |
|---|---|---|---|---|
| D1 | 成员看不到自己创建的私库：详情 200，列表缺失 | `技术部(2)` 详情 `code=0`，`GET /datasets` 只回 2 个被授权的库 | `40-overreach` 的 `test.fixme`；列表 scope 只认 owner / team / 授权 / 部门管理员，漏了 `created_by = 本人` | `8ba40d72e`：`QueryScope` 的 SQL 补 `created_by`，用例转正 |
| D2 | 成员能读整棵资源授权树（18 个库，含打不开的私库） | `GET /tenants/:id/grant-tree` 对该成员 `code=0, total=18` | FINDING 用例；只读、写已 403，属信息暴露 | `8ba40d72e` `266dd05f0`：树/列表/子项/按成员全部按读权限收窄；文件与文件夹是租户级资产，不收窄 |
| D3 | 质检规则未按资源授权过滤，按租户返回 | 成员 `GET /qc/rules` 拿到 9 条规则 | FINDING 用例；规则归属应用对成员不可见，规则本身仍可读 | `8ba40d72e`：普通成员收窄到可见 chat/canvas 应用，管理层保持全量 |
| D4 | 内置角色矩阵可被空写覆盖，随后被静默回填 | `PUT /roles/:id/permissions` 提交 `{permissions: []}` 返回成功，下次 `ListRoles` 又按 `ConsoleModules` 补回默认行 | 不写成用例（要写线上数据）；`dao.backfillBuiltinRolePermissions` 无法区分「模块新增」与「管理员撤销」 | `8ba40d72e`：保存时补满 25 行（false 也落库），Owner 矩阵拒绝写入 |
| D5 | 内置角色可被改名，而多处逻辑按名字匹配 | `PUT /roles/:id` 无 `is_builtin` 保护；`EnsureTenantAdminRole` / backfill 按 `name` 查 | 前端已禁用编辑，接口层未拦；同上，只记录 | `8ba40d72e`：`UpdateRole` 拒绝内置角色 |

修复的单测结论：`/root/rf-verify` 全量 `./build.sh --test` → **0 FAIL / 131 packages ok**（2026-11-03）。
E2E 里的 D1–D5 回归断言要等这次后端发版后才转绿，它们是发版的验收条件。

## 运行

```bash
cd e2e
npm install
npx playwright install chromium   # 首次
npm test                          # 全部
npm run test:overreach            # 单个 spec
npm run report                    # 看 HTML 报告
```

登录态失效（token 被顶掉）时重跑 `node scripts/auth.mjs`，或删掉 `.auth/*.json` 交给
`global-setup` 自动生成。

## 资源级「排除」（2026-11-04）

语义（实现见 `internal/permission/policy_ce.go` 的 `grantLevel` 与 dataset `QueryScope`）：

1. deny 恒压 allow；命中一条即不可见（列表、详情、检索一致）。
2. deny 不作用于创建者、租户 owner/admin、部门管理员（避免把资源锁到没人能取消）。
3. 「全团队」不能作为排除对象（等价于清空授权，接口拒绝）。
4. 库级 deny 短路文件级规则；文件级 deny 仍是库内细化。
5. 目前只对 `dataset` + `document` 开放写入，其余 kind 接口拒绝（`grantDenyKinds`）。

`80-exclude.spec.ts` 的现状：3 条「拒绝非法组合」在当前线上版本就通过；4 条
`supports_deny` / 界面入口断言要等这批改动发版后转绿。

### 发版后要补的正向验收（现在不自动化，因为要向真实库写排除规则）

| 用例 | 预期 |
|---|---|
| 全团队允许 + 张三排除 | 张三：列表无、详情 404、检索不命中；李四正常 |
| 部门允许 + 张三（在该部门）排除 | 同上，排除压过部门 |
| 张三被排除但他是创建者 | 仍可见，保存时后端就拒绝写这条规则 |
| 只有排除、没有允许 | 等价「仅所有者可见」，不报错 |
| 库级排除 + 库内文件级允许 | 仍不可见（库级优先） |
| 同一资源同时命中 allow + deny（不同主体） | deny 胜 |
| 树摘要 | 有排除的节点显示「N 个主体 · 排除 M」，橙色 |

## 两个踩过的坑

- **登录态会过期**：失效时接口回 401，而 `expect(body.code).not.toBe(0)` 对这种
  用例照样"通过"——拒绝类断言必须先断 `res.status() === 200`，否则假绿。
- **别写死「别人看不到的库」**：目标租户是真实环境，管理员把某个库临时开成全团队后，
  5 条写死 id 的断言同时翻转。用 `support/hidden-dataset.ts` 求 owner/member 列表差集。
