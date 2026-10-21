# 工作室（Chatflow / Workflow）全量测试 + 端到端测试报告

**测试时间**：2026-10-21 15:45–17:05
**被测版本**：`e472901ce`（含本次修复）；线上后端 `30f5dbe`、前端 `dist_20261021_1621`
**覆盖范围**：11:30 之后 16 个提交里与工作室/任务流相关的改动（119 文件 → 本批 22 前端 + 7 后端）
**环境**：`http://47.99.241.190`，E2E 账号 `qa.e2e@example.com`

---

## 一、结论

| 层级 | 结果 |
|---|---|
| 后端全量单测 | ✅ **148 个包：126 通过 / 0 失败 / 22 无测试**，EXIT=0 |
| 前端类型检查 | ✅ 203 个错误（与本批改动前一致，**零新增**） |
| 前端 lint | ⚠️ 0 error / 179 warning（本批新增 3 条 `react-hooks` 告警） |
| 前端单测 | ⚠️ 11 套件 / 18 用例红，与上午同一批，**零新增** |
| E2E · API（工作室） | ✅ **21/21** |
| E2E · UI（工作室） | ✅ **23/23** |

**共发现 1 个会导致整页崩溃的功能缺陷，已修复并上线**；另有 1 个陈旧用例被改动打红，已一并修复；
4 条建议项（含 2 个新功能零单测）。

---

## 二、本批改动的功能面

| 提交 | 内容 |
|---|---|
| `d060b0a16` | 工作室画布独立成页，与智能体彻底隔离 |
| `e2a0f955a` `694dde9fb` `28b307bbc` | 节点面板对齐原型（分组/命名/配色）、工具栏与底部运行面板 |
| `0cae2b705` | **编辑器内「试运行」接口**（`POST /apps/:id/debug-run`） |
| `a6c6a58e3` | **通用节点重试**（ND-01） |
| `580835adf` | **节点异常策略「默认值」**（ND-03 一部分） |
| `3d5c1e4ae` | HTTP 节点补全 PATCH / DELETE |
| `5644454fb` | 试运行后自动展示节点级 Tracing |
| `33792d8b2` | 节点右键菜单（CV-03） |
| `6a29ef130` | 发布版本支持备注（VER-04） |
| `bdfc67a5d` `156b239c0` | 任务流创建形态修正、创建后跳工作室画布 |

---

## 三、后端全量单测

```
$ export PATH=$PATH:/usr/local/go/bin
$ export TIKTOKEN_CACHE_DIR=/root/ragflow/ragflow_deps
$ bash build.sh --test ./internal/...
EXIT=0
ok=126  fail=0  notest=22  total=148
```

### 3.1 修复前唯一的失败：一个被改动打红的陈旧用例

```
--- FAIL: TestInvoke_BadMethod (0.01s)
    invoke_test.go:237: error "Invoke: do: Patch \"http://localhost:1\": dial tcp ...: connection refused"
    should mention invalid method
```

用例把 `PATCH` 当作「非法方法」来验证前置校验，但 `3d5c1e4ae` 已经让 HTTP 节点支持 PATCH/DELETE，
于是请求真的发出去了，断言拿到的是连接错误而不是 method 错误。

**已修**（同一次提交）：

- 把样本换成真正会被拒的 `CONNECT`；
- 新增 `TestInvoke_AcceptsExtendedMethods`，正向覆盖 PATCH / DELETE / PUT（用不可达地址证明
  "通过了方法校验、走到了网络层"）。

修后 `internal/agent/component` 整包 `ok 0.084s`，全量 148 包 0 失败。

> 这不是"测试写得不好"，而是**改了行为没同步改用例**。同类风险：这次 5 个功能提交
> （重试、异常策略、PATCH/DELETE、试运行接口、发布备注）**一个测试都没带**。

---

## 四、前端检查

- `tsc --noEmit`：**203** 个错误，与本批改动前完全一致；改动文件内仅 1 条
  （`invoke-form/index.tsx` 的隐式 any），是存量、仅行号位移。
- `oxlint src`：**0 error / 179 warning**。本批新增 3 条，都是 `react-hooks(exhaustive-deps)`：

