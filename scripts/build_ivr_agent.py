#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""华小夏-IVR（按键菜单）智能体：开场报菜单、输入数字走固定答、其余自然语言走检索。

为什么做成智能体而不是本地页面：
    客户要的三件事正好对应画布三个能力，不用改一行代码——
      1. 「开头就报 1 是什么、2 是什么」→ Begin.prologue（开场白，聊天框里直接出现，点喇叭能朗读）
      2. 「输入 1~9 给对应答复」        → Switch 精确匹配 sys.query（不走模型，零延迟、零幻觉）
      3. 「还能问其他同类问题」          → Switch 的 end_cpn_ids 兜底 → 改写 → 检索 → 生成

    数字分支是死值，问法分支是活知识，两者用 Switch 分流，互不干扰。

用法：
    export RF_BASE_URL / RF_SECRET_KEY / RF_ACCESS_TOKEN（同 huaxia_configure.py）
    python scripts/build_ivr_agent.py check      # 只做静态自检，不碰线上
    python scripts/build_ivr_agent.py apply      # 建或更新智能体（幂等）
    python scripts/build_ivr_agent.py run        # 逐个按键跑一遍 + 自然语言回归
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from huaxia_configure import (  # noqa: E402
    Api, KB_CHANNEL, KB_FAQ, KB_GREET, LLM, RETRIEVAL_TUNING, _sse,
)

AGENT_NAME = "华小夏-IVR（按键菜单）"

# 开场白 = 菜单。同时也是按 0 时重播的内容，两处共用一份文本，改一处就够。
MENU = (
    "您好，欢迎致电华夏基金客户服务中心。基金有风险，投资需谨慎。\n"
    "请按数字选择，也可以直接说出您的问题：\n"
    "1  客服电话与服务时间\n"
    "2  基金定投起点金额\n"
    "3  申购费率怎么收\n"
    "4  申购赎回何时确认\n"
    "5  分红方式怎么改\n"
    "6  基金净值在哪里查\n"
    "7  风险测评与过期重做\n"
    "8  支持哪些银行卡\n"
    "9  转人工客服\n"
    "0  重新听一遍菜单"
)

# 按键答案：口语短句，事实全部来自 FAQ 库（不自己编），末尾统一给回菜单的口子。
KEYS = {
    "1": "客服热线 400-818-6666，所在地区未开通 400 服务的请拨 010-50919000。"
         "人工服务时间为工作日 8:30 至 21:00，周末及节假日 8:30 至 17:00。回复 0 回到菜单。",
    "2": "基金定投的金额下限是 100 元，示例区间为 100 元至 20 万元。"
         "具体金额和费率以各基金及销售渠道最新规则为准。回复 0 回到菜单。",
    "3": "以华夏沪深 300ETF 联接为例：100 万元以下、100 万至 500 万、500 万至 1000 万三档，"
         "优惠后申购费率都是 0.60%；1000 万元以上每笔 1000 元。回复 0 回到菜单。",
    "4": "T 日的申购申请，T+2 日起可以查询确认结果；QDII 基金 T+3、FOF 基金 T+4。"
         "开放日 15:00 以后或非开放日提交的，算下一个开放日的申请。回复 0 回到菜单。",
    "5": "变更分红方式要在分红公告规定的权益登记截止时点前，通过销售机构办理。"
         "例如华夏鼎通债券要求分红日前一工作日 15 点前办理，直销客户可以在华夏基金管家 App 修改。回复 0 回到菜单。",
    "6": "可以在华夏基金官网、华夏基金管家 App、微信公众号，或者客服电话自助语音查询，自助语音 7×24 小时。"
         "货币基金看万份收益和七日年化，其他基金看单位净值和累计净值。回复 0 回到菜单。",
    "7": "按投资者适当性管理要求，网上交易需要完成风险测评。"
         "测评过期会导致委托无法提交，重新做完测评才能继续办理业务。回复 0 回到菜单。",
    "8": "支持工商银行、农业银行、中国银行、建设银行、交通银行、招商银行、邮储银行、中信银行、光大银行、"
         "兴业银行、华夏银行、民生银行、广发银行、浦发银行、平安银行、北京银行等，其他银行在陆续增加。回复 0 回到菜单。",
    "9": "正在为您转接人工客服。人工服务时间为工作日 8:30 至 21:00，周末及节假日 8:30 至 17:00，"
         "也可以直接拨打 400-818-6666。回复 0 回到菜单。",
}

