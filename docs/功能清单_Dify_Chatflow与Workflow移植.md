# Dify Chatflow / Workflow 能力移植 —— 功能清单

| 项 | 内容 |
|---|---|
| 版本 | v1.1（按四件套评审修订） |
| 日期 | 2026-10-19 |
| 状态 | 待评审 |
| 调研基线 | Dify `17cff2d80a4b31870c3c4af6375cc3ed44144a7a`；RAGFlow `ac2044bb` |
| 用途 | 功能盘点与优先级排序，不作为最终 PRD |

**v1.1 修订记录**

| 变更 | 说明 |
|---|---|
| 修正 LLM 节点口径 | 后端 `component/llm.go` 已注册 `"LLM"`，缺口是前端表单与面板，不是后端新增 |
| 修正「形态」表述 | agent 侧只有一种形态；`canvas_category` 另有 `dataflow_canvas`（数据管道），不要混为一谈 |
| 新增 P0 项 | API 幂等、run 级超时/预算、审计表、DSL schema 版本 |
| 新增 P1 项 | 版本快照含环境变量、多租户隔离测试、PII 与提示词注入防护 |
| 调整分期 | 异步 API 降到 V1.1（V1.0 只做 blocking/streaming）；公开 API 的 HITL 在 V1.0 用发布校验阻止 |

---

## 0. 一句话结论

Dify 的 Chatflow 与 Workflow **不是两套引擎**，而是「同一张图 + 两种应用外层」：Workflow 用 `Start → End` 输出 JSON，Chatflow 用 `Start → Answer` 输出流式消息并绑定会话。RAGFlow 在 **agent 侧只有一种 `agent_canvas` 形态**（`canvas_category` 另有 `dataflow_canvas` 供数据管道使用，不在本清单范围），靠 Begin 节点的 `mode`（conversational / task / Webhook）在**前端**区分，后端执行完全一致。

因此移植的主线不是照搬 Dify，而是：

> **把「应用形态」从 Begin 节点的一个字段，提升为真正的应用类型，并补齐两种形态各自的输入/输出/会话/发布契约；节点能力优先复用 RAGFlow 已有引擎，只补硬缺口。**

---

## 1. 目标与设计原则

### 1.1 目标

| 目标 | 说明 |
|---|---|
| 两种应用形态 | Workflow（无对话、结构化输出）与 Chatflow（对话式、流式回答）成为独立应用类型 |
| 复用现有引擎 | 复用 RAGFlow 的 React Flow 画布、Go `internal/agent/canvas` + `component`，不引入 Dify 的 graphon |
| 保留 RAGFlow 强项 | 知识库检索、引用溯源、文档解析、知识编译、Memory |
| 接口契约清晰 | 两种形态各有独立的运行 API、输入输出契约、日志与版本语义 |

### 1.2 设计原则

- **不重写引擎**：RAGFlow 的节点执行、变量池、循环/并行、中断恢复已可用，优先扩展而非替换。
- **形态即契约**：应用类型决定「能不能有 Answer / End / 会话变量 / 触发器」，不能只靠前端隐藏。
- **先补硬缺口**：没有 End、参数提取、模板转换、版本回滚、run 级 trace，Workflow 就不可用。
- **不追求功能对齐数量**：Dify 有但 RAGFlow 场景不需要的（如 CRDT 实时协作、插件市场）后置。

### 1.3 本期不做

- 不引入 Dify 的 `graphon` 包或 Python 运行时。
- 不做跨租户应用市场。
- 不做 CRDT 多人实时协作（P2 可选）。
- 不做插件市场与自定义节点 SDK（节点仍为编译期注册）。

---

## 2. 应用形态（核心改造）

> 这是整份清单的地基。形态不独立，后面的节点限制、变量、发布 API 都无从谈起。

