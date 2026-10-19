# Agent Webhook 触发器 — 使用手册

> 适用版本：ragflow 含 webhook 能力的分支（main，2026-10-16 起已合入官方实现）
> 面向读者：使用 Agent 画布的业务/集成人员、运维人员
> 配套文档：PRD `docs/prd_webhook.md`、实现核查 `docs/webhook_implementation_review.md`

---

## 1. 功能简介

Agent Webhook 触发器允许**外部系统用标准 HTTP 请求直接触发某个 Agent 画布运行**，并把请求中的参数（query / headers / body）映射为画布的输入变量。

**典型场景**：第三方系统回调、CI/CD 流水线、工单系统事件、IoT 事件、定时外部推送等事件驱动的自动化集成。

**重要认知（必读）**：Webhook **不是独立页面/菜单**，它是**内嵌在 Agent 画布「Begin（开始）节点」里的配置项**。只有在把 Begin 节点的「模式」切到 Webhook 后，相关配置面板才会出现。很多人"找不到 webhook 页面"，其实是因为在找独立菜单。

---

## 2. 入口与前置条件

- 进入「**Agent**」应用 → 打开（或新建）一个 Agent → 进入**画布编排页**
- 前置：至少有一个已创建的 Agent（画布）

> 注意：**Dataflow（数据管道）画布不支持 Webhook 触发**，配置为 Webhook 模式会返回 "Dataflow can not be triggered by webhook."。

---

## 3. 配置步骤

### 步骤 1：打开 Begin 节点并切换模式
1. 在画布上点击最左侧的 **Begin / 开始**节点
2. 在右侧属性面板的「**模式 (mode)**」下拉中，选择 **Webhook**
3. 面板下方随即展开 Webhook 配置区

### 步骤 2：填写基础参数
| 配置项 | 说明 |
|--------|------|
| 回调地址 | 自动生成，形如 `https://域名/api/v1/agents/<canvas_id>/webhook`，可一键复制 |
| 允许的请求方法 | POST / GET / PUT / PATCH / DELETE / HEAD（多选，未勾选的方法会被拒绝） |
| Content-Type 白名单 | `application/json` 或 `application/x-www-form-urlencoded` |

### 步骤 3：配置安全策略（建议必配）
| 子项 | 说明 |
|------|------|
| IP 白名单 | 支持 CIDR（如 `192.168.1.0/24`）与精确 IP |
| 速率限制 | 如 100 次/分钟（second / minute / hour / day） |
| 鉴权方式 | 无 / Token 请求头 / Basic / JWT |

> **默认拒绝（fail-closed）**：未配置任何安全策略，或 `auth_type=none` 但未显式勾选"允许匿名"，**所有请求一律被拒绝（返回 102）**。这与早期"空配置即开放"不同，迁移时务必注意。

### 步骤 4：配置字段映射 Schema
从 `query` / `headers` / `body` 三段抽取字段，指定类型（string / number / boolean / object / array / file）与是否必填。抽取后的字段成为画布输入变量，供后续组件引用。

### 步骤 5：选择执行模式与响应模板
- **立即响应（Immediately）**：先按配置返回状态码（200–399）+ 响应体模板（支持 `{{session_id}}` 等变量），画布在后台异步执行（5 分钟超时，客户端断开不影响执行）
- **同步阻塞**：阻塞等待画布执行完成，聚合消息后返回 JSON

### 步骤 6：保存（并发布）
点击「保存」。建议同时**发布（Publish）**该 Agent，以确保对外调用稳定。

---

## 4. 字段映射说明

外部请求示例（POST body）：

```json
{"order_id": "A123", "amount": 100}
```

在 Begin 节点的 **body Schema** 中配置：

- `order_id`：类型 string，必填
- `amount`：类型 number

保存后，这两个字段会被抽取为画布输入变量，在后续组件（如提示词、工具调用）中通过变量选择器插入引用即可。未配置的字段会被忽略；**必填字段缺失则触发被拒绝**。

> 类型支持：string / number / boolean / object / array / file。注意 `file` 类型当前**无法从 webhook 入参填充**（见第 9 节限制）。

---

## 5. 安全配置示例

**Token 请求头鉴权**（最常用）：
- 鉴权方式选 `Token`
- 填写 `token_header`（如 `x-webhook-token`）与 `token_value`（密钥）
- 调用方须在请求头携带该 header 与值

**JWT 鉴权**：
- 鉴权方式选 `JWT`
- 填写算法（HS256/RS256/ES*）、secret、可选 `audience` / `issuer` / 必填 `claims`

**IP 白名单 + 限流组合**：
- IP 白名单填 `10.0.0.0/8`
- 速率限制填 1000 次/分钟

---

## 6. 测试与日志

配置为 Webhook 模式并保存后，页面会出现 **Webhook 测试面板**，内含：
- **回调地址**展示
- **概览 / 调用日志（Trace）**标签页，展示每次触发的运行轨迹：`start / message / finished / error`

> 先用「测试」面板验证配置能否跑通，再交给外部系统调用。日志也可通过接口查询（见第 8 节）。

---

## 7. 用外部系统调用

Webhook 有**两层鉴权**：
1. **第一层（平台身份）**：请求头 `Authorization: Bearer <平台用户/API Token>`
2. **第二层（Webhook 策略）**：你在安全策略里配置的 Token / Basic / JWT

curl 示例（Token 鉴权）：

```bash
curl -X POST 'https://你的域名/api/v1/agents/<canvas_id>/webhook' \
  -H 'Authorization: Bearer <平台用户Token>' \
  -H 'Content-Type: application/json' \
  -H 'x-webhook-token: <你配置的 token_value>' \
  -d '{"query": "查一下订单状态", "order_id": "A123"}'
```

- 方法、Content-Type 必须落在配置白名单内，否则返回 102
- `execution_mode=Immediately` 时接口立即返回响应模板，画布后台异步跑
- 同步模式时接口阻塞直到执行完，返回：
  ```json
  {"message": "...", "success": true, "code": 200, "task_id": "...", "session_id": "..."}
  ```

---

## 8. 接口参考

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/v1/agents/:canvas_id/webhook` | POST/GET/PUT/PATCH/DELETE/HEAD | 生产触发入口 |
| `/api/v1/agents/:canvas_id/webhook/test` | 同上 | 测试触发，写入 trace 日志 |
| `/api/v1/agents/:canvas_id/webhook/logs` | GET | 查询最近一次调用的执行轨迹 |

**常见响应码**
- `200`：成功（同步模式返回执结果；立即模式返回配置的响应模板）
- `102`：业务拒绝（画布不存在、方法/Content-Type 不匹配、安全校验未通过、字段映射失败等）
- `401`：平台身份鉴权失败
- `404`：后端路由未注册（通常是后端二进制未重新编译部署）
- `501`：`multipart/form-data` 上传暂不支持

---

## 9. 注意事项与排错

- **Dataflow 画布不可触发 Webhook**
- **`multipart/form-data` 文件上传暂不支持**（返回 501），Schema 的 `file` 类型字段当前无法从 webhook 入参填充
- **安全默认拒绝**：空安全配置 / 缺 `allow_anonymous` 直接拒绝
- **发布建议**：配置后建议发布 Agent，确保对外调用稳定
- **调不通时排查顺序**：
  1. 先用内置「测试面板」看日志，确认画布本身能跑
  2. 返回 102 → 检查请求方法、Content-Type、Token/IP/限流配置
  3. 返回 404 → 后端二进制未含该路由，需重新编译部署（确认 `internal/handler/agent_webhook.go` 已编译进服务）
  4. 返回 401 → 第一层平台 Token 缺失或错误