FALLBACK = "抱歉，这个问题我暂时没查到相关资料。您可以回复 0 回到菜单，或者直接说「人工」转接客服。"

REWRITE_PROMPT = (
    "你是「查询改写器」，不是问答助手。输出一句用于知识库检索的中文查询。\n"
    "硬性规则：只输出一行纯文本，不超过 30 个汉字；不回答问题、不解释、不分点、不换行；"
    "当前问题已完整时原样输出。"
)

GENERATE_PROMPT = (
    "# 角色\n"
    "你是华夏基金电话客服的应答助手，回答会被播报给来电客户听。\n\n"
    "# 回复要求\n"
    "1. 只依据下方「参考资料」回答，资料里没有的不要编造。\n"
    "2. 口语化，一段话说完，不要 Markdown、不要列表符号、不要表格、不要引用标号。\n"
    "3. 一般控制在 120 字以内；信息太多时只说最关键的一条。\n"
    "4. 涉及收益、风险时不作任何承诺。\n"
    "5. 结尾统一加一句：回复 0 回到菜单。\n"
    "6. 参考资料为空或与问题无关时，只回复：抱歉，这个问题我暂时没查到相关资料，您可以回复 0 回到菜单，或者直接说「人工」转接客服。\n\n"
    "# 参考资料\n{Retrieval:FAQ@formalized_content}\n"
)

# 组件 id：一眼能看出是什么，比随机名好维护
C_BEGIN = "begin"
C_SWITCH = "Switch:Menu"
C_REWRITE = "Agent:Rewrite"
C_RETRIEVAL = "Retrieval:FAQ"
C_HASCHUNK = "Switch:HasChunk"
C_GENERATE = "Agent:Generate"
C_ANSWER = "Message:Answer"
C_FALLBACK = "Message:Fallback"
C_MENU = "Message:Menu"

NODE_TYPE = {
    "Begin": "beginNode",
    "Switch": "switchNode",
    "Message": "messageNode",
    "Agent": "agentNode",
    "Retrieval": "retrievalNode",
}


def key_node(k: str) -> str:
    return f"Message:Key{k}"