| 编号 | 功能项 | 说明 | RAGFlow 现状 | 优先级 |
|---|---|---|---|---|
| APP-01 | 应用类型：Workflow | 无对话；`Start → ... → End`；同步/异步 API；输出 JSON | **缺失**：只有 `agent_canvas`，`mode=task` 只是前端隐藏输入框 | P0 |
| APP-02 | 应用类型：Chatflow | 对话式；`Start → ... → Answer`；Chat API；会话变量 + 记忆 | **半成品**：`mode=conversational` 可用，但后端不区分形态，无 Answer 节点、无会话变量双轨 | P0 |
| APP-03 | 应用类型：Agent（保留） | 现有智能体形态，可含工具/子智能体/反思 | 已有 | 保持 |
| APP-04 | 类型与节点限制 | Chatflow 禁止 End / 触发器；Workflow 禁止 Answer；Start 与 Trigger 二选一 | **缺失**：无形态级校验 | P0 |
| APP-05 | 创建入口与起步模板 | 创建时选类型；Chatflow 默认 `Start → LLM → Answer`；Workflow 默认 `Start → End` | 已有创建弹窗，但只有「智能体/数据管道/编译算子」 | P0 |
| APP-06 | 应用列表与筛选 | 按类型筛选、搜索、复制、删除 | 已有列表，缺类型字段与筛选 | P1 |
| APP-07 | 应用设置 | 名称、图标、描述、权限、开场白、建议问题 | 已有 `setting-dialog`，需补 Chatflow 专属项 | P1 |
| APP-08 | 草稿 / 发布态 | 草稿可编辑，发布生成不可变快照 | 已有 `release` + 版本表，但语义不完整 | P1 |

**改造要点**

- 新增 `app_mode` 字段（`agent` / `chatflow` / `workflow`），替代「靠 Begin.mode 推断」。
- 后端编译/运行入口按 `app_mode` 选择 Runner：Workflow Runner / Chatflow Runner。
- 前端按 `app_mode` 切换节点目录、变量面板、发布 API 说明、调试预览形态。

---

## 3. 画布与编排

| 编号 | 功能项 | 说明 | RAGFlow 现状 | 优先级 |
|---|---|---|---|---|
| CV-01 | 可视化画布 | 拖拽、连线、缩放、框选、撤销重做 | 已有（React Flow） | 保持 |
| CV-02 | 左侧节点面板 | 按分类展示可添加节点，支持搜索 | **缺失**：只能从节点 Handle 拖出下拉 | P1 |
| CV-03 | 右键菜单 | 在画布/节点上右键添加、删除、复制 | **缺失**：`canvas/context-menu` 已写好但未接线 | P1 |
| CV-04 | 节点搜索 / 全局跳转 | 快速定位节点 | 缺失 | P2 |
| CV-05 | 小地图 | 大图导航 | 缺失（只有 Controls） | P2 |
| CV-06 | 连线约束 | 禁止非法上下游、单实例节点、容器边界 | 已有 `RestrictedUpstreamMap` | 保持 |
| CV-07 | 容器节点 | Iteration / Loop 子图、进出点 | 已有 | 保持 |
| CV-08 | 画布注释 | 便签/说明，不参与执行 | 已有 `Note` | 保持 |
| CV-09 | 多选与批量操作 | 批量删除/复制/移动 | 部分支持 | P2 |
| CV-10 | 多人协作 / 评论 | 评论、@、在线用户、CRDT | 缺失 | P3 |

---

## 4. 节点能力（现状对照）

> 判定口径：**已有** = 面板可用且后端完整；**半成品** = 有代码但不可用/不完整；**缺失** = 没有。
> 优先级只针对「Workflow / Chatflow 可用性」，不代表 RAGFlow 现有场景的价值。

### 4.1 入口 / 出口

| Dify 节点 | RAGFlow 对应 | 状态 | 缺口 | 优先级 |
|---|---|---|---|---|
| `start` | `Begin` | 已有 | 需支持 Workflow/Chatflow 两套输入契约 | 保持 + 扩展 |
| `end` | 无 | **缺失** | 无输出契约节点；末端隐式取第一个非空 | **P0** |
| `answer` | `Message` | 半成品 | 无 Chatflow 流式 Answer 语义；无「回答节点」概念 | **P0** |
| `start-placeholder` | 无 | 缺失 | 画布占位提示 | P2 |

