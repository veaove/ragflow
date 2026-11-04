# 权限与资源授权 E2E 测试报告

| 项 | 内容 |
|---|---|
| 报告日期 | 2026-11-04（第三轮：资源级「排除」改造 + 全量回归） |
| 被测环境 | `http://172.30.20.51`（内网）。线上已含 D1–D5 修复（实测 member 的授权树 `total` 已从 18 收窄到 4）；本轮「排除」功能尚未发版 |
| 被测租户 | 华夏基金 `8d5c79460d6c46efb58353c68d8bf729` |
| 测试账号 | `owner` = 123456789@qq.com（租户所有者）；`member` = hjzd@hjzd.com（自定义角色「技术员」，矩阵 25 模块全勾） |
| 测试框架 | Playwright 1.64.1 / Chromium，单 worker 串行，`fullyParallel=false` |
| 用例位置 | `e2e/specs/00~80-*.spec.ts`，设计说明见 `e2e/PLAN.md` |
| 执行结果 | **55 用例：51 passed / 4 failed**，总耗时 1.3 min。4 条失败全部是「排除」功能的 `supports_deny` / 界面入口断言，等本轮改动发版后转绿（见 §1.9） |
| 测试基线 | **默认只读**：不创建、不修改、不删除业务数据；写接口打不存在的资源或提交「与现状相同」的值 |

## 0. 只读基线与判定口径

- 写接口一律打**不存在的资源 id**（`does-not-exist-0001`）：权限层放行才会走到「资源不存在」，因此 **403 能证明拦截生效且不改任何数据**。
- 已知缺陷用 `test.fixme` 或「断言当前行为」的 FINDING 用例固化，不用 `test.skip`：修复后用例会变红，提醒更新断言。
- 资源可见口径（与实现一致）：`创建者 | 租户管理层 | 授权`；写操作额外要求租户管理层，与权限矩阵无关。
- 资源不可见时的返回约定：错误码非 0 且 message 含 `Resource not found`，不泄露「该资源存在」。

---

## 1. 已覆盖的业务场景清单

### 1.1 冒烟（`00-smoke.spec.ts`，4 条）

| 场景 | 测试范围 | 结果 |
|---|---|---|
| 登录态有效，身份与一级导航正确（owner） | 打开 `/datasets`，断言顶栏邮箱为本人；9 个一级导航（总览 / 知识库 / 知识问答 / 知识搜索 / 智能体 / 记忆中心 / 会话质检 / 文件管理 / 租户中心）全部可见 | 通过 |
| 登录态有效，身份与一级导航正确（member） | 同上，改用 member 的 storageState | 通过 |
| 未登录访问被重定向到登录页（owner / member 各一次） | 新建**空登录态**上下文访问 `/datasets`，断言最终 URL 落到 `/login` 且登录卡渲染 | 通过 |

> 说明：前端**没有路由守卫**，跳转由 `/api/v1/users/me` 的 401 触发，实测 3~4 s（先 401，再拉 captcha 与 `system/config` 才渲染登录页）。

### 1.2 角色权限矩阵（`10-role-matrix.spec.ts`，3 条）

| 场景 | 测试范围 | 结果 |
|---|---|---|
| 内置与自定义角色都在列表里，且能切换矩阵 | `/console/roles`：Owner、普通成员、租户管理员、部门管理员（4 个内置）+ 技术员、质检员（2 个自定义）；Owner 描述含「不可编辑」；切到「技术员」后矩阵仍渲染知识库 / 知识问答 / 知识搜索 / 智能体 / 记忆中心 / 资源授权 6 个模块及「查看 / 管理」两档 | 通过 |
| 接口层：矩阵含 25 个模块，技术员为全勾 | `GET /tenants/:tid/roles`：`modules.length = 25`；「技术员」存在且 `is_builtin = false` | 通过 |
| Owner 内置角色：矩阵满 25 个模块且全勾 | 只读断言 Owner `is_builtin = true`、描述含「不可编辑」、权限行数 = 模块数、25 行 × 5 个动作（view/create/edit/delete/manage）全为 true | 通过 |

> 该组原有一条「Owner 矩阵写入必须被拒绝」的断言，核对 `internal/dao/role.go` 后确认与实现相反：后端**刻意**允许 owner 微调内置角色的矩阵（仅禁止删除内置角色）。已改写为只读断言，理由见 §2「非产品缺陷」。

### 1.3 资源授权（`20-grant.spec.ts`，4 条）