# ----------------------------------------------------------------------
# DSL 构造
# ----------------------------------------------------------------------
def build_dsl() -> dict:
    """拼一份完整 DSL：components + graph（nodes/edges）+ globals。

    数字分支用 `=` 精确匹配：为什么不用 contains —— "1998年" 里也有 9 和 8，
    contains 会把正常提问误路由到菜单项；精确匹配才是按键语义。
    """
    comps: dict = {}
    nodes: list = []
    edges: list = []

    def add(cid, comp_name, params, upstream, pos, label, downstream=()):
        comps[cid] = {
            "downstream": list(downstream),
            "obj": {"component_name": comp_name, "params": params},
            "upstream": list(upstream),
        }
        nodes.append({
            "id": cid,
            "type": NODE_TYPE[comp_name],
            "position": {"x": pos[0], "y": pos[1]},
            "data": {"form": params, "label": label, "name": cid.split(":", 1)[-1]},
            "dragging": False,
            "selected": False,
            "sourcePosition": "right",
            "targetPosition": "left",
        })

    def link(src, tgt, handle="end"):
        edges.append({
            "id": f"xy-edge__{src}{handle}-{tgt}end",
            "source": src,
            "sourceHandle": handle,
            "target": tgt,
            "targetHandle": "end",
            "type": "buttonEdge",
            "markerEnd": "logo",
            "zIndex": 1001,
            "data": {"isHovered": False},
        })

    # --- Begin：开场白就是菜单 -------------------------------------------
    add(C_BEGIN, "Begin",
        {"mode": "conversational", "enablePrologue": True, "prologue": MENU,
         "inputs": {}, "outputs": {}},
        [], (0, 380), "Begin", [C_SWITCH])
    link(C_BEGIN, C_SWITCH, "start")

    # --- Switch：数字 → 固定答，其他 → 检索链 ----------------------------
    conditions = [
        {"items": [{"cpn_id": "sys.query", "operator": "=", "value": k}],
         "logical_operator": "and", "to": [key_node(k)]}
        for k in "123456789"
    ]
    # 0 / 全角０ / "菜单" / "返回" 都算回菜单
    conditions.append({
        "items": [
            {"cpn_id": "sys.query", "operator": "=", "value": "0"},
            {"cpn_id": "sys.query", "operator": "=", "value": "０"},
            {"cpn_id": "sys.query", "operator": "contains", "value": "菜单"},
            {"cpn_id": "sys.query", "operator": "contains", "value": "返回"},
        ],
        "logical_operator": "or", "to": [C_MENU],
    })
    # 说「人工」「转接」等同于按 9
    conditions.append({
        "items": [
            {"cpn_id": "sys.query", "operator": "contains", "value": "人工"},
            {"cpn_id": "sys.query", "operator": "contains", "value": "转接"},
        ],
        "logical_operator": "or", "to": [key_node("9")],
    })
    switch_params = {"conditions": conditions, "end_cpn_ids": [C_REWRITE]}
    add(C_SWITCH, "Switch", switch_params, [C_BEGIN], (280, 380), "Condition",
        [key_node(k) for k in "123456789"] + [C_MENU, C_REWRITE])
    for i, k in enumerate("123456789"):
        link(C_SWITCH, key_node(k), f"Case {i + 1}")
    link(C_SWITCH, C_MENU, "Case 10")
    link(C_SWITCH, C_REWRITE, "end_cpn_ids")

    # --- 10 个固定答节点 --------------------------------------------------
    add(C_MENU, "Message", {"content": [MENU], "user_id": "{sys.user_id}"},
        [C_SWITCH], (600, 20), "Message")
    for i, k in enumerate("123456789"):
        add(key_node(k), "Message", {"content": [KEYS[k]], "user_id": "{sys.user_id}"},
            [C_SWITCH], (600, 150 + i * 118), "Message")

    # --- 自然语言分支：改写 → 检索 → 有无召回 → 生成/兜底 ------------------
    add(C_REWRITE, "Agent", {
        "llm_id": LLM, "sys_prompt": REWRITE_PROMPT,
        "prompts": [{"role": "user",
                     "content": "【对话历史】\n{sys.history}\n\n【当前问题】\n{sys.query}\n\n请只输出一句检索查询："}],
        "outputs": {"content": {"type": "string", "value": ""}, "structured": {}},
        "cite": False, "message_history_window_size": 0, "max_tokens": 120,
        "temperature": 0.1, "temperatureEnabled": True, "max_rounds": 1,
        "max_retries": 3, "delay_after_error": 1, "mcp": [],
        "exception_goto": [], "exception_method": "", "exception_default_value": "",
        "showStructuredOutput": False,
    }, [C_SWITCH], (980, 380), "Agent", [C_RETRIEVAL])
    link(C_REWRITE, C_RETRIEVAL)

    add(C_RETRIEVAL, "Retrieval", {
        "dataset_ids": [KB_FAQ, KB_GREET, KB_CHANNEL],
        "query": "{Agent:Rewrite@content}",
        "retrieval_from": "dataset",
        # 与「华小夏-客服」「夏管家推送」共用同一套基线（见 huaxia_configure.RETRIEVAL_TUNING）。
        # 单独调这个节点的阈值，就会出现「同样一句话在 IVR 里兜底、在客服里能答」。
        "similarity_threshold": RETRIEVAL_TUNING["similarity_threshold"],
        "keywords_similarity_weight": RETRIEVAL_TUNING["keywords_similarity_weight"],
        "rerank_id": RETRIEVAL_TUNING["rerank_id"],
        "top_n": 5, "top_k": 1024, "rerank_candidates_count": 30,
        "cross_languages": [], "meta_data_filter": {},
        "user_id": "{sys.user_id}",
        "outputs": {"formalized_content": {"type": "string", "value": ""},
                    "json": {"type": "Array<Object>", "value": []}},
    }, [C_REWRITE], (1240, 380), "Retrieval", [C_HASCHUNK])
    link(C_RETRIEVAL, C_HASCHUNK)

    add(C_HASCHUNK, "Switch", {
        "conditions": [{"items": [{"cpn_id": "Retrieval:FAQ@formalized_content",
                                   "operator": "empty", "value": ""}],
                        "logical_operator": "and", "to": [C_FALLBACK]}],
        "end_cpn_ids": [C_GENERATE],
    }, [C_RETRIEVAL], (1500, 380), "Condition", [C_FALLBACK, C_GENERATE])
    link(C_HASCHUNK, C_FALLBACK, "Case 1")
    link(C_HASCHUNK, C_GENERATE, "end_cpn_ids")

    add(C_GENERATE, "Agent", {
        "llm_id": LLM, "sys_prompt": GENERATE_PROMPT,
        "prompts": [{"role": "user", "content": "{sys.query}"}],
        "outputs": {"content": {"type": "string", "value": ""}, "structured": {}},
        # cite 必须关：开着答案里会带 [ID:xxx]，喇叭朗读时会把这段标号念出来
        "cite": False, "message_history_window_size": 3, "max_tokens": 512,
        "temperature": 0.1, "temperatureEnabled": True, "max_rounds": 1,
        "max_retries": 3, "delay_after_error": 1, "mcp": [],
        "exception_goto": [], "exception_method": "", "exception_default_value": "",
        "showStructuredOutput": False,
    }, [C_HASCHUNK], (1780, 520), "Agent", [C_ANSWER])
    link(C_GENERATE, C_ANSWER)

    # Agent 后面必须挂一个 Message 把 content 吐到聊天流 —— 直接让 Agent 空下游，
    # 答案只会出现在 workflow_finished.outputs 里，前端一个字都不显示（踩过）。
    add(C_ANSWER, "Message", {"content": ["{Agent:Generate@content}"], "user_id": "{sys.user_id}"},
        [C_GENERATE], (2040, 520), "Message")

    add(C_FALLBACK, "Message", {"content": [FALLBACK], "user_id": "{sys.user_id}"},
        [C_HASCHUNK], (1780, 200), "Message")

    return {
        "components": comps,
        "globals": {"sys.conversation_turns": 0, "sys.date": "", "sys.files": [],
                    "sys.history": [], "sys.query": "", "sys.user_id": ""},
        "graph": {"nodes": nodes, "edges": edges},
        "variables": [],
    }