### 4.2 模型 / 知识

| Dify 节点 | RAGFlow 对应 | 状态 | 缺口 | 优先级 |
|---|---|---|---|---|
| `llm` | `Agent`（LLM 内嵌） | 半成品 | 无独立 LLM 节点（后端 `component/llm.go` 有，前端无表单） | **P0** |
| `knowledge-retrieval` | `Retrieval` | 已有 | 需对齐输出契约（`result[]` + citation metadata） | 保持 |
| `question-classifier` | `Categorize` | 已有 | 鲁棒性：依赖 LLM 返回类别名 | 保持 |
| `parameter-extractor` | 无（仅 Agent 结构化输出） | **缺失** | 无独立节点；Agent 不强制 JSON | **P0** |
| `agent` | `Agent` | 已有 | 工具/MCP/子智能体/反思已较完整 | 保持 |
| `agent-v2` | 无 | 缺失 | Dify 自研 Agent Runtime | P2 |
| `knowledge-index` | `Tokenizer` / `Compiler`（数据管道） | 半成品 | 不在 Agent 画布，RAG Pipeline 专用 | P2 |
| `datasource` | `File`（数据管道） | 半成品 | 数据源类型少 | P2 |

### 4.3 逻辑 / 容器

| Dify 节点 | RAGFlow 对应 | 状态 | 缺口 | 优先级 |
|---|---|---|---|---|
| `if-else` | `Switch` | 已有 | 多条件组 + Else，已完整 | 保持 |
| `iteration` | `Iteration` | 已有 | 并发上限、结果有序 | 保持 |
| `loop` | `Loop` | 已有 | while + 终止条件 + 最大次数 | 保持 |
| `iteration-start` / `loop-start` / `loop-end` | 自动生成 | 已有 | — | 保持 |
| `variable-aggregator` | `VariableAggregator` | 已有 | 多分组取首个非空 | 保持 |
| `assigner` | `VariableAssigner` | 已有 | 数值/数组运算符齐全 | 保持 |
| `list-operator` | `ListOperations` | 已有 | 比 Dify 更丰富 | 保持 |

### 4.4 数据 / 集成

| Dify 节点 | RAGFlow 对应 | 状态 | 缺口 | 优先级 |
|---|---|---|---|---|
| `code` | `Code` | 已有 | 多沙箱后端；无依赖安装 | 保持 |
| `template-transform` | 无（内部 Jinja） | **缺失** | 无独立模板节点；`initialTemplateValues` 是死代码 | **P0** |
| `http-request` | `Invoke` | 半成品 | UI 仅 GET/POST/PUT；无鉴权/重试/证书/PATCH/DELETE | **P1** |
| `document-extractor` | `Parser`（数据管道） | 半成品 | Agent 画布无独立文档解析节点 | P1 |
| `tool` | `Tool` | 半成品 | 只在子智能体内，不在面板 | P1 |
| MCP | 已有 | 已有 | — | 保持 |
| Workflow-as-Tool（子工作流） | 无 | **缺失** | 不能引用另一个已发布工作流 | **P1** |
| `human-input` | `UserFillUp` | 已有 | 表单/文件/选项 + 中断恢复 | 保持 |
| `trigger-webhook` | `Begin.mode=Webhook` | 半成品 | 不是独立根节点；不支持 multipart | P1 |
| `trigger-schedule` | 无 | **缺失** | 无 Cron/定时 | P2 |
| `trigger-plugin` | 无 | 缺失 | 无插件事件订阅 | P3 |
| `note` | `Note` | 已有 | — | 保持 |

### 4.5 节点通用能力（跨节点）

