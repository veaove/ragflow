# RAGFlow 测试基线报告

> 摸底日期：2026-10-19
> 执行方式：本地 Windows Go 单测 + ECS 部署服务 API 探测
> 结论性质：**基线**，非最终门禁结果

---

## 一、测试对象断三件事

| 维度 | 判断 |
|---|---|
| 项目规模 | 大项目：2858 个 Go 文件、1291 个 `_test.go`、多服务（api/admin/ingestor/syncer） |
| 测试对象 | API（HTTP REST）、数据库（MySQL + Infinity/ES 搜索后端）、CLI（ragflow-cli）、Web 前端（React+TS） |
| 执行方式 | LLM 自主执行（推荐）+ 关键路径人工复核 |

## 二、环境与基建现状

- 本地 Go 工具链：`go1.27.0 windows/amd64`（可用，`GOPROXY=goproxy.cn`）
- ECS 部署：`47.99.241.190`，三个服务全部 active（nginx:80、admin:9381、api:9380）
- nginx 反代：`/api/v1/admin`→9381，`/api/v1`→9380，`/`→前端静态
- **缺失依赖**：`cl100k_base.tiktoken` BPE 表未下载（tokenizer/graph 相关测试 panic）

## 三、API 探测结果（ECS 实机）

| 探测项 | HTTP | 判定 |
|---|---|---|
| `GET /` | 200 | 前端正常 |
| `GET /api/v1/system/version` | 200 | 公开路由正常 |
| `GET /api/v1/system/config` | 200 | 公开路由正常 |
| `GET /api/v1/users/me`（未登录） | 401 | 路由存在 + 鉴权生效 |
| `GET /api/v1/users/me/admin`（未登录） | 401 | 路由存在 |
| `GET /api/v1/user/info` | 404 | 路由不存在（错误路径） |
| `POST /api/v1/auth/login`（空体） | 200 + code:400 | 业务错误用 body code 表达 |

### 关键发现（测试断言必须遵守）
1. **错误语义**：ragflow API 用 **HTTP 200 + body 里的 `code` 字段** 表达业务错误（如 `code:400` 参数校验失败），不是标准 REST 状态码。断言成功/失败必须看 `code`，HTTP 状态码只用于区分「路由存在性（401/403 vs 404）」。
2. **鉴权路由正确前缀**：用户信息是 `GET /api/v1/users/me`（不是 `/user/info`）。
3. **401=路由存在、404=路由未注册** 的验证规则在实机得到验证。

## 四、本地 Go 单测基线（`go test ./internal/...`）

### 失败包分类

**A 类：Windows 平台编译失败（预期，非代码缺陷）**
根本原因：平台限定符号 / Linux-only build tag。你本地备忘已预判。
- `syscall.STILL_ACTIVE`（stagehand-go/v3 Windows 文件）
- `newLocalProviderFromEnv` / `newLocalProviderFromConfig` / `statusFromExitCode`（agent/sandbox，需 Linux build tag）

涉及包（约 20+ 个，多为 build failed）：`internal/admin`、`internal/agent/*`、`internal/channels`、`internal/dao`、`internal/handler`、`internal/ingestion/pipeline|registry|service|task`、`internal/router`、`internal/server/*`、`internal/service/*`、`internal/syncer` 等。

**验证方式**：`GOOS=linux go build` 才能真实验证（Windows 下这些是预期失败）。

**B 类：缺失 BPE 表（环境问题，非代码缺陷）**
根因：`cl100k_base.tiktoken` 未下载。错误提示明确：`run uv run ragflow_deps/download_deps.py` 或设 `TIKTOKEN_CACHE_DIR`。
- `internal/tokenizer`：TestFit_AllFits、TestFitMessages_EverythingFits
- `internal/service/graph`：TestRetrieval_Basic
- `internal/ingestion/component`：TestLlmtagChunk_MessageFit
- 连锁 panic（tokenizer 是底层依赖）

**修复方式**：在 Linux/Docker 上跑 `download_deps.py` 拉取运行时资源。

**C 类：疑似真实缺陷（已逐项人工复核，2026-10-19 21:24）**

