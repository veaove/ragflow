#!/usr/bin/env node
/**
 * 工作室任务流冒烟用例（不依赖 LLM）。
 *
 * 价值：`Begin → End` 的图不需要模型就能跑完，是唯一在「无可用 LLM」环境下
 * 也能稳定验证的端到端链路。断言点覆盖：
 *   1. 能创建 workflow 形态的画布（canvas_category 正确）
 *   2. 编辑器内试运行接口可用，返回 status=succeeded + run_id
 *   3. 节点级执行记录落了库（Tracing 数据源）
 *   4. 清理（删掉临时画布，不污染环境）
 *
 * 用法：
 *   RAGFLOW_TOKEN=<登录返回的 access_token> node scripts/smoke_studio_workflow.mjs
 *   # 可选：RAGFLOW_BASE（默认 http://47.99.241.190:9380）
 *
 * 拿 token：
 *   curl -s -X POST $BASE/api/v1/auth/login -H 'Content-Type: application/json' \
 *        -d '{"email":"...","password":"<RSA 加密后的 base64>"}' -D - -o /dev/null | grep -i authorization
 *   （密码需按前端链路 RSA 加密；也可用浏览器登录后在 Network 里取）
 *
 * 退出码：0 全通过；1 断言失败；2 环境不满足（缺 token）
 */

const BASE = (process.env.RAGFLOW_BASE || 'http://47.99.241.190:9380').replace(/\/$/, '');
const TOKEN = process.env.RAGFLOW_TOKEN;

if (!TOKEN) {
  console.error('[smoke] 缺少 RAGFLOW_TOKEN（登录返回的 access_token）');
  process.exit(2);
}

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
};

let createdID = '';

function fail(msg) {
  console.error(`[smoke] ❌ ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function ok(msg) {
  console.log(`[smoke] ✅ ${msg}`);
}

async function api(path, init = {}) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    ...init,
    headers: { ...HEADERS, ...(init.headers || {}) },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* 非 JSON 响应，留空 */
  }
  return { status: res.status, body };
}

/**
 * 最小可运行图：Begin(task) → End(result)。
 * 形状必须与前端种子一致：
 *   - data.form.outputs 是数组（表单）
 *   - components[].obj.params.outputs 是 map（执行期 + 发布校验）
 * 详见 docs/DSL_CANVAS_CONTRACT.md
 */
function minimalWorkflowDSL() {
  const beginID = 'begin';
  const endID = 'end';
  return {
    graph: {
      nodes: [
        {
          id: beginID,
          type: 'beginNode',
          position: { x: 50, y: 200 },
          data: {
            label: 'Begin',
            name: 'Begin',
            form: { mode: 'task', prologue: '' },
          },
          sourcePosition: 'left',
          targetPosition: 'right',
        },
        {
          id: endID,
          type: 'studioNode',
          position: { x: 420, y: 200 },
          data: {
            label: 'End',
            name: 'End',
            form: { outputs: [{ name: 'result', type: 'string', value: '' }] },
          },
          sourcePosition: 'left',
          targetPosition: 'right',
        },
      ],
      edges: [
        {
          id: `xy-edge__${beginID}start-${endID}end`,
          source: beginID,
          sourceHandle: 'start',
          target: endID,
          targetHandle: 'end',
        },
      ],
    },
    // components 是对象 map（key = 节点 id），不是数组。
    components: {
      [beginID]: {
        obj: { component_name: 'Begin', params: { mode: 'task' } },
        downstream: [endID],
        upstream: [],
      },
      [endID]: {
        obj: {
          component_name: 'End',
          params: { outputs: { result: { type: 'string', value: '' } } },
        },
        downstream: [],
        upstream: [beginID],
      },
    },
    variables: [],
    globals: {},
    retrieval: [],
    history: [],
    path: [],
  };
}

async function cleanup() {
  if (!createdID) {
    return;
  }
  try {
    await api(`/agents/${createdID}`, { method: 'DELETE' });
    console.log(`[smoke] 已清理临时画布 ${createdID}`);
  } catch (e) {
    console.warn(`[smoke] 清理失败（可手工删除 ${createdID}）: ${e.message}`);
  }
}

async function main() {
  const title = `smoke-workflow-${Date.now()}`;

  // 1. 创建
  const created = await api('/agents', {
    method: 'POST',
    body: JSON.stringify({
      title,
      dsl: minimalWorkflowDSL(),
      canvas_category: 'workflow_canvas',
    }),
  });
  if (created.body?.code !== 0) {
    fail(`创建失败: ${JSON.stringify(created.body)}`);
  }
  createdID = created.body?.data?.id;
  if (!createdID) {
    fail('创建返回里没有 id');
  }
  ok(`创建任务流 ${createdID}`);

  // 2. 形态正确
  const detail = await api(`/agents/${createdID}`);
  const category = detail.body?.data?.canvas_category;
  if (category !== 'workflow_canvas') {
    fail(`canvas_category = ${category}，期望 workflow_canvas`);
  }
  ok(`形态正确（${category}）`);

  // 3. 试运行（用户身份，不依赖 app key / LLM）
  const run = await api(`/apps/${createdID}/debug-run`, {
    method: 'POST',
    body: JSON.stringify({ inputs: {} }),
  });
  if (run.body?.code !== 0) {
    fail(`试运行失败: ${JSON.stringify(run.body)}`);
  }
  const runData = run.body?.data;
  if (runData?.status !== 'succeeded') {
    fail(`run status = ${runData?.status}，期望 succeeded`);
  }
  if (!runData?.run_id) {
    fail('run 响应里没有 run_id');
  }
  ok(`试运行成功 status=succeeded run_id=${runData.run_id}`);

  // 4. 节点级记录（Tracing 数据源）
  const nodes = await api(`/runs/${runData.run_id}/nodes`);
  const nodeList = nodes.body?.data;
  if (!Array.isArray(nodeList) || nodeList.length === 0) {
    fail(`节点执行记录为空: ${JSON.stringify(nodes.body)}`);
  }
  ok(`节点执行记录 ${nodeList.length} 条（Tracing 可用）`);

  // 5. 发布（验证 End outputs 契约：种子自带 result 字段，应可直接发布）
  const published = await api(`/agents/${createdID}/publish`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (published.body?.code !== 0) {
    fail(`发布失败（End 输出契约可能未满足）: ${JSON.stringify(published.body)}`);
  }
  ok('发布成功（End outputs 契约满足）');
}

main()
  .catch((e) => {
    if (process.exitCode !== 1) {
      console.error(`[smoke] ❌ 异常: ${e.message}`);
      process.exitCode = 1;
    }
  })
  .finally(async () => {
    await cleanup();
    const code = process.exitCode ?? 0;
    console.log(code === 0 ? '\n[smoke] 全部通过' : '\n[smoke] 存在失败项');
  });