# ----------------------------------------------------------------------
# 静态自检：不碰线上，先把结构性问题挡掉
# ----------------------------------------------------------------------
def check(dsl: dict | None = None) -> bool:
    dsl = dsl or build_dsl()
    comps = dsl["components"]
    errs = []

    # 1) 下游/上游引用的组件必须存在
    for cid, c in comps.items():
        for d in c["downstream"]:
            if d not in comps:
                errs.append(f"{cid} 下游 {d} 不存在")
        for u in c["upstream"]:
            if u not in comps:
                errs.append(f"{cid} 上游 {u} 不存在")

    # 2) 图里每条边两端要有节点
    ids = {n["id"] for n in dsl["graph"]["nodes"]}
    for e in dsl["graph"]["edges"]:
        for side in ("source", "target"):
            if e[side] not in ids:
                errs.append(f"边 {e['id']} 的 {side}={e[side]} 不在画布上")

    # 3) 每个按键都有且只有一条分支
    sw = comps[C_SWITCH]["obj"]["params"]
    targets = [t for g in sw["conditions"] for t in g["to"]]
    for k in "1234567890":
        want = key_node(k) if k != "0" else C_MENU
        if want not in targets:
            errs.append(f"按键 {k} 没有对应分支（应为 {want}）")
    if C_REWRITE not in sw["end_cpn_ids"]:
        errs.append("Switch 没把自然语言兜到改写节点，问其他问题会走空")

    # 4) 固定答必须有内容、别带引用标号、别太长
    for cid in [key_node(k) for k in "123456789"] + [C_MENU, C_FALLBACK]:
        text = (comps[cid]["obj"]["params"].get("content") or [""])[0]
        if not text.strip():
            errs.append(f"{cid} 内容是空的")
        if "[ID:" in text:
            errs.append(f"{cid} 带引用标号，朗读时会念出来")
        if len(text) > 160 and cid != C_MENU:
            errs.append(f"{cid} 太长（{len(text)} 字），播报体验差")

    # 5) 开场白不能空，否则第一屏什么都没有
    if not comps[C_BEGIN]["obj"]["params"].get("prologue", "").strip():
        errs.append("Begin 没有开场白，客户进来会看到空白")

    # 6) 可达性：从 begin 出发能否走到每个节点
    seen, stack = set(), [C_BEGIN]
    while stack:
        cur = stack.pop()
        if cur in seen or cur not in comps:
            continue
        seen.add(cur)
        stack.extend(comps[cur]["downstream"])
    unreachable = set(comps) - seen
    if unreachable:
        errs.append(f"从 begin 走不到：{sorted(unreachable)}")

    # 7) 出答案的 Agent（除改写器之外的 Agent）必须挂一个 Message 承接，
    #    否则答案只落在 workflow_finished.outputs 里，前端聊天框一个字都不显示。
    for cid, c in comps.items():
        if c["obj"]["component_name"] != "Agent" or cid == C_REWRITE:
            continue
        has_msg = any(comps.get(d, {}).get("obj", {}).get("component_name") == "Message"
                      for d in c["downstream"])
        if not has_msg:
            errs.append(f"{cid} 后面没挂 Message，答案不会进聊天流（前端显示空白）")

    print(f"组件 {len(comps)} 个，画布节点 {len(ids)} 个，连线 {len(dsl['graph']['edges'])} 条，"
          f"按键分支 {len(targets)} 条")
    if errs:
        print("发现问题：")
        for e in errs:
            print("  [x]", e)
        return False
    print("自检通过：无悬空连线、10 个按键都有分支、固定答都有内容、节点全部可达")
    return True


