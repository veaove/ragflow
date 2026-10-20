# Dify Chatflow / Workflow 能力移植 —— 技术详细设计

| 项 | 内容 |
|---|---|
| 文档名称 | Dify Chatflow / Workflow 能力移植 技术详细设计 |
| 版本 | v1.1（按四件套评审修订） |
| 状态 | 待评审 |
| 日期 | 2026-10-19 |
| 代码基线 | RAGFlow `ac2044bb`（Go 单实现 + React Flow 前端） |
| 上游文档 | PRD `docs/PRD_Dify_Chatflow与Workflow移植.md`；功能清单 `docs/功能清单_Dify_Chatflow与Workflow移植.md`；原型 `docs/prototypes/Dify_Chatflow_Workflow_原型.html`；评审 `docs/REVIEW_Dify_Chatflow与Workflow四件套.md` |

**v1.1 修订记录**

| 变更 | 落点 |
|---|---|
| API Key 改走 `RunAgentAsApp`，不再传系统用户过权限链 | 4.6、6.3、7.5 |
| async 降到 V1.1，V1.0 只做 blocking/streaming | 4.4、7.2、11.2 |
| 环境变量快照唯一键改 `(canvas_id, name, version_seq)`，restore 一并恢复 | 5.6、10.3、10.4 |
| 新增幂等、run 级超时/预算、审计表 | 4.8、4.9、5.8、8.6、11.1 |
| 明确 `conversation_id` 映射与 HITL 公开 API 策略 | 4.10、11.3、11.6 |
| 补 DSL schema 版本、ALTER 语句、多租户测试、PII/注入防护 | 5.1、13.1、15、17 |

---

## 一、设计目标与约束

### 1.1 目标

在不引入第二套运行时、不破坏现有 Agent 的前提下，把 Workflow 与 Chatflow 做成 RAGFlow 的一等应用形态，并补齐出口节点、变量双轨、运行记录、版本回滚与双发布 API。

### 1.2 硬约束

| 约束 | 说明 |
|---|---|
| 复用现有引擎 | 继续使用 `internal/agent/canvas`（Eino `compose.Workflow`）+ `internal/agent/component`，不移植 Dify `graphon` |
| 复用现有画布 | 继续使用 `@xyflow/react`（React Flow），不换 X6 |
| 存量零回归 | 现有 `agent_canvas` 应用的创建、运行、日志、分享、Webhook 全部保持 |
| 单写路径 | 不保留新旧双轨；新增能力直接落到现有包，不做兼容 shim |
| 发布原子 | 发布必须事务化，失败回滚，不出现部分生效 |

### 1.3 非目标

- 不实现 Dify DSL 导入（节点字段映射层单独立项）。
- 不实现定时/插件触发器。
- 不实现多人实时协作。
- 不重写前端画布渲染层。

---

## 二、现状与差距（代码级）

### 2.1 现状

| 能力 | 现有实现 | 结论 |
|---|---|---|
| 应用载体 | `internal/entity/canvas.go` 的 `UserCanvas`，表 `user_canvas`，字段 `canvas_category` 默认 `agent_canvas` | **可复用**，形态可落在 `canvas_category` |
| 版本表 | `UserCanvasVersion`，表 `user_canvas_version`，字段 `release` / `dsl` | **可复用**，但缺 restore |
| 画布 DSL | `Canvas{Components, Path, History, Memory, Retrieval, Globals}`；`CanvasComponent{Obj{ComponentName, Params}, Downstream, Upstream}` | **可复用**，节点即组件 |
| 编译 | `canvas.Compile` → `compose.NewWorkflow` → `CompiledCanvas{Workflow, CheckPointID}` | **可复用** |
| 终结点 | `scheduler.go` Pass 3 把无下游节点 `wireWorkflowTerminals` 到 `compose.END`，多终止节点走 gather | **天然支持 End 节点** |
| 组件契约 | `component.Component{Name, Invoke, Stream, Inputs, Outputs}`，`Register(name, factory)` | **新增节点只需注册** |
| 变量 | `runtime.CanvasState{Outputs, Sys, Env, Path, History, Memory, Retrieval, Globals, RunID, SessionID}` | **缺 Conversation 命名空间** |
| LLM | `component/llm.go` 已注册 `"LLM"`，支持 system/user prompt、temperature、JSONOutput、OutputStructure | **后端已就绪，前端缺表单** |
| Message | `component/message.go` 已实现 `Invoke` 与 `Stream` | **可作为 Answer 的渲染底座** |
| 运行追踪 | `canvas/run_tracker.go` 基于 Redis，记录 run/session 状态 | **可复用 run_id，但不持久化节点 IO** |
| 发布 | `service/agent.go:1281 PublishAgent` 设 `release=true` 并保存版本 | **可复用事务，缺形态校验** |
| 版本保存 | `dao/user_canvas_version.go:162 SaveOrReplaceLatestTx`，DSL 相同则更新最新行 | **与「不可变快照」冲突，需改** |
| 路由 | `router/agent_routes.go` 已有 CRUD/run/publish/versions/sessions/logs/webhook/components debug | **可复用，缺双 API 与 API Key** |
| 前端画布 | `web/src/pages/agent`，React Flow，节点表单在 `form/*-form` | **缺 end/answer/llm/parameter-extractor/template-transform 表单** |

### 2.2 差距清单

| # | 差距 | 影响 | 改造类型 |
|---|---|---|---|
| G1 | 只有 `agent_canvas`，无形态语义 | Workflow/Chatflow 无法区分 | 枚举扩展 + 校验 |
| G2 | 无 End 组件 | Workflow 无输出契约 | 新增组件 |
| G3 | 无 Answer 组件 | Chatflow 无正式出口 | 新增组件（复用 Message） |
| G4 | LLM 组件后端有、前端无 | 无法在画布配置 LLM | 前端表单 + 节点目录 |
| G5 | 无 ParameterExtractor | 无法做结构化抽取 | 新增组件 + 表单 |
| G6 | 无 TemplateTransform | 无法做 Jinja 模板 | 新增组件 + 表单 |
| G7 | `CanvasState` 无 Conversation | 会话变量不成立 | 状态扩展 + 持久化 |
| G8 | `env.*` 可被赋值节点写 | 环境变量不安全 | 只读约束 |
| G9 | 节点 IO 不落库 | 刷新即丢，无法排障 | 新表 + 异步记录 |
| G10 | 版本按 DSL 去重 | 快照不可变不成立 | DAO 选项改造 |
| G11 | 无 restore | 只能看不能回滚 | 新接口 |
| G12 | 只有 Agent run | 无 Workflow/Chatflow API | facade + 鉴权 |

---

## 三、总体架构

```
┌──────────────────────────────────────────────────────────────┐
│ 前端 web/src/pages/agent                                     │
│  ├─ 应用列表（按 canvas_category 分形态）                      │
│  ├─ 画布（React Flow，复用）                                   │
│  ├─ 节点表单（新增 end / answer / llm / param / template）     │
│  ├─ 变量面板（env 只读 / conversation 可写）                   │
│  └─ 运行面板（结果 / 变量 / Tracing）                          │
└───────────────────────────┬──────────────────────────────────┘
                            │ HTTP / SSE
┌───────────────────────────▼──────────────────────────────────┐
│ 接入层 internal/handler + internal/router                     │
│  ├─ /agents/:id/*            编辑态 CRUD / 试运行 / 版本       │
│  ├─ /workflows/:id/run       Workflow 发布态 API              │
│  ├─ /chatflows/:id/chat      Chatflow 发布态 API              │
│  └─ /apps/:id/api-keys       应用级密钥                        │
└───────────────────────────┬──────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────┐
│ 服务层 internal/service                                       │
│  ├─ AgentService：Run / Publish / Restore / Validate          │
│  ├─ RunRecorder：消费 RunEvent → 异步落库                      │
│  ├─ ConversationVariableService：按会话读写                    │
│  └─ AppKeyService：Key 签发 / 校验 / 限流                      │
└───────────────────────────┬──────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────┐
│ 执行层 internal/agent                                         │
│  ├─ canvas：Compile / BuildWorkflow / CanvasState / RunTracker│
│  ├─ runtime：CanvasState / Registry / TemplateJinja           │
│  ├─ component：Begin / End / Answer / LLM / ParamExtract / ...│
│  └─ dsl：Normalize / Extract                                  │
└───────────────────────────┬──────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────┐
│ 存储层                                                        │
│  MySQL：user_canvas / user_canvas_version / agent_run / ...   │
│  Redis：RunTracker（运行态、取消、中断恢复）                    │
└──────────────────────────────────────────────────────────────┘
```

---

## 四、关键设计决策

### D1：应用形态落 `canvas_category`，不新增 `app_mode`

**决策**：`user_canvas.canvas_category` 扩展为 `agent_canvas` / `chatflow_canvas` / `workflow_canvas`，不新增 `app_mode` 列。

**理由**：

