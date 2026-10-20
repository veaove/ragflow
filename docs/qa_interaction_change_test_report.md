# 全量测试 + 端到端测试报告

**被测变更**：《交互调整说明 —— 智能体 / 工作室》v1.0（入口与创建交互）
**测试时间**：2026-10-20
**测试对象**：`47.99.241.190` 线上部署（前端 dist_20261020_170906）+ 服务器源码 `017243da9`
**规格文档**：`docs/交互调整说明_智能体与工作室.md`
**原型**：`docs/prototypes/Dify_Chatflow_Workflow_原型.html`

---

## 一、结论

| 层级 | 结果 | 说明 |
|---|---|---|
| 后端全量单测 | ✅ **126 包通过 / 0 失败** | 原本 8 个用例红，已定位为真实测试夹具缺陷并修复 |
| 前端类型检查 | ⚠️ 207 个错误 | 其中 **1 个本次新增**（死代码），其余 206 个为既有 |
| 前端 lint | ✅ 0 error / 176 warning | `src/pages/studio/` **0 告警** |
| 前端单测 | ⚠️ 124/136 套件通过 | 12 套件 19 用例失败，**全部为既有环境/夹具问题**，与本次改动无关（已用基线回退验证） |
| E2E · API 层 | ✅ **12/12 通过** | 创建/字段/筛选/分页/搜索/聚合/排序 |
| E2E · UI 层 | ⚠️ **55/60 通过** | 5 项失败：1 项真实功能缺口 + 3 项规格偏差 + 1 项可测性缺陷 |

**总体判断**：核心链路可用，可以继续推进。有 **1 个真实功能缺口**（智能体列表缺视图切换）需要开发补；
**3 处规格与实现不一致**需要产品或开发确认后二选一；另有 1 处死代码导致 `tsc` 报错，顺手可清。

---

## 二、测试环境

| 项 | 值 |
|---|---|
| 部署地址 | `http://47.99.241.190`（nginx root → `/root/ragflow/web/dist_20261020_170906`） |
| 服务器源码 | `/root/ragflow`，HEAD `017243da9`，工作区干净 |
| 后端测试入口 | `bash build.sh --test ./internal/...`（**必须走 build.sh**，裸 `go test` 缺 CGO 环境） |
| 后端环境变量 | `PATH=$PATH:/usr/local/go/bin`、`TIKTOKEN_CACHE_DIR=/root/ragflow/ragflow_deps` |
| E2E 账号 | `qa.e2e@example.com`（普通用户 `is_superuser=0`，主 API 可用） |
| 测试工具 | Playwright 1.64.1（Chromium headless），Node 22.22.2 |

---

## 三、后端全量单测

```
$ export PATH=$PATH:/usr/local/go/bin
$ export TIKTOKEN_CACHE_DIR=/root/ragflow/ragflow_deps
$ bash build.sh --test ./internal/...
EXIT=0
ok 包:   126
无测试:  22
FAIL:    0
```

覆盖范围：`internal/...` 全部包，含 `dao`、`service`、`handler`、`router`、
`ingestion/*`、`agent/*`、`harness/*`、`deepdoc/*`、`engine/*`、`syncer`、`tokenizer`。

### 3.1 修复的 8 个失败（真实缺陷）

首轮跑出 8 个红：`internal/dao` × 5、`internal/service` × 3，报错统一为

```
SQL logic error: no such table: user / user_canvas_version / agent_run
```

**根因**：`UserCanvasDAO.ListByIDs` 改成 `LEFT JOIN user` 并用子查询取
`user_canvas_version` 的最大版本号、`agent_run` 的最大运行时间（运行日志页需要），
但两处测试 DB 的 `AutoMigrate` 没跟上，只建了 `user_canvas` 一张表。

**修复**（提交 `017243da9`）：

- `internal/dao/user_canvas_test.go`：`setupUserCanvasTestDB` 一次迁移
  `user_canvas` / `user` / `user_canvas_version` / `agent_run` 四张表；
- 同步删除 4 处针对 `user` 的重复 `AutoMigrate`（表已由 helper 建好，
  SQLite 上二次迁移会报 `no such column: is_anonymous/is_superuser`）；