| 文件 | 位置 | 说明 |
|---|---|---|
| `pages/agent/components/node-panel.tsx` | 117 | `useMemo` 依赖缺 `label`，搜索用到的 label 变了不会重算 |
| `pages/agent/canvas/index.tsx` | 332 | `useCallback` 依赖不全（右键菜单相关） |

  这两处都在本次新增代码里，属"能跑但可能拿到旧闭包"的隐患，建议补依赖或加注释说明。
- `jest`：11 套件 / 18 用例红，与上午同一批（jsdom 缺 `Request`/`Blob.arrayBuffer`、babel 未剥类型注解、
  夹具过期），**本批零新增**。`pages/studio/` 与 `components/list-view/` 仍是 0 测试。

---

## 五、E2E · API（21/21）

| 组 | 校验点 |
|---|---|
| 创建 | `S-01~04` 分别创建 chatflow / workflow，`canvas_category` 正确（任务流不再是"对话式"） |
| 列表 | `S-05~08` 工作室列表只含两类、按类过滤互不串 |
| Tab 计数 | `S-09~10` `/agents?type=filter` 聚合含 `workflow_canvas` / `chatflow_canvas` 且与实际条数一致 |
| 详情/更新 | `S-11~12` 详情返回 dsl；改标题生效 |
| **发布** | `S-13` 发布成功；`S-15` **备注被记录（VER-04）**；`S-17` 出现在"已发布"筛选 |
| 版本 | `S-14/16` 版本列表与详情可取；`S-18` 第二版后数量增长 |
| **回滚** | `S-19` 回滚把 DSL 恢复（用 End 输出字段名变化验证，而非标题——回滚按设计只恢复 DSL） |
| 边界 | `S-20` 不存在的画布返回 103（= 无权/不存在）；`S-21` 删除后列表不再返回 |

### 顺带确认的两条接口语义（**不是 bug**，但容易误判）

1. **`PUT /agents/:id` 会产生一个 `release=false` 的草稿版本**。所以"发布失败却有 1 个版本"是正常的，
   不是残留脏数据（实测：只创建不保存 = 0 版本；PUT 一次 = 1 版本）。
2. **发布校验会拒绝不合法的图**，且信息明确，是正确行为：
   - `Workflow 必须且只能有一个 End 节点（当前 0 个）`
   - `End 节点必须声明至少一个输出字段`
   - `Chatflow 至少需要一个可达的 Answer 节点` / `Chatflow 不允许 End 节点`

   ⚠️ 但**契约是隐式的**：`outputs` 必须是 **map**（`{result: {type, value}}`）而不是数组，
   且要写在 `components[end].obj.params` 里，不是节点 `data.form`。前端是在 End 表单提交时做数组→map 转换
   （`end-form/index.tsx:51-56`）才对齐的。建议在 DSL 文档或组件描述里写清，否则接入方必踩。

---

## 六、E2E · UI（23/23，修复后）

| ID | 校验点 | 结果 |
|---|---|---|
| U-02/03 | 工作室列表两张类型卡、Tab 带总数 | ✅ |
| **U-04** | 创建任务流后进入 `/studio/:id`（对应 `156b239c0` 的修复） | ✅ |
| U-05 / U-16 | 画布类型标识分别为「任务流」「对话流」 | ✅ |
| U-06 | 左侧节点面板可见 | ✅ |
| U-06b | 节点面板按分组（入口/出口、模型…） | ✅ |
| U-06c | 节点右键菜单可用（CV-03） | ✅ 2 项 |
| U-07 | 工具栏含 变量/版本/试运行/校验/保存/发布 | ✅ |
| U-08/09/09b | **试运行跑通**：`status=succeeded`、返回 `run_id` | ✅ |
| U-09c | Tracing 页签可切换 | ✅ |
| U-09d | 「校验」打开校验面板 | ✅ |
| **U-10** | 「版本」弹窗可打开（**修复前必崩**） | ✅ |
| U-11/12 | 发布弹窗 + 备注输入 + 发布成功（状态变「已发布」） | ✅ |
| U-13/14 | 表格视图渲染 12 行、操作列含 Run/Launch/Checklist/Version history/Publish/Log | ✅ |
| U-17 | 页面无 JS 异常 | ✅ |
| U-18 | 清理创建的画布 | ✅ |

