# Agent Webhook 触发器 — 产品需求文档（PRD）

> 版本：v0.2（据代码实现核查修正） · 状态：评审中 · 模块：Agent 工作流 / Webhook 触发器
> 说明：本文档基于 RagFlow 当前代码实现整理（Go 端口对应 Python `agent_api.py` 的 webhook 段），用于售前方案与客户需求对齐。v0.2 已据 `docs/webhook_implementation_review.md` 核查结论修正安全默认语义、限流边界与单位口径。

---

## 1. 背景与目标

RagFlow 的 Agent 画布支持多种触发方式（对话、API 调用、Webhook 等）。本 PRD 定义其中的 **Webhook 触发** 能力：允许外部系统通过标准 HTTP 请求直接触发某个 Agent 画布运行，并将请求参数（query / headers / body）映射为画布的输入变量。

**适用场景**：事件驱动的系统集成——第三方系统回调、自动化流水线（CI/CD、工单系统）、IoT 事件、定时外部推送等。

**目标**
- 提供稳定、安全的对外 HTTP 触发入口
- 通过多层安全校验防止未授权调用与滥用（DoS、越权）
- 支持灵活的请求字段映射与响应定制
- 提供测试通道与调用日志，便于排查

**非目标（本期不做）**
- `multipart/form-data` 文件上传触发（当前返回 HTTP 501）
- Dataflow（数据管道）画布的 Webhook 触发

---

## 2. 术语

| 术语 | 说明 |
|------|------|
| 画布（Canvas） | Agent 工作流的可视化定义，内含 DSL 描述 |
| Begin 节点 | 画布入口节点，可配置触发模式（对话 / Webhook） |
| 立即响应（Immediately） | 先返回配置的响应，画布在后台异步执行 |
| 同步阻塞 | 等待画布执行完成，聚合消息后返回 JSON |
| 安全校验层 | 方法 / Body 大小 / IP / 速率 / Token / Basic·JWT 六道关卡 |

---

## 3. 功能需求

### FR1 触发接口
- 统一触发入口：`/api/v1/agents/:canvas_id/webhook`
- 支持方法：POST、GET、PUT、PATCH、DELETE、HEAD（可在配置中限定允许的方法集合）
- 测试入口：`/api/v1/agents/:canvas_id/webhook/test`（携带 trace 日志）
- 日志查询：`GET /api/v1/agents/:canvas_id/webhook/logs`
- 仅当画布 Begin 节点模式为 `Webhook` 时可用；`dataflow_canvas` 画布禁止触发，返回 "Dataflow can not be triggered by webhook."

### FR2 安全校验体系（默认拒绝 / fail-closed，任一不通过即返回 102 错误码）

> 安全策略采用**默认拒绝**语义：未配置 `security` 块、或 `auth_type=none` 未显式设置 `allow_anonymous: true` 时，所有请求一律拒绝（返回 102）。这与早期 Python 版本"空配置即开放"的行为相反，迁移客户需特别注意。

1. **请求方法白名单**（`methodAllowed`）：未在配置中的方法返回拒绝
2. **Body 大小限制**：默认上限 **10 MB（十进制，10,000,000 字节）**，采用 `http.MaxBytesReader` 双重校验（防 DoS）；比二进制口径的 10MB 严格约 486KB
3. **IP 白名单**：支持 CIDR 与精确 IP 匹配
4. **速率限制**：令牌桶（token bucket）；Redis 校验失败时拒绝，但 Redis **超时/取消**时出于可用性妥协会放行（非严格 fail-closed，审计时需知悉此边界）
5. **Token 请求头校验**：要求 header 与 value 均非空配置，否则拒绝（杜绝"空 token 即放行"）
6. **Basic Auth / JWT**：支持 HS256 / RS256 / ES*，可校验 `audience`、`issuer`、必填 `claims`

### FR3 配置面板（Begin 节点 Webhook 模式）
- 自动生成回调地址（可一键复制）
- 允许的请求方法（多选）
- Content-Type 白名单（`application/json` / `application/x-www-form-urlencoded`）
- 最大 Body 大小（1 / 5 / 10 MB）
- 安全策略：IP 白名单、速率限制、鉴权方式
- 字段映射 Schema（query / headers / body 的字段抽取规则）
- 执行模式与响应模板

### FR4 字段映射 Schema
将入参按 schema 从 `query` / `headers` / `body` 抽取为画布输入变量；未匹配字段按规则忽略或报错，最终组装为 `clean_request` 传入画布运行。支持 string / number / boolean / object / array / file 等类型，header 名大小写不敏感。