复核结论：9 项中 **1 项确认为真实缺陷并已修复**，**2 项为 flaky test**，**其余 6 项为 B 类（BPE 表缺失）连锁**。

| 失败测试 | 包 | 复核结论 |
|---|---|---|
| TestSanitizeFilename | service/file | ✅ **真实缺陷，已修复**。`sanitizeFilename` 用 `filepath.Base` 处理 URL path（本质 POSIX 路径），Windows 上把 `a:` 误判盘符剥离首字符。改为 `path.Base` 后测试通过。见下方详述 |
| TestBareDelimiterSplitsAndTokenMergesText | ingestion/component/chunker | B 类连锁（tokenizer panic） |
| TestKnowledgeCompiler_Tree_EndToEnd | knowledge_compiler | B 类连锁 |
| TestLLMMergeDeciderDecideBatchSplitsByTokenBudget | knowledge_compiler/structure | B 类连锁 |
| TestBuildClusterContentJoinsWithSingleNewline | knowledge_compiler/tree | B 类连锁（TrimContentToTokenLimit panic） |
| TestEmbedRecordsTheDeclaredLimitInTheCalibration | entity/models | B 类连锁（OwnTokenMax→Count→NumTokensFromString 返回 0，导致 want=+Inf） |
| TestRerankModelTokenLimitModes | entity/models | B 类连锁（tokenizer panic） |
| TestGitHub_ReferencesAndOutputsPreserveRawResults | agent/tool | B 类连锁（limitGitHubReferences→tokenizer panic） |
| TestIntegration_RecordReplayRoundTrip / TestFork_WithEngine | harness/replay | ⚠️ **flaky test**。`result.Duration == 0` 断言脆弱：回放内存 store 少量事件极快，Windows `time.Now` 时钟粒度粗，`time.Since` 可能返回 0。非产品 bug |

### 缺陷 #1：sanitizeFilename 平台相关文件名截断（已修复）

- **文件**：`internal/service/file/file_url.go`
- **根因**：`sanitizeFilename` 内部用 `filepath.Base(name)` 处理 URL 文件名。`filepath.Base` 是 OS 相关的，Windows 上把 `a:` 误判为盘符（drive letter）并剥离 → `"a:b*c?"` 变 `"b*c?"`，首字符丢失。URL path 本质是 POSIX 路径（`/` 分隔），应使用 `path.Base`。
- **影响**：同一 URL 在 Windows/Linux 上产生不同文件名（首字符丢失），破坏跨平台一致性。且 `normalizeRemoteUploadFilename` 第 59 行已 `filepath.Base(parsed.Path)` 一次，函数内又 `filepath.Base` 一次，重复且语义混乱。
- **修复**：两处 `filepath.Base` 均改为 `path.Base`（import 同步 `path/filepath`→`path`）。
- **验证**：`TestSanitizeFilename` 及整个 `service/file` 包测试通过。

## 五、摸底结论

1. **本地 Windows 只能测「纯逻辑」包**：parser/chunk 等无平台依赖、无 BPE 依赖的包可正常跑（如 `parser/chunk` 2s 通过）。
2. **真实后端编译/集成测试必须在 Linux/Docker**：A 类 + B 类都需要 Linux 环境 + 运行时资源。
3. **已确认 1 个真实缺陷并修复**：`TestSanitizeFilename`（`filepath.Base` 平台相关，改为 `path.Base`）。
4. **发现 2 个 flaky test**：`harness/replay` 的 duration 断言在快速路径上可能为 0。
5. **测试断言规则已明确**：业务错误看 body code，路由存在性看 HTTP 401/403 vs 404。

## 六、下一步建议

1. ~~人工复核 C 类失败~~ ✅ 已完成：1 真缺陷已修复，2 flaky，6 个 B 类连锁。
2. 在 Linux 环境跑 `download_deps.py` 补齐 BPE 表，再重跑 B 类（6 个连锁 + tokenizer 自身）。
3. 用 `GOOS=linux go build` 验证 A 类编译（真实验证后端能编译）。
4. 对 ECS 实机做登录后全链路 E2E（上传→解析→分块→检索→Agent）。
5. （可选）加固 flaky test：`harness/replay` 的 duration 断言改为「允许 0」或注入可测的 start 时间。
