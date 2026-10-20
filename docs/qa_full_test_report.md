# RAGFlow 全量测试报告

> 测试日期：2026-10-19
> 测试对象：服务器部署版（47.99.241.190，代码版本 `bd14f2e` = 本地 `317dd1374`）
> 测试结论：**后端单元测试全绿，可交付开发专家做进一步优化**

---

## 一、测试范围与分层

| 测试层 | 执行方式 | 结果 |
|---|---|---|
| 后端单元测试 | 服务器 `build.sh --test ./internal/...` | ✅ 全部通过 |
| Native 测试 | `build.sh --test` 内置 native 测试 | ✅ 全部通过 |
| 本地纯逻辑包测试 | Windows `go test`（对照） | ✅ 全部通过 |
| API 实机探测 | curl 打三服务路由 | ✅ 正常 |
| Integration 测试 | `--test-integration`（需真实服务+测试账号） | ⚠️ 未执行（缺配置） |
| E2E 测试 | `--test-e2e`（全链路） | ⚠️ 未执行（缺配置） |

## 二、后端单元测试（核心结论：全绿）

在服务器上通过 `build.sh --test` 执行（正确设置 CGO 环境 + native 静态库），**所有 `internal/...` 包测试通过，0 失败**。

关键覆盖（全部 `ok`）：
- `internal/admin`、`internal/handler`、`internal/router`（HTTP 路由/鉴权）
- `internal/dao`（数据访问层，含 migration）
- `internal/engine/*`（elasticsearch/infinity/kvrocks/nats/oceanbase/vastbase/serenedb）
- `internal/ingestion/*`（pipeline/service/task/component/chunker/knowledge_compiler）
- `internal/parser/*`（parser/chunk/tableutil）
- `internal/deepdoc/*`（pdf/office/native，含 CGO 静态库 pdfium/pdf_oxide/office_oxide/onnxruntime）
- `internal/agent/*`、`internal/harness/*`、`internal/service/*`、`internal/syncer/*`、`internal/tokenizer`

**Native 测试**（DeepDoc det/DLA/TSR/OCR-rec Go 移植）：全部通过。

### 重要说明：正确测试入口

直接 `go test ./internal/...` 会因缺 CGO 环境而 **build failed**（`undefined reference to pdf_oxide_*`、`office_oxide.h: No such file or directory`）。这是**环境问题，不是代码缺陷**。正确入口是 `build.sh --test`，它会：
1. `setup_cgo_env` 设置 `CGO_CFLAGS`/`CGO_LDFLAGS` 指向 `/root/ragflow-native-libs/` 下的 native 静态库
2. 用 `-tags cgo,static` 编译

## 三、本地 Windows 对照测试

本地 Windows 能跑通「纯逻辑包」（无 CGO/平台依赖）：
- `internal/parser/chunk`、`internal/service/file`、`internal/utility`、`internal/entity`、`internal/storage`、`internal/permission` 全部 `ok`
- 其中 `internal/service/file` 包含上一轮修复的 `path.Base` 缺陷（`sanitizeFilename` 平台相关文件名截断），测试通过

> 本地 Windows 无法跑 CGO/平台相关包（`syscall.STILL_ACTIVE`、`newLocalProviderFromEnv` 等平台符号），这是预期，不是缺陷。

## 四、API 实机探测

三个服务全部 `active`（nginx:80、admin:9381、api:9380）。

| 探测项 | 结果 | 判定 |
|---|---|---|
| `GET /` | 200（HTML 3534B） | 前端正常 |
| `GET /api/v1/system/version` | 200，data=`bd14f2e` | 版本正确 |
| `GET /api/v1/system/config` | 200 | 公开路由正常 |
| `GET /api/v1/users/me`（未登录） | HTTP 401 | 鉴权生效 |
| `GET /api/v1/auth/login`（空体） | HTTP 200 + code:400 | 参数校验（业务 code 表达） |
| `POST /api/v1/auth/login`（错误密码） | HTTP 200 + code:109 | 密码错误（RSA 加密） |
| `GET /api/v1/admin/ping` | 200，`pong` | admin 服务正常 |
| `GET /api/v1/admin/users`（未登录） | HTTP 200 + code:401 | admin 鉴权（HTTP 200 包装） |

### 关键断言规则（供开发专家参考）

1. **api 服务（9380）**：鉴权失败返回真实 HTTP 401；业务错误返回 HTTP 200 + body `code`。
2. **admin 服务（9381）**：鉴权失败也返回 HTTP 200 + body `code:401`（与 api 服务不一致，鉴权中间件实现不同）。
3. 断言业务成功/失败看 body 的 `code` 字段，不能只看 HTTP 状态码。

## 五、未执行的测试及原因

| 测试 | 未执行原因 | 补齐方式 |
|---|---|---|
| Integration（`--test-integration`） | 需真实服务 + 测试账号 `qa@infiniflow.org`（服务器无此账号）+ 独立测试库 | 创建测试账号 + 配置 `RAGFLOW_TEST_MYSQL_DSN` 指向独立 `ragflow_test` 库 |
| E2E（`--test-e2e`） | 需完整 pipeline + LLM API key（ZHIPU/SiliconFlow） | 配置 LLM key |
| `test/api` 集成测试 | 默认连 `127.0.0.1:9380` + 登录 `qa@infiniflow.org` | 提供测试账号或 `RAGFLOW_TEST_API_KEY` |

## 六、结论与建议

1. **后端代码质量良好**：单元测试全绿，覆盖路由、鉴权、数据访问、解析、ingestion、引擎、agent、native 等核心模块。
2. **部署服务健康**：三服务运行正常，前端/API/admin 均可访问，鉴权链路正确。
3. **上一轮修复的缺陷已回归通过**：`sanitizeFilename` 的 `path.Base` 修复在服务器全量测试中通过。

### 给开发专家的优化建议

1. **admin 服务鉴权一致性**：admin 服务鉴权失败返回 HTTP 200 + code:401，api 服务返回 HTTP 401，建议统一（减少客户端适配成本）。
2. **integration/e2e 测试需补配置**：当前服务器缺测试账号和独立测试库，无法跑 integration tier。建议在 CI 或测试环境补齐，以覆盖真实服务集成场景。
3. **（上轮遗留）flaky test 加固**：`internal/harness/replay` 的 `Duration == 0` 断言在快速路径上脆弱，建议注入可测时间或放宽断言。
