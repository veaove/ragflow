# 全量测试 + 端到端测试报告（10-20 18:00 → 10-21 09:12 的 32 个提交）

**测试时间**：2026-10-21 10:00–10:45
**被测版本**：`52e2112bd`（API 自报版本一致）
**部署状态**：前端 `dist_20261021_093146`（nginx 已指向）、后端二进制 09:39 构建、三个服务 active
**测试基线**：`017243da9`（上一份报告的最后一个提交）
**变更规模**：119 个文件 / +15911 −356 行

---

## 一、结论

| 层级 | 结果 | 判断 |
|---|---|---|
| 后端全量单测 | ✅ **148 个包：126 通过 / 0 失败 / 22 无测试** | 可放行 |
| 前端类型检查 | ✅ 203 个错误（基线 206，**净减 3**） | 无新增 |
| 前端 lint | ✅ 0 error / 176 warning | 无新增 |
| 前端单测 | ⚠️ 124/136 套件通过（12 套件 19 用例红） | 与昨日**完全同一批**，无新增 |
| E2E · API | ⚠️ 28/28 + 补测 7/9 | 有 **1 个 P1 真实缺陷**（已修复并上线：`26d32c6db` + `1e8f202fb`） |
| E2E · UI | ⚠️ 24/29（2 失败 / 3 跳过） | 有 **1 个 P2 可见缺陷** |

**一句话**：后端和类型检查层面这次是干净的；但**检索测试设置的自动保存实际是坏的**（前端发的字段被后端白名单拒绝），
已于 `26d32c6db`（后端）+ `1e8f202fb`（前端）修好，**已编译部署并复验通过**；
另外新加的列表表格把两个未翻译的 i18n key 直接暴露给了用户。

---

## 二、本轮覆盖的功能块

按提交聚类，共 8 块：

| 功能块 | 相关提交 | 覆盖方式 |
|---|---|---|
| 实时质检 QC（规则管理 / 选中集 / 命中 / 实时推送） | `5ca6777` `64c1e73` `bbdf30e` `8e44490` `fbcadc5` `a2787cc` `ea171c4` `eba0539` | API E2E 全覆盖 |
| 同义词 / 相似问测试对比 2.0 | `0e32bbd` `1008e15` `b09d1f9` `b48b020` `f76dbd4` `5d330fd` | 部分（缺 LLM/embedding，见 §七） |
| 4 个业务列表统一卡片/表格 | `52e2112` | UI E2E 全覆盖 |
| 工作室操作列下沉 | `4fdb9f9` | UI E2E 覆盖 |
| 检索测试配置落库 | `5e0d7dc` `057a41d` `7a7b537` `16cdd80` | API 实测，**发现缺陷** |
| i18n 改名（知识问答 / 知识搜索 / 会话质检） | `453c781` `f16878e` `77c31e6` | UI E2E 覆盖 |
| 变更中心按选中项发布 / 对比 | `375d463` | 部分（同 §七） |
| E2E 脚本与部署脚本维护 | `3783af9` `b4ca6df` `3cbd4aa` `80fe38e` `77bc26f` | 不计入功能测试 |

---

## 三、后端全量单测

```
$ export PATH=$PATH:/usr/local/go/bin
$ export TIKTOKEN_CACHE_DIR=/root/ragflow/ragflow_deps
$ bash build.sh --test ./internal/...
EXIT=0

ok=126   fail=0   notest=22   total=148
panic / timed out = 0
```

耗时最长的包：`service` 48.2s、`entity/models` 43.3s、`syncer` 30.5s、`service/dataset` 28.1s。

### 3.1 首轮出现 1 个挂死（P2，flaky，未复现）

首轮全量在第 10 分钟被 `go test` 默认超时打断：

```
panic: test timed out after 10m0s
	running tests:
		TestVisionCropImage_ReusesSourceAfterItemContextExpires (9m54s)
FAIL	ragflow/internal/ingestion/component	600.201s
```

定性过程：

| 做法 | 结果 |
|---|---|
| 单独跑这条用例（`build.sh --test -- ./internal/ingestion/component -run TestVisionCropImage`） | **10 条全 PASS**，该用例 0.04s |
| 第二次跑全量 | 该包 `18.483s` 通过 |
| 第三次跑全量（最终取值） | 该包 `18.097s` 通过 |