- `internal/service/agent_test.go`：`setupAgentSessionServiceTest` 补 `agent_run`
  （`ListAgents` 的 `last_run_time` 子查询依赖它）。

修复后 `dao`、`service` 两个包转绿，全量 0 失败。**注意**：这不是"测试写得不好"，
而是新增 SQL 依赖了 4 张表却没同步测试夹具 —— 后续任何新增 JOIN/子查询都要同步改夹具。

---

## 四、前端静态检查与单测

### 4.1 类型检查（`tsc --noEmit`）

**207 个错误**（基线 206，本次 **+1**）。本次新增的那 1 个已定位：

```
src/services/agent-service.ts(31,3): error TS6133: 'listRuns' is declared but its value is never read.
```

**原因**：`agent-service.ts` 第 31 行从 `api` 解构了 `listRuns`，但第 74 行用的是
`api.listRuns`（没走解构变量），于是解构出来的绑定成了未使用变量。
**修法（二选一）**：删掉第 31 行的 `listRuns,`，或把第 74 行改成 `url: listRuns,`。

其余 206 个错误分布在 `agent-log-page.tsx`、`agent-templates.tsx`、
`builtin-pipeline-*.test.tsx`、`knowledge-service.ts`、`utils/__tests__/*` 等
**本次未改动的文件**，属历史存量。

### 4.2 Lint（`oxlint src`）

```
Found 176 warnings and 0 errors.  (1516 files)
```

- `src/pages/studio/`：**0 告警**（8 个源文件全部干净）
- `src/pages/agents/`：仅 2 条（`use-export-agent-log.ts` 的 console、`agent-dropdown.tsx` 的类型断言），均为存量

### 4.3 单测（`jest`）

```
Test Suites: 12 failed, 124 passed, 136 total
Tests:       19 failed, 955 passed, 974 total
```

12 个失败套件逐条归因，**没有一个是本次改动引入的**：

| # | 套件 | 根因 | 归类 |
|---|---|---|---|
| 1 | `components/__tests__/switch-fom-field` | 点 label 不触发 radix Switch，`data-state` 仍 unchecked | jsdom 事件模型限制 |
| 2 | `components/highlight-markdown` | `constants/markdown-rehype-plugins.ts` 的 `export` 未被 babel 转译 | jest transform 配置 |
| 3 | `hooks/logic-hooks-use-scroll-to-bottom` | `ReferenceError: Request is not defined`（`routes.tsx` 模块级 `createBrowserRouter`）+ jsdom 无 `overflowAnchor` | 环境缺 polyfill |
| 4 | `pages/agent/hooks/use-save-graph` | 同上，`Request is not defined` | 环境缺 polyfill |
| 5 | `pages/agent/utils/pipeline-connection` | `isSingleInstanceOperator` / `buildPipelineNextOperators` 断言不符 | 夹具过期 |
| 6 | `pages/dataset/.../use-manage-values-modal` | `Cannot transform the imported binding "IManageValuesProps"` | babel 未剥类型注解 |
| 7 | `setting-model/instance-card/models-section/hooks` | `TypeError: Cannot read properties of undefined (reading 'Text')` | 循环依赖导致 `FormFieldType` 未定义 |
| 8 | `setting-model/.../local-llm-configs` | FunASR 默认 URL 与断言不一致 | 夹具过期 |
| 9 | `utils/__tests__/chat` | `preprocessLaTeX` 5 条断言不符 | 夹具过期 |
| 10 | `utils/__tests__/file-util` | `new Blob().arrayBuffer()` jsdom 不支持 | 环境限制 |
| 11 | `utils/__tests__/llm-util` | `addTenantParams` 清空 rerank 模型 id 的断言不符 | 夹具过期 |
| 12 | `utils/__tests__/source-locate` | 期望 `docx` 不支持，实际已支持 | 夹具过期（实现已扩） |

**"与本次改动无关"的证据**（两条独立验证）：