1. `canvas_category` 已存在、已建索引、已有 DAO 过滤（`dao/user_canvas.go:133/157/319`），且唯一索引是 `(user_id, canvas_category, title)`，形态内重名校验天然成立。
2. 新增 `app_mode` 会与 `canvas_category` 形成双事实源，后续必然出现两者不一致。
3. `internal/admin/service_ee.go:677` 用 `strings.SplitN(canvas_category, "_", 2)[0]` 取前缀，`workflow_canvas` → `workflow`，仍然成立。

**被否方案**：新增 `app_mode` 列。被否原因：与现有分类重复，需同步维护两处。

**迁移**：存量行保持 `agent_canvas`，无需数据迁移。

### D2：End / Answer 作为普通组件接入，不改图引擎

**决策**：

- `End` 注册为普通组件，作为 Workflow 的唯一终止节点。
- `Answer` 注册为普通组件，内部复用 `MessageComponent` 的渲染与 `Stream`，作为 Chatflow 的终止节点。

**理由**：

1. `scheduler.go` Pass 3 已经把「无下游节点」通过 `wireWorkflowTerminals` 接到 `compose.END`，多终止节点走 gather；End/Answer 不需要改编译器。
2. `message.go` 已实现 `Invoke`（174 行）与 `Stream`（562 行），Answer 直接复用渲染逻辑，避免重写 SSE。
3. 终止节点是图的一部分，校验、变量、日志都能复用现有机制。

**风险与对策**：多个 End 会被 gather 合并，导致输出契约不确定。对策：编译前校验「Workflow 恰好一个可达 End」「Chatflow 至少一个可达 Answer 且无 End」。

### D3：变量双轨扩展 `CanvasState`

**决策**：在 `runtime.CanvasState` 增加 `Conversation map[string]any`；`Env` 变为运行时只读。

**理由**：

1. 现有 `CanvasState` 已有 `Sys` / `Env` / `Outputs`，命名空间拆分逻辑在 `scheduler.go:428-441`，扩展 `conversation.` 与现有模式一致。
2. `Env` 的写入目前只有 `VariableAssigner` 与 DSL globals；把写入收敛到「仅编译期 seed」，即可实现只读。
3. 会话变量需要跨轮持久化，必须落库；不能继续塞进会话 DSL 副本。

**被否方案**：把会话变量继续存在 `API4Conversation.DSL`。被否原因：DSL 是图定义，不是运行时数据；混在一起会导致版本快照污染与并发写覆盖。

### D4：运行记录旁路异步落库，async 延后到 V1.1

**决策**：

- 新增 `agent_run` / `agent_node_execution` 两张表；`RunAgent` 在消费 `canvas.RunEvent` 的同时，把事件投递给 `RunRecorder`，由它批量异步写入。
- **V1.0 不提供 `response_mode=async`**，只做 blocking 与 streaming；async 需要持久化队列与孤儿恢复，放到 V1.1，用 NATS worker 实现。

**理由**：

1. 现有 `RunTracker` 是 Redis 运行态（`run_tracker.go`），不适合做历史查询；`API4Conversation` 是会话消息，不是运行记录。
2. 同步写库会拖慢 SSE 首包；用带缓冲的 channel + 批量 insert，把 P95 影响控制在 50ms 内。
3. 现有 `RunAgent`（`service/agent.go:1818-1860`）绑定在 HTTP 请求的 goroutine 上；没有 worker 就做 async，进程重启后 `queued/running` 会变孤儿，等于交付一个假接口。宁可不做。

**被否方案**：复用 `API4Conversation` 存 run。被否原因：一个会话多轮 run，粒度不匹配；且会污染会话查询。

**被否方案**：V1.0 直接上 async + 临时 goroutine。被否原因：不可恢复，违反「可上线」标准。

### D5：发布版本改为「追加 + 不可变」

**决策**：给 `SaveOrReplaceLatestVersionOptions` 增加 `AlwaysCreate bool`；发布走 `AlwaysCreate=true`，恢复/自动保存走原逻辑。

**理由**：

1. `SaveOrReplaceLatestTx`（`dao/user_canvas_version.go:185`）在 DSL 相同时会更新最新行，不是追加。这与「每次发布生成不可变快照」冲突。
2. 版本历史需要可枚举、可回滚，必须每次发布新增一行。
3. 改动只在 DAO 选项层，不破坏现有自动保存的去重行为。

**发布原子性**：沿用 `PublishAgent` 现有事务（`service/agent.go:1318`），在事务前增加 `validatePublish`，事务内完成 `user_canvas` 更新 + 版本插入。

### D6：双 API 走 facade，API Key 用 `RunAgentAsApp`

**决策**：

- 编辑态继续用 `/agents/:canvas_id/run`，走用户 Session 与 `loadCanvasForUser`。
- 新增 `/workflows/:canvas_id/run` 与 `/chatflows/:canvas_id/chat`，只做「形态校验 + 参数映射 + 鉴权」，内部调用 `AgentService.RunAgentAsApp`。
- **API Key 调用不走 `loadCanvasForUser`**：新增 `RunAgentAsApp(ctx, canvasID, keyID, ...)`，按 `canvas_id` 直接加载画布，校验 `app_api_key.canvas_id` 匹配与 `status=active`，用 `canvasRow.UserID` 作为 owner/tenant 传入运行器。

**理由**：

1. `loadCanvasForUser`（`service/agent.go:1033`）会调用 `CheckCanvasPermission(Subject{UserID: userID})`；传「系统用户」必然 404。这不是配置问题，是权限模型问题。
2. `agentTenantID := canvasRow.UserID`（`service/agent.go:1448`）——运行时租户就是画布 owner，直接用 owner 身份最一致。
3. 运行逻辑只有一份，facade 只做鉴权与参数映射，避免三套 SSE 处理。

**被否方案**：给「系统用户」授权。被否原因：会在权限模型上开一个永久后门，后续审计无法解释。
**被否方案**：把 `/agents/:id/run` 直接复用为公开 API。被否原因：编辑态要用户 Token，公开 API 要应用 Key，混用会导致权限模型混乱。

### D7：前端复用 React Flow，新增节点表单

**决策**：不换画布库；新增 `end-form`、`answer-form`、`llm-form`、`parameter-extractor-form`、`template-transform-form`，并在节点目录中按形态过滤；同时补左侧节点面板与右键菜单。

**理由**：

1. `web/src/pages/agent/canvas/node/*` 已有 27 种节点渲染，新增节点只需加渲染组件与表单。
2. `web/src/constants/agent.tsx` 的 `Operator` 枚举是节点类型单一事实源，新增枚举即可驱动面板与表单。
3. 形态过滤可以复用现有 `AgentOperatorList` 的思路，新增 `WorkflowOperatorList` / `ChatflowOperatorList`。
4. 节点面板与右键菜单是 PRD V1.0 的能力，必须有对应工作包，不能只写在 PRD 里。

### D8：API 幂等放在 `agent_run` 唯一索引

**决策**：接受 `Idempotency-Key` 请求头；`agent_run` 增加 `idempotency_key`，唯一索引 `(canvas_id, idempotency_key)`。

**理由**：

1. 外部系统重试是常态，没有幂等就会重复执行、重复扣 token。
2. 放数据库唯一索引而不是 Redis，是因为 run 记录本身要持久化，唯一约束与持久化在同一个事务里最可靠。
3. 重复请求直接返回首次 `run_id` 与状态，不重复执行。

**边界**：不传 `Idempotency-Key` 时按「每次新建」处理，文档写明；Key 有效期与 run 记录保留期一致。

### D9：run 级超时与预算在 runner 上下文统一控制

**决策**：运行参数增加 `max_duration_ms`、`max_tokens`、`max_cost`；在 runner 的 `context` 上挂 `WithTimeout`，每次 LLM 调用后累计 token，超限终止并标记 `RUN_TIMEOUT` / `BUDGET_EXCEEDED`。

**理由**：

1. 只有节点级超时，Loop 写错或模型反复重试会让整次 run 无限跑。
2. 成本必须可控；基金场景单次对话可能有多次检索 + LLM，不能只靠租户配额兜底。
3. 终止原因要落 `agent_run`，否则排障时只知道失败、不知道为什么。

**默认值（经验起点，需用实际数据校准）**：`max_duration_ms=300000`（5 分钟）、`max_tokens=100000`、`max_cost` 按租户配置；Iteration 并发默认 10。

### D10：审计独立成表，不随 run 清理

**决策**：新增 `audit_log` 表，记录创建/编辑/发布/回滚/删除/Key 轮换；保留 ≥180 天，独立清理任务。

**理由**：

1. 运行记录默认保留 90 天，审计要求 ≥180 天，两者生命周期不同，不能共用一张表。
2. 审计要能回答「谁在什么时候把什么改成了什么」，必须存前后值（脱敏）。
3. 发布、回滚、Key 轮换是高风险操作，必须有独立可查的证据链。

---

## 五、数据模型

### 5.0 PRD 概念 → 实现实体映射