**结论：时序脆弱，不是稳定失败。** 用例设计上用 `context.WithTimeout(..., 20ms)` 卡时序
（`vision_enhancement_cgo_test.go:374`），靠 `<-fetchStarted` / `<-firstItemCtx.Done()` / `close(finishFetch)`
三段握手验证「item 上下文过期后复用同一份 source」。满载并行时（这次同时在跑 146 个包）goroutine 调度延后，
握手顺序被打破，于是某一步永久阻塞——**它是挂死而不是失败**，所以拖垮整包并触发 10 分钟超时。

> 影响：整包被拖垮，一次全量要白等 10 分钟；且报错信息只见"超时"，容易误判为产品死锁。
> 建议：把 20ms 的固定超时换成可控通道信号（或给该用例加 `-timeout` 局部门限 + `t.Parallel()` 隔离），
> 并在 `go test` 上加 `-timeout 300s` 让失败快而明确。

---

## 四、前端静态检查与单测

### 4.1 类型检查

**203 个错误**（基线 206，净减 3 —— 昨天报的 `agent-service.ts listRuns` 死代码已被顺手修掉）。

本次改动的 47 个前端文件里只有 3 条错误，且**全部是存量**（昨日同一批，仅行号位移）：

| 文件 | 今日 | 昨日 |
|---|---|---|
| `pages/agent/chat/use-send-agent-message.ts` | 423,33 | 396,33 |
| `pages/agent/setting-dialog/index.tsx` | 30,34 | 25,34 |
| `services/knowledge-service.ts` | 41,3 | 41,3 |

→ **本次改动没有引入任何新的类型错误。**

### 4.2 Lint

```
Found 176 warnings and 0 errors.  (1527 files)
```

与昨日 176 warning / 1516 files 持平：新增 11 个源文件，**未新增告警**。

### 4.3 单测

```
Test Suites: 12 failed, 124 passed, 136 total
Tests:       19 failed, 955 passed, 974 total
```

12 个失败套件与昨日**逐条一致**（`switch-fom-field`、`highlight-markdown`、
`logic-hooks-use-scroll-to-bottom`、`use-save-graph`、`pipeline-connection`、
`use-manage-values-modal`、`models-section/hooks`、`local-llm-configs`、
`chat`、`file-util`、`llm-util`、`source-locate`），累计数字也完全一样（19 用例）。

根因仍是两类，与本次改动无关：**jsdom 环境缺 `Request` / `Blob.arrayBuffer`**、
**babel 未剥类型注解 / 夹具过期**。昨日报告已逐条列过，此处不重复。

> 其中 `utils/__tests__/llm-util` 已在修 §6.1 时顺带修好（它的两条用例断言了
> 早已被移除的 chats 注入行为），该套件现已 22 用例全绿，**剩下 11 个**。

> **后端本次新增了 7 个测试文件**，方向是对的：
> `dao/qc_rule_binding_test.go`、`service/qc_matcher_test.go`、`service/chunk/compare_test.go`、
> `service/chunk/compare_scope_test.go`、`service/dataset/references_test.go`、
> `service/kb_change_set_scope_test.go`、`service/nlp/query_builder_override_test.go`。
>
> 但**前端 0 个新增测试**：`pages/qc/`（质检管理）与 `components/list-view/`（列表表格骨架）
> 都是新模块、0 单测。这是当前最大的工程债。

---

## 五、E2E · API 层

主脚本 28 项 + 补测 9 项，覆盖 QC 全链路与知识库配置。

### 5.1 QC 规则闭环（22 项全 PASS）