1. `git log 374cf58d6..HEAD -- <12 个测试文件>` 全部为 **0** —— 这些测试文件本次一行没动；
2. 把本次改动涉及的 3 个共享文件（`hooks/logic-hooks.ts`、`hooks/route-hook.ts`、
   `routes.tsx`）**回退到基线 `374cf58d6`** 后重跑第 3、4 号套件，仍然报
   `ReferenceError: Request is not defined` —— 说明 `routes.tsx` 模块级
   `createBrowserRouter` 这个崩溃点在改动前就存在（基线 `routes.tsx:497` 同样有）。
   验证完已恢复改动版本，工作区干净。

> 说明：曾尝试用 `git worktree` 建基线副本整批对比，但 worktree 里 jest 的 babel
> transform 配置失效（所有套件报 `Cannot transform ... type annotation`），
> 对比结论不可信，已废弃该路径。

### 4.4 新模块测试覆盖

`src/pages/studio/` 共 **8 个源文件、0 个测试文件**。

```
create-studio-dialog.tsx  index.tsx  list-sort-filter.tsx  runs-page.tsx
studio-table.tsx  studio-type-tab.tsx  use-studio-type-filter.ts  view-toggle.tsx
```

整个工作室模块（列表、Tab、视图切换、创建弹窗、运行日志页）**没有任何前端单测**。
这一层目前完全靠本次的 UI E2E 兜底，回归风险偏高。

---

## 五、端到端测试

### 5.1 API 层：12/12 通过

| ID | 校验点 | 结果 |
|---|---|---|
| F-02 | 列表返回 `release`（状态列数据源） | `release=false` ✅ |
| F-03 | 列表返回 `latest_version_seq`（版本列） | `0` ✅ |
| F-04 | 从未运行时 `last_run_time` 省略 | 字段被省略 ✅ |
| F-05a | `release=true` 只返回已发布 | 0 条（全为草稿）✅ |
| F-05b | `release=false` 只返回草稿 | 6/6 ✅ |
| F-06 / 06b | `page_size=8` 生效、第 2 页可翻 | 6 条 / 0 条 ✅ |
| F-07 | 关键词匹配名称 | 命中 1 条 ✅ |
| F-08 | **搜索不匹配描述**（规格 3.3） | 描述含 "E2E seed"，命中 0 条 ✅ |
| F-08b | 搜索匹配名称子串 | 关键字 `W4` 命中 1 条 ✅ |
| F-12 | 分类聚合（Tab 计数数据源） | `agent_canvas:1, chatflow_canvas:1, workflow_canvas:4` ✅ |
| F-13 | 按创建时间升/降排序 | 双向正确 ✅ |

### 5.2 UI 层：55/60 通过（Playwright）

覆盖侧边栏、工作室列表/创建弹窗/运行日志、智能体列表/拆分按钮/创建弹窗。

**通过项摘要**：

- **侧边栏**：工作室入口存在、位于智能体之后、文案正确、智能体入口未动
- **工作室列表**：两张类型卡（对话流 / 任务流）齐备；卡片含"是什么 / 图长什么样 / 创建对话流 →"三段说明；
  hover 时提示从 `opacity:0 → 1`；三个类型 Tab 带总数（`全部 5 / 任务流 4 / 对话流 1`）
- **搜索**：无结果提示 `No app matches "__no_such_app_zzz__"`；**Tab 计数搜索前后完全一致**（规格 3.3 的核心要求）
- **视图切换**：切表格写入 `localStorage['ragflow:list-view-mode']=table`，刷新后保持；
  表头为 `Name / Type / Status / Version / Last run / Updated / Action`，与规格 7 列一致
- **创建弹窗**：点类型卡能打开且**按点击预选**对应类型（Chatflow 卡带选中勾）；
  含"类型不可更改"说明、含归属兜底提示（`Ingestion pipeline`）；
- **运行日志**：搜索 + 触发方式 + 状态 + 排序四个控件齐备；表头
  `Run ID / App / Trigger / Status / Duration / Tokens / Started at`，5 条数据行
- **智能体列表**：`创建应用` 主按钮 + 箭头拆分；下拉为
  `Create from blank / Create from template / Import JSON file ─── Compilation operator`，
  **编译算子已被分隔线独立**，下拉里不再出现 Chatflow / Workflow；
  创建弹窗**只余 2 张卡**（Agent canvas / Ingestion pipeline），无未翻译 key、无置灰项、无竖排
