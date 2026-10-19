# Agent Webhook 触发器 — 实现完整性核查清单

> 核查对象：PRD `docs/prd_webhook.md` 的 FR1–FR6
> 代码基线：ragflow 当前工作区（Go 端口，对应 Python `agent_api.py` webhook 段）
> 核查结论：**方案已在代码里基本实现，FR1–FR6 均有对应落地代码，端到端链路打通；但 PRD 中有 1 处描述与代码实现不符，另有 3 处需标注的偏差/缺口。**
> 修订状态：PRD 已据本清单修正至 **v0.2**（见 `docs/prd_webhook.md`），下述 4 项偏差均已回写，两份文档现已一致。

---

## 一、逐条对照

### FR1 触发接口
| 项 | 状态 | 说明 |
|----|------|------|
| `/webhook`、`/webhook/test`、`/webhook/logs` 路由 | ✅ 已实现 | `internal/router/agent_routes.go` 注册，6 种方法经 `registerAnyMethod` 挂载 |
| 仅 Webhook 模式可用 | ✅ 已实现 | `findWebhookBegin` 扫描 DSL 找 `mode=="Webhook"` 的 Begin，否则返回 102 |
| 拒绝 Dataflow 画布 | ✅ 已实现 | `dataflow_canvas` 直接返回 "Dataflow can not be triggered by webhook." |
| 画布归属（IDOR）安全 | ✅ 已实现 | `LoadCanvasByID` → `loadCanvasForUser`，带 `OperationRead` 权限校验 |

### FR2 安全校验体系
| 校验关 | 状态 | 实现位置 |
|--------|------|----------|
| 方法白名单 | ✅ | `methodAllowed` |
| Body 大小 | ✅ | `validateMaxBodySize` + `http.MaxBytesReader` 双重校验（防 DoS） |
| IP 白名单 | ✅ | `validateIPWhitelist`（CIDR + 精确，依赖可信代理配置） |
| 速率限制 | ✅（有偏差） | `validateRateLimit`，令牌桶 `EvalTokenBucketStrict` |
| Token | ✅ | `validateTokenAuth`（要求 header/value 均非空配置） |
| Basic / JWT | ✅ | `validateBasicAuth` / `validateJWTAuth`（HS/RS/ES，校验 audience/issuer/required_claims） |

> 说明：安全层整体**比 PRD 描述更严格**——空 security 配置在 Go 端口已改为 **fail-closed**（PR #14890），缺失配置块或缺 `allow_anonymous:true` 的 `auth_type=none` 都会被拒绝。

### FR3 配置面板（Begin 节点 Webhook 模式）
| 项 | 状态 | 说明 |
|----|------|------|
| 回调地址生成 + 复制 | ✅ | `use-build-webhook-url` + `CopyToClipboardWithText` |
| 允许方法多选 | ✅ | `MultiSelect` 绑定 `methods` |
| 限流配置 | ✅ | `rate_limit.per` + 上下限映射 |
| 鉴权配置 | ✅ | `Auth` 子组件 |
| 请求 Schema | ✅ | `WebhookRequestSchema` 子组件 |
| 响应模板 | ✅ | `WebhookResponse` 子组件 |

> 说明：前端 UI 已落地并通过 `react-hook-form` 绑定到画布 DSL 表单。建议补充验证：保存/发布链路是否将 `methods/security/schema/execution_mode/response` 完整写入 Begin 节点 `params`，以及编辑后是否需要重新 publish 才对外生效。

### FR4 字段映射 Schema
| 项 | 状态 | 说明 |
|----|------|------|
| 三段抽取（query/headers/body） | ✅ | `applyWebhookSchema` → `extractBySchema` |
| 类型转换与校验 | ✅ | `autoCastValue` + `validateType`（string/number/boolean/object/array/file） |
| 必填校验 / 默认值 | ✅ | `defaultForType`，缺必填字段报错 |
| header 大小写不敏感 | ✅ | 内部 lower 化匹配，保留原 key 输出 |

> 偏差：`"file"` 类型在 schema 层支持，但 webhook 入参路径已拒绝 `multipart/form-data`（返回 501），故 file 字段实际**无法通过 webhook 触发填充**。属于预期缺口，需与 PRD 第 8 节一并说明。