| 场景 | 测试范围 | 结果 |
|---|---|---|
| 资源树按「库 → 文件夹」展示并给出文件数与摘要 | `/console/grants`：头部「资源（18 个库）」「N 个文件」；默认只展开根节点，库 `07-帮助中心` 可见，文件不进树 | 通过 |
| 点知识库 → 右栏切换；点子文件夹 → 右栏跟进（回归） | 点 `07-帮助中心` 后右栏 `h2` 标题随之切换，出现「本层授权」「子项例外」；再点其下文件夹「银行介绍」，标题切换为「银行介绍」并提示「文件夹不单独授权，规则落在知识库与文件上」（历史缺陷回归点：曾回落到第一个知识库） | 通过 |
| 「按成员」视角给出直接授权/部门来源 | 切到「按成员」Tab，出现「直接授权 / 部门 / 全团队」来源标识 | 通过 |
| 接口层：授权树带出文件数与例外数 | `GET /tenants/:tid/grant-tree?kind=dataset`：`total = 18 = nodes.length`；`07-帮助中心` 的 `file_count = 44` 且 `children` 为数组（实测子文件夹：华夏基金 6、操作手册 0、银行介绍 37）；`问数-示例SQL-fund_demo` 在树中 | 通过 |

### 1.4 资源可见范围（`30-resource-scope.spec.ts`，7 条）

| 场景 | 测试范围 | 结果 |
|---|---|---|
| 知识库列表包含未授权的私有库（owner） | `/datasets` 可见 `07-帮助中心`（private）与 `问数-示例SQL-fund_demo`（granted） | 通过 |
| 知识问答 / 知识搜索 / 记忆 / 智能体 / 质检都有数据（owner） | `/chats` 见「基金咨询」、`/searches` 见「客服部智能检索」、`/memories` 见「华夏基金」、`/agents` 见「华小夏-IVR（按键菜单）」、`/qc` 见「共 N 条」 | 通过 |
| 知识库只看到被授权的两个库（member） | `/datasets` 见 `问数-示例SQL-fund_demo`，且 `07-帮助中心` 出现次数为 0 | 通过 |
| 知识问答 / 知识搜索 / 记忆为空态（member） | 三页分别渲染「尚未创建聊天应用」「尚未创建搜索应用」「尚未创建记忆」 | 通过 |
| 智能体只看到被授权的那一个（member） | 见「问数助手·fund_demo」，未见「华小夏-IVR（按键菜单）」 | 通过 |
| 会话质检没有可配置的应用（member） | `/qc` 的空态文案「暂无可配置的应用，请先创建聊天应用或对话流」可见 | 通过 |
| member 的可见集合是 owner 的真子集（接口计数） | `datasets` 2 < 18；`chats` 0；`searches` 0；`agents` 1 且 owner > 1 | 通过 |

实测计数：知识库 owner 18 / member 2（两个均为显式授权，`permission=me`）；聊天 7 / 0；搜索 2 / 0；智能体 27 / 1。

### 1.5 越权访问（`40-overreach.spec.ts`，6 条）

| 场景 | 测试范围 | 结果 |
|---|---|---|
| 读别人的私有知识库 → 404，且不泄露存在性 | member `GET /datasets/56c2dfd3…`：`code ≠ 0` 且 message 含 `Resource not found` | 通过 |
| 读被授权的知识库 → 200 | member `GET /datasets/1febaf3e…`：`code = 0`，返回 id 一致 | 通过 |
| 改资源授权 / 角色矩阵 / 成员角色 → 403 | member `PUT grants/dataset/{不存在}`、`PUT roles/{不存在}/permissions`、`PUT console/members/{不存在}` 全部 HTTP 403（先于「资源不存在」判定，说明拦截在权限层） | 通过 |
| FINDING：成员能读到资源授权树 | member `GET grant-tree`：`code = 0`、`total = 18`（含其打不开的私库） | 通过（记录缺陷 D2） |
| FINDING：质检规则未按资源授权过滤 | member `GET /qc/rules`：`code = 0`，返回 9 条规则 | 通过（记录缺陷 D3） |
| 成员能看到自己创建的私库（D1 回归） | member 对 `技术部(2)` 详情与列表都可见 | 断言已转正，等发版转绿 |

### 1.6 边界条件（`50-boundary.spec.ts`，10 条）