> **试运行无需模型也能跑**：`Begin → End` 的任务流直接返回
> `{"status":"succeeded","run_id":"...","outputs":{...}}`。这给了一个不依赖 LLM 的冒烟入口，
> 建议作为发版前的固定回归用例。

---

## 七、缺陷清单

### 7.1 【P1，已修复】画布「版本」弹窗点击必崩，整页进 error boundary

**现象**：工作室画布只要**存过版本**（保存 / 试运行 / 发布都会产生版本），点顶部「版本」：

- 整页变成 `Something went wrong`；
- 弹窗打不开；
- 之后所有工具栏按钮都点不动（错误边界接管了整棵 React 树）。

没有任何接口报错、控制台也没有可见异常——生产构建下 React 不打印组件栈，所以一开始像"无声崩溃"。

**复现**：新建任务流 → 试运行（或点保存）→ 点「版本」→ 必崩。无版本时（`Total 0`）正常。

**根因**（用本地 dev 构建 + 反向代理线上 API 才拿到栈）：

```
Error: useDropdownManager must be used within DropdownProvider
    at useDropdownManager (src/pages/agent/canvas/context.tsx:9:11)
    at CommonHandle (src/pages/agent/canvas/node/handle.tsx:29:7)
    ...
```

版本弹窗用一个 `ReactFlow` 预览历史版本的 DSL（`version-dialog/index.tsx`），
预览里的节点会渲染 `CommonHandle`，它调用 `useDropdownManager()`；
而画布页只把 `DropdownProvider` 包在画布区域
（`studio/canvas/index.tsx:228-237`），`<VersionDialog>` 渲染在它外面（第 371 行），
于是预览取不到 context → 抛错 → 错误边界兜住整页。

同一个弹窗在旧智能体编辑器里没暴露，是因为那边的 Provider 包得更大。

**修复**（`e472901ce`）：让版本预览**自备** `DropdownProvider`，
弹窗不再依赖宿主页面的 Provider 包裹范围。

**验证**：

- 本地 dev 构建复现 → 打补丁 → 异常消失；
- 线上 `dist_20261021_1621` 部署后，UI E2E `U-10` 通过，弹窗正常渲染版本预览（Total 1）。

### 7.2 【P2，已修复】`TestInvoke_BadMethod` 陈旧 —— 见 §3.1

### 7.3 【P3，未修，建议】版本列表把「租户/用户 ID」直接展示给用户

版本标题由 `buildVersionTitle(nickname, title, ts)` 拼成 `昵称_应用名_时间`，
昵称为空时回退成 **userID**（`internal/service/agent.go:1418-1424`）。
E2E 账号无昵称，于是弹窗里显示：

```
aa002404815e48d19e85f9055b239630_QAU7GI 任务流_2026-10-21 16:28:51
```

32 位内部 ID 对用户毫无意义。建议：昵称为空时退化为 `应用名_时间`（版本靠 id 区分，不依赖标题唯一性）。
未改动是因为命名属产品口径，避免单方面改语义。

### 7.4 【P3，记录】新增 3 条 `react-hooks` 告警

`node-panel.tsx:117` 的 `useMemo` 漏了 `label` 依赖（搜索过滤可能用旧闭包）；
`canvas/index.tsx:332` 的 `useCallback` 依赖不全。当前未见可复现的功能异常，但属隐患。

### 7.5 【P2，工程债】本批 5 个功能提交零测试

`a6c6a58e3`（重试）、`580835adf`（异常策略）、`3d5c1e4ae`（PATCH/DELETE）、
`0cae2b705`（试运行接口）、`6a29ef130`（发布备注）**都没有带 `_test.go`**。
其中重试与异常策略是纯逻辑（`internal/agent/canvas/node_body.go`），
注入一个假组件就能单测，不需要外部依赖——建议补上，否则这类"运行时才生效"的开关只能靠手工点。

---

## 八、未覆盖项及原因