| 编号 | 功能项 | 说明 | RAGFlow 现状 | 优先级 |
|---|---|---|---|---|
| ND-01 | 节点重试 | 最大次数、间隔、是否启用 | **仅 Agent 有**；其它节点无 | **P0** |
| ND-02 | 节点超时 | 连接/读/写超时 | **仅 Agent 有** | P1 |
| ND-03 | 异常策略 | 无 / 失败分支 / 默认值 | **仅 Agent 有** | P1 |
| ND-04 | 失败分支边 | `fail-branch` 句柄 | 缺失 | P1 |
| ND-05 | 节点版本 | `type + version → 实现`，老图兼容 | 缺失 | P2 |
| ND-06 | 节点级 token/耗时 | 写入执行记录 | 部分（仅 SSE 实时） | P1 |
| ND-07 | run 级超时 / token / 成本上限 | 整次运行的最大时长、token、费用；超限终止并标记原因 | 缺失 | **P0** |

---

## 5. 变量系统

| 编号 | 功能项 | 说明 | RAGFlow 现状 | 优先级 |
|---|---|---|---|---|
| VAR-01 | 系统变量 | `sys.query` / `sys.user_id` / `sys.files` 等 | 已有 6 个（query/user_id/conversation_turns/files/history/date） | 保持 + 扩展 |
| VAR-02 | 环境变量 | 只读、可含 secret、按应用版本持久化 | **缺失**：`env.*` 同时承担环境变量与会话变量 | **P1** |
| VAR-03 | 会话变量 | Chatflow 专属，按 Conversation 持久化 | **半成品**：会话级 DSL 副本，非独立变量表 | **P0** |
| VAR-04 | 节点输出变量 | 节点输出按 `cpnID@param.path` 引用 | 已有 | 保持 |
| VAR-05 | 变量池 / 选择器 | 按图拓扑过滤上游可达变量 | 已有 | 保持 |
| VAR-06 | 变量引用语法 | `{{#node.var#}}` 或等价 | 已有 `{cpnID@param}` | 保持 + 兼容 |
| VAR-07 | 变量类型与校验 | 编译期强类型、必填校验 | **缺失**：仅 UI 校验 + 失效引用检测 | P1 |
| VAR-08 | 变量检查器 | 底部面板查看/编辑运行变量 | **缺失**（只有节点时间线） | P1 |
| VAR-09 | 密钥变量 | 加密存储、掩码回显、DSL 不导出 | 缺失 | P1 |
| VAR-10 | 变量更新事件 | 会话变量写回持久化 | 已有（运行结束写回会话 DSL） | 保持 |

**关键语义差异（必须在设计里定清）**

| 维度 | Dify | RAGFlow 现状 | 建议 |
|---|---|---|---|
| 环境变量 | 只读，按版本快照 | `env.*` 可被 VariableAssigner 写 | 拆成 `env.`（只读）+ `conversation.`（可变） |
| 会话变量 | 独立表，按 Conversation | 会话 DSL 副本 | 新增 `conversation_variables` 表 |
| 作用域 | sys / env / conversation / node | sys / env / node | 补 conversation |

---

## 6. 调试与运行

| 编号 | 功能项 | 说明 | RAGFlow 现状 | 优先级 |
|---|---|---|---|---|
| DBG-01 | 整图试运行 | 从 Start 跑到结束 | 已有 | 保持 |
| DBG-02 | 单节点试运行 | 只跑一个节点，自定义输入 | 已有（`single-debug-sheet`） | 保持 |
| DBG-03 | 运行面板 | 结果 / 详情 / Tracing 三视图 | 部分（时间线） | P1 |
| DBG-04 | 变量检查器 | 查看/编辑每个节点输出 | 缺失 | P1 |
| DBG-05 | 单步 / 断点 | 执行到某节点暂停、继续 | **缺失**：后端有 interrupt 能力但未用于逐节点 | P2 |
| DBG-06 | 从某节点重跑 | 继承上游 state 重跑 | 缺失 | P2 |
| DBG-07 | 最近一次运行 | 刷新后恢复节点结果 | 缺失 | P1 |
| DBG-08 | 停止运行 | 中断正在执行的任务 | 已有（取消） | 保持 |
| DBG-09 | Chatflow 调试预览 | 聊天式调试 + 会话变量 | 部分（`chat-sheet`） | P1 |
| DBG-10 | 运行历史回看 | 打开历史 run 的输入/结果/Tracing | 缺失（只有会话消息） | P1 |