- **运行时**：控制台无 JS 异常，除未登录探针外无 4xx/5xx

---

## 六、缺陷与偏差清单

### P1 · 智能体列表缺「卡片 / 表格」视图切换（真实功能缺口）

规格第三节明确要求"**两个页面都加**「卡片 / 表格」分段开关"，§3.2 还要求"两个页面共用一个偏好"。

实测：`ViewToggle` 只接入了工作室页。

```
grep -rn "ViewToggle" src/ → 仅 src/pages/studio/index.tsx:32,110
grep -rn "useListViewPreference" src/ → 仅 studio/index.tsx:33,54
```

`src/pages/agents/index.tsx`（432 行）里没有任何 `viewMode` / 表格渲染，
因此规格要求的智能体表格列（`名称·类型·标签·状态·上次保存·操作`）也无从出现。
智能体页的**搜索、排序、发布状态筛选、分页（12/页、8-12-24-48）都已到位**，只缺视图切换这一块。

> 影响：智能体应用多起来时无法横向比对状态/上次保存时间——正是 §3.2 说表格要解决的场景。

### P2 · 工作室创建弹窗缺「图标」与「起步模板」控件

规格第三节列的工作室弹窗要素是"名称、**图标**、描述、**起步模板**"。
实测弹窗只有：两张类型大卡 + "类型不可更改"说明 + 名称输入 + 描述输入 + 归属提示。

- **图标**：无选择控件（类型卡上的 lucide 图标是卡片装饰，不是应用图标）
- **起步模板**：无选择控件。代码里是按类型写死一张空图
  （`create-studio-dialog.tsx:70` 注释："chatflow 走 agent 形态的空图…workflow 同理"），
  相当于 §4.2 第 2 点"起步模板随类型联动"的默认值，但不是用户可选的模板列表

> 需产品确认：本期是否必须做模板选择器？若不做，建议把规格§三的"图标、起步模板"改成"按类型默认"，
> 避免验收时口径不一致。

### P2 · 规格自身冲突：弹窗到底 2 张卡还是 4 张卡

- **§二（调整方案）**：创建智能体弹窗 → **2 类**，"智能体流程 / Ingestion pipeline"
- **§6.1（已定 decisions）**：移出编译算子后"弹窗正好是 **4 个**：2 个原生 + 2 个新增"

实现选了 §二（2 张卡），代码注释写的是"只保留两个原生项（产品文档 6.1 定稿）"——
即开发把 §6.1 当成了最终口径，但 §6.1 的字面结论恰好相反。

> 建议：把 §6.1 里"弹窗正好是 4 个"改为"弹窗 2 个原生项，新增两项落在工作室"，与 §二 对齐。
> 这是文档问题不是代码问题，但留着会让后续验收/交接反复扯。

### P2 · "搜索框带 × 一键清空" 未实现

规格 §3.3 要求搜索"带 `×` 一键清空"。实测 `SearchInput` 只有前置搜索图标：

```
src/components/ui/input.tsx  SearchInput  →  placeholder + prefix={<Search/>}，无 clear 按钮
src/components/list-filter-bar/index.tsx:155  →  <SearchInput value onChange role="searchbox"/>
```

空结果时的"清空按钮"也没有——工作室空态只给了 `studio.noMatch` 文案 + 通用空卡片
（那个卡片点击是"去创建"，不是"清空搜索"）。

### P3 · 视图切换的 `data-testid` 未透传到 DOM（可测性）

`view-toggle.tsx` 给 `Segmented` 传了 `data-testid="list-view-toggle"`，但
`src/components/ui/segmented.tsx` 的渲染根 `div` 没有展开 `...rest`，属性被丢弃。
实测 `document.querySelectorAll('[data-testid="list-view-toggle"]').length === 0`。

> 影响：自动化与 E2E 只能靠文案定位（本次已改为按按钮名匹配才能跑通）；
> 建议 `Segmented` 根节点透传 `...rest`，或显式加 `data-testid` prop。

### P3 · `agent-service.ts` 死代码导致 `tsc` 新增 1 个错误

见 §4.1。删一行即可。