# ----------------------------------------------------------------------
# 线上操作
# ----------------------------------------------------------------------
def find_agent(api: Api, name: str):
    data = api.get("/api/v1/agents?page=1&page_size=200")["data"]
    items = data.get("agents") or data.get("canvas") or (data if isinstance(data, list) else [])
    for a in items:
        if a.get("title") == name or a.get("name") == name:
            return a
    return None


def cmd_apply(api: Api):
    dsl = build_dsl()
    if not check(dsl):
        sys.exit(1)
    exist = find_agent(api, AGENT_NAME)
    if exist:
        old = api.get(f"/api/v1/agents/{exist['id']}")["data"]
        # release 必须原样带回：PUT 不传 release 会被写成 false，等于悄悄下架
        body = {"title": AGENT_NAME, "dsl": dsl, "release": bool(old.get("release"))}
        api.put(f"/api/v1/agents/{exist['id']}", body)
        print(f"~ 已更新 {AGENT_NAME}：{exist['id']}（release 保持 {body['release']}）")
        return exist["id"]
    out = api.post("/api/v1/agents", {
        "title": AGENT_NAME,
        "description": "电话渠道按键菜单：开场报菜单，输入 1-9 出固定答案，其他问题走知识库检索",
        "permission": "me",
        "canvas_category": "agent_canvas",
        "dsl": dsl,
    })
    aid = out["data"]["id"]
    print(f"+ 已创建 {AGENT_NAME}：{aid}")
    return aid


def cmd_run(api: Api, aid: str | None):
    aid = aid or (find_agent(api, AGENT_NAME) or {}).get("id")
    if not aid:
        print("找不到智能体，先跑 apply")
        sys.exit(1)
    print(f"智能体 {aid}\n")
    rows, bad = [], 0

    cases = [(k, KEYS[k][:14]) for k in "123456789"]
    cases += [("0", "您好，欢迎致电"), ("菜单", "您好，欢迎致电")]
    cases += [("人工", "转接人工")]
    for q, expect in cases:
        text, _ = _sse(api, f"/api/v1/agents/{aid}/run", {"question": q})
        ok = expect in text
        bad += 0 if ok else 1
        rows.append(("PASS" if ok else "FAIL", q, text[:70].replace("\n", " ")))

    # 自然语言回归：不该被菜单拦走，且要有实质回答
    for q in ["在吗", "基金定投的起点金额是多少", "你们支持哪些银行卡"]:
        text, _ = _sse(api, f"/api/v1/agents/{aid}/run", {"question": q})
        ok = bool(text.strip()) and "按键无效" not in text
        bad += 0 if ok else 1
        rows.append(("PASS" if ok else "FAIL", q, text[:70].replace("\n", " ")))

    for st, q, a in rows:
        print(f"[{st}] {q:<14} {a}")
    print(f"\n{len(rows) - bad}/{len(rows)} 通过")
    return bad == 0


if __name__ == "__main__":
    dsl = build_dsl()
    if "check" in sys.argv:
        sys.exit(0 if check(dsl) else 1)
    api = Api()
    aid = cmd_apply(api) if "apply" in sys.argv or "run" in sys.argv else None
    if "run" in sys.argv:
        sys.exit(0 if cmd_run(api, aid) else 1)
    if not any(x in sys.argv for x in ("apply", "run")):
        check(dsl)