### FR5 执行模式
| 项 | 状态 | 说明 |
|----|------|------|
| 立即响应 | ✅ | `renderImmediatelyResponse` + `runWebhookDetached`（5min 超时、detach cancel，客户端断开不影响执行） |
| 同步阻塞聚合 | ✅ | `runWebhookSync` 聚合 message 返回 JSON |
| 默认模式 | ✅ | 空 `execution_mode` 默认 `Immediately` |

### FR6 测试与日志
| 项 | 状态 | 说明 |
|----|------|------|
| `/webhook/test` 写 Trace | ✅ | `appendWebhookTrace` 写入 `webhook-trace-<id>-logs`（TTL 10min） |
| `/webhook/logs` 查询 | ✅ | `GetAgentWebhookLogs`（`handler/agent.go:1525`），含增量轮询、HMAC 签名 cursor、归属校验 |
| 失败脱敏 / 过期停止 | ✅ | 多组单测覆盖（`agent_webhook_trace_test.go` 等） |

**端到端链路**：`handler.Webhook` → `loader.RunAgentWithWebhook` → `service.RunAgentWithWebhook`（context 注入 `webhook_payload`）→ Begin 节点消费 → 画布运行。链路已打通。

**测试资产**：`agent_webhook_test.go`、`agent_webhook_security_test.go`、`agent_webhook_trace_test.go`、`agent_webhook_trace_poll_test.go`、`agent_webhook_workflow_test.go`、`agent_webhook_schema.go` 相关测试——单测与集成测试覆盖较完整。

---

## 二、需修正 / 重点标注的 4 项

1. **【PRD 事实错误，需修正】空安全配置语义不一致**
   PRD 第 4.2 节写"空 security config 意味着无检查（matches python:1607）"。但代码注释明确：Go 端口已通过 PR #14890 **改为 fail-closed**——空配置或缺 `allow_anonymous:true` 的 `auth_type=none` 一律拒绝（返回 102）。建议将 PRD 改为"空配置默认拒绝，需显式 `allow_anonymous:true` 才开放匿名"。

2. **【偏差】速率限制超时放行**
   `validateRateLimit` 在 Redis 调用**超时**（DeadlineExceeded/Canceled）时 `return nil`（放行），仅 Redis 报错才拒绝。注释称为"ambiguous, allowing"的可用性妥协。这与"严格 fail-closed"的措辞略有出入，建议在 PRD/安全说明里明确该边界，避免客户审计时误判。

3. **【偏差】Body 大小单位**
   代码用 SI 十进制（1 KB = 1000 B），比 Python 二进制的 10MB 严格约 486KB。配置上限 10MB 仍是 10,000,000 字节而非 10,485,760。PRD 未提及，建议补一句"实际上限以十进制计"。

4. **【缺口】file 类型无上传入口**
   Schema 支持 `file`，但 `multipart/form-data` 被 501 拒绝，file 字段无法触发填充。PRD 第 8 节已标注该限制，但建议在第 4.4 节同步注明"file 类型当前不可用于 webhook 入参"。

---

## 三、建议补充验证项
- [ ] 前端保存链路：Begin 节点 `params` 是否完整写入 webhook 配置，编辑后是否需 republish
- [ ] 速率限制在真实 Redis 故障/超时下的行为确认（边界 #2）
- [ ] 同步模式下画布异常的响应码映射（当前 error→500 / cancelled→409 / waiting_for_user→409）
- [ ] 跨版本升级：若客户沿用 Python 版"空配置即开放"的旧习惯，迁移到 Go 端口需提示其 webhook 将被默认拒绝

---

## 四、核查结论
该 webhook 方案**无需从零实现**，代码已覆盖 PRD 全部功能点（FR1–FR6）并带有完整测试。当前工作应聚焦于：① 修正 PRD 与代码不符的 1 处描述；② 向客户明确 3 处实现偏差（默认拒绝、限流超时放行、十进制大小）；③ 视需要补齐 multipart 上传（唯一真正的功能缺口）。
