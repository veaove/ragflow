# Dify Chatflow / Workflow 四件套评审报告

| 项 | 内容 |
|---|---|
| 评审对象 | 功能清单、PRD、原型、技术详设 |
| 代码基线 | RAGFlow `ac2044bb` |
| 评审日期 | 2026-10-19 |
| 结论 | **不建议直接进入开发**。有 7 个 P0 阻断项，主要集中在 API Key 权限、异步执行、幂等、环境变量快照四处 |

---

## 0. 总体结论

四份文档的主线是自洽的：形态 → 节点 → 变量 → 运行 → 版本 → 发布，逐层展开，没有方向性错误。问题集中在**「从设计到代码」的最后一公里**：

- 技术详设对现有权限链、异步执行、版本快照的判断过于乐观，三处直接落在代码上会失败。
- PRD 的若干 V1.0 能力（审计、WebApp/嵌入、DSL 导入导出、节点面板）在技术详设里没有对应落点。
- 原型覆盖了主流程，但缺失败态、停止、单节点运行、运行历史、API Key 管理，评审时容易让人误以为这些不用做。

按当前状态，P0 修完可以进入开发；P1 建议在开发前定口径，避免返工。

### v1.1 修订状态（2026-10-19 更新）

四份文档已按本报告修订到 v1.1，P0 处理情况：

| P0 | 修订落点 | 状态 |
|---|---|---|
| P0-1 API Key 权限路径 | 技术详设 D6 + `RunAgentAsApp`（6.3）；PRD FR-07-04 | ✅ 已修 |
| P0-2 环境变量快照 | 技术详设 5.6 唯一键 `(canvas_id, name, version_seq)` + 10.4 restore 含 env；PRD FR-06-07 | ✅ 已修 |
| P0-3 异步执行 | 技术详设 D4 + 11.2；PRD 3.2 明确 async 降到 V1.1 | ✅ 已决策（降级） |
| P0-4 API 幂等 | 技术详设 D8 + 5.3 唯一索引；PRD FR-07-09 | ✅ 已修 |
| P0-5 run 超时/预算 | 技术详设 D9 + 8.7；PRD FR-05-08 | ✅ 已修 |
| P0-6 conversation_id 映射 | 技术详设 11.3；PRD FR-07-03 | ✅ 已修 |
| P0-7 HITL 公开 API | 技术详设 11.2 + 发布校验；PRD FR-07-10（V1.0 阻止发布） | ✅ 已决策 |

P1 中已补落点：审计表（5.8 + WP13）、版本快照完整性（10.3/10.4）、DSL schema（13.2）、WebApp/DSL（11.6）、节点面板/右键（12.6 + WP14）、失败态/冲突态（12.7 + 原型）、多租户与 PII 测试（17）。
仍未闭合：限流的具体容量参数需按现网压测校准；API Key 成本归属需产品拍板。

---

## 1. P0 阻断项（开发前必须修）

### P0-1 API Key 调用会卡在权限校验

**问题**：技术详设 D6 说「API Key 中间件注入 tenant_id / canvas_id / system user」，但现有 `AgentService.loadCanvasForUser` 会做用户级权限校验。

**证据**：

- `internal/service/agent.go:1033` `loadCanvasForUser` 调用 `CheckCanvasPermission(ctx, permission.Subject{UserID: userID}, canvasID, operation)`，失败统一返回 `ErrUserCanvasNotFound`。
- `internal/service/agent.go:1448` `agentTenantID := canvasRow.UserID`，运行时租户就是画布 owner 的 `user_id`。
- `internal/entity/canvas.go` 的 `UserCanvas` 只有 `UserID`，没有 `tenant_id`。

**影响**：传一个「系统用户」进来会直接 404；即使绕过，租户维度也会错。

**修法**：新增 `RunAgentAsApp(ctx, canvasID, keyID, ...)`：