| 场景 | 预期 | 结果 |
|---|---|---|
| `page=0&page_size=0` | code 101「greater than or equal to 1」，不落到 `LIMIT 0` | 通过 |
| `page=-1&page_size=1000` | code 101，负 offset 不透传 | 通过 |
| 授权列表 `page_size=1000` | code 0，`page_size > 200` 回落默认 20，行数与 total 一致（18） | 通过 |
| 授权树 `keywords=%` | code 0、total 0（`%` 按字面量，不是通配符） | 通过 |
| 授权树 `keywords` 300 字符 | code 0、total 0，不 500 | 通过 |
| `grant-exceptions` 缺 `dataset_id` | code 102「缺少知识库 id」 | 通过 |
| 不存在的租户 | HTTP 403「租户不存在」，不返回 200+空树 | 通过 |
| 未知 kind（grants / grant-tree） | 各自显式报错（不支持的资源类型 / 没有层级结构） | 通过 |
| 不存在的资源 id | 与「无权访问」同一条 message `Resource not found` | 通过 |
| member 查他人 / 自己的授权清单 | 他人 403、自己 200（D2 回归） | 失败（未发版） |

### 1.7 异常输入（`60-invalid-input.spec.ts`，7 条）

| 场景 | 预期 | 结果 |
|---|---|---|
| 授权写入体是畸形 JSON | HTTP 400 + code 400（解析先于权限/资源校验，不落库） | 通过 |
| 授权写入 `kind=bogus` | code 非 0「不支持的资源类型」 | 通过 |
| 授权写入打不存在的资源 | code 非 0「资源不存在」 | 通过 |
| 质检规则只给 `app_type` 或只给 `app_id` | code 101「must be provided together」 | 通过 |
| 不带 Authorization | HTTP 401「Missing Authorization header」 | 通过 |
| 伪造 token | HTTP 401「Invalid access token」 | 通过 |
| member 请求里塞别的租户 id | HTTP 403「租户不存在」，不回落到自己的租户 | 通过 |

### 1.8 关键路径（`70-keypaths.spec.ts`，4 条）

| 场景 | 预期 | 结果 |
|---|---|---|
| 授权页「按资源 ↔ 按成员」往返 | 回来后仍选中同一个库，右栏不退回第一个库 | 通过 |
| 角色矩阵连续切换 3 个角色 | 每次都渲染矩阵首行「知识库」，不串台 | 通过 |
| member 打开授权树页（D2 的 UI 面） | 只出现自己可读的库，owner 私库不出现 | 失败（未发版） |
| member 打开知识库列表页 | 被授权库在、owner 私库不在，接口 name 与页面一致 | 通过 |

---

### 1.9 资源级「排除」（`80-exclude.spec.ts`，7 条）

| 场景 | 预期 | 结果 |
|---|---|---|
| 授权列表对知识库声明 `supports_deny` | `supports_deny=true`，前端据此渲染「不可见（排除）」 | 失败（未发版） |
| 授权树：知识库可排除、文件夹不可排除 | 库节点 `true`、文件夹节点 `false`（文件夹还没接排除谓词） | 失败（未发版） |
| 子项例外：库内文件可排除 | `grant_kind=document` 的项 `supports_deny=true` | 失败（未发版） |
| 设置可见范围里有「不可见（排除）」入口 | 下拉出现第三档 | 失败（未发版） |
| 未接排除谓词的类型不许写排除 | HTTP 200 + code≠0（新旧版本都拒绝，文案不同） | 通过 |
| 「全团队」不能作为排除对象 | HTTP 200 + code≠0 | 通过 |
| 不能把租户所有者写进排除名单 | HTTP 200 + code≠0，且事后校验原有授权未被改动 | 通过 |

## 2. 发现的问题汇总

### 2.1 产品缺陷