| PRD 概念 | 本设计落点 | 说明 |
|---|---|---|
| `application` | `user_canvas` | 复用现有应用表，形态落 `canvas_category` |
| `app_version` | `user_canvas_version` | 复用现有版本表，增加 `version_seq` / `remark` / `base_version_id` |
| `workflow_run` | `agent_run`（新增） | 避免与会话消息表 `api4_conversation` 混淆 |
| `workflow_node_execution` | `agent_node_execution`（新增） | 节点级 IO 持久化 |
| `conversation_variable` | `conversation_variable`（新增） | 按 Conversation 持久化 |
| `environment_variable` | `environment_variable`（新增） | 应用级、版本快照 |
| `app_api_key` | `app_api_key`（新增） | 独立密钥与限流 |

### 5.1 `user_canvas`（改造）

| 字段 | 类型 | 变更 | 说明 |
|---|---|---|---|
| `canvas_category` | varchar(32) | 扩枚举 | `agent_canvas` / `chatflow_canvas` / `workflow_canvas` / `dataflow_canvas` |
| `archived_at` | datetime NULL | 新增 | 归档时间；非空即归档 |
| `dsl_schema_version` | int | 新增 | DSL schema 版本，默认 1；旧 DSL 按版本迁移 |
| `release` | bool | 保留 | 是否已发布；与 `archived_at` 组合推导状态 |

**状态推导**（不新增 status 列，避免双事实源）：

```
archived_at != NULL        → archived
release = true             → published
其他                        → draft
```

### 5.2 `user_canvas_version`（改造）

| 字段 | 类型 | 变更 | 说明 |
|---|---|---|---|
| `version_seq` | int | 新增 | 单调递增，用于生成 v1/v2 |
| `remark` | varchar(255) | 新增 | 版本备注 |
| `base_version_id` | varchar(32) NULL | 新增 | 发布时的基线版本，用于冲突检测 |
| `env_snapshot` | LONGTEXT | 新增 | 环境变量快照（加密），restore 时一并恢复 |

**必须新增索引**：`UNIQUE KEY uk_canvas_version_seq (user_canvas_id, version_seq)`，防并发发布产生重复版本号。

### 5.3 `agent_run`（新增）