1. 用 `keyID` 查 `app_api_key`，校验 `canvas_id` 匹配、`status=active`。
2. 直接按 `canvas_id` 加载画布，**不走** `CheckCanvasPermission`。
3. 用 `canvasRow.UserID` 作为 owner/tenant 传给运行器。
4. 在 `agent_run` 记录 `api_key_id`，用于审计与配额。

不要试图给「系统用户」授权，这会把权限模型撕开一个口子。

---

### P0-2 `environment_variable` 快照 schema 自相矛盾

**问题**：DDL 有 `version_seq`，但唯一键是 `(canvas_id, name)`，同一变量无法按版本存多行；而发布流程又要求「INSERT environment_variable snapshot」。

**证据**：技术详设 5.6 DDL；第 7.3 节发布时序。

**影响**：要么发布时覆盖上一版环境变量，要么插入失败；回滚时无法恢复旧版环境变量。

**修法（二选一）**：

- 方案 A：唯一键改 `(canvas_id, name, version_seq)`，发布时按新 `version_seq` 复制一份；草稿用 `version_seq=0`。
- 方案 B：新增 `environment_variable_snapshot(version_id, name, value_cipher)`，版本表只存 DSL。

同时补：**restore 必须恢复环境变量**，否则「回滚」只回滚了图，配置漂移。

---

### P0-3 异步运行没有持久化执行体

**问题**：`response_mode: async` 返回 `run_id` 后，谁执行？技术详设只说「返回 task_id，轮询结果」，没有 worker/队列。

**证据**：`internal/service/agent.go:1818-1860`，运行器绑定在 HTTP 请求的 goroutine 上；客户端断开后只是停止转发，不保证后台可恢复。进程重启后 `queued/running` 的 run 会变成孤儿。

**影响**：异步模式在真实生产不可用；长任务重启即丢。

**修法**：

- 用现有 NATS（项目已在用）或 DB 轮询 worker：`queued → running → terminal`，worker 消费并执行。
- 启动时扫描 `running` 超过 N 分钟的 run，标记 `failed(ORPHANED)` 或重投。
- 如果 V1.0 不想做 worker，**明确把 async 从 V1.0 拿掉**，只保留 blocking/streaming，别留一个假接口。

---

### P0-4 公开 API 没有幂等

**问题**：`POST /workflows/:id/run` 被客户端重试会产生重复运行。四份文档里「幂等」只出现在 HITL-03，API 层完全没有。

**影响**：重复扣 token、重复写业务数据；对有副作用的 Workflow 是事故。

**修法**：

- 接受 `Idempotency-Key` 请求头。
- `agent_run` 增加 `idempotency_key` 列 + 唯一索引 `(canvas_id, idempotency_key)`。
- 重复请求返回首次的 `run_id` 与状态，不重复执行。
- 无 Key 的请求按「每次新建」处理，但要在文档里写明。

---

### P0-5 整次运行没有超时与预算上限

**问题**：技术详设 8.6 只有节点级 `timeout_ms`，没有 run 级超时/token/成本上限。

**影响**：Loop 写错、模型反复重试、检索卡住，都会让一次 run 无限跑或烧掉大量 token。

**修法**：

- 运行参数增加 `max_duration_ms`、`max_tokens`、`max_cost`（按租户配置默认值）。
- 在 runner 的上下文里挂 `context.WithTimeout`，并在每次 LLM 调用后累计 token；超限标记 `RUN_TIMEOUT` / `BUDGET_EXCEEDED`。
- 在 `agent_run` 记录 `budget_exceeded` 原因，便于审计。

---

### P0-6 Chatflow `conversation_id` 与现有 `sessionID` 映射未定义

**问题**：公开 API 用 `conversation_id`，现有 `RunAgent` 用 `sessionID`；技术详设没有说明两者关系，也没说首次调用如何创建会话。

**证据**：`internal/service/agent.go:1442 RunAgent(ctx, userID, canvasID, sessionID, version, userInput, files)`；`internal/entity/api_for_conversation.go` 有 `ID` 与 `DialogID`。