| 编号 | 严重程度 | 问题 | 表现 | 影响 | 证据 | 状态 |
|---|---|---|---|---|---|---|
| **D1** | **高** | 成员看不到自己创建的知识库 | `技术部(2)`（`c9f2f30c…`）详情接口对 member 返回 `code=0`，但 `GET /datasets` 列表只有 2 个被授权的库，不含它 | 成员自建的库在列表里「凭空消失」，无法进入管理 / 删改，等同于数据丢失；详情可读说明不是权限拒绝，而是列表过滤条件缺失 | `40-overreach.spec.ts` fixme 用例；列表可见范围只取 `owner / team / 授权 / 部门管理员`，漏了 `created_by = 本人` | **已修复（未发版）** |
| **D2** | 中 | 普通成员可读取整棵资源授权树 | member `GET /tenants/:tid/grant-tree` 返回 `code=0, total=18` | 泄露全部知识库名称、文件数、文件夹结构与授权摘要，包括本人无权打开的私库；写操作已 403，故为**只读信息暴露**，不能横向提权，但可被用于踩点 | `40-overreach.spec.ts` FINDING 用例 | **已修复（未发版）** |
| **D3** | 中 | 质检规则未按资源授权过滤 | member `GET /qc/rules` 返回 9 条规则（与其可见应用无关） | 成员可读到不属于自己可见应用的质检规则配置（规则名 / 提示词 / 判定条件）；数据面越权读取 | `40-overreach.spec.ts` FINDING 用例；另见 `30-resource-scope` 中 member 的 `/qc` 页面确实「暂无可配置的应用」 | **已修复（未发版）** |
| **D4** | 中 | 内置角色矩阵可被空写覆盖，随后被静默回填 | `PUT /roles/:id/permissions` 提交 `{permissions: []}` 返回成功；下一次 `ListRoles` 又按 `ConsoleModules` 把默认行补回 | 「撤销某模块 / 撤销全部」对内置角色**不可持久化**：保存成功但实际被改回默认，管理员会误以为权限已收紧；`backfillBuiltinRolePermissions` 无法区分「模块新增需补行」与「管理员主动删除」 | 本轮实测：Owner 提交空矩阵后仍为 25 行全勾（数据未丢，但语义被吞） | **已修复（未发版）** |
| **D5** | 低 | 内置角色可被改名，多处逻辑按名字匹配 | `PUT /roles/:id` 前端已禁用编辑，接口层无 `is_builtin` 保护 | 改名后 `EnsureTenantAdminRole`（按「租户管理员」）、`backfillBuiltinRolePermissions`（按 spec name）静默失配，owner 移交与权限补行行为不可预期 | `internal/dao/role.go`（Delete 有内置保护，Update 无） | **已修复（未发版）** |

> 严重程度定义：**高** = 主流程不可用或权限边界判断错误；**中** = 越权/信息暴露或管理动作语义错误，但不阻断主流程；**低** = 需高权限前提或管理面边界问题。

### 2.2 非产品缺陷（本轮用例自身问题，已修复）

| 问题 | 根因 | 处理 |
|---|---|---|
| 未登录跳转用例失败 | 固定 `waitForTimeout(2000)` 早于 401 触发（实测 3~4 s）；且 `browser.newContext()` 会继承 `test.use` 的 `storageState`，导致「未登录」上下文实际带着 token | 显式 `storageState: { cookies: [], origins: [] }`，并改用 `expect(page).toHaveURL(/\/login/)` 等待 |
| 授权树点击用例失败 | `page.locator('aside').first()` 命中的是左侧全局导航（同为 `aside`），不是授权树面板 | 按面板头部「资源（N 个库）」过滤定位 |
| 接口计数用例得到 `-1` | `/chats`、`/searches`、`/agents` 返回 `{ total, list }`，用例只认数组或 `total_count` | 计数函数兼容数组与 `total` 两种形态 |
| 质检空态用例失败 | 正则先命中 `<option>暂无可用应用</option>`，而 option 永远不可见 | 直接断言可见空态文案 |
| 「Owner 矩阵写入必须被拒绝」断言失败 | 与后端刻意设计相反（允许 owner 微调内置角色矩阵） | 改为只读断言「Owner 25 行全勾」 |

### 2.3 本轮修复与验证（2026-11-03）