| 项 | 原因 |
|---|---|
| **含 LLM 节点的任务流执行** | 租户 `llm_id` / `embd_id` 全空，LLM 节点必然失败（`no default chat model for tenant`） |
| **对话流的试运行** | Answer 节点需要模型生成内容，同上 |
| **节点重试（ND-01）/ 异常策略默认值（ND-03）的运行时行为** | HTTP 节点有 SSRF 防护，指向内网/不可达地址会在参数校验阶段被拦下，构造不出"可重试的中途失败"；且这两处**没有单测**。建议开发者补单测或用可达的外部地址验证 |
| 节点拖拽建图、连线校验 | 依赖画布交互细节，本轮以"创建即有 Begin→End"的种子图验证主链路 |
| 前端 `pages/studio` 单测 | 该目录仍 0 测试文件 |

---

## 九、部署记录（2026-10-21 15:52–16:30）

| 项 | 内容 |
|---|---|
| 后端 | 未重新编译（本批后端改动只有测试文件；`internal/agent/component` 的修复仅影响测试） |
| 前端 | `dist_20261021_1552`（含 15:35 的任务流跳转修复）→ 随后 `dist_20261021_1621`（含版本弹窗修复） |
| 切换 | 两次均先 `nginx -t` 通过再 `kill -HUP $(pgrep -o nginx)`；入口 hash 由 `BpDIGPBr` → `BGHnAvvP` → `a-pSTsOy` 逐次变化，确认加载的确是新的 |
| 服务 | admin / ingestor / api 全部 active；healthz 五项 ok |
| 清理 | 旧 `dist` 保留最近 2 版；磁盘 82%（剩 7.1G，需关注） |

**回滚**：把 nginx root 指回 `dist_20261021_1552` 后 `kill -HUP`（前一版）。

---

## 十、给开发专家的建议（按优先级）

1. **补 `node_body.go` 里重试与异常策略的单测**（§7.5）。这是两个 P0 开关，目前零覆盖，
   而它们恰好是"只在运行时生效、界面看不出对错"的类型。
2. **修 3 条 `react-hooks` 告警**（§7.4）。尤其 `node-panel` 的 `label` 依赖，直接影响搜索过滤。
3. **版本标题不要再暴露 userID**（§7.3）。
4. **把 DSL 的 End 输出契约写进文档**（§5）：`components[end].obj.params.outputs` 且必须是 map。
   前后端靠"表单提交时转换"这种隐式约定对齐，接入方与自动化都容易踩。
5. **加一条不依赖模型的冒烟用例**：`Begin → End` 任务流 → 试运行 → 断言 `status=succeeded`。
   可以在无 LLM 环境稳定跑，性价比很高。

---

## 附：本次执行记录

| 步骤 | 方式 | 结果 |
|---|---|---|
| 后端全量 | `build.sh --test ./internal/...` | 148 包 / 0 失败（修复后） |
| 前端类型 | `npx tsc --noEmit` | 203（零新增） |
| 前端 lint | `npx oxlint src` | 179 warning / 0 error |
| 前端单测 | `npx jest --no-cache` | 11 套件 / 18 用例红（存量） |
| API E2E | `.tmp_qa/e2e_studio_api.js` | 21/21 |
| UI E2E | `.tmp_qa/e2e_studio_ui.js`（Playwright） | 23/23 |

**排障手法备忘**：生产构建吞掉了 React 组件栈（错误边界只显示 "Something went wrong"）。
可靠做法是**用本地 dev 构建 + 反向代理到线上 API** 复现——把 `vite.config.ts` 的 proxy target
改成线上地址，`vite --config` 起 dev server，Playwright 指过去，异常栈就完整了。
这套办法对以后任何"界面静默崩溃"都适用。

截图见 `docs/qa_shots/2026-10-21/`：
`shot1021_studio_canvas.png`（画布+节点面板）、`shot1021_studio_run.png`（试运行结果）、
`shot1021_studio_version_dialog.png`（修复后的版本弹窗）、`shot1021_studio_published.png`（发布成功）、
`probe_version_saved.png`（修复前的崩溃现场）。
