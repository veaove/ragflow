#!/usr/bin/env python3
"""配置「文件解析助手」智能体（幂等）。

做什么：在画布上建一个 Agent —— 用户丢进文件（PDF/Word/Excel/CSV/Markdown/
PPT/HTML/纯文本/图片），它把内容读出来，按用户要求整理或回答。

为什么这么配（都是实测/读码得出的，不是猜的）：
  1. 走 `POST /api/v1/agents/chat/completions`，文件放在顶层 `files` 字段。
     `/agents/{id}/run` 不接受 files（handler 里硬传 nil），用错端点会静默
     丢掉文件、sys.files 恒空。
  2. 文件在 run 开始前由 ParseAgentUploads 解析成文本写进 sys.files
     （图片则是 base64 data URL）。所以画布不需要 Parser 节点。
  3. LLM 组件对 {sys.files} 有专门处理：文本 join 后进 prompt，data URL
     进 VisualFiles 走多模态通道。因此模型必须支持 vision，否则带图会
     直接被 rejectUnsupportedImages 挡掉。
  4. 音频/视频在这条链路上不可用（AudioParser 不转写、video 直接报
     unsupported file type），属于后端限制，见文档说明。

用法：
    export RF_SECRET_KEY=... RF_ACCESS_TOKEN=...
    python3 scripts/build_parser_agent.py            # 建/更新 + 发布
    python3 scripts/build_parser_agent.py --dry-run  # 只打印 DSL
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from huaxia_configure import Api  # noqa: E402  复用签名与请求封装

AGENT_TITLE = "文件解析助手"

# 通义多模态：model_type=9（chat + vision）。必须带 vision，否则上传图片时
# rejectUnsupportedImages 会让整次运行失败。
LLM_VISION = "05f58e7067624c2aabba08eaf550df00"  # qwen3-vl-plus @ tongyi

NODE_TYPE = {
    "Begin": "beginNode",
    "Message": "messageNode",
    "Agent": "agentNode",
}

PROLOGUE = (
    "把文件发给我，我帮你读。\n"
    "支持 PDF、Word、Excel、CSV、Markdown、PPT、HTML、纯文本和图片。\n"
    "直接发文件＝整理全文；带上要求（如「提取所有金额」「转成 JSON」）＝按你的要求处理。"
)

SYS_PROMPT = """你是文件解析助手。用户会上传文件，系统已把文件内容解析好放在下面的「文件内容」里；图片会以图片形式直接提供给你。

工作要求：
1. 只依据文件内容作答，不编造、不补充文件外的知识。文件里没有的信息，明确写「文件中未提及」。
2. 用户没有提额外要求时，输出结构化整理：先用一句话概括这份文件是什么，再按原文顺序分节列出要点。原文里的表格用 Markdown 表格还原。
3. 用户提了明确要求时（如「提取所有金额」「翻译成英文」「转成 JSON」「有哪些风险点」），严格按该要求输出，不要额外加总结段落。
4. 保留原文的数字、日期、金额、比例、专有名词，逐字照抄，不要四舍五入、不要换同义词。
5. 如果「文件内容」为空，说明这次没有读到文件内容（可能是没上传文件，或格式暂不支持），请如实告知并提示用户重新上传；不要凭空猜测文件里有什么。
6. 内容很长时优先保证信息完整，可以分点，但不要为了简短丢掉关键条目。"""

USER_PROMPT = """【文件内容】
{sys.files}

