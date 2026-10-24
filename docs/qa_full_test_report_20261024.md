# 全量功能 / API / 性能 / 端到端测试报告（2026-10-24）

**被测版本**：`13e139c73`（后端二进制 12:29 构建，12:33 四个服务重启）
**前端**：`dist_20261024_1032`（nginx 指向，10:32 构建 —— **早于** `482e322` 的租户管理页）
**被测环境**：ECS 47.99→42.121.119.90，2 核 8G，MySQL + Infinity + kvrocks（docker），四进程
`ragflow-admin / api / ingestor / syncer`
**测试方式**：真实 HTTP 打接口 + Playwright 真实浏览器；**没有采信上一轮的结论，全部重跑**
**产物**：截图 78 张 → `docs/qa_shots/2026-10-24/`

---

## 一、结论

| 层级 | 结果 | 判断 |
|---|---|---|
| 全量 API（162 项） | **160 PASS / 0 FAIL / 2 SKIP** | 通过 |
| 页面功能（41 页，Playwright 逐页） | **40 PASS / 1 FAIL** | 1 项是前端没发版，非代码缺陷 |
| 端到端业务链路（22 项，Playwright） | **22 PASS / 0 FAIL** | 通过 |
| 性能（9 接口 × 20 轮 + 并发 1/10/30） | **0 错误**，见 §六 | 基线可用 |
| 新增回归单测 | 4 个（3 个文件）全通过，见 §七 | — |

**一句话**：这一轮翻出 4 个缺陷，其中 **3 个是真实代码缺陷，已修复、已部署、已验证**；
第 4 个是「后端已上、前端还没发版」导致的页面 404，属于发版顺序问题，不是代码问题。
最值得说的一条：管理后台的**平台租户管理页整页打不开**（SQL 列名写错 → Error 1054），
而它在业务侧完全无感 —— 因为前面 20 组业务用例根本碰不到管理后台的独立进程。

---

## 二、这次测试踩到的三个环境前提

这三件事决定了脚本能不能跑起来，记下来省下一轮摸索。

| 前提 | 现象 | 处理 |
|---|---|---|
| 公网 IP 变了 | 老地址 `47.99.241.190` 全部 502/超时，像服务挂了 | 实际是 `42.121.119.90`（`~/.ssh/config` 的 `ecs-ragflow`），换地址后一切正常 |
| 登录强制图形验证码 | `109 captcha is required` | `GET /api/v1/auth/captcha` 拿 `captcha_id`，明文只存在 kvrocks 的 `captcha:<id>`，脚本走 SSH 直读 KV，不引入 OCR |
| 密码必须加密提交 | 密码正确仍报 `email and password do not match` | 前端是先 **base64 再 RSA(PKCS1)**，脚本复刻这一步 |

另有一条容易踩的：**管理后台是独立进程、独立 token（只有超管能进）**，
浏览器登录还会顶掉 API token —— 所以 E2E 里浏览器登录后必须重新取一次 token。

---

## 三、全量 API 测试（162 项）

真实数据、真实鉴权，覆盖 router 注册的主要业务面。业务码藏在 HTTP 200 里的情况
（`code >= 500`）也一并解析，只看状态码会漏。

| 组 | 范围 | 项数 |
|---|---|---|
| A | 认证与身份（含 CE 桩不 5xx） | 7 |
| B | 租户与成员 | 3 |
| C | 知识库 CRUD / 配置 | 15 |
| D | 文档 / 分块 / 解析 | 5 |
| E | 检索 | 4 |
| F | 对话（Chat） | 9（1 跳过） |
| G | 知识搜索 | 4 |
| H | 工作室 Agent / Apps（建、改、发布、版本、试运行、删除） | 25 |
| I | 运行记录与审计 | 4 |
| J | 记忆 | 7 |
| K | 文件与提交 | 6 |
| L | 实时质检（规则 / 绑定 / 命中 / 测试） | 9 |
| M | 分析 | 4 |
| N | 系统 | 15 |
| O | MCP | 2（1 跳过） |
| P | 模型 / 供应商（含真实对话与向量化调用） | 7 |
| Q | 编译模板 / 连接器 | 5 |
| R | 负向 / 越权 / 稳定性（非法 id、路径穿越、伪造 token、非法分页） | 7 |
| **T** | **平台管理后台（本轮新增，23 项）** | 23 |
| Z | 测试资源清理 | 1 |

**总计 162 项，160 通过，0 失败，用时 13.9–26.2s（随机器负载浮动）。**

### 3.1 为什么新增 T 组