| ID | 校验点 | 结果 |
|---|---|---|
| Q-01/02 | `qc/config` 读取 / 修改并持久化 | ✅ `retention_days` 改后回读一致 |
| Q-03 | 创建规则 | ✅ |
| **Q-04** | **创建时 `enabled=false` 被真正落库**（`eba0539` 修的历史缺陷） | ✅ 返回 `enabled=false` |
| Q-05 | 创建时 `enabled=true` 生效 | ✅ |
| Q-06/07 | 按应用列规则 / 详情字段完整 | ✅ |
| Q-08 | 更新名称+关键词 | ✅ 关键词 2→3 |
| Q-09 | 启停接口按 `body.enabled` 设置 | ✅ |
| **Q-10/11** | **勾选即落库 / 取消勾选即清除**（`a2787cc` 修的"隐式全选"） | ✅ `selected` true→false |
| Q-12 | 选中集是租户级共享库（带 `home` 标志） | ✅ 符合设计 |
| **Q-13** | **contains 命中两个关键词 `hit_count=2`**（`bbdf30e` 修的"恒为 1"） | ✅ |
| Q-14 | 返回 `<mark>` 高亮片段 | ✅ |
| **Q-15** | **regex 模式生效**（`bbdf30e` 修的"正则失效"） | ✅ `hit_count=1` |
| Q-16 | 无命中 `hit_count=0` | ✅ |
| Q-17~20 | 非法 app_type / 空关键词 / 名称超 50 字 / 不存在的应用 | ✅ 全部被拒（101/101/101/**404**） |
| Q-21/22 | 命中记录列表 / 导出 | ✅ 200 |
| Q-23 | 删除后列表不再返回 | ✅ |

### 5.2 列表与知识库（补测）

| ID | 校验点 | 结果 |
|---|---|---|
| L-01/02 | 智能体列表具备表格列字段（含 tags） | ✅ |
| L-04/05 | 知识问答 / 知识搜索列表接口 | ✅ |
| D-01 | 创建临时知识库 | ✅（`parse_type=1` + `parser_id` 必需） |
| **D-02/03** | **检索测试配置写入并回读** | ❌ **见 §六.1（P1）** |
| D-04/04b | 知识库启用/停用开关（`enabled` 独立于 `status`） | ✅ false→true |
| D-05 | `/datasets/:id/references` 引用接口 | ✅ |
| D-06/07 | 变更中心列表 / 创建变更集 | ✅ |
| D-09 | 清理临时数据 | ✅ |

---

## 六、缺陷清单

### 6.1 【P1】检索测试设置的自动保存实际不生效——前端发的字段被后端白名单拒绝

> **状态：已修复并已上线（后端 `26d32c6db` + 前端 `1e8f202fb`，线上版本 `1e8f202`，
> 前端 `dist_20261021_1109`）。UI 复验 9/9、接口复验 9/9。**

**现象**：知识库「检索测试」页改任何设置，右上角报
`101 Extra inputs are not permitted: similarity_threshold`，且永远看不到「保存成功」。
（用户 10:40 截图复现，与此前 API 层实测一致。）

**证据（线上实测，临时知识库）**：

```
PUT /api/v1/datasets/{id}  {"similarity_threshold":0.22}
  => {"code":101,"message":"Extra inputs are not permitted: similarity_threshold"}
PUT /api/v1/datasets/{id}  {"keywords_similarity_weight":0.7}
  => {"code":101,"message":"Extra inputs are not permitted: keywords_similarity_weight"}
PUT /api/v1/datasets/{id}  {"rerank_id":""}
  => {"code":101,"message":"Extra inputs are not permitted: rerank_id"}
```

**根因**：前后端字段契约不一致。

- 前端 `web/src/pages/dataset/testing/testing-form.tsx:207-212` 发的是**顶层**三个字段：
  `similarity_threshold` / `keywords_similarity_weight` / `rerank_id`
  → 经 `useUpdateKnowledge`（`use-knowledge-request.ts:375-401`）原样透传
  → `updateKb` = `PUT /api/v1/datasets/{id}`（`api.ts:164`）
- 后端 `internal/handler/dataset.go:387-401` 的 `updateDatasetAllowedFields` 白名单里
  **这三个字段一个都没有**（只有 `name/avatar/description/embedding_model/permission/parse_type/pipeline_id/chunk_method/parser_id/parser_config/auto_metadata_config/dataset_id/pagerank/language/connectors/enabled`）

**影响**：`057a41df` / `5e0d7dc4` / `7a7b537d` 三个提交声称修好"设置自动保存并提示保存成功"，
实际在真实接口上是失败的——只是前端把错误吞成了全局提示，容易被当成网络抖动。

**已实施的修复**（提交 `26d32c6db`）：把三个字段加进 `updateDatasetAllowedFields`。
只需改白名单——`UpdateDatasetRequest` 三个字段早已定义，service 也已实现
（0..1 范围校验、`1 - keyword` 取反写 `vector_similarity_weight`、空串清空 `rerank_id`），
缺的只是最外层这道闸。

回归保护（均已在服务器跑通）：

- `internal/handler/dataset_update_allowed_fields_test.go`
  - `TestUpdateDatasetAcceptsRetrievalTestSettings`：白名单必须含这三个 key；
  - `TestUpdateDatasetWhitelistCoversRequestJSONFields`：`UpdateDatasetRequest` 的每个
    json 字段都必须在白名单里，防止再次漂移（`embd_id` 是无用的列级别名，显式跳过并注明）。
- `internal/service/dataset/update_test.go`
  - `TestUpdateDatasetPersistsRetrievalTestSettings`：写入并回读，验证权重取反、
    空串清空 rerank 且不影响另外两个数值；
  - `TestUpdateDatasetRejectsOutOfRangeRetrievalTestSettings`：越界值被拒。

验证结果：`internal/handler` 与 `internal/service/dataset` 两包全部 PASS，0 失败。

**第二个根因（后端放开后才暴露，提交 `1e8f202fb`）**：UI 仍报
`101 Extra inputs are not permitted: tenant_rerank_id`。

请求拦截器 `web/src/utils/llm-util.ts` 的 `addTenantParams` 把 `/api/v1/datasets`
列进了「需要租户模型 id」的白名单，只要请求体出现 `rerank_id` 就额外塞一个
`tenant_rerank_id`（清空时塞 `null`）。而知识库存的是普通模型名、检索时自行解析，
`PUT /datasets/:id` 又是严格字段白名单 —— 多出来的这个键把保存直接打回。

源码里 `/api/v1/chats` 早已因同样原因被移出该白名单（注释写明：chats 由服务端做
模型名/id 归一，前端不该回填 tenant_*），数据集同理，故一并移出。

顺带修掉一个**陈旧用例**：`llm-util.test.ts` 有两条用例用 chats URL 断言
"会注入 tenant_rerank_id"，而 chats 早已不在白名单，这个套件因此长期为红
（就是本报告 §4.3 里 12 个红套件之一）。改为用真正在白名单内的 `/api/v1/memories`
验证清空逻辑，并新增「chats / datasets 不应被注入」用例锁住行为。修复后该套件
22 个用例全绿。

**上线后复验**：

| 层 | 结果 |
|---|---|
| 接口（临时知识库，跑完删除） | **9/9**：三字段一起 PUT 被接受、threshold 回读一致、关键词权重 `0.65→vector 0.35` 反算正确、rerank 写入/清空、越界仍拒、白名单外字段仍拒 |
| UI（Playwright，真实点输入框） | **9/9**：出现「保存成功」、不再出现 Extra inputs、刷新后设置保持、接口回读与界面一致 |

截图：`docs/qa_shots/2026-10-21/shot1021_retrieval_saved.png`（绿色「Settings saved」，与故障截图对照）。

> 另注：知识库权重列在库里叫 `vector_similarity_weight`（默认 0.3），接口对外叫
> `keywords_similarity_weight`，写入时是 `1 - vector`。修的时候别按字面直写。

### 6.2 【P2】`PUT /datasets/:id` 带 `parser_config` 返回成功但静默丢弃

**现象**：`PUT {"parser_config":{"top_k":64,"similarity_threshold":0.22,"vector_similarity_weight":0.45}}`
返回 `code=0`，但回读 `parser_config` 与写入前**完全一致**（`top_k` 消失）。

**推断**：新建知识库时 `parser_config` 会被规范化成流水线组件结构
（`Parser:HipSignsRhyme` / `GeneralChunker:SixApplesFall` / `Tokenizer:LegalReadersDecide` / …），
更新时传入扁平 key 被规范化逻辑覆盖掉，却没有报错。

**影响**：调用方以为写成功，实际没写进去——比报错更难排查。
**建议**：未知/被丢弃的 key 至少返回告警；或按组件路径合并而不是整体替换。

### 6.3 【P2】新加的两张表格把未翻译的 i18n key 直接渲染给用户

线上英文界面下，表格表头实测：

| 列表 | 表头实录 |
|---|---|
| 智能体 | `Name / Type / Status / Version / Last run / **common.knowledgeBase** / 标签 / 创建者 / 更新时间 / Action` |
| 知识问答 | `Name / **common.description** / 模型 / **common.knowledgeBase** / TopK / 阈值 / 重排模型 / 更新时间 / Action` |

**根因**：`common.description` 与 `common.knowledgeBase` 这两个 key 在
`web/src/locales/zh.ts` 和 `en.ts` 里**都不存在**（`common.name` / `common.action` 存在）。
i18next 找不到就原样输出 key。

**本次新增的 3 处暴露点**（都是 `52e2112` 引入）：
`agent-list-table.tsx:121`、`chat-table.tsx:47,67`、`search-table.tsx:46`。
另有 2 处存量：`create-studio-dialog.tsx:169-170`、`avatar-name-description/index.tsx:88`。

**修法**：补两条词条即可（同时修掉存量的 2 处）：
```ts
// zh.ts / en.ts 的 common 块
description: '描述',        // Description
knowledgeBase: '知识库',    // Knowledge Base
```

### 6.4 【P3】英文词典没跟着改名

`f16878ec` 只改了中文：

| key | zh | en |
|---|---|---|
| `header.qc` | `会话质检` | **`QC`**（未改） |

实测英文界面侧边栏显示 `QC`。功能无影响，属 i18n 漏改。

### 6.5 【P3】质检管理页文案硬编码中文，未接 i18n

`web/src/pages/qc/index.tsx:87-89` 直接写死 `label: '实时质检'` / `'命中记录'` / `'系统配置'`，
`rule-panel.tsx` 里 `t()` 调用数为 **0**。英文界面下这一整页仍是中文，
和全局语言设置不一致（实测页面文案：`质检规则 实时质检 命中记录 系统配置 配置应用：聊天应用 对话流`）。

### 6.6 【P4】`POST /qc/rules/:id/toggle` 名为 toggle，实为「设置」

接口接收 `{"enabled": bool}` 并直接写入，不是翻转。传 `{}` 会被当成 `enabled=false` 静默关掉规则。
名字容易误导调用方，建议改名 `PUT /qc/rules/:id/enabled` 或在文档里写清。

---

## 七、未覆盖项及原因

| 项 | 原因 | 如何解锁 |
|---|---|---|
| 变更中心 **检索对比**（`retrieval-compare`） | 租户 `llm_id` / `embd_id` / `rerank_id` 全为空，且 E2E 账号无知识库；接口返回 `Invalid request: RetrievalCompareRequest...Datasets` | 配一个 chat 模型 + embedding 模型，灌一篇文档并解析入库 |
| QC **实时命中**（对话中拦截 / 横幅 / WebSocket 推送） | 同上：`/chat/completions` 在进入 `AsyncChat` 前就报 `no default chat model for tenant`，质检代码根本不会执行 | 同上，另需配 chat 模型 |
| 知识搜索 / 知识库两个列表的视图切换 | 账号下这两个列表为空（`No search app created yet` / `No dataset created yet`），切换开关在空态下不渲染 | 用有数据的账号，或先造数据 |
| `--test-integration` / `--test-e2e` | 需真实全栈依赖与 LLM key | 见 `build.sh` 分层说明 |
| 4 个列表的**列内容**正确性 | 只能验证表头与行数，单元格取值需造数据比对 | 造带模型/知识库/标签的应用 |

> 上述"未覆盖"里，**检索对比与 QC 实时命中是本次两个最大的功能块**，
> 当前环境（无模型）下无法端到端验证。这部分只能靠单测与代码评审兜底，
> 建议在配好模型的测试环境上补一轮。

---

## 八、给开发专家的事项（按优先级）

1. **【P1，已修复已上线】检索测试设置保存**（§6.1）。这是本次唯一的 P1，且是"看起来已修好、实际没生效"的类型，
   验收时最容易被漏掉。后端 `26d32c6db` + 前端 `1e8f202fb`，已部署并 UI/接口双层复验通过。
2. **【P2】补 `common.description` / `common.knowledgeBase` 两个词条**（§6.3）——两行改动，
   顺手把 `create-studio-dialog` 与 `avatar-name-description` 的存量暴露点一起清掉。
3. **【P2】`parser_config` 静默丢弃要么报错要么合并**（§6.2）。
4. **【P2】给挂死用例加隔离**（§3.1）。当前表现是整包超时 10 分钟，
   在 CI 上会白白吃掉一次构建，且日志误导性强。
5. **【P3】英文词典同步改名**（§6.4）；**质检页接 i18n**（§6.5）。
6. **补新模块单测**：`pages/qc/` 与 `components/list-view/` 目前 0 测试。
   优先覆盖 `qc` 的规则校验（`validateQcRule` 前端侧）与 `list-data-table` 的列渲染。

---

## 九、E2E 截图证据

存于 `docs/qa_shots/2026-10-21/`：

| 文件 | 内容 |
|---|---|
| `shot1021_agents_table.png` | 智能体表格视图（含 `common.knowledgeBase` 暴露，§6.3 证据） |
| `shot1021_chats_table.png` | 知识问答表格视图（含 `common.description` 暴露） |
| `shot1021_studio_table.png` | 工作室表格视图 + 操作列下沉后的下拉 |
| `shot1021_qc.png` | 质检管理页（中文硬编码，§6.5 证据） |
| `probe_searches.png` | 知识搜索空态（无切换开关，§七 未覆盖原因） |
| `probe_datasets.png` | 知识库空态（同上） |

---

## 十、附：本次执行记录
| 步骤 | 命令 / 方式 | 结果 |
|---|---|---|
| 版本确认 | `curl /api/v1/system/version` | `52e2112` == HEAD |
| 后端全量 | `build.sh --test ./internal/...` | 148 包，0 失败（第 3 次运行取值） |
| 前端 tsc | `npx tsc --noEmit` | 203 错误 |
| 前端 lint | `npx oxlint src` | 176 warning / 0 error |
| 前端 jest | `npx jest --no-cache` | 12 套件 / 19 用例红（存量） |
| API E2E | `.tmp_qa/e2e_api_1021.js` | 28/28，跳过 3 |
| API 补测 | `.tmp_qa/e2e_api_1021b.js` | 7/9，跳过 1 |
| UI E2E | `.tmp_qa/e2e_ui_1021.js`（Playwright） | 24/29，失败 2，跳过 3 |

**执行期踩到的两个坑**（写下来免得重复踩）：

1. **SSH 会话被回收会带走后台任务**：`nohup ... &` 启动的全量测试在 SSH 客户端被 SIGTERM 后
   仍会丢 12 个包（第二次运行只跑到 `server/syncer`）。后来改用受管后台任务（保持连接）才跑完 148 个包。
   判断依据：`grep -cE "^(ok|FAIL|\?)"` 的结果行数 < `go list ./internal/... | wc -l`。
2. **E2E token 有效期短且单会话**：同一账号再登录一次会把浏览器/脚本的旧 token 顶掉，
   表现是中途全部 401。跑 UI E2E 期间不要再刷新 token。

---

## 十一、部署记录（2026-10-21 10:55–11:20）

| 项 | 内容 |
|---|---|
| 触发 | 用户确认"现在跑"（此前 P1 修复只提交未发布） |
| 后端 | `./build.sh --all`，缓存命中增量编译 53s；二进制 10:56:24（比旧包大 984B） |
| 迁移 | `--migrate` RC=0，无新表新列（本次只改白名单，无 schema 变更） |
| 启动 | `admin → ingestor → api`，三个服务 active，9380/9381 OPEN |
| healthz | db / redis / doc_engine / storage / message_queue **五项全 ok** |
| 版本 | 线上 `version` 由 `52e2112` → `1e8f202` |
| 前端 | `dist_20261021_1109`（49M），nginx root 已切换、`nginx -t` 通过、`kill -HUP` 重载 |
| 服务 | 入口 `/entry/js/index-BpDIGPBr.js` 与本地产物一致；`llm-util` chunk 经 nginx 取回 200 + `application/javascript` |
| 清理 | 旧备份轮转保留 2 份；旧 `dist` 保留 2 个版本；磁盘 71% |

**部署时发现并规避的一个坑**：工作区里存在**另一个会话未提交的改动**
（`web/src/pages/agent/canvas/index.tsx`、`pages/agent/index.tsx`、新增 `node-panel.tsx`）。
第一次直接在当前工作区 `vite build`，产物把这些半成品也打了进去；发现后：
删除该产物 → 提交自己的两个文件 → 用 **干净 worktree（HEAD）** 重新构建 →
产物中确认不含 `node-panel` 字样后才上传。

> **教训**：多会话共用一个工作区时，前端打包前必须先 `git status` 确认没有别人的未提交改动，
> 否则会把半成品带上生产。后端编译不受影响（它编的是已提交的源码树），但前端 build 吃的是工作区。

**回滚方式**（本次未用到）：后端 `cp bin/ragflow_server.bak.20261021_105534 bin/ragflow_server`；
前端把 nginx root 改回 `dist_20261021_093146` 后 `kill -HUP $(pgrep -o nginx)`。