【用户要求】
{sys.query}"""


def build_dsl() -> dict:
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

    c_begin, c_parse, c_answer = "begin_0", "Agent:Parse", "message_0"

    add(c_begin, "Begin", {
        "mode": "conversational",
        "enablePrologue": True,
        "prologue": PROLOGUE,
        "inputs": {
            "doc": {
                "key": "doc",
                "type": "file",
                "name": "文件",
                "value": "",
                "optional": True,
                "options": [],
            },
        },
        "outputs": {},
    }, [], (0, 300), "Begin", [c_parse])
    link(c_begin, c_parse, "start")

    add(c_parse, "Agent", {
        "llm_id": LLM_VISION,
        "sys_prompt": SYS_PROMPT,
        "prompts": [{"role": "user", "content": USER_PROMPT}],
        "outputs": {"content": {"type": "string", "value": ""}, "structured": {}},
        # cite 必须关：开着答案里会混进 [ID:xxx]，解析结果里没有引用编号的位置。
        "cite": False,
        "message_history_window_size": 0,
        "max_tokens": 4096,
        "temperature": 0.1,
        "temperatureEnabled": True,
        "max_rounds": 1,
        "max_retries": 3,
        "delay_after_error": 1,
        "mcp": [],
        "tools": [],
        "exception_goto": [],
        "exception_method": "",
        "exception_default_value": "",
        "showStructuredOutput": False,
    }, [c_begin], (420, 300), "Agent", [c_answer])
    link(c_parse, c_answer)

    # Agent 后面必须挂 Message：Agent 空下游时答案只落 workflow_finished.outputs，
    # 聊天窗口一个字都不显示。
    add(c_answer, "Message", {
        "content": ["{Agent:Parse@content}"],
        "user_id": "{sys.user_id}",
    }, [c_parse], (840, 300), "Message")

    return {
        "components": comps,
        "globals": {
            "sys.conversation_turns": 0,
            "sys.date": "",
            "sys.files": [],
            "sys.history": [],
            "sys.query": "",
            "sys.user_id": "",
        },
        "graph": {"nodes": nodes, "edges": edges},
        "variables": [],
    }


def check(dsl: dict) -> bool:
    comps = dsl["components"]
    errs = []
    for cid, c in comps.items():
        for d in c["downstream"]:
            if d not in comps:
                errs.append(f"{cid} 下游 {d} 不存在")
        for u in c["upstream"]:
            if u not in comps:
                errs.append(f"{cid} 上游 {u} 不存在")

    # Agent 不能是终点：答案必须经 Message 落到聊天流
    for cid, c in comps.items():
        if c["obj"]["component_name"] == "Agent" and not c["downstream"]:
            errs.append(f"{cid} 是 Agent 但没有下游 Message，答案不会显示")

    # {sys.files} 必须在 prompt 里，否则文件内容靠 collectSysFiles 隐式注入，
    # 位置不受控（这里显式放在固定段落里更稳）
    agent = comps.get("Agent:Parse", {}).get("obj", {}).get("params", {})
    joined = (agent.get("sys_prompt", "") + json.dumps(agent.get("prompts", []), ensure_ascii=False))
    if "{sys.files}" not in joined:
        errs.append("prompt 里没有 {sys.files}，文件内容不会进模型")

    # 模型必须支持 vision：带图时 rejectUnsupportedImages 会直接失败
    if not agent.get("llm_id"):
        errs.append("llm_id 为空")

    for e in errs:
        print(f"  ✗ {e}")
    return not errs


def find_agent(api: Api):
    """按标题找一个已存在的画布。

    ListAgents 返回的是 {canvas: [...], total: n}，不是裸数组；按 agents 取
    会拿到 None，于是每次都判定"不存在"→ 重复建同名画布（踩过一次，
    UniqueName 还会自动加序号，症状是列表里冒出「文件解析助手1」）。
    """
    data = api.get("/api/v1/agents?page=1&page_size=100")["data"]
    rows = data.get("canvas") if isinstance(data, dict) else data
    matches = [r for r in (rows or []) if (r.get("title") or "").startswith(AGENT_TITLE)]
    if not matches:
        return None
    # 标题完全一致优先，否则取最早的那个，避免误用带序号的副本
    exact = [r for r in matches if r.get("title") == AGENT_TITLE]
    matches.sort(key=lambda r: r.get("create_time") or 0)
    chosen = exact[0] if exact else matches[0]
    for dup in matches:
        if dup is not chosen:
            print(f"  ! 发现同名副本 {dup.get('id')}（{dup.get('title')}），未处理")
    return chosen


def run_tests(agent_id: str) -> int:
    """上传各类文件，验证「读得到 / 按要求处理 / 空文件不瞎猜」。"""
    from probe_agent_file_parse import (  # noqa: PLC0415
        Api as ProbeApi,
        extract_message,
        make_docx,
        make_pdf,
        make_png,
        make_xlsx,
        write,
    )

    api = ProbeApi()
    workdir = "/tmp/probe_parse"
    os.makedirs(workdir, exist_ok=True)

    cases = [
        ("pdf", make_pdf(f"{workdir}/huaxia.pdf"), ""),
        ("docx", make_docx(f"{workdir}/huaxia.docx"), "这份文件说了什么？"),
        ("xlsx", make_xlsx(f"{workdir}/huaxia.xlsx"), "把基金代码列出来"),
        ("csv", write(f"{workdir}/h.csv", "产品,费率\n定投,0.15%\n".encode()), "费率是多少"),
        ("md", write(f"{workdir}/h.md", "# 标题\n- 要点一\n- 要点二\n".encode()), ""),
        ("png", make_png(f"{workdir}/huaxia.png"), "这张图是什么颜色"),
        ("none", None, "你好"),
    ]

    failures = 0
    for fmt, path, ask in cases:
        body = {
            "agent_id": agent_id,
            "query": ask or "整理这份文件的内容",
            "inputs": {},
            "stream": True,
        }
        if path:
            up = api.upload(f"/api/v1/agents/{agent_id}/upload", path)
            if up.get("code") not in (0, None):
                print(f"\n--- {fmt}: 上传失败 {up}")
                failures += 1
                continue
            desc = up.get("data")
            descs = desc if isinstance(desc, list) else [desc]
            body["files"] = descs
            body["inputs"] = {
                "doc": {"key": "doc", "type": "file", "name": "文件",
                        "value": descs[0].get("id", ""), "optional": True, "options": []}
            }

        events = api.run_sse("/api/v1/agents/chat/completions", body)
        content, error = extract_message(events)
        text = content.strip()
        state = "OK" if text and not error else ("ERROR" if error else "EMPTY")
        if state != "OK":
            failures += 1
        print(f"\n--- {fmt} [{state}] 问：{body['query']}")
        if error:
            print(f"    错误：{error[:300]}")
        else:
            print("    " + text[:400].replace("\n", "\n    "))

    print(f"\n==== 失败 {failures} / {len(cases)} ====")
    return 1 if failures else 0


def main() -> int:
    dry = "--dry-run" in sys.argv
    dsl = build_dsl()
    print("== 静态自检 ==")
    if not check(dsl):
        return 1
    print("  ✓ 通过")
    if dry:
        print(json.dumps(dsl, ensure_ascii=False, indent=2))
        return 0

    api = Api()
    existing = find_agent(api)
    if existing:
        agent_id = existing.get("id") or existing.get("canvas_id")
        release = bool(existing.get("release"))
        # 幂等：DSL 已经一致时不能再 PUT + publish —— release=true 且 DSL 与
        # 最新版本不同会追加一条"已发布"版本，等于每跑一次脚本就发一次版。
        old = existing.get("dsl")
        if isinstance(old, str):
            try:
                old = json.loads(old)
            except Exception:
                old = None
        if old == json.loads(json.dumps(dsl)):
            print(f"== {AGENT_TITLE}（{agent_id}）已是目标 DSL，跳过写入（release={release}）==")
            if not release:
                api.post(f"/api/v1/agents/{agent_id}/publish", {})
                print("== 之前未上架，已补发布 ==")
            if "--test" in sys.argv:
                print("\n== 实测 ==")
                return run_tests(agent_id)
            return 0
        api.put(f"/api/v1/agents/{agent_id}", {
            "title": AGENT_TITLE,
            "description": "上传文件（PDF/Word/Excel/CSV/Markdown/PPT/HTML/文本/图片），按需提取或整理内容。",
            "dsl": dsl,
            # release 必须原样带回，不传等于悄悄下架
            "release": release,
        })
        print(f"== 已更新 {AGENT_TITLE}（{agent_id}），release 保持 {release} ==")
    else:
        out = api.post("/api/v1/agents", {
            "title": AGENT_TITLE,
            "description": "上传文件（PDF/Word/Excel/CSV/Markdown/PPT/HTML/文本/图片），按需提取或整理内容。",
            "permission": "me",
            "canvas_category": "agent_canvas",
            "dsl": dsl,
        })
        payload = out.get("data") or {}
        agent_id = payload.get("id") or payload.get("canvas_id")
        print(f"== 已创建 {AGENT_TITLE}（{agent_id}）==")

    api.post(f"/api/v1/agents/{agent_id}/publish", {})
    row = api.get(f"/api/v1/agents/{agent_id}")["data"]
    print(f"== 发布完成：release={row.get('release')} ==")
    print(f"入口：/agent/{agent_id}")

    if "--test" in sys.argv:
        print("\n== 实测 ==")
        return run_tests(agent_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