**影响**：多轮对话可能每次新建会话，会话变量读不到；或者把 `DialogID` 与 `ID` 混用，导致会话串号。

**修法**：

- 明确 `conversation_id = API4Conversation.ID`。
- 首次调用无 `conversation_id` 时创建会话并返回；后续按 `conversation_id` 加载。
- `agent_run.conversation_id` 存该 ID，索引已建。
- 在 API 文档里写清「不传则新建，传了必须属于该 canvas」。

---

### P0-7 HITL 在公开 API 上没有恢复链路

**问题**：`UserFillUp` 节点会 `compose.Interrupt`；编辑态有 resume 机制，但 `/workflows/run` 与 `/chatflows/chat` 没有 `POST /runs/:id/resume`。

**影响**：带人工确认的 Workflow 通过 API 调用会永远停在 waiting。

**修法**：

- 新增 `POST /api/v1/runs/:run_id/resume`，带 `resume_token` 与表单数据；校验 run 属于该 canvas/key。
- 或者明确「V1.0 公开 API 不支持 HITL」，在发布校验里阻止含 UserFillUp 的 Workflow 发布为 API。二选一，不能含糊。

---

## 2. P1 重要缺口（开发前定口径）

| # | 缺口 | 证据 | 建议 |
|---|---|---|---|
| P1-1 | 版本快照只存 DSL，不存环境变量/模型/提示词版本 | 技术详设 10.2-10.4 | 版本快照扩展为 `{dsl, env_vars, model_ids, prompt_versions}`；restore 一起恢复 |
| P1-2 | `version_seq` 无唯一约束 | 技术详设 10.2 说 `SELECT FOR UPDATE`，DDL 无唯一索引 | 加 `UNIQUE(user_canvas_id, version_seq)`，重复时重试 |
| P1-3 | 审计表只有一句话，没有 DDL/服务/接口 | 技术详设 15 提到 `audit_log`，第 5 章无表 | 补 `audit_log` DDL、写入点、查询 API |
| P1-4 | 运行记录保留 90 天，PRD 审计要求 ≥180 天 | PRD FR-09-04 vs 技术详设 14 | 拆成两套保留策略；审计独立存储，不随 run 清理 |
| P1-5 | WebApp/分享/嵌入、DSL 导入导出在技术详设无落点 | PRD FR-07-06/07 | 复用现有 share 能力；补 DSL 导入导出接口与校验 |
| P1-6 | 节点面板、右键菜单没有工作包 | PRD FR-02-01/03（V1.0）vs 技术详设 WP 列表 | 增加前端 WP，或把这两项降到 V1.1 |
| P1-7 | 原型缺单节点运行、停止、运行历史、API Key 管理、归档 | 原型 grep：无「停止/单节点/运行历史/归档」 | 至少补停止与运行历史；其余可在 PRD 标注「原型未覆盖」 |
| P1-8 | 发布校验失败没有可交互反馈 | PRD FR-07-01 要求逐条列出；原型只有 toast | 增加校验结果面板，点击定位节点 |
| P1-9 | DSL 无 schema 版本 | 技术详设全文无 `schema_version` | `user_canvas` 加 `dsl_schema_version`；`NormalizeForCanvas` 按版本迁移 |
| P1-10 | 并发编辑冲突无 UI | PRD FR-06-01 要求乐观锁；原型无冲突弹窗 | 增加冲突提示与「基于最新版本重编辑」 |
| P1-11 | PII、提示词注入、生成内容合规未落地 | PRD 只有通用合规声明；技术详设只说「不打印提示词全文」 | 日志/运行记录做 PII 脱敏；Chatflow 增加注入防护与免责声明；基金内容加合规话术 |
| P1-12 | 多租户隔离没有测试用例 | 技术详设第 17 章无跨租户测试 | 补 API Key、run、会话变量的跨租户用例 |
| P1-13 | 限流只有「Redis token bucket」一句话 | 技术详设 15 | 明确 key 格式、窗口、burst、`Retry-After` |
| P1-14 | `user_canvas` / `user_canvas_version` 改造没有 ALTER 语句 | 技术详设第 5 章只有新表 DDL | 补 ALTER + `version_seq` 回填 SQL |