```sql
CREATE TABLE agent_run (
  id              VARCHAR(32)  NOT NULL PRIMARY KEY,
  canvas_id       VARCHAR(32)  NOT NULL,
  tenant_id       VARCHAR(64)  NOT NULL,   -- 画布 owner 的 user_id（见 D6）
  version_seq     INT          NOT NULL DEFAULT 0,
  trigger_type    VARCHAR(16)  NOT NULL,  -- debug / api / webapp / embed / webhook
  status          VARCHAR(16)  NOT NULL,  -- queued/running/succeeded/failed/stopped/partial
  inputs          LONGTEXT,
  outputs         LONGTEXT,
  error_code      VARCHAR(64),
  error_message   TEXT,
  duration_ms     INT          NOT NULL DEFAULT 0,
  max_duration_ms INT          NOT NULL DEFAULT 300000,
  prompt_tokens   INT          NOT NULL DEFAULT 0,
  completion_tokens INT        NOT NULL DEFAULT 0,
  conversation_id VARCHAR(32),
  idempotency_key VARCHAR(128),
  api_key_id      VARCHAR(32),
  created_by      VARCHAR(64),
  create_time     DATETIME(3)  NOT NULL,
  update_time     DATETIME(3)  NOT NULL,
  UNIQUE KEY uk_run_idem (canvas_id, idempotency_key),
  KEY idx_run_canvas_time (canvas_id, create_time),
  KEY idx_run_conversation (conversation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 5.4 `agent_node_execution`（新增）

```sql
CREATE TABLE agent_node_execution (
  id           VARCHAR(32) NOT NULL PRIMARY KEY,
  run_id       VARCHAR(32) NOT NULL,
  canvas_id    VARCHAR(32) NOT NULL,
  node_id      VARCHAR(64) NOT NULL,
  node_type    VARCHAR(64) NOT NULL,
  status       VARCHAR(16) NOT NULL,  -- waiting/running/succeeded/failed/skipped/retrying
  inputs       LONGTEXT,
  process      LONGTEXT,
  outputs      LONGTEXT,
  error_code   VARCHAR(64),
  error_message TEXT,
  duration_ms  INT NOT NULL DEFAULT 0,
  retry_count  INT NOT NULL DEFAULT 0,
  create_time  DATETIME(3) NOT NULL,
  KEY idx_node_run (run_id),
  KEY idx_node_canvas_type (canvas_id, node_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 5.5 `conversation_variable`（新增）

```sql
CREATE TABLE conversation_variable (
  id              VARCHAR(32) NOT NULL PRIMARY KEY,
  conversation_id VARCHAR(32) NOT NULL,
  canvas_id       VARCHAR(32) NOT NULL,
  name            VARCHAR(128) NOT NULL,
  value           LONGTEXT,
  value_type      VARCHAR(32) NOT NULL DEFAULT 'string',
  update_time     DATETIME(3) NOT NULL,
  UNIQUE KEY uk_conv_name (conversation_id, name),
  KEY idx_conv_canvas (canvas_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 5.6 `environment_variable`（新增）

```sql
CREATE TABLE environment_variable (
  id          VARCHAR(32) NOT NULL PRIMARY KEY,
  canvas_id   VARCHAR(32) NOT NULL,
  name        VARCHAR(128) NOT NULL,
  value       TEXT NOT NULL,               -- secret 类型加密存储
  value_type  VARCHAR(16) NOT NULL DEFAULT 'text',
  version_seq INT NOT NULL DEFAULT 0,       -- 0=草稿；>0=发布版本
  create_time DATETIME(3) NOT NULL,
  update_time DATETIME(3) NOT NULL,
  UNIQUE KEY uk_env_canvas_name_version (canvas_id, name, version_seq)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

> **修正说明（v1.1）**：原设计唯一键是 `(canvas_id, name)`，无法按版本存多行；发布快照会覆盖旧值，restore 也恢复不了环境变量。改为三列唯一键，发布时按新 `version_seq` 复制一份，草稿用 `version_seq=0`。

### 5.7 `app_api_key`（新增）

```sql
CREATE TABLE app_api_key (
  id           VARCHAR(32) NOT NULL PRIMARY KEY,
  canvas_id    VARCHAR(32) NOT NULL,
  owner_user_id VARCHAR(64) NOT NULL,   -- 画布 owner，运行时作为 tenant（见 D6）
  key_prefix   VARCHAR(16) NOT NULL,
  key_hash     VARCHAR(128) NOT NULL,
  status       VARCHAR(16) NOT NULL DEFAULT 'active',
  rpm_limit    INT NOT NULL DEFAULT 60,
  concurrency_limit INT NOT NULL DEFAULT 5,
  burst_limit  INT NOT NULL DEFAULT 10,
  last_used_at DATETIME(3),
  created_by   VARCHAR(64),
  create_time  DATETIME(3) NOT NULL,
  UNIQUE KEY uk_key_hash (key_hash),
  KEY idx_key_canvas (canvas_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 5.8 `audit_log`（新增）

```sql
CREATE TABLE audit_log (
  id          VARCHAR(32) NOT NULL PRIMARY KEY,
  tenant_id   VARCHAR(64) NOT NULL,
  canvas_id   VARCHAR(32) NOT NULL,
  action      VARCHAR(32) NOT NULL,   -- create/update/publish/restore/delete/key_rotate/archive
  object_type VARCHAR(32) NOT NULL,
  object_id   VARCHAR(32),
  before      LONGTEXT,
  after       LONGTEXT,
  operator    VARCHAR(64) NOT NULL,
  create_time DATETIME(3) NOT NULL,
  KEY idx_audit_canvas_time (canvas_id, create_time),
  KEY idx_audit_action (action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

> 保留策略：审计 ≥180 天，独立清理任务；运行记录默认 90 天，两者不共用生命周期。

---

## 六、后端模块设计

### 6.1 entity 层

| 文件 | 变更 |
|---|---|
| `internal/entity/canvas.go` | `UserCanvas` 增加 `ArchivedAt *time.Time`、`DSLSchemaVersion int`；`UserCanvasVersion` 增加 `VersionSeq int`、`Remark *string`、`BaseVersionID *string`、`EnvSnapshot JSONMap` |
| `internal/entity/agent_run.go`（新增） | `AgentRun`（含 `IdempotencyKey` / `APIKeyID` / `MaxDurationMS`）、`AgentNodeExecution` |
| `internal/entity/conversation_variable.go`（新增） | `ConversationVariable` |
| `internal/entity/environment_variable.go`（新增） | `EnvironmentVariable` |
| `internal/entity/app_api_key.go`（新增） | `AppAPIKey`（含 `OwnerUserID` / `BurstLimit`） |
| `internal/entity/audit_log.go`（新增） | `AuditLog` |

### 6.2 dao 层

| 文件 | 变更 |
|---|---|
| `internal/dao/user_canvas.go` | 列表/计数已按 `canvas_category` 过滤，无需改；新增 `Archive/Unarchive` |
| `internal/dao/user_canvas_version.go` | `SaveOrReplaceLatestVersionOptions` 增加 `AlwaysCreate bool`；`SaveOrReplaceLatestTx` 在 `AlwaysCreate` 时跳过 same-DSL 去重，直接 `Create`；新增 `NextVersionSeqTx` |
| `internal/dao/agent_run.go`（新增） | `Create`、`BatchCreateNodes`、`List`、`Get`、`UpdateStatus`、`GetByIdempotencyKey` |
| `internal/dao/conversation_variable.go`（新增） | `LoadByConversation`、`UpsertMany` |
| `internal/dao/environment_variable.go`（新增） | `LoadByCanvas`、`Upsert`、`Delete`、`SnapshotVersionTx` |
| `internal/dao/app_api_key.go`（新增） | `Create`、`GetByHash`、`ListByCanvas`、`Disable` |
| `internal/dao/audit_log.go`（新增） | `Create`、`List`、`PurgeBefore` |

**关键改动**：`SaveOrReplaceLatestTx` 当前逻辑（`dao/user_canvas_version.go:185`）在 `opts.sameDSL(latest.DSL)` 为真时更新最新行。改为：

```go
if !opts.AlwaysCreate && err == nil && opts.sameDSL(latest.DSL) {
    // 原去重逻辑
} else {
    // 新增一行，version_seq = latest.VersionSeq + 1
}
```

### 6.3 service 层

| 文件 | 变更 |
|---|---|
| `internal/service/agent.go` | `PublishAgent` 增加 `validatePublish(ctx, canvas, req)`；发布时 `AlwaysCreate=true`；新增 `RestoreVersion`（含环境变量）；新增 `ArchiveAgent` |
| `internal/service/agent_app_run.go`（新增） | **`RunAgentAsApp(ctx, canvasID, keyID, ...)`**：按 canvas_id 直取画布，校验 key→canvas，用 `canvasRow.UserID` 作为 owner/tenant，**不走** `loadCanvasForUser` |
| `internal/service/agent_publish_validate.go`（新增） | 形态校验：唯一终端、变量可达、必填配置、密钥完整、**含 UserFillUp 的 Workflow 禁止发布为公开 API** |
| `internal/service/agent_run.go`（新增，或从 agent.go 拆出） | `RunAgent` 增加 run 记录、幂等检查、run 级超时/token 预算、`RunRecorder` 挂载；按 `canvas_category` 选择 Runner |
| `internal/service/run_recorder.go`（新增） | 消费 `canvas.RunEvent`，批量写 `agent_run` / `agent_node_execution`；PII 脱敏 |
| `internal/service/conversation_variable.go`（新增） | 运行前加载、运行后写回；按 `conversation_id` 串行化 |
| `internal/service/app_api_key.go`（新增） | 生成、轮换、禁用、校验、限流（RPM + 并发 + burst） |
| `internal/service/audit.go`（新增） | 写审计、查询、保留期清理 |
| `internal/service/agent_sessions.go` | 会话创建时初始化会话变量 |

**`RunAgent` 改造点**（`service/agent.go:1442`）：

```go
func (s *AgentService) RunAgent(ctx, userID, canvasID, sessionID, version string, req RunRequest) (<-chan canvas.RunEvent, error) {
    canvasRow := s.loadCanvasForUser(ctx, userID, canvasID, permission.OperationRun) // 编辑态
    return s.runWithRules(ctx, canvasRow, userID, sessionID, version, req)
}

// RunAgentAsApp：公开 API 入口，不走用户权限链（D6）
func (s *AgentService) RunAgentAsApp(ctx context.Context, canvasID, keyID string, req RunRequest) (<-chan canvas.RunEvent, error) {
    key, err := s.appKeyDAO.GetByID(ctx, keyID)
    if err != nil || key.Status != "active" || key.CanvasID != canvasID {
        return nil, ErrAppKeyForbidden
    }
    canvasRow, err := s.canvasDAO.GetByID(ctx, canvasID) // 直取，不查用户权限
    if err != nil { return nil, err }
    return s.runWithRules(ctx, canvasRow, canvasRow.UserID, req.ConversationID, "", req)
}

func (s *AgentService) runWithRules(ctx, canvasRow, ownerUserID, sessionID, version string, req RunRequest) (<-chan canvas.RunEvent, error) {
    // 1. 形态校验
    if err := validateRunMode(canvasRow.CanvasCategory, req); err != nil { return nil, err }

    // 2. 幂等（D8）：先查，再创建；唯一索引兜底
    if req.IdempotencyKey != "" {
        if existing, _ := s.runDAO.GetByIdempotencyKey(ctx, canvasRow.ID, req.IdempotencyKey); existing != nil {
            return s.replayRunEvents(ctx, existing)
        }
    }

    runID := common.GenerateUUID()
    s.runDAO.Create(ctx, &entity.AgentRun{
        ID: runID, CanvasID: canvasRow.ID, TenantID: ownerUserID,
        IdempotencyKey: req.IdempotencyKey, APIKeyID: req.APIKeyID,
        MaxDurationMS: req.MaxDurationMS, Status: "running",
    })

    // 3. run 级超时与预算（D9）
    runCtx, cancel := context.WithTimeout(ctx, time.Duration(req.MaxDurationMS)*time.Millisecond)
    defer cancel()

    // 4. 加载会话变量
    convVars := s.convVarService.Load(ctx, sessionID, canvasRow.ID)

    // 5. 编译 + 运行
    events := s.runCompiled(runCtx, canvasRow, runID, convVars, req)

    // 6. 挂 RunRecorder + 写回会话变量 + 审计
    return s.runRecorder.Wrap(runCtx, runID, events, func(finalState *canvas.CanvasState) {
        s.convVarService.Upsert(ctx, sessionID, canvasRow.ID, finalState.Conversation)
    }), nil
}
```

### 6.4 handler / router 层

| 文件 | 变更 |
|---|---|
| `internal/handler/agent.go` | 新增 `RestoreVersion`、`ArchiveAgent` |
| `internal/handler/workflow.go`（新增） | `RunWorkflow`（V1.0：blocking/streaming；async 返回 400） |
| `internal/handler/chatflow.go`（新增） | `ChatFlow`（SSE + conversation_id） |
| `internal/handler/app_api_key.go`（新增） | Key CRUD、轮换、禁用 |
| `internal/handler/run.go`（新增） | Run 列表/详情/节点记录 |
| `internal/handler/audit.go`（新增） | 审计查询与导出 |
| `internal/handler/app_share.go`（新增） | WebApp/分享/嵌入、DSL 导入导出 |
| `internal/router/agent_routes.go` | 增加 `POST /:canvas_id/versions/:version_id/restore`、`POST /:canvas_id/archive` |
| `internal/router/workflow_routes.go`（新增） | `POST /workflows/:canvas_id/run` |
| `internal/router/chatflow_routes.go`（新增） | `POST /chatflows/:canvas_id/chat` |
| `internal/router/app_key_routes.go`（新增） | `/apps/:canvas_id/api-keys` |
| `internal/router/run_routes.go`（新增） | `/runs`、`/runs/:run_id`、`/runs/:run_id/nodes` |
| `internal/router/audit_routes.go`（新增） | `/audits` |
| `internal/router/middleware/app_key_auth.go`（新增） | 解析 `Authorization: Bearer <key>`，校验 key→canvas，注入 `keyID` / `ownerUserID`（**不注入「系统用户」**） |

### 6.5 component 层

| 文件 | 变更 |
|---|---|
| `internal/agent/component/end.go`（新增） | `EndComponent`，解析 `outputs`，返回输出 map |
| `internal/agent/component/answer.go`（新增） | `AnswerComponent`，内嵌 `MessageComponent`，覆盖 `Name()`，补充 citations |
| `internal/agent/component/parameter_extractor.go`（新增） | `ParameterExtractorComponent`，输出结构化对象 |
| `internal/agent/component/template_transform.go`（新增） | `TemplateTransformComponent`，复用 `runtime/template_jinja.go` |
| `internal/agent/component/retry.go`（新增） | 通用重试包装器 |
| `internal/agent/component/llm.go` | 已存在，补充 `Register` 的输入参数校验与 `retry` 配置读取 |
| `internal/agent/component/registry.go` | 无需改，`Register` 自动收集 |

### 6.6 canvas / runtime 层

| 文件 | 变更 |
|---|---|
| `internal/agent/runtime/state.go` | `CanvasState` 增加 `Conversation map[string]any`；`GetVar/SetVar` 支持 `conversation.` 前缀；`SetVar` 对 `env.` 返回错误 |
| `internal/agent/canvas/scheduler.go` | `genState` 从上下文注入 Conversation；`globals` 只 seed `sys.`/`env.` |
| `internal/agent/canvas/compile.go` | 增加 `WithValidateMode(mode)` 选项，编译前校验形态 |
| `internal/agent/canvas/variable.go` | `ResolveTemplate` 支持 `conversation.` 引用 |
| `internal/agent/canvas/run_tracker.go` | 无需改，run_id 继续复用 |

---

## 七、核心链路时序

### 7.1 创建与保存

```
前端 POST /agents {canvas_category:"workflow_canvas", title}
  → AgentHandler.CreateAgent
  → AgentService.CreateAgent
  → dao.UserCanvasDAO.Create (canvas_category=workflow_canvas, release=false)
  → 返回 canvas_id
前端 PUT /agents/:id {dsl}
  → 校验 DSL（NormalizeForCanvas + ValidateIntegerParameters）
  → 写 user_canvas.dsl
```

### 7.2 试运行

```
前端 POST /agents/:id/run {inputs, session_id?}
  → AgentHandler.RunAgent
  → AgentService.RunAgent
      ├─ loadCanvasForUser → canvas_category
      ├─ validateRunMode
      ├─ runDAO.Create(status=queued)
      ├─ convVarService.Load(session_id)
      ├─ dsl.NormalizeForCanvas → canvas.Compile
      ├─ 注入 CanvasState{sys, env, conversation}
      ├─ compiled.Workflow.Invoke / Stream
      └─ RunRecorder 消费事件 → 批量写 agent_run / agent_node_execution
  → SSE 返回 workflow_started / node_started / node_finished / workflow_finished
```

### 7.3 发布

```
前端 POST /agents/:id/publish {dsl, base_version_id}
  → validatePublish
      ├─ 形态：Workflow 唯一 End；Chatflow ≥1 Answer 且无 End
      ├─ 出口：End 输出字段非空 / Answer 内容非空
      ├─ 变量：所有引用可达、类型兼容
      └─ 密钥：secret 环境变量已配置
  → 事务：
      ├─ UPDATE user_canvas SET dsl=?, release=true
      ├─ INSERT user_canvas_version (version_seq=N+1, AlwaysCreate=true)
      └─ INSERT environment_variable snapshot
  → 失败：整个事务回滚
```

### 7.4 回滚

```
前端 POST /agents/:id/versions/:vid/restore
  → AgentService.RestoreVersion
      ├─ 读取 version.dsl
      ├─ 写 user_canvas.dsl（草稿）
      ├─ 不修改 release
      └─ 返回新草稿
前端再走一次 publish → 生成 v(N+1)
```

### 7.5 公开 API 调用

```
POST /workflows/:id/run
  Authorization: Bearer wf-sk-xxx
  → AppKeyAuth middleware
      ├─ hash 查 app_api_key
      ├─ 校验 status=active、canvas_id 匹配
      ├─ 限流（Redis token bucket: rpm/concurrency）
      └─ 注入 tenant_id / canvas_id / system user
  → WorkflowHandler.RunWorkflow
      ├─ 校验 canvas_category=workflow_canvas
      ├─ response_mode: blocking / async / streaming
      └─ 调用 AgentService.RunAgent
```

---

## 八、节点详细设计

### 8.1 End 节点

**文件**：`internal/agent/component/end.go`

**参数**：

```json
{
  "outputs": {
    "broadcast_text": { "type": "string", "value": "{llm@broadcast_text}" },
    "count": { "type": "number", "value": "{code@count}" }
  }
}
```

**Invoke 逻辑**：

1. 遍历 `outputs`，对每个 `value` 调 `canvas.ResolveTemplate`。
2. 按 `type` 做类型转换（string / number / boolean / object / array）。
3. 返回 `map[string]any`，即该节点的输出。

**与图引擎的关系**：End 无下游，`BuildWorkflow` Pass 3 会把它接到 `compose.END`。如果只有一个 End，返回的就是它；如果有多个，gather 会合并——因此编译前必须校验唯一性。

**校验规则**：

- `outputs` 非空。
- 每个字段有 `type` 与 `value`。
- `value` 中的变量引用可达。
- Workflow 恰好一个可达 End。

### 8.2 Answer 节点

**文件**：`internal/agent/component/answer.go`

**实现**：内嵌 `MessageComponent`，复用其 `Invoke` / `Stream` 渲染逻辑，覆盖 `Name()` 返回 `"Answer"`，并在输出中补充 `citations`。

**参数**：

```json
{
  "content": "{llm@answer}",
  "stream": true,
  "with_citation": true,
  "markdown": true
}
```

**与 Message 的差异**：

| 维度 | Message | Answer |
|---|---|---|
| 形态 | Agent 通用 | Chatflow 专用 |
| 流式 | 支持 | 必须支持 |
| 引用 | 可选 | 默认携带 |
| 校验 | 无 | Chatflow 至少一个可达 |

**校验规则**：

- `content` 非空。
- Chatflow 至少一个可达 Answer。
- Chatflow 不允许 End。

### 8.3 LLM 节点

**现状**：`internal/agent/component/llm.go` 已注册 `"LLM"`，`LLMParam` 已包含 `ModelID`、`SystemPrompt`、`UserPrompt`、`Temperature`、`TopP`、`MaxTokens`、`JSONOutput`、`OutputStructure`、`Cite`、`MessageHistoryWindowSize`、`ChatTemplateKwargs` 等。

**本期改造**：

1. **前端**：新增 `web/src/pages/agent/form/llm-form/`，字段对齐 `LLMParam`。
2. **节点目录**：在 `web/src/constants/agent.tsx` 的 `Operator` 增加 `LLM = 'LLM'`，并加入 `WorkflowOperatorList` 与 `ChatflowOperatorList`。
3. **后端**：补充 `retry` / `timeout` 参数读取（见 8.6）。
4. **输出**：保持 `answer`（文本）与 `structured`（JSON）双输出。

**注意**：RAGFlow 现有的 `Agent` 节点也调用 LLM，但带工具与规划。产品上要明确：**纯文本生成用 LLM，需要工具/多步规划用 Agent**。

### 8.4 ParameterExtractor 节点

**文件**：`internal/agent/component/parameter_extractor.go`

**参数**：

```json
{
  "input": "{sys.query}",
  "model_id": "...",
  "fields": [
    { "name": "fund_name", "type": "string", "required": true, "description": "基金名称" },
    { "name": "amount", "type": "number", "required": false, "description": "金额" }
  ],
  "instruction": "从用户问题中抽取字段，不要猜测。"
}
```

**实现要点**：

1. 构造 JSON Schema 提示词，要求模型只输出 JSON。
2. 解析后按 `fields` 校验：必填缺失 → 字段为空并标注 `missing: true`；类型不符 → 尝试转换，失败则标注 `invalid: true`。
3. 输出 `{ "result": {...}, "missing": [...], "invalid": [...] }`。
4. 复用 `llm.go` 的模型调用与重试逻辑，不重复造。

**质量约束**：字段准确率 ≥85%（PRD FR-11）；低置信字段不猜测。

### 8.5 TemplateTransform 节点

**文件**：`internal/agent/component/template_transform.go`

**参数**：

```json
{
  "template": "您好 {{ name }}，您的基金 {{ fund }} 今日净值 {{ nav }}。",
  "variables": { "name": "{start@user_name}", "fund": "{retrieval@fund}", "nav": "{llm@nav}" }
}
```

**实现**：复用 `internal/agent/runtime/template_jinja.go` 的渲染能力；输出 `{ "output": "渲染结果" }`。

**校验**：模板中的变量必须在 `variables` 中声明；未声明变量运行时为空并给出警告。

### 8.6 通用异常与重试

**文件**：`internal/agent/component/retry.go`

**参数**（所有节点通用）：

```json
{
  "retry": { "enabled": true, "max_attempts": 2, "interval_ms": 1000 },
  "timeout_ms": 30000,
  "on_error": "fail_branch"   // terminate / default_value / fail_branch
}
```

**实现**：

- 在 `buildNodeBody` 外包一层 `retryableBody`，统一处理重试与超时。
- `on_error=default_value` 时读取 `default_output`。
- `on_error=fail_branch` 时输出 `{ "_error": {...} }` 并走 `fail-branch` 边（V1.1）。

**注意**：`llm.go` 已有 `llm_retry.go`，需要把它的重试逻辑抽到通用层，避免两套。

### 8.7 run 级超时与预算

**位置**：`runWithRules`（见 6.3）+ `component/llm.go` 的 token 累计。

**参数**：

```json
{
  "max_duration_ms": 300000,
  "max_tokens": 100000,
  "max_cost": 5.00
}
```

**实现**：

1. `runWithRules` 用 `context.WithTimeout` 挂 run 级超时；到点取消整个图。
2. 每次 LLM 调用后把 `prompt_tokens + completion_tokens` 累加到 `CanvasState`，超过 `max_tokens` 触发取消。
3. 终止后写 `agent_run.status=failed`，`error_code` 为 `RUN_TIMEOUT` / `BUDGET_EXCEEDED`，`error_message` 带具体数值。
4. `max_cost` 按租户配置的单价换算；单价来源为模型配置，不在本设计内硬编码。

**验证**：构造一个 Loop 死循环 + 一个超长 LLM 调用，确认都在上限内被终止，且 `agent_run` 记录了原因。

---

## 九、变量系统详细设计

### 9.1 命名空间

| 前缀 | 来源 | 读写 | 生命周期 |
|---|---|---|---|
| `sys.` | 运行时注入 | 只读 | 单次 run |
| `env.` | DSL globals + 环境变量表 | 只读 | 应用版本 |
| `conversation.` | `conversation_variable` 表 | 可读写 | 单会话 |
| `{node}@` | 节点输出 | 只读 | 单次 run |

### 9.2 `CanvasState` 扩展

```go
type CanvasState struct {
    // ...existing
    Env          map[string]any
    Conversation map[string]any   // 新增
    // ...
}
```

**`GetVar` 解析顺序**：

1. `conversation.` → `Conversation[key]`
2. `env.` → `Env[key]`
3. `sys.` → `Sys[key]`
4. `{node}@param` → `Outputs[node][param]`

**`SetVar` 约束**：

```go
func (s *CanvasState) SetVar(ns, key string, v any) error {
    switch ns {
    case "env":
        return ErrEnvReadOnly
    case "conversation":
        s.Conversation[key] = v
        return nil
    // ...
    }
}
```

### 9.3 加载与写回

- **加载**：`AgentService.RunAgent` 在编译前调用 `convVarService.Load(ctx, sessionID, canvasID)`，把结果注入 `CanvasState.Conversation`。
- **写回**：`RunRecorder` 在 `workflow_finished` 时把 `finalState.Conversation` 通过 `UpsertMany` 写回。
- **并发**：同一 `conversation_id` 的写回用 Redis 锁串行化，避免多轮并发覆盖。

### 9.4 校验

- Workflow 中引用 `conversation.*` → 发布校验失败。
- `env.*` 被 `VariableAssigner` 写入 → 保存时拒绝。
- 变量引用不可达 → 发布校验失败并定位节点。

---

## 十、发布与版本详细设计

### 10.1 发布校验

新增 `internal/service/agent_publish_validate.go`：

```go
func validatePublish(ctx, canvas *entity.UserCanvas, dsl *entity.JSONMap) error {
    mode := canvas.CanvasCategory
    switch mode {
    case "workflow_canvas":
        requireExactlyOneReachableEnd(dsl)
        requireNonEmptyEndOutputs(dsl)
        forbidConversationVars(dsl)
    case "chatflow_canvas":
        requireAtLeastOneReachableAnswer(dsl)
        forbidEnd(dsl)
        requireConversationVarDeclarations(dsl)
    case "agent_canvas":
        // 保持原逻辑
    }
    requireReachableVariables(dsl)
    requireSecretEnvConfigured(dsl)
    return nil
}
```

### 10.2 版本号

- `version_seq` 单调递增；展示为 `v{seq}`。
- 迁移时按 `create_time` 回填存量版本。
- 发布时 `version_seq = latest + 1`，在事务内用 `SELECT ... FOR UPDATE` 防并发。

### 10.3 不可变

`SaveOrReplaceLatestTx` 增加 `AlwaysCreate`：

```go
if !opts.AlwaysCreate && err == nil && opts.sameDSL(latest.DSL) {
    // 更新 latest
} else {
    row := &entity.UserCanvasVersion{ VersionSeq: latest.VersionSeq + 1, ... }
    tx.Create(row)
}
```

**并发保护**：`user_canvas_version` 必须有 `UNIQUE(user_canvas_id, version_seq)`；发布事务内 `SELECT ... FOR UPDATE` 取最新版本，重复键时重试一次。

**快照完整性**：发布事务内同时写 `env_snapshot`（环境变量，`secret` 加密），保证 restore 能一起恢复。

### 10.4 回滚

- `RestoreVersion(ctx, userID, canvasID, versionID)`：
  1. 校验权限与归属。
  2. 读取版本 `dsl` 与 `env_snapshot`。
  3. 写 `user_canvas.dsl` 与草稿环境变量（`version_seq=0`），**不改 `release`**。
  4. 返回草稿。
- 前端提示「已恢复到草稿，需重新发布；线上仍是当前版本」。
- **restore 必须恢复环境变量**，否则会出现「图回滚了、密钥还是新的」的配置漂移。

### 10.5 冲突检测

- 发布请求带 `base_version_id`。
- 服务端比较 `user_canvas` 当前最新版本；不一致则返回 `409 VERSION_CONFLICT`，并返回差异摘要。

---

## 十一、API 设计

### 11.1 应用 CRUD（复用）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/agents?category=workflow_canvas` | 列表，按形态过滤 |
| POST | `/api/v1/agents` | 创建，body 含 `canvas_category` |
| GET | `/api/v1/agents/:canvas_id` | 详情 |
| PUT | `/api/v1/agents/:canvas_id` | 保存 DSL |
| DELETE | `/api/v1/agents/:canvas_id` | 删除 |
| POST | `/api/v1/agents/:canvas_id/archive` | 归档（新增） |
| POST | `/api/v1/agents/:canvas_id/run` | 编辑态试运行 |
| POST | `/api/v1/agents/:canvas_id/publish` | 发布 |
| GET | `/api/v1/agents/:canvas_id/versions` | 版本列表 |
| POST | `/api/v1/agents/:canvas_id/versions/:vid/restore` | 恢复（新增） |

### 11.2 Workflow 运行 API（新增）

`POST /api/v1/workflows/:canvas_id/run`

**请求头**：

| Header | 必填 | 说明 |
|---|---|---|
| `Authorization` | 是 | `Bearer <app_api_key>` |
| `Idempotency-Key` | 否 | 幂等键；同一 Key + 同一 canvas 重复调用只产生一个 run |

**请求**：

```json
{
  "inputs": { "date": "2026-10-19", "channel": "APP" },
  "response_mode": "blocking",   // V1.0: blocking / streaming；async 返回 400
  "max_duration_ms": 300000
}
```

**响应（blocking）**：

```json
{
  "code": 0,
  "data": {
    "run_id": "7f3c...",
    "status": "succeeded",
    "outputs": { "broadcast_text": "今日华夏成长混合净值..." },
    "elapsed_ms": 2412,
    "usage": { "prompt_tokens": 812, "completion_tokens": 246 }
  }
}
```

**响应（streaming）**：SSE，事件同 Agent：
`workflow_started` / `node_started` / `node_finished` / `workflow_finished` / `error`。

**async**：V1.0 返回 `400 RESPONSE_MODE_NOT_SUPPORTED`，提示「异步模式计划 V1.1 提供」。不做假接口。

**HITL**：含 `UserFillUp` 的 Workflow 在 V1.0 发布时被 `validatePublish` 拦截，不允许发布为公开 API。

### 11.3 Chatflow API（新增）

`POST /api/v1/chatflows/:canvas_id/chat`

**请求**：

```json
{
  "query": "华夏成长混合今天净值多少？",
  "conversation_id": "conv_9f2a...",
  "inputs": {},
  "stream": true,
  "max_duration_ms": 120000
}
```

**conversation_id 映射**：`conversation_id` 就是 `api4_conversation.id`，同时也是 `RunAgent` 的 `sessionID`。首次调用不传时创建会话并在响应中返回；后续按该 ID 加载历史与会话变量。

**响应**：SSE，事件：
`conversation_id`（首帧返回）/ `message`（增量文本）/ `message_end`（含 citations、usage）/ `error`。

### 11.4 运行查询（新增）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/runs?canvas_id=&status=&from=&to=` | Run 列表 |
| GET | `/api/v1/runs/:run_id` | Run 详情 |
| GET | `/api/v1/runs/:run_id/nodes` | 节点执行记录 |

### 11.5 API Key（新增）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/apps/:canvas_id/api-keys` | 列表（只返回前缀） |
| POST | `/api/v1/apps/:canvas_id/api-keys` | 创建，返回明文一次 |
| POST | `/api/v1/apps/:canvas_id/api-keys/:id/rotate` | 轮换（旧 Key 保留 24h 宽限） |
| POST | `/api/v1/apps/:canvas_id/api-keys/:id/disable` | 禁用 |

### 11.6 WebApp / 分享 / 嵌入 / DSL（新增）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/apps/:canvas_id/share` | 获取分享配置（链接、密码、开关） |
| PUT | `/api/v1/apps/:canvas_id/share` | 更新分享配置 |
| GET | `/api/v1/apps/:canvas_id/dsl/export` | 导出 DSL（剔除密钥） |
| POST | `/api/v1/apps/:canvas_id/dsl/import` | 导入 DSL，未知节点明确报错 |

> 复用现有 Agent 分享页与 embed 能力；Workflow 的 WebApp 是「表单 + 结果页」，Chatflow 是对话页。

### 11.7 审计（新增）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/audits?canvas_id=&action=&from=&to=` | 审计查询 |
| GET | `/api/v1/audits/export` | 导出 CSV |

### 11.8 错误码

| 错误码 | HTTP | 场景 |
|---|---|---|
| `APP_MODE_MISMATCH` | 400 | 用 Workflow API 调 Chatflow |
| `PUBLISH_VALIDATION_FAILED` | 400 | 发布校验失败，返回逐条原因 |
| `RESPONSE_MODE_NOT_SUPPORTED` | 400 | V1.0 请求 async |
| `HITL_PUBLIC_API_UNSUPPORTED` | 400 | 含 UserFillUp 的 Workflow 发布为公开 API |
| `VERSION_CONFLICT` | 409 | 基线版本不一致 |
| `APP_ARCHIVED` | 410 | 应用已归档 |
| `APP_KEY_INVALID` | 401 | Key 无效/禁用 |
| `APP_KEY_FORBIDDEN` | 403 | Key 与 canvas 不匹配 |
| `RATE_LIMITED` | 429 | 超过 RPM/并发；带 `Retry-After` |
| `RUN_NOT_FOUND` | 404 | run_id 不存在 |
| `IDEMPOTENCY_CONFLICT` | 409 | 同一幂等键但请求体不同 |

---

## 十二、前端改造

### 12.1 路由

| 路由 | 页面 | 说明 |
|---|---|---|
| `/agent/:id` | 现有编辑器 | `agent_canvas` |
| `/workflow/:id` | 复用编辑器 | `workflow_canvas`，隐藏 Answer |
| `/chatflow/:id` | 复用编辑器 | `chatflow_canvas`，隐藏 End，显示调试预览 |
| `/workflow/:id/runs` | 运行日志 | Workflow 运行记录 |
| `/chatflow/:id/logs` | 会话日志 | Chatflow 会话记录 |

### 12.2 节点目录

`web/src/constants/agent.tsx`：

```ts
export enum Operator {
  // ...existing
  End = 'End',
  Answer = 'Answer',
  LLM = 'LLM',
  ParameterExtractor = 'ParameterExtractor',
  TemplateTransform = 'TemplateTransform',
}

export const WorkflowOperatorList = [
  Operator.Begin, Operator.End, Operator.LLM, Operator.Agent,
  Operator.Retrieval, Operator.Categorize, Operator.Switch,
  Operator.Iteration, Operator.Loop, Operator.Code, Operator.Invoke,
  Operator.VariableAggregator, Operator.VariableAssigner, Operator.Note,
];

export const ChatflowOperatorList = [
  Operator.Begin, Operator.Answer, Operator.LLM, Operator.Agent,
  Operator.Retrieval, Operator.Categorize, Operator.Switch,
  Operator.Iteration, Operator.Loop, Operator.Code, Operator.Invoke,
  Operator.VariableAggregator, Operator.VariableAssigner, Operator.Note,
];
```

### 12.3 新增表单

| 表单 | 路径 | 字段 |
|---|---|---|
| `end-form` | `web/src/pages/agent/form/end-form/` | outputs（name/type/value） |
| `answer-form` | `.../answer-form/` | content、stream、with_citation、markdown |
| `llm-form` | `.../llm-form/` | model、temperature、top_p、system_prompt、user_prompt、output_var、json_output、schema |
| `parameter-extractor-form` | `.../parameter-extractor-form/` | input、fields、instruction、model |
| `template-transform-form` | `.../template-transform-form/` | template、variables |

### 12.4 变量面板

- 在现有 `gobal-variable-sheet` 基础上拆两个 Tab：`环境变量`（只读 + secret）与 `会话变量`（仅 Chatflow）。
- 节点变量选择器复用 `use-get-begin-query.tsx` 的可达性逻辑，增加 `conversation.` 命名空间。

### 12.5 运行面板

- 复用现有 `run-sheet` / `debug-content`，增加「变量」Tab 与「Tracing」Tab。
- `Tracing` 数据来自 `GET /runs/:run_id/nodes`。
- 增加「停止」按钮，调用现有取消接口。
- 增加运行历史入口，跳 `/workflow/:id/runs`。

### 12.6 节点面板与右键菜单（补工作包）

- 左侧节点面板：按 `WorkflowOperatorList` / `ChatflowOperatorList` 过滤，分组展示，支持搜索。
- 右键菜单：添加、删除、复制、查看日志；复用现有 `canvas/context-menu` 组件并接线。
- 这两项是 PRD V1.0 的 CV-02/03，必须有对应工作包，不能只写在 PRD 里。

### 12.7 失败态与冲突态（补原型/实现）

| 场景 | 交互 |
|---|---|
| 发布校验失败 | 弹出校验面板，逐条列出原因，点击定位节点 |
| 并发编辑冲突 | 弹窗提示「已被他人修改」，提供「基于最新版本重新编辑」 |
| 运行失败 | 运行面板高亮失败节点，展示错误码与节点输入 |
| 空画布 | 展示起步模板与「从节点面板拖入」引导 |
| 加载中 | 画布骨架屏 + 节点禁用 |
| 画布加载失败 | 展示重试按钮与错误详情 |

---

## 十三、兼容与迁移

### 13.1 存量应用

- 存量 `user_canvas` 行 `canvas_category=agent_canvas`，无需迁移。
- `release` 语义不变；`archived_at` 默认 NULL。
- 存量 `user_canvas_version` 回填 `version_seq`：按 `create_time` 升序编号。

**ALTER 与回填 SQL**

```sql
ALTER TABLE user_canvas
  ADD COLUMN archived_at DATETIME(3) NULL,
  ADD COLUMN dsl_schema_version INT NOT NULL DEFAULT 1;

ALTER TABLE user_canvas_version
  ADD COLUMN version_seq INT NOT NULL DEFAULT 0,
  ADD COLUMN remark VARCHAR(255) NULL,
  ADD COLUMN base_version_id VARCHAR(32) NULL,
  ADD COLUMN env_snapshot LONGTEXT NULL;

-- 回填 version_seq（MySQL 8 窗口函数）
UPDATE user_canvas_version v
JOIN (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY user_canvas_id ORDER BY create_time, id) AS seq
  FROM user_canvas_version
) t ON t.id = v.id
SET v.version_seq = t.seq;

ALTER TABLE user_canvas_version
  ADD UNIQUE KEY uk_canvas_version_seq (user_canvas_id, version_seq);
```

> 回填后先校验无重复（`GROUP BY user_canvas_id, version_seq HAVING COUNT(*) > 1`），再加唯一索引。

### 13.2 DSL

- 旧 DSL 不含 `End` / `Answer`，继续按「无下游节点即终止」运行，不受影响。
- 新 DSL 增加 `component_name: "End"` / `"Answer"`，`NormalizeForCanvas` 无需特殊处理。
- 新 DSL 必须带 `schema_version`；`NormalizeForCanvas` 按版本迁移，未知高版本拒绝加载并提示升级。
- 旧 DSL 导入时 `schema_version` 缺省为 1，按 v1 规则处理。

### 13.3 路由

- `/agents/*` 保持；新增 `/workflows/*`、`/chatflows/*` 不冲突。
- 前端旧路由 `/agent/:id` 保持；新增 `/workflow/:id`、`/chatflow/:id`。

### 13.4 回滚预案

- 发布前备份 `user_canvas.dsl` 与 `user_canvas_version`。
- 新表只增不改，回滚时保留（无副作用）。
- 若形态校验导致存量应用无法发布，提供 `legacy_bypass` 开关（仅管理员），限期移除。

---

## 十四、性能与容量

| 项 | 设计 | 目标 |
|---|---|---|
| 画布加载 | DSL 单行读取，前端解析 | 200 节点 ≤300ms |
| 编译 | `canvas.Compile` 每次 run 一次 | ≤50ms |
| SSE 首包 | run 记录异步写，不阻塞 | ≤200ms |
| 节点记录写入 | 批量 insert，每 20 条或 500ms 刷一次 | 对 run 耗时影响 ≤50ms |
| 运行记录保留 | 默认 90 天，可配 | 单应用 10 万 run 内查询 ≤500ms |
| 版本快照 | DSL 压缩存储（gzip） | 单版本 ≤2MB |
| 并发 | 单应用并发上限可配；Iteration 并发上限可配 | 默认 5 / 10 |

**索引**：

- `agent_run(canvas_id, create_time)`：列表查询。
- `agent_node_execution(run_id)`：详情查询。
- `conversation_variable(conversation_id, name)`：会话变量读写。
- `app_api_key(key_hash)`：鉴权查询。

---

## 十五、安全设计

| 项 | 设计 |
|---|---|
| 租户隔离 | 所有查询带 `tenant_id` / `user_id`；越权与不存在统一 404 |
| API Key | 只存 SHA-256 哈希；明文仅创建时返回；支持禁用与轮换 |
| 环境变量 | `secret` 类型 AES-GCM 加密；导出 DSL 剔除；日志掩码 |
| 代码沙箱 | 复用现有 `internal/agent/sandbox`；限制网络与文件系统 |
| HTTP SSRF | 禁止内网/元数据地址；DNS 解析后二次校验 |
| 审计 | 创建/编辑/发布/回滚/删除/Key 轮换全部落 `audit_log`；保留 ≥180 天 |
| 二次确认 | 发布、回滚、删除、Key 重置 |
| 限流 | Redis token bucket，按 Key 维度；key=`rl:{key_id}:{window}`；支持 RPM/并发/burst；超限返回 429 + `Retry-After` |
| PII 脱敏 | 运行记录、节点 IO、日志统一脱敏手机号/身份证/银行卡；提示词全文不落日志 |
| 提示词注入 | Chatflow 系统提示词加「忽略用户指令中的角色切换」约束；工具调用做参数白名单；输出前敏感词过滤 |
| 生成内容合规 | 基金场景输出带风险提示与免责声明；禁止承诺收益；人工抽检 + 举报下架 |

---

## 十六、可观测

### 16.1 运行事件

沿用现有 `canvas.RunEvent`，新增字段：

| 字段 | 说明 |
|---|---|
| `run_id` | 运行 ID |
| `node_id` / `node_type` | 节点 |
| `status` | 节点状态 |
| `inputs` / `outputs` | 节点 IO |
| `duration_ms` | 耗时 |
| `retry_count` | 重试次数 |
| `error_code` / `error_message` | 错误 |

### 16.2 指标

| 指标 | 口径 |
|---|---|
| 运行成功率 | succeeded / (succeeded+failed+partial)，排除 stopped |
| P95 非 LLM 开销 | 总耗时 − LLM 节点耗时 |
| 节点记录完整率 | 有节点记录的 run / 成功或失败 run |
| 发布失败率 | 发布失败 / 发布总数 |
| API 错误率 | 4xx+5xx / 总调用，按 Key 维度 |
| 结构化输出合规率 | Schema 通过 / 结构化输出总数 |

### 16.3 日志

- 每次 run 一条结构化日志：`run_id, canvas_id, mode, status, duration_ms, tokens`。
- 错误日志带 `node_id` 与 `error_code`，不打印提示词全文（防泄露）。

---

## 十七、测试策略

| 层级 | 范围 | 重点 |
|---|---|---|
| 单元测试 | `component/end_test.go`、`answer_test.go`、`parameter_extractor_test.go`、`template_transform_test.go` | 输出契约、类型转换、空值 |
| 单元测试 | `canvas/state_test.go` | `conversation.` 读写、`env.` 只读 |
| 单元测试 | `dao/user_canvas_version_test.go` | `AlwaysCreate` 追加、version_seq |
| 集成测试 | `service/agent_run_e2e_test.go` | 编译→运行→事件→落库 |
| 集成测试 | `service/agent_app_run_test.go` | **API Key 调用绕过用户权限链、以 owner 身份运行** |
| 集成测试 | `service/agent_publish_test.go` | 形态校验、原子发布、冲突、环境变量快照与 restore |
| 集成测试 | `handler/workflow_test.go` | blocking/streaming；async 返回 400；Idempotency-Key |
| 集成测试 | `handler/chatflow_test.go` | conversation_id 续聊、会话变量、停止生成 |
| 集成测试 | `service/audit_test.go` | 审计写入、查询、保留期清理 |
| 集成测试 | `service/agent_run_limit_test.go` | run 超时、token 预算、死循环终止 |
| 安全测试 | 跨租户 | **API Key / run / 会话变量 / 版本全部返回 404** |
| 安全测试 | PII | 运行记录与日志中手机号/身份证/银行卡已脱敏 |
| 回归测试 | 存量 `agent_canvas` | 创建/运行/日志/分享/Webhook 不变 |
| 压测 | 100 并发 run | P95 非 LLM 开销 ≤500ms |
| 压测 | 限流 | RPM/并发/burst 生效，429 带 Retry-After |

---

## 十八、风险与待确认

### 18.1 技术风险

| 编号 | 风险 | 概率 | 影响 | 应对 |
|---|---|---|---|---|
| TR-01 | `SaveOrReplaceLatest` 改造影响自动保存 | 中 | 中 | `AlwaysCreate` 仅发布使用；自动保存走原路径；补单测 |
| TR-02 | `CanvasState` 增加 Conversation 影响状态序列化 | 中 | 高 | 扩展 `state_serializer.go`；补序列化/恢复测试 |
| TR-03 | 多个 End 被 gather 合并 | 中 | 中 | 编译期校验唯一性 |
| TR-04 | 运行记录异步写丢数据 | 低 | 中 | 缓冲 + 重试 + 落盘 fallback |
| TR-05 | SSE 与落库竞争导致顺序错乱 | 低 | 中 | 事件带序号；落库按序号排序 |
| TR-06 | 存量 DSL 无 `End` 导致 Workflow 校验失败 | 高 | 中 | 仅新形态校验；存量 agent 不受影响 |
| TR-07 | 前端节点表单与后端参数字段漂移 | 中 | 中 | 以 `Inputs()/Outputs()` 元数据生成表单校验 |
| TR-08 | API Key 中间件与现有鉴权冲突 | 中 | 高 | 独立路由组 + 独立中间件，不混用 |

### 18.2 待确认

1. **`canvas_category` 是否作为唯一形态事实源？** 本设计采用是；若后续需要独立 `app_mode`，需重新评估。
2. **`version_seq` 是否需要暴露给用户？** 本设计展示为 `v{seq}`。
3. **运行记录保留期？** 本设计默认 90 天。
4. **会话变量并发写策略？** 本设计用 Redis 锁串行化；若性能不足，改为版本号乐观锁。
5. **公开 API 是否需要 IP 白名单？** 本设计未包含，建议 V1.1 补。
6. **代码节点是否允许访问外网？** 本设计默认禁止，白名单可配。

---

## 十九、附录

### 19.1 代码索引

| 能力 | 文件 | 关键位置 |
|---|---|---|
| 应用实体 | `internal/entity/canvas.go` | `UserCanvas`、`UserCanvasVersion` |
| 画布 DSL | `internal/agent/canvas/canvas.go` | `Canvas`、`CanvasComponent` |
| 编译 | `internal/agent/canvas/compile.go` | `Compile`、`CompileOptions` |
| 图构建 | `internal/agent/canvas/scheduler.go` | `BuildWorkflow`、Pass 3 终止节点 |
| 变量 | `internal/agent/runtime/state.go` | `CanvasState` |
| 模板 | `internal/agent/runtime/template_jinja.go` | Jinja 渲染 |
| 组件契约 | `internal/agent/component/base.go` | `Component` |
| LLM | `internal/agent/component/llm.go` | `LLMParam`、`Register("LLM")` |
| Message | `internal/agent/component/message.go` | `Invoke`、`Stream` |
| 运行入口 | `internal/service/agent.go` | `RunAgent`（1442） |
| 发布 | `internal/service/agent.go` | `PublishAgent`（1281） |
| 版本 DAO | `internal/dao/user_canvas_version.go` | `SaveOrReplaceLatestTx`（162） |
| 路由 | `internal/router/agent_routes.go` | `RegisterAgentRoutes` |
| 前端节点 | `web/src/pages/agent/canvas/node/` | 27 种节点渲染 |
| 前端表单 | `web/src/pages/agent/form/` | 节点表单 |
| 前端枚举 | `web/src/constants/agent.tsx` | `Operator` |

### 19.2 工作包拆分

| 包 | 内容 | 依赖 | 预估 |
|---|---|---|---|
| WP1 | `canvas_category` 形态 + 路由 + 列表 + 归档 | 无 | 4 天 |
| WP2 | `CanvasState.Conversation` + env 只读 + 序列化 | WP1 | 5 天 |
| WP3 | End 组件 + 校验 + 表单 | WP1 | 4 天 |
| WP4 | Answer 组件 + Chatflow 校验 + 表单 | WP1 | 4 天 |
| WP5 | LLM 前端表单 + 节点目录 | WP1 | 3 天 |
| WP6 | ParameterExtractor 组件 + 表单 | WP5 | 5 天 |
| WP7 | TemplateTransform 组件 + 表单 | WP5 | 3 天 |
| WP8 | 通用重试/超时/异常策略 + **run 级超时/预算** | WP3~7 | 5 天 |
| WP9 | `agent_run` / `agent_node_execution` + RunRecorder + **幂等** | WP2 | 7 天 |
| WP10 | 版本不可变 + restore（含 env）+ 冲突检测 + `version_seq` 唯一索引 | WP1 | 6 天 |
| WP11 | Workflow API + Chatflow API（blocking/streaming，async 返回 400） | WP9 | 5 天 |
| WP12 | `RunAgentAsApp` + API Key + 限流 | WP11 | 6 天 |
| WP13 | 审计表 + 写入点 + 查询 API | WP10 | 3 天 |
| WP14 | 前端节点面板 + 右键菜单 + 失败态/冲突态 | WP1 | 5 天 |
| WP15 | 运行日志页 + 变量检查器 + 调试预览 + 停止 | WP9 | 7 天 |
| WP16 | WebApp/分享/嵌入 + DSL 导入导出 | WP11 | 4 天 |
| WP17 | PII 脱敏 + 注入防护 + 合规话术 | WP9 | 3 天 |
| WP18 | 回归 + 压测 + 迁移 + 多租户安全测试 | 全部 | 6 天 |

**V1.1 追加**：NATS async worker + 孤儿恢复 + HITL resume（约 8 天）。

**总预估**：V1.0 约 10~12 周（原 8~10 周，增加 P0/P1 修复与前端补齐）。

### 19.3 交付前自查

- [x] 关键决策均给出「选择 X 而非 Y，因为 Z」
- [x] 数据模型含 DDL 与索引
- [x] 节点设计含参数、Invoke 逻辑、校验规则
- [x] 变量系统含命名空间、读写约束、加载写回
- [x] 发布含校验、原子性、版本、冲突、回滚
- [x] API 含请求/响应/错误码
- [x] 前端改造落到具体目录与文件
- [x] 兼容与迁移含回滚预案
- [x] 性能、安全、可观测、测试均有量化目标
- [x] 工作包可排期、依赖清晰

---

> 说明：本文为技术详细设计，代码位置以 `ac2044bb` 基线为准；实施时若行号漂移，以符号名为准。