上一轮 139 项全绿，但 `/api/v1/admin/tenants` 是 500 —— 因为它挂在**管理后台独立进程**上，
业务用例一条都走不到。T 组按「超管登录 → 逐个只读接口」扫一遍，并对三处做了实质断言：

- `T-04 /admin/tenants`：`data.list` 必须是数组，且 `member_count / kb_count / agent_count`
  都必须是数字（**这正是 1054 的直接暴露点**）
- `T-05`：关键字过滤必须真的过滤（返回 0 行）
- `T-20 /admin/ingestion/tasks`：7496 行必须在 **10s** 内返回（N+1 回归闸门）
- `T-22`：普通用户 token 访问平台控制台必须被拒（实测 403）

### 3.2 两个跳过项（如实记录）

| 项 | 原因 | 是否有风险 |
|---|---|---|
| `F-01` 创建对话助手 | 接口要求「知识库里有已解析文档」；现网 ingestor 积压 **5749 个 SCHEDULED** 任务（他人批量导入），测试窗口内新文档解析不出来 | 无。同一能力在 `H` 组用工作流 DSL 全覆盖（建/改/发布/版本/试运行/删除 25 项全过） |
| `O-02` 创建 MCP 服务 | 需要外部可达的 SSE 端点做握手，实测返回 404（SSRF 防护 + 外网不可达） | 无。MCP 列表/删除/内置服务均正常 |

---

## 四、页面功能测试（41 页，Playwright）

逐页扫 `routes.tsx` 里的实际路由，每页记录：`pageerror` / console error / 5xx /
**HTTP 200 里的 `code>=500`** / Error Boundary / 主体是否为空。详情页用 API 现场造夹具，跑完清理。

本轮补了两个盲区，都是被真问题逼出来的：

1. **管理后台 4 页**（服务状态 / 用户管理 / 租户管理 / 沙箱配置）—— 独立进程 + 超管 token，
   业务页面上下文根本进不去。
2. **前端 404 组件识别** —— `pages/404.tsx` 会安静地渲染出一整页「页面不存在」：
   控制台干净、没有 5xx、body 也不空。只看 5xx/控制台会把「路由没发版」判成 PASS。
   加上 `页面不存在|Page not found` 检测后，`/admin/tenants` 立刻从「假绿」变成 FAIL。

**结果：41 页，40 PASS，1 FAIL。**

| 失败页 | 现象 | 定性 |
|---|---|---|
| `/admin/tenants` 管理后台-租户管理 | 前端 404 组件（`ROUTE_404`） | **不是代码缺陷**：后端已修好并验证（`T-04` 200/code=0/total=3），但线上前端是 10:32 的 `dist_20261024_1032`，而租户管理页是 11:25 的 `482e322` 才进的代码。**后端先行、前端待发版**，下次前端发版后即可复验 |

顺手修掉一个假失败：`/user-setting/locale` 在 `routes.tsx` 里是**注释掉的路由**（语言切换已挪走），
扫描清单里删掉，否则每轮都报一次。

---

## 五、端到端业务链路（22 项，Playwright）

真实浏览器、真实点击、真实页面断言，覆盖 7 条链路：