| 缺陷 | 改动 | 验证 |
|---|---|---|
| **D1** | `internal/permission/policy_ce.go`：`QueryScope` 的 SQL 快路径补 `knowledgebase.created_by = 调用者`，与逐条判权的 `Scope` 口径一致 | 新增 `TestQueryScopeIncludesDatasetsCreatedByCaller`；`TestDepartmentAdminQueryScopeMatchesSingleResourceCheck` 的旧期望（「成员一个都看不到」）修正为「只看得到自建的那个」 |
| **D2** | `resource_grant_scope.go`（新增）：把授权页 kind 映射到权限 kind，`grant-tree` / `grants` / `grant-exceptions` / `grants-by-subject` 按调用者读权限收窄；按 id 展开子项也判父节点；文件/文件夹是租户级资产，显式不收窄 | 新增 `TestGrantTreeScopesToCallerReadableDatasets`；既有 4 条授权树用例改造为带 caller 参数 |
| **D3** | `dao.QcRuleListFilter` 增加 `AppIDsByType`；`handler.ListRules` 对非租户管理层收窄到可见 chat/canvas 应用 | 新增 `TestQcRuleListScopesToVisibleApps`（含「空集合 ≠ 不限」） |
| **D4** | `ConsoleService.SavePermissions`：保存时把未提交模块补成全 false 行（行缺失在 `ModulePermission` 是放行、在 backfill 是按默认补回）；Owner 矩阵拒绝写入 | 新增 `TestSavePermissionsMaterializesRevokedModules`、`TestSavePermissionsRejectsOwnerMatrix`；`TestSavePermissionsClearsMatrix` 改为断言 25 行全 false |
| **D5** | `ConsoleService.UpdateRole`：内置角色拒绝改名/改描述（`EnsureTenantAdminRole`、backfill 都按名字匹配） | 新增 `TestUpdateRoleRejectsBuiltinRename` |

**单测结论**：`/root/rf-verify`（detached `origin/main`）`./build.sh --test` → **0 FAIL / 131 packages ok**。

**E2E 结论**：48 条里 40 条通过，8 条失败全部是上表缺陷的回归断言（D1/D2×3/D3/D4/D5），必须等这批后端改动发版后才会转绿——它们是发版验收条件，不要为了让套件变绿而放宽。

**过程中的一次事故（已恢复）**：D5 用例最初提交了一个新角色名「普通成员-改名」，在未发版的旧服务里**真的把线上内置角色改了名**（旧服务没有保护），导致后续「点普通成员」的用例超时。已用同接口改回，并把 D4/D5 两条用例改为提交「与现状相同的值」：旧服务幂等接受、新服务拒绝，修复前后都只读。

### 2.4 资源级「排除」改造（2026-11-04）

| 层 | 改动 | 验证 |
|---|---|---|
| 判定（单条） | `grantLevel` 增加 `denied` 计数并短路：deny 压过任何 allow；创建者、租户管理层、部门管理员不受影响 | `TestDatasetDenyBeatsTeamGrant`、`TestDatasetDenyIgnoredForCreatorAndManagement` |
| 判定（列表） | dataset `QueryScope` 的授权子查询排除 deny 行，可见性表达式加 `NOT EXISTS(deny)` | `TestQueryScopeExcludesDeniedDatasets` |
| 判定（文件） | 库级被排除时 `documentRuleClause` 返回恒假谓词（与 `CheckDocumentAccess` 口径一致） | `TestDocumentRuleClauseFailsClosedWhenDatasetDenied` |
| 接口 | `grantDenyKinds`（dataset + document）：其他类型显式拒绝；拒绝 `team` 排除；拒绝把创建者 / 租户 owner 写进排除名单；`effect` 缺省时沿用库里的既有排除（防止老前端整表替换把排除变成允许） | `TestSetGrantsAcceptsDatasetDeny`、`...RejectsTeamDeny`、`...RejectsDenyForUnsupportedKind`、`...RejectsDenyOnCreatorAndTenantOwner`、`...KeepsDenyWhenEffectOmitted` |
| 接口返回 | `supports_deny` 出现在授权列表、树节点、子项例外三处，前端不再按 kind 猜 | `80-exclude.spec.ts` 前 3 条（待发版） |
| 界面 | 「设置可见范围」第三档「不可见（排除）」；已授权标签显示「已排除」；「开放给全团队」在排除模式下禁用；树摘要橙色标注「N 个主体 · 排除 M」 | `grant-views.test.tsx` 新增 2 条；`80-exclude` 第 4 条（待发版） |

单测结论：`/root/rf-verify` 跑 `./build.sh --test ./internal/permission/... ./internal/service/...` → **0 FAIL**。
前端：`jest src/pages/console` 通过，改动文件 `tsc` 无新增错误，`oxlint` 无 error。

---

## 3. 尚未覆盖 / 未测试的场景