---

## 7. 版本管理

| 编号 | 功能项 | 说明 | RAGFlow 现状 | 优先级 |
|---|---|---|---|---|
| VER-01 | 草稿自动保存 | 防抖自动保存 + 乐观锁 | 已有（20s 防抖），**无 hash 锁** | P1 |
| VER-02 | 发布快照 | 每次发布生成不可变版本 | 已有 | 保持 |
| VER-03 | 版本列表 | 列表、预览、下载 DSL | 已有 | 保持 |
| VER-04 | 版本命名 / 备注 | 给版本打标签 | 缺失 | P2 |
| VER-05 | 版本恢复 / 回滚 | 把历史版本恢复为草稿 | **缺失**（前端无入口，后端无 restore） | **P0** |
| VER-06 | 版本 diff | 节点/边/配置差异 | 缺失 | P2 |
| VER-07 | 指定版本运行 | 按历史版本跑 | 部分（`?version=`） | P1 |
| VER-08 | DSL schema 版本 | DSL 带 `schema_version`，旧版本可迁移 | 缺失 | **P0** |
| VER-09 | 版本快照完整性 | 快照含 DSL + 环境变量 + 模型/提示词版本 | 仅 DSL | **P0** |
| VER-08 | 版本删除 | UI 删除 | 缺失（只有 API） | P3 |
| VER-09 | 发布审批 | 多人审批后发布 | 缺失 | P2 |

> 说明：VER-05 是「Workflow 敢上线」的前提，优先级高于版本 diff。Dify 也没有服务端 diff，diff 属于增强项。

---

## 8. 发布与集成

| 编号 | 功能项 | 说明 | RAGFlow 现状 | 优先级 |
|---|---|---|---|---|
| PUB-01 | 发布前校验 | 图完整性、必填节点、变量可达性、密钥 | 已有画布检查清单 | 保持 + 扩展 |
| PUB-02 | Workflow API | 同步/异步/流式运行，输出 JSON | **缺失**（只有 Agent run） | **P0** |
| PUB-03 | Chatflow Chat API | 流式消息 + conversation_id 续聊 | 部分（Agent run SSE） | **P0** |
| PUB-04 | 运行事件协议 | `workflow_started/node_started/node_finished/...` | 已有同类事件 | 保持 + 对齐 |
| PUB-05 | WebApp | 独立访问页 | 已有分享页 | 保持 |
| PUB-06 | 分享链接 | 公开链接 | 已有 | 保持 |
| PUB-07 | iframe / script 嵌入 | 嵌入第三方站点 | 已有 | 保持 |
| PUB-08 | 每应用 API Key | 独立密钥、可轮换 | **缺失**（只有用户级 token） | P1 |
| PUB-09 | 调用配额 / 限流 | RPM/RPH、并发上限 | 缺失 | P1 |
| PUB-10 | OpenAPI 文档 | 自动生成接口说明 | 缺失 | P2 |
| PUB-11 | MCP 暴露 | 应用作为 MCP server | 部分（Agent MCP） | P2 |
| PUB-12 | Workflow-as-Tool | 发布版本注册为工具 | 缺失 | P1 |
| PUB-13 | DSL 导入/导出 | 跨环境迁移 | 部分（JSON 导入导出） | P1 |
| PUB-14 | API 幂等 | `Idempotency-Key` + 唯一索引，重试不重复执行 | 缺失 | **P0** |
| PUB-15 | 异步运行 worker | 持久化队列 + 孤儿恢复 | 缺失 | P1（V1.0 不做 async） |
| PUB-16 | HITL 公开 API resume | 含 UserFillUp 的 Workflow 可通过 API 恢复 | 缺失 | P1（V1.0 发布时阻止） |