| 链路 | 覆盖内容 | 结果 |
|---|---|---|
| E1 登录 | 填表（邮箱/密码/**验证码**）、提交、跳转 | 2/2 |
| E2 知识库 | 列表渲染、UI 新建、检索测试页渲染、**检索配置保存（P1 回归）**、无控制台错误 | 5/5 |
| E3 工作室 | UI 新建任务流 → 进入画布 → 节点渲染 → **画布试运行出结果** → UI 发布 → **版本弹窗不崩（P1 回归）** → 无 React 上下文错误 | 6/6 |
| E4 技能 | 技能页打开不报错（**缺表回归**）、空间接口、创建空间、无控制台错误 | 4/4 |
| E5 质检 | 页面渲染、规则接口、命中接口 | 3/3 |
| E6 模型设置 | 页面渲染 | 1/1 |
| E7 总览 | 页面渲染 | 1/1 |

**22/22 通过。** 其中 3 项是专门为历史 P1 缺陷留的回归点（检索配置保存、版本弹窗、技能缺表），
本轮全部复验通过。

---

## 六、性能测试

只读混合负载，2 核机器，同机跑 MySQL/Infinity。串行 9 个接口 × 20 轮，并发 1/10/30 各 12 秒。

### 6.1 单接口延迟（ms，n=20，err=0）

| 接口 | p50 | p95 | p99 | max |
|---|---|---|---|---|
| L1 知识库列表 | 74.6 | 117.8 | 122.8 | 122.8 |
| L2 应用列表 | 42.5 | 78.2 | 85.6 | 85.6 |
| L3 运行记录列表 | 31.9 | 67.0 | 77.5 | 77.5 |
| L4 质检命中列表 | 28.3 | 34.9 | 37.2 | 37.2 |
| L5 文件列表 | 56.0 | 101.7 | 136.8 | 136.8 |
| L6 文档列表 | 40.7 | 109.2 | 121.3 | 121.3 |
| R1 单库检索（空库） | 38.9 | 59.7 | 71.4 | 71.4 |
| S1 系统状态 | 31.1 | 35.6 | 52.7 | 52.7 |
| H1 首页 index.html | 20.1 | 23.1 | 28.9 | 28.9 |

### 6.2 并发吞吐（12s / 档，err=0）

| 并发 | RPS | p50 | p95 | p99 |
|---|---|---|---|---|
| 1 | 23.3 | 38.7 | 77.1 | 129.8 |
| 10 | 48.0 | 186.8 | 518.2 | 754.9 |
| 30 | 41.2 | 696.7 | 1850.6 | 2201.1 |

读路径在 2 核上约 **48 RPS 饱和**，并发 30 时吞吐反而掉到 41（排队变长），全程 **0 错误**。
这一轮同时有 ingestor 在跑积压任务（测试期间 load 从 2.21 升到 11.87），
所以绝对值比上午那轮（load 1.43 起）略差，**两轮 0 错误是一致的**。

### 6.3 管理后台两个接口的前后对比

| 接口 | 修复前 | 修复后 | 说明 |
|---|---|---|---|
| `/admin/tenants` | **500**（Error 1054） | 200 / code=0 / 3 行 | 列名写错 |
| `/admin/ingestion/tasks`（7496 行） | **107 s**（约 2.2 万次查询） | **0.76 s**（4 次查询） | N+1，见 §七 |

---

## 七、本轮发现并修复的缺陷

### P1-1 技能空间缺表 → 整站 Skills 页 500（`3710f9b`）

`entity.SkillSpace` 没进 `goRuntimeModels`，表不存在；而 `/skills/spaces` 的**权限校验**
先读这张表，于是 500 被包成 `Permission check failed`，看不出一丝 schema 的味道。
修复：补进 `goRuntimeModels`；新增 `internal/dao/schema_registration_test.go`
用 `go/parser` 静态扫描 `Model(&entity.X{})`，与迁移集合做差集，**任何实体漏注册直接编译期红灯**。

### P1-2 embedding 维度元数据缺失（`3710f9b`）

`validateEmbeddingModel` 要求 `MaxDimension != nil`，`conf/models/aliyun.json` 里
`text-embedding-v3/v4` 没写 `max_dimension` → 向量化接口直接失败。
修复：补 `max_batch_size` + `max_dimension`。复验 `/embeddings` 返回 `code=0`、1024 维。

### P1-3 平台租户列表 500（Error 1054）（`820ace4`）

`internal/admin/service.go` 的 `agent_count` 子查询写成 `user_canvas c WHERE c.tenant_id = t.id`，
但 `user_canvas` 压根没有 `tenant_id` 列（租户 id 就是 owner 的 user id，
`dao/analytics.go` 里同样拿 tenantID join `user_canvas.user_id`）。
→ MySQL `Error 1054 Unknown column`，整页打不开。

修复：改成 `c.user_id = t.id`，并在注释里写清这个约定，避免下一个人「顺手改回去」。
新增 `internal/admin/service_tenants_test.go`：在真实 schema 上建 2 租户 / 3 成员 / 3 知识库 / 4 画布，
断言 `member_count=2 / kb_count=2 / agent_count=3` —— 列名写错会在这里当场炸，而不是等线上 500。

**线上核对**（接口值 = SQL 直查值）：

| 租户 | 成员 | 知识库 | 智能体 |
|---|---|---|---|
| 's Kingdom | 1 | 1 | 18 |
| nick's Kingdom | 1 | 11 | 13 |
| liumin's Kingdom | 1 | 0 | 0 |

### P2-4 管理后台任务列表 107 秒（N+1）（`13e139c`）

`/api/v1/admin/ingestion/tasks` 不分页返回全量任务（现网 **7496 行**），
原实现对**每一行**各查一次 owner / `run_count` / 组件进度：

```
7496 × (1 owner + 1 pipeline_log + 2 progress) ≈ 2.2 万次查询 → 实测 107 s
```

浏览器与 nginx 都会先超时，用户看到的是白屏或 504。

修复：改成 4 次批量查询（新增三个 DAO 方法，返回结构与字段**完全不变**，
`ragflow-cli admin ingestion-tasks` 不用改）：

| 新增方法 | 作用 |
|---|---|
| `UserDAO.GetEmailsByIDs` | 一次取全部 owner 邮箱 |
| `PipelineOperationLogDAO.GetRunCountsByIDs` | 一次取全部 run_count |
| `IngestionTaskLogDAO.AggregateProgressByPipelineLogIDs` | 一次算全部组件进度（`MAX(id)` 按 `(run, component)` 分组，语义与单条版一致） |

顺带给 `GetAllTasks` 的 `pageSize==0` 分支补 `create_time DESC`，未分页输出也稳定。

**验证**：新增 `TestListAllForAdminQueryCountIsIndependentOfTaskCount` —— 对比
「1 个任务」与「4 个任务」的查询次数**必须相等**，并逐行校验邮箱 / run_count / 进度，
含两个边界（同一组件后写覆盖先写、有组件总数但没有 run 身份）。
线上复测：**107 s → 0.76 s**，7496 行与字段形状不变。

---

## 八、没覆盖 / 没验证的，以及为什么

| 项 | 状态 | 说明 |
|---|---|---|
| 文档解析全链路（上传 → 解析 → 分块 → 检索命中） | **未验证** | ingestor 积压 5749 个任务（他人批量导入），排不进去；只验证了空库检索（p95 59.7ms）与文档/分块接口 |
| `/admin/tenants` 浏览器端到端 | **未验证** | 前端 `dist_20261024_1032`（10:32）不含该页（11:25 才进代码）；后端已 API 级验证。下次前端发版后可复验 |
| MCP 外部服务接入 | 跳过 | 需外部可达 SSE 端点 |
| CE 企业版功能（角色 / 白名单 / 监控 / 资源配额） | 按设计跳过 | CE 包是 501 或 `not supported` 桩，断言的是「不 5xx」 |
| 多轮长对话压测 / 长稳 | 未做 | 需要 LLM 配额与更长窗口 |

---

## 九、环境与流程提醒

1. **ingestor 严重积压**：`SCHEDULED 5749 / RUNNING 2 / COMPLETED 1744`。机器 load 长时间 6–15（2 核）。
   这不是本次改动引入的，但会拖慢一切性能数字，也会让「解析类」用例排队到超时。
2. **前后端发版不同步**：后端已经跑到 `13e139c`，前端还停在 10:32 的产物。
   管理后台的租户管理页因此 404 —— 发版时要**前后端成对发**。
3. **磁盘 86%**（5.5G 可用）。本轮清掉了过期 `dist_20261024_0805`、旧备份两个（约 760M）。
   `build.sh --all` 峰值会再吃掉几个 G，留神。
4. **构建必须带 PATH**：非交互 SSH 里 `build.sh` 找不到 go，要
   `export PATH=$PATH:/usr/local/go/bin`，否则报 `go is required but not installed`。
5. **部署后按字符串验二进制**：`strings bin/ragflow_server | grep -c "<新代码特有字符串>"`，
   与新备份对比（本轮用 `user_canvas c WHERE c.user_id` 和 `load task owner`）。

---

## 十、复跑方法

四个套件在 `.tmp_qa/full/`（该目录被 `.gitignore` 忽略，属于本机脚本，未入仓）：

```bash
export NODE_PATH="/c/Users/liumin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules"

node .tmp_qa/full/api_suite.js    # 全量 API，162 项 → api_suite_result.json
node .tmp_qa/full/ui_pages.js     # 逐页扫描，41 页 + 截图 → ui_pages_result.json
node .tmp_qa/full/e2e_flows.js    # 业务链路 E2E，22 项 → e2e_flows_result.json
node .tmp_qa/full/perf.js         # 性能，9×20 串行 + 并发 1/10/30 → perf_result.json
```

登录态统一走 `.tmp_qa/lib/auth.js`（验证码 + RSA + 超管登录都在里面）。

两个 Go 回归单测：

```bash
export PATH=$PATH:/usr/local/go/bin && export TIKTOKEN_CACHE_DIR=/root/ragflow/ragflow_deps
bash build.sh --test -- ./internal/admin/   -run TestListTenantsCountsOwnedResources -v
bash build.sh --test -- ./internal/service/ -run TestListAllForAdmin -v
bash build.sh --test -- ./internal/dao/     -run TestEveryQueriedEntityIsRegisteredForMigration -v
```