---

## 3. P2 一致性与打磨

| # | 问题 | 位置 | 建议 |
|---|---|---|---|
| P2-1 | PRD 数据模型写 `app_status`，技术详设改为 `release` + `archived_at` 推导 | PRD 9.1 vs 技术详设 5.1 | PRD 加注「status 为派生视图」，避免实施建错列 |
| P2-2 | PRD 写 `application` / `app_version`，技术详设落 `user_canvas` / `user_canvas_version` | PRD 9.1 vs 技术详设 5.0 | PRD 补一张实体映射表，或直接改用现有表名 |
| P2-3 | 功能清单/PRD 说「新增独立 LLM 节点」，技术详设发现后端 `llm.go` 已实现 | 功能清单 4.2 / PRD FR-03-03 vs 技术详设 2.1 | 改为「前端补齐 + 纳入面板」，工作量重估 |
| P2-4 | 原型「增量」标记过度使用 | Chatflow 的「变量赋值」是现有节点 | 标记能力（会话变量写入），不要标记节点本身 |
| P2-5 | 原型 Chatflow 的 assigner 用虚线连接 | 原型 canvas-cf | 改为实线并标注「写会话变量」，否则像可选分支 |
| P2-6 | 原型缺空/错/加载三态 | 原型全局 | 至少补一个空状态与一个错误态，评审时能讲清 |
| P2-7 | 「40 个 Agent 面板算子」口径不清 | 功能清单 2.1 | 区分「Operator 枚举数」与「面板可选算子数」 |
| P2-8 | Agent 与 Chatflow 的定位没有一句话说清 | 四份文档 | 补一张对比表：Agent=自主规划+工具；Chatflow=固定编排+对话 |
| P2-9 | API 版本与弃用策略缺失 | 技术详设第 11 章 | 补 v1 兼容承诺与弃用窗口 |
| P2-10 | API Key 消耗谁的模型配额未定义 | 技术详设 D6 | 明确「归画布 owner」或「归 Key 创建者」，写进合同/文档 |

---

## 4. 四份文档一致性矩阵

| 能力 | 功能清单 | PRD V1.0 | 原型 | 技术详设 | 一致性 |
|---|---|---|---|---|---|
| 应用形态 | APP-01~04 | FR-01 | 应用列表 + 创建 | D1 + WP1 | ✅ |
| End 节点 | 4.1 P0 | FR-03-01 | Workflow 有 | 8.1 + WP3 | ✅ |
| Answer 节点 | 4.1 P0 | FR-03-02 | Chatflow 有 | 8.2 + WP4 | ✅ |
| 独立 LLM | 4.2 P0 | FR-03-03 | 有 | 8.3 + WP5（后端已存在） | ⚠ 工作量口径不一致 |
| 参数提取 | 4.2 P0 | FR-03-04 | 节点面板有，无配置面板 | 8.4 + WP6 | ⚠ 原型缺配置表单 |
| 模板转换 | 4.4 P0 | FR-03-05 | 节点面板有，无配置面板 | 8.5 + WP7 | ⚠ 原型缺配置表单 |
| 变量双轨 | VAR-02/03 | FR-04 | 变量弹窗 | 9 + WP2 | ✅ |
| 运行记录 | LOG-01~03 | FR-08 | 只有抽屉，无列表 | 5.3/5.4 + WP9 | ⚠ 原型缺列表 |
| 版本回滚 | VER-05 | FR-06-04 | 版本弹窗有恢复 | 10.4 + WP10 | ✅ |
| 双 API | PUB-02/03 | FR-07-02/03 | 发布弹窗 | 11.2/11.3 + WP11 | ✅ |
| API Key | PUB-08 | FR-07-04 | 只展示，无管理 | 11.5 + WP12 | ⚠ 原型缺管理 |
| 审计 | GOV-04 | FR-09-04 | 无 | 15 一句话，无 DDL | ❌ 缺落点 |
| WebApp/嵌入 | PUB-05/07 | FR-07-06 | 发布弹窗有 | 技术详设无 | ⚠ 缺落点 |
| DSL 导入导出 | PUB-13 | FR-07-07 | 列表有「导入 DSL」 | 技术详设无 | ⚠ 缺落点 |
| 节点面板/右键 | CV-02/03 | FR-02-01/03 | 有面板，无右键 | D7 提及，无 WP | ⚠ 缺工作包 |
| 单节点运行/停止 | DBG-02/04 | FR-05-02/04 | 无 | 未展开 | ❌ 缺 |
| 归档 | APP-05 | FR-01-05 | 无 | 5.1 + 11.1 有 | ⚠ 原型缺 |