---

## 9. 日志与可观测

| 编号 | 功能项 | 说明 | RAGFlow 现状 | 优先级 |
|---|---|---|---|---|
| LOG-01 | Run 列表 | 按应用查运行记录 | 缺失（日志页是会话列表） | **P0** |
| LOG-02 | Run 详情 | 输入、输出、状态、耗时、token | 部分（SSE 实时） | **P0** |
| LOG-03 | 节点执行记录 | 每节点 inputs/process/outputs/error | **缺失持久化**（刷新即丢） | **P0** |
| LOG-04 | Trace 时间线 | 节点级耗时与顺序 | 已有（实时） | 保持 + 持久化 |
| LOG-05 | 错误定位 | 节点错误 + 堆栈 | 部分 | P1 |
| LOG-06 | Token / 成本统计 | Run 级 + 节点级 + 消息级 | 部分（workflow_finished.usage） | P1 |
| LOG-07 | 运行状态筛选 | 成功/失败/停止/部分成功 | 缺失 | P1 |
| LOG-08 | 标注 / 反馈 | 人工标注、回流数据集 | 缺失 | P2 |
| LOG-09 | 外部 Trace | Langfuse / LangSmith 等 | 部分（Langfuse） | P2 |
| LOG-10 | 统计看板 | 日运行、成功率、平均耗时 | 缺失 | P2 |
| LOG-11 | 大对象 offload | 大输入输出存对象存储 | 缺失 | P2 |

> LOG-03 是「调试能回看」的关键；没有它，用户刷新页面就丢失整次运行的节点 IO，Workflow 无法排障。

---

## 10. 人机协同与触发器

| 编号 | 功能项 | 说明 | RAGFlow 现状 | 优先级 |
|---|---|---|---|---|
| HITL-01 | 等待输入节点 | 表单/文件/选项，暂停后恢复 | 已有 `UserFillUp` | 保持 |
| HITL-02 | 表单投递 | WebApp / 邮件 | 部分（WebApp） | P1 |
| HITL-03 | 超时与恢复 | 节点超时、全局过期、幂等恢复 | 部分（中断恢复有） | P1 |
| HITL-04 | 表单实体与审计 | 表单、收件人、投递记录 | 缺失 | P2 |
| TRG-01 | Webhook 触发 | 多方法、鉴权、限流、Schema | 已有（Begin.mode=Webhook） | 保持 + 独立根节点 |
| TRG-02 | 定时触发 | Cron / 可视化频率 | **缺失** | P2 |
| TRG-03 | 插件事件触发 | OAuth 订阅、事件回调 | 缺失 | P3 |
| TRG-04 | 触发器日志 | 触发数据、状态、重试 | 部分 | P2 |

---

## 11. 权限与治理

| 编号 | 功能项 | 说明 | 现状 | 优先级 |
|---|---|---|---|---|
| GOV-01 | 应用级权限 | 查看/编辑/运行/发布分离 | 部分 | P1 |
| GOV-02 | 租户隔离 | 跨租户不可见 | 已有 | 保持 |
| GOV-03 | 密钥与敏感信息 | 加密、掩码、不导出 | 部分 | P1 |
| GOV-04 | 审计日志 | 谁改了图、谁发布了；独立表，保留 ≥180 天 | 缺失 | **P0** |
| GOV-05 | 发布审批 | 审批人 | 缺失 | P2 |
| GOV-06 | 工作流即 API 的配额 | 按应用限流 | 缺失 | P1 |
| GOV-07 | 多租户隔离验证 | API Key / run / 会话变量的跨租户用例 | 缺失 | P1 |
| GOV-08 | PII 与注入防护 | 日志/运行记录脱敏；提示词注入防护；生成内容免责声明 | 缺失 | P1 |