> 注：Schema 虽支持 `file` 类型，但 webhook 入参已拒绝 `multipart/form-data`（返回 501），故 `file` 字段当前无法通过 webhook 触发填充。

### FR5 执行模式
- **立即响应**：返回配置的状态码（200–399）+ 响应体模板（支持 `{{session_id}}` 等变量），画布在后台 detached 运行（5 分钟超时，客户端断开不影响执行）
- **同步阻塞**：阻塞等待执行，聚合 message 内容，返回
  ```json
  {"message": "...", "success": true, "code": 200, "task_id": "...", "session_id": "..."}
  ```

### FR6 测试与日志
- `/webhook/test` 触发时，运行事件写入 Redis 键 `webhook-trace-<canvas_id>-logs`（TTL 10 分钟）
- `/webhook/logs` 可查询最近一次调用的执行轨迹（start / message / finished / error 等事件）

---

## 4. 接口定义

### 4.1 触发接口
- **路径**：`POST|GET|PUT|PATCH|DELETE|HEAD /api/v1/agents/:canvas_id/webhook`
- **鉴权**：平台用户 Token（`GetUser` + 画布归属校验）
- **请求参数**：随业务，来源为 query / headers / body
- **成功响应**
  - 立即响应：配置状态码（200–399）+ 模板体（JSON 或纯文本）
  - 同步阻塞：HTTP 200 + 上述 JSON
- **错误响应**：统一 102 envelope（`CodeDataError`，附带具体原因文案）

### 4.2 测试接口
- **路径**：`.../webhook/test`（同方法集合）
- **区别**：写入 trace 日志，便于前端展示执行过程

### 4.3 日志接口
- **路径**：`GET /api/v1/agents/:canvas_id/webhook/logs`

---

## 5. 鉴权方案（双层）

| 层级 | 机制 | 目的 |
|------|------|------|
| 第一层 | 平台用户身份（GetUser + 画布归属） | 确保调用者对该画布有权 |
| 第二层 | Webhook 级安全策略（Token / Basic / JWT / IP / 速率） | 确保来源可信、防滥用 |

---

## 6. 业务流程（见附图）

```
外部 HTTP 请求
   → 接口鉴权与画布加载（IDOR 安全，拒绝 Dataflow）
   → 安全校验层（方法 / Body 大小 / IP / 速率 / Token / Basic·JWT）
   → 解析请求 & Schema 字段抽取（Content-Type 白名单 + 三段映射）
   → 分发执行（立即响应 / 同步阻塞）
   → 返回响应 + 写入 Trace 日志
```

---

## 7. 非功能需求

- **安全**：默认 fail-closed，绝大多数安全校验失败即拒绝（空配置 / 缺 `allow_anonymous` 直接拒绝；Body 大小双重校验）；唯一例外是限流环节在 Redis 超时/取消时放行，以避免误杀，详见 FR2 第 4 点
- **性能**：同步阻塞有 5 分钟上限；立即模式不阻塞客户端
- **可观测**：trace 日志留存 10 分钟，支持排障
- **兼容**：与 Python 参考实现（`agent_api.py:1563-2248`）行为对齐

---

## 8. 限制与已知问题

- 不支持 `multipart/form-data` 上传（返回 501）；因此 Schema 的 `file` 类型字段无法通过 webhook 入参填充
- `dataflow_canvas` 画布不可触发
- 立即响应模式下，画布执行结果不随 HTTP 响应返回（仅返回配置的响应模板）

---

## 9. 验收标准

- [ ] 配置 Webhook 模式后，回调地址可生成并可复制
- [ ] 仅配置允许的方法可调用，其他方法返回 102
- [ ] 6 项安全校验均可独立开启并正确拦截
- [ ] 字段映射按 schema 正确注入画布输入变量
- [ ] 立即 / 同步两种模式行为符合定义
- [ ] `/webhook/test` 与 `/webhook/logs` 可正常记录与查询

---

## 附：实现位置（代码参考）

| 能力 | 文件 |
|------|------|
| 触发处理器 | `internal/handler/agent_webhook.go` |
| 安全校验 | `internal/handler/agent_webhook_security.go` |
| 路由注册 | `internal/router/agent_routes.go` |
| 字段抽取 | `internal/handler/agent_webhook_schema.go` |
| Begin 模式解析 | `internal/agent/component/begin.go` |
| 前端配置 UI | `web/src/pages/agent/form/begin-form/webhook/` |