---

## 5. 原型覆盖度对照

| PRD 要求 | 原型状态 | 说明 |
|---|---|---|
| 创建三种应用 | ✅ | 三选一卡片 |
| 节点面板 | ✅ | 分组 + 增量标记 |
| 右键菜单 | ❌ | 无 |
| 单节点试运行 | ❌ | 只有整图试运行 |
| 停止运行 | ❌ | 运行面板无停止按钮 |
| 运行历史 | ❌ | 只有单次 run 抽屉 |
| 节点执行详情 | ⚠ | 只有耗时条，无完整 IO |
| 发布校验失败 | ❌ | 只有 toast |
| API Key 管理 | ❌ | 发布弹窗只展示一个 Key |
| 版本恢复 | ✅ | 有「恢复」入口 |
| 归档 | ❌ | 无 |
| 并发冲突 | ❌ | 无 |
| 空/错/加载态 | ❌ | 无 |
| 环境变量 secret | ⚠ | 有掩码展示，无编辑/轮换 |

---

## 6. 建议的修订顺序

| 顺序 | 动作 | 产出 |
|---|---|---|
| 1 | 修 P0-1（API Key 权限路径） | 技术详设新增 `RunAgentAsApp` 章节 |
| 2 | 修 P0-2（环境变量快照） | DDL 调整 + restore 语义 |
| 3 | 修 P0-3/4/5（异步、幂等、超时预算） | 运行模型章节重写；或明确砍掉 async |
| 4 | 修 P0-6/7（conversation_id、HITL resume） | API 契约补全 |
| 5 | 补 P1-3/4（审计与保留期） | 新表 + 保留策略 |
| 6 | 补 P1-5/6（WebApp/嵌入、DSL、节点面板） | 工作包补齐或降级 |
| 7 | 补原型失败态与运行历史 | 原型 v1.1 |
| 8 | 统一 P2 命名与口径 | PRD/清单/技术详设对齐 |

---

## 7. 复核清单（修完后逐项打勾）

- [ ] API Key 调用能在无用户 Session 的情况下跑通，且 tenant 正确
- [ ] 发布两次相同 DSL 生成两个版本号，可分别回滚
- [ ] 回滚 v2 后，环境变量、模型、提示词都回到 v2
- [ ] 异步 run 在进程重启后不会永久卡在 running
- [ ] 同一 `Idempotency-Key` 重复调用只产生一个 run
- [ ] 一个死循环 Workflow 会在 `max_duration` 后被终止
- [ ] Chatflow 第二次调用带 `conversation_id` 能读到第一轮的会话变量
- [ ] 含 UserFillUp 的 Workflow 通过 API 调用能 resume（或发布时被阻止）
- [ ] 审计日志可查，保留 ≥180 天，且不随 run 清理
- [ ] 跨租户访问 API Key / run / 会话变量统一 404
- [ ] 原型能演示一次发布校验失败并定位到节点
- [ ] 原型能演示停止运行与运行历史

---

> 评审说明：以上问题均基于 `ac2044bb` 代码与四份文档对照得出；P0 项不是文档措辞问题，是按当前设计直接实现会失败或产生数据错误的点。