---

## 12. 非功能需求（清单级）

| 编号 | 类别 | 要求 |
|---|---|---|
| NFR-01 | 性能 | 画布 200 节点内流畅；单节点试运行 P95 ≤ 3s（不含 LLM） |
| NFR-02 | 并发 | 单应用并发运行上限可配；Iteration 并发上限可配 |
| NFR-03 | 可靠性 | 发布原子化；版本快照不可变；运行中断可恢复（HITL） |
| NFR-04 | 兼容 | 支持旧 DSL 导入；未知节点给出明确报错而非静默失败 |
| NFR-05 | 可观测 | 每次运行必须有 run_id；节点执行必须可追溯 |
| NFR-06 | 安全 | 代码沙箱隔离；HTTP 节点防 SSRF；密钥不落日志 |
| NFR-07 | 数据 | 大输入输出 offload；运行记录保留期可配 |

---

## 13. 优先级与分期建议

### P0（不做则 Workflow/Chatflow 不可用）— 约 8~10 周

| # | 功能 | 对应编号 | 备注 |
|---|---|---|---|
| 1 | 应用类型独立（Workflow / Chatflow），后端按形态分流 | APP-01/02/03/04 | 用 `canvas_category` 扩枚举，不新增 `app_mode` |
| 2 | End 输出节点 + 输出契约 | 节点 4.1 | 编译期校验唯一可达 |
| 3 | Answer 节点 + Chatflow 流式语义 | 节点 4.1 | 内嵌 Message 渲染，至少一个可达 |
| 4 | LLM 节点前端补齐 + 纳入面板 | 节点 4.2 | **后端已有 `llm.go`，仅前端表单与节点目录** |
| 5 | 参数提取节点 | 节点 4.2 | 后端新增 + 前端表单 |
| 6 | 模板转换节点 | 节点 4.4 | 复用 Jinja 能力 |
| 7 | 会话变量（独立表 + 双轨语义） | VAR-02/03 | `env` 只读、`conversation` 可写 |
| 8 | 版本回滚 + 快照不可变 | VER-05 | 版本追加，含环境变量快照 |
| 9 | Run / 节点执行记录持久化 | LOG-01/02/03 | 异步旁路落库 |
| 10 | 通用节点重试 | ND-01 | 抽到公共层 |
| 11 | Workflow / Chatflow 发布 API（blocking + streaming） | PUB-02/03 | **async 降到 V1.1** |
| 12 | API 幂等 | PUB-14（新增） | `Idempotency-Key` + 唯一索引 |
| 13 | run 级超时 / token / 成本上限 | ND-07（新增） | 防死循环与成本失控 |
| 14 | 审计表与查询 | GOV-07（新增） | ≥180 天，独立于 run 记录 |
| 15 | DSL schema 版本 | VAR-11（新增） | 支持旧 DSL 迁移 |

### P1（让 Workflow 好用）— 约 6~8 周

- 左侧节点面板、右键菜单（CV-02/03）
- HTTP 节点补全（鉴权、重试、PATCH/DELETE）
- Workflow-as-Tool / 子工作流
- 变量检查器、运行面板三视图
- 每应用 API Key + 限流（V1.0 已含 API Key，P1 补轮换/审计增强）
- 节点超时/异常策略/失败分支
- 版本命名/备注、指定版本运行
- 表单投递（邮件）、HITL 超时与公开 API resume
- **异步 API + 持久化 worker**
- 多租户隔离测试
- PII 脱敏、提示词注入防护、生成内容合规
- 限流细节（key 格式、burst、`Retry-After`）

### P2（体验与治理）— 约 6~8 周

- 单步/断点/从节点重跑
- 定时触发器
- 版本 diff、发布审批
- 标注/反馈/数据集回流
- 外部 Trace、统计看板、大对象 offload
- 节点版本机制、DSL 兼容层

### P3（可选）