| 编号 | 未覆盖场景 | 未测原因 | 建议后续计划 | 优先级 |
|---|---|---|---|---|
| G1 | 正向写流程：创建 / 修改 / 删除角色、写入资源授权、邀请成员、变更成员角色、移交 owner | 全部会污染真实租户数据；本套件坚持只读基线 | 建**专用测试租户**（或用一次性自建资源 + 清理钩子），配 `E2E_ALLOW_WRITE=1` 开关；先建后删，断言以接口返回为准 | P0 |
| G2 | 文件级授权（document 级 allow/deny）在列表、单文件内容、检索三条路径上的生效与拒绝 | 需先造文件与 folder 级 grant，且清理成本高 | 基于测试租户上传 2~3 个 fixture 文件，覆盖「库允许 + 单文件 deny」与反向组合 | P0 |
| G3 | 知识库可见范围三档中的「租户管理层」「平台管理员」 | 当前只有 owner / 普通成员两种身份；平台管理员需平台侧账号 | 补 1 个租户管理员 + 1 个平台管理员账号，验证三档阈值与逐人授权的叠加关系 | P1 |
| G4 | 部门管理员的数据范围（department scope） | 需部门树与部门成员数据，当前租户结构未固化 | 在测试租户造部门 + 2 名成员，验证「本部门可见 / 跨部门不可见」 | P1 |
| G5 | 检索与问答链路的授权过滤（RAG 召回、知识图谱、解析任务） | 依赖真实文档与解析流水线，属 e2e/integration 重用例，单轮耗时高；且知识图谱与解析任务目前仍是库级 | 作为独立 integration 套件，用固定 fixture 库 + 已知 chunk 断言召回集合 | P1 |
| G6 | 跨租户隔离（member 携带他租户 ID / `X-Tenant-ID` 越界） | 需第二租户与第二租户成员账号 | 建隔离租户 A/B，验证 `X-Tenant-ID` 伪造、资源 id 直读、授权树查询全部被拒 | P1 |
| G7 | 前端权限守卫（菜单隐藏、路由级拦截） | 已确认当前实现按「我 owner 的租户」查权限，纯成员直接不发请求（页面骨架空渲染）；纳入套件需先定实现口径 | 先修「按当前访问租户查权限」，再用例化菜单 / 路由 / 按钮三级可见性 | P2 |
| G8 | 登录态失效：token 过期、被顶号、401 后续跳转 | 制造失效会踢掉真实会话，可能影响他人使用 | 用独立测试账号，或在测试租户内故意签发短有效期 token | P2 |
| G9 | 会话质检命中记录 / 实时质检的授权过滤 | 依赖实时会话数据，无法稳定造数 | 在测试租户跑一条固定会话，断言命中记录只对归属应用可见者返回 | P2 |
| G10 | 并发与性能（多用户同时切换授权、权限缓存一致性） | 非功能类，需压测环境与监控 | 单独做一轮 10~50 并发的授权变更 + 立即读取一致性验证 | P3 |
| G11 | 移动端 / 窄屏响应式与可用性 | 无对应设计稿与验收标准 | 待设计稿确认后补 `viewport` 项目 | P3 |
| G12 | 资源级「排除」的正向路径（写入排除后验证列表/详情/检索） | 必须往真实知识库写一条排除规则，且旧版本会整表替换；等专用测试库 | 建一个专用测试库（含 2 个文件），发版后按 `e2e/PLAN.md` 的 7 条矩阵补自动化 | P0 |

### 3.1 本套件的已知局限（评审时请注意）

1. **只读基线意味着写接口只验证了负向（403）**：owner 的正向写成功路径未覆盖，需 G1 补齐。
2. **强依赖真实租户数据**：库 / 应用 / 成员的 id 与名称写死在 `e2e/support/env.ts`。线上改名或删库会让用例失败，维护点只有这一个文件，属预期行为而非偶发抖动。
3. **单 worker 串行**，全量约 2.7 min；若扩到多租户场景需改为按租户分 project 并行。
4. `test.fixme` 与 FINDING 用例是**有意保留的「红灯占位」**：D1/D2/D3 修复后这些用例会变红，提醒同步更新断言，不要直接删掉。

---

## 4. 运行与产物

```bash
cd e2e
npm install && npx playwright install chromium   # 首次
npm test                                         # 全量（约 3 min）
npm run test:overreach                           # 单组
npm run report                                   # HTML 报告
```

- 报告与 trace：`e2e/report/`（HTML + `results.json`），失败用例留 `trace.zip` 可 `npx playwright show-trace` 回放。
- 登录态：`e2e/.auth/{owner,member}.json`，缺失时由 `support/global-setup.ts` 调 `scripts/auth.mjs` 自动生成；失效后删文件重跑即可。
- 运行产物与登录态已加入 `e2e/.gitignore`，不入库。