### P3 · 侧边栏工作室「新增」徽标已移除，但规格未同步

规格第三节写"工作室（新增，带「新增」标记）"。实测不存在——提交
`e3a98277e fix(web): 去掉内容区顶部的重复 logo 与工作室「新增」徽标` 主动移除了它。

> 属于实现先行、文档未回写。建议在规格里补一句"上线后不再带新增徽标"。

### 观察项 · `last_run_time` 为 `omitempty`

从未运行过的应用，接口**不返回** `last_run_time` 键（nil + omitempty），不是返回 `0`。
前端必须以 `undefined` 判断，不能写 `== 0`。当前 `studio-table.tsx` 按 `undefined` 处理，正确。
后端 BPE 校准那条用例也印证了同一模式（`OwnTokenMax` 静默返回 0）。

---

## 七、未执行项

| 项 | 原因 | 启用方式 |
|---|---|---|
| `build.sh --test-integration` | 需真实 MySQL/Redis/MinIO/ES 全栈 + 测试账号 `qa@infiniflow.org` | 服务器上补账号后 `bash build.sh --test-integration` |
| `build.sh --test-e2e` | 全链路需真实 LLM key | 配 key 后 `bash build.sh --test-e2e` |
| 前端 `storybook` 视觉回归 | 项目未接入视觉基线 | 需先建基线快照 |
| 分页页码省略号 UI 实测 | 当前数据量 6 条 < 12 条/页，凑不出 >7 页 | 代码级确认：`RAGFlowPagination` 实现 `maxDisplayedPages` + `ellipsis`，调用方传 `LIST_MAX_DISPLAYED_PAGES=7` |
| 搜索重置到第 1 页 UI 实测 | 同上，无第 2 页可退回 | 代码级确认：`useHandleSearchChange` 内 `setPagination({ page: 1 })` |

---

## 八、给开发专家的优化建议（按性价比排序）

1. **补智能体列表的视图切换**（P1）。`StudioTable` 已存在，抽成共享组件给两页复用，
   `ViewToggle` + `useListViewPreference` 直接接上即可，偏好天然共用。
2. **清 `agent-service.ts:31` 的 `listRuns` 死代码**（P3，1 行）。让 `tsc` 回到 206 不增长。
3. **`Segmented` 透传 `rest` props**（P3）。一处改动，让所有带 testid 的分段控件可被自动化定位。
4. **补工作室模块单测**（P1 工程债）。8 个文件 0 测试，优先覆盖
   `use-studio-type-filter`（Tab 过滤）、`use-list-view-preference`（持久化）、
   `list-sort-filter`（排序/筛选参数拼接）——这三个是纯逻辑，最容易测也最容易改坏。
5. **修 12 个存量失败套件**（与本变更无关，但拖低整体可信度）。最快见效的是给 jest 环境
   加 `Request`/`Blob.arrayBuffer` polyfill，一次性解决 3、4、10 号；
   其余是夹具过期，按实现更新断言即可。
6. **文档回写**：§6.1 的"4 个卡片"改 2 个；§三 的"新增徽标"和"图标/起步模板"按实际实现调整。

---

## 附：本次相关的提交与同步

| 提交 | 内容 |
|---|---|
| `017243da9` | test(dao,service): 补齐 ListByIDs 关联表迁移，修复 SQLite 缺表失败（本次新增） |
| `e3a98277e` | fix(web): 去掉内容区顶部的重复 logo 与工作室「新增」徽标 |
| `a78d7780b` | fix(studio): 修复实测反馈的 6 个 UI 缺陷 |
| `2a08f5e51` | test(dao): 补运行日志列表的筛选与排序单测 |

同步状态：本地 `main` == `origin/main`（gitee），服务器已 `git pull --ff-only` 到 `017243da9`，工作区干净。

> 注：服务器与本地之间曾出现"CRLF 伪差异"（`git status` 报 `M`，`--ignore-cr-at-eol` 才是真差异）。
> 判定方式：`git diff --ignore-cr-at-eol --stat`，空则纯行尾差异；有输出才是真改。
> 另：服务器 SSH 非登录 shell 不带 `/usr/local/go/bin`，跑 `build.sh` 前必须手动 `export PATH`。