- 多人协作 / 评论 / CRDT
- 插件事件触发 / 插件市场
- Agent v2 运行时

---

## 14. 待确认（影响范围与排期）

1. **应用形态是新增还是合并？** 现有 `agent_canvas` 是否直接拆成 `workflow` / `chatflow` 两类，还是保留 `agent` 作为第三类？建议保留三类，`agent` 走现有能力。
2. **Chatflow 的 Answer 是否允许没有？** Dify 前端强制、后端不强制；建议 RAGFlow 发布时强制至少一个可达 Answer。
3. **Workflow 的 End 是否必填？** 建议必填，否则无法定义输出契约。
4. **会话变量是否按 Conversation 存？** 建议是；跨会话共享另做「应用变量」。
5. **是否兼容 Dify DSL 导入？** 若需要，节点类型/字段要做映射层；工作量显著增加。
6. **是否需要每应用 API Key？** 若客户要独立计费/限流，必须做；否则可先用租户 token。
7. **触发器是否本期做？** 定时触发与插件事件建议后置，先做 Webhook。
8. **代码沙箱是否复用现有？** RAGFlow 已有多沙箱后端，建议复用，不引入 Dify 的 sandbox。

---

## 15. 附录：Dify ↔ RAGFlow 节点对照全表

| Dify | RAGFlow | 状态 | 优先级 |
|---|---|---|---|
| start | Begin | 已有 | 保持 |
| end | — | 缺失 | P0 |
| answer | Message | 半成品 | P0 |
| llm | 独立 LLM（后端已有 `llm.go`，缺前端） | 半成品（前端） | P0 |
| knowledge-retrieval | Retrieval | 已有 | 保持 |
| question-classifier | Categorize | 已有 | 保持 |
| parameter-extractor | — | 缺失 | P0 |
| if-else | Switch | 已有 | 保持 |
| iteration | Iteration | 已有 | 保持 |
| loop | Loop | 已有 | 保持 |
| iteration-start | 自动生成 | 已有 | 保持 |
| loop-start / loop-end | 自动生成 | 已有 | 保持 |
| code | Code | 已有 | 保持 |
| template-transform | — | 缺失 | P0 |
| http-request | Invoke | 半成品 | P1 |
| assigner | VariableAssigner | 已有 | 保持 |
| variable-aggregator | VariableAggregator | 已有 | 保持 |
| list-operator | ListOperations | 已有 | 保持 |
| document-extractor | Parser（管道） | 半成品 | P1 |
| tool | Tool | 半成品 | P1 |
| agent | Agent | 已有 | 保持 |
| agent-v2 | — | 缺失 | P2 |
| datasource | File（管道） | 半成品 | P2 |
| knowledge-index | Tokenizer / Compiler | 半成品 | P2 |
| human-input | UserFillUp | 已有 | 保持 |
| trigger-webhook | Begin.mode=Webhook | 半成品 | P1 |
| trigger-schedule | — | 缺失 | P2 |
| trigger-plugin | — | 缺失 | P3 |
| note | Note | 已有 | 保持 |

---

## 16. 与现有能力的关系（避免重复建设）

| RAGFlow 已有能力 | 在 Workflow/Chatflow 中的定位 |
|---|---|
| 知识库 / 检索 / 引用溯源 | Chatflow 的核心竞争力，必须保留 citation 元数据 |
| 文档解析 / 知识编译 | 可作为 Workflow 的「数据准备」前置步骤 |
| Agent 工具 / MCP / 子智能体 | Workflow 中的智能节点，不重复造 |
| 数据管道（File/Parser/Tokenizer/Compiler） | 与 Workflow 共用画布引擎，但节点目录隔离 |
| 会话历史 / Memory | Chatflow 的多轮基础 |
| Langfuse | 外部可观测入口，先复用 |

---

> 说明：本文为功能盘点，不替代 PRD。进入排期前需就第 14 节逐项确认，并对 P0 项补写 15 段 PRD 与验收标准。
