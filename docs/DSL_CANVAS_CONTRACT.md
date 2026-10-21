# 画布 DSL 契约（Canvaas DSL Contract）

> 面向：接 SDK / 调 API / 写导入导出工具的同学。
> 这份文档只讲**容易被误判**的硬约定，不是完整字段手册。
> 最后更新：2026-10-21（据 QA 端到端测试暴露的隐式契约整理）

---

## 1. 顶层结构

```jsonc
{
  "graph":      { "nodes": [...], "edges": [...] },
  "components": { ... },            // 对象 map：key = 节点 id（cpn_id）
  "variables":  [],                 // 环境变量（只读 + secret）
  "globals":    {},                 // 会话变量（仅 Chatflow 有意义）
  "retrieval":  [],                 // 知识库引用快照
  "history":    [],
  "path":       []
}
```

`components` 是**对象 map**，key 是节点 id（`graph.nodes[].id`），值里
`obj.component_name` 才是组件类型（Begin/End/LLM…）。

⚠️ 写成数组会静默解析不到组件、运行直接失败（本仓库的冒烟脚本踩过一次）。
`data.label` 是渲染用的类型标识，`components[节点id].obj.component_name` 才是执行入口。

---

## 2. 节点

```jsonc
// graph.nodes[]
{
  "id": "end",
  "type": "studioNode",            // 渲染用；未知 type 会 fallback 到 ragNode
  "position": { "x": 420, "y": 200 },
  "data": {
    "label": "End",                // 组件类型标识，与 components[].obj.component_name 一致
    "name":  "End",                // 画布上显示的名字
    "form":  { }                   // 前端表单值，**不是**执行期真正读的参数
  }
}
```

⚠️ **`data.form` 只是前端表单状态**。执行期读的是 `components[].obj.params`。
两者在表单提交时同步，但**手写/程序化生成的 DSL 必须写 `components[].obj.params`**，
只写 `data.form` 不会生效。

---

## 3. End 节点的输出契约（最常踩）

> 这是 QA 端到端测试里唯一让人反复出错的点，单独拎出来。

**执行期读的是**：

```jsonc
// components["<end 节点 id>"]，其 obj.component_name == "End"
{
  "obj": {
    "component_name": "End",
    "params": {
      "outputs": {                       // ← 必须是 map
        "report":  { "type": "string", "value": "{{生成播报@result}}" },
        "channel": { "type": "string", "value": "{{begin@channel}}" }
      }
    }
  },
  "downstream": [],
  "upstream": ["begin"]
}
```

**三个硬约定**：

| # | 约定 | 说明 |
|---|---|---|
| 1 | `outputs` 必须是 **map**（`{名字: {type, value}}`） | 写成数组会被判定为"未声明输出字段" |
| 2 | 必须放在 `components[end].obj.params.outputs` | 放在节点 `data.form.outputs` 不生效 |
| 3 | 至少要有一个字段 | 空 map 发布校验会拒绝 |

**为什么容易踩**：前端 End 表单里 `outputs` 是**数组**（`[{name, type, value}]`，
方便增删行），只在**表单提交时**才转换成 map
（见 `web/src/pages/agent/form/end-form/index.tsx`）。
所以从界面复制出来的 `data.form` 和最终落库的 `params` 形状不一样。

---

## 4. Begin 节点的 mode 与形态强绑定

```jsonc
{ "obj": { "component_name": "Begin", "params": { "mode": "task" } } }
```

| 形态 | `mode` | 语义 |
|---|---|---|
| Workflow（任务流） | `"task"` | 无对话，输入从 `inputs` 取，输出走 End |
| Chatflow（对话流） | `"conversational"` | 有会话历史，输出走 Answer |
| 智能体 | `"conversational"` | 对话式，流式回答 |

`mode` 与 `canvas_category` **不一致时不会自动纠正**（避免擅自改用户数据），
只能由使用者修正。新建时后端按形态给正确种子，手写 DSL 要自己保证。

---

## 5. 发布校验规则（不满足直接拒绝发布）

| 形态 | 规则 |
|---|---|
| Workflow | 必须**恰好一个** `End` 节点 |
| Workflow | **不允许** `Answer` 节点 |
| Workflow | `End.outputs` 至少一个字段 |
| Chatflow | 至少一个**可达**的 `Answer` 节点 |
| Chatflow | **不允许** `End` 节点 |

错误信息是明确的（例：`Workflow 必须且只能有一个 End 节点（当前 0 个）`），
可以直接透给用户。

---

## 6. 运行接口的两套鉴权（别混）

| 场景 | 接口 | 鉴权 |
|---|---|---|
| 编辑器内「试运行」 | `POST /api/v1/apps/:canvas_id/debug-run` | **用户登录 token**，权限按画布 run 操作校验 |
| 发布后正式调用 | `POST /api/v1/workflows/:canvas_id/run` | **应用级 API Key**（`Authorization: Bearer <app_key>`） |

用用户 token 打 `/workflows/:id/run` 会得到 `401 APP_KEY_INVALID` —— 这不是没登录，
而是接口要的是应用密钥。

试运行支持 `Idempotency-Key`（同 key + 同画布返回首次 run），正式调用同样支持。

---

## 7. run 记录与 Tracing

| 接口 | 返回 |
|---|---|
| `GET /api/v1/runs` | run 列表 |
| `GET /api/v1/runs/:run_id` | 单次 run（status / outputs / usage） |
| `GET /api/v1/runs/:run_id/nodes` | 节点级执行记录 |

节点级记录（`agent_node_execution`）字段：
`node_id / node_type / status / duration_ms / retry_count / inputs / outputs / error_code / error_message`。

---

## 8. 节点级开关（运行时生效，界面看不出对错）

这两个是 DSL 参数，**只影响执行期**，配错了界面不会有任何提示：

```jsonc
// components[].obj.params
{
  "max_retries": 2,                 // 失败重试次数（默认 0 = 不重试）
  "error_strategy": "default_value",// none | default_value
  "error_default_value": "N/A"      // error_strategy=default_value 时的兜底输出
}
```

- 重试：指数退避 2s→30s，尊重取消。LLM / Agent **不走外层重试**
  （它们内部有独立重试循环，外层再包会乘法叠加）。
- 异常策略：`default_value` 时失败不中断流程，输出兜底值并打 `__error_fallback__` 标记；
  **取消 / 超时属控制流，不走兜底**。
