#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
华夏基金业务咨询 · 意图分流智能体（v2，Switch 版）

为什么不用 Categorize：
    categorize.go 的 outputs["_next"] 当前是空切片，canvas/multibranch.go 的
    注释明确写着「category → cpn_id 的胶水还没落地」。实测 Categorize 执行完
    直接报 `no tasks to execute, last completed nodes: [Categorize:Intent]`，
    一个下游都不会跑。Switch 的 _next 是已实现的单 cpn_id，可以真正路由。

拓扑：
    begin → Agent:Router（只输出类目词）
                 → Switch:Route（按关键词 contains 匹配）
                      ├─ 法务     → Retrieval → Agent(法务专家)   ┐
                      ├─ 企业信息 → Retrieval → Agent(企业信息)   ├→ Aggregator → Message
                      ├─ 业务政策 → Retrieval → Agent(政策专家)   │
                      └─ 兜底     → Agent(通用客服) ──────────────┘

用 contains 而不是 ==：模型输出常带换行或标点，精确匹配会漏判。
"""

import json
import sys

LLM = "qwen-flash@tongyi@Tongyi-Qianwen"

KB_LEGAL = "ab87ed24c99f4dec92281414532f3bb1"   # 华夏基金FAQ话术
KB_CORP = "33a59a209238432ea2c95a88393052ef"    # 01-关于华夏
KB_POLICY = "6995fa4b2ad24d5f9270fcfe18d12d1d"  # 华夏基金FAQ库


def form_agent(llm_prompt, user_prompt, cite=True, max_tokens=2048):
    return {
        "llm_id": LLM,
        "sys_prompt": llm_prompt,
        "prompts": [{"role": "user", "content": user_prompt}],
        "cite": cite,
        "temperature": 0.1,
        "temperatureEnabled": True,
        "top_p": 0.3,
        "topPEnabled": True,
        "presence_penalty": 0.4,
        "presencePenaltyEnabled": True,
        "frequency_penalty": 0.7,
        "frequencyPenaltyEnabled": False,
        "max_tokens": max_tokens,
        "maxTokensEnabled": False,
        "max_rounds": 1,
        "max_retries": 3,
        "delay_after_error": 1,
        "message_history_window_size": 6,
        "description": "",
        "exception_method": "",
        "exception_goto": [],
        "exception_default_value": "",
        "tools": [],
        "mcp": [],
        "outputs": {"content": {"type": "string", "value": ""}},
        "visual_files_var": "",
        "showStructuredOutput": False,
    }


def form_retrieval(kb_ids, empty):
    return {
        "kb_ids": kb_ids,
        # query 必须带花括号：不带时会被当成字面量 "sys.query" 去检索，永远查不到东西。
        "query": "{sys.query}",
        "similarity_threshold": 0.2,
        "keywords_similarity_weight": 0.7,
        "top_k": 1024,
        "top_n": 6,
        "rerank_id": "",
        "retrieval_from": "dataset",
        "use_kg": False,
        "toc_enhance": False,
        "cross_languages": [],
        "meta_data_filter": {},
        "empty_response": empty,
        "outputs": {
            "formalized_content": {"type": "string", "value": ""},
            "json": {"type": "Array<Object>", "value": []},
        },
    }


PROMPT_ROUTER = (
    "你是华夏基金客服系统的意图分类器。\n"
    "阅读用户问题，把它归入下面四类中的一类，并**只输出类目名**（2-4 个汉字），"
    "不要输出解释、标点、引号或任何其他内容。\n\n"
    "分类标准：\n"
    "1. 法务 —— 法律法规、合规要求、合同条款、投资者适当性、反洗钱、"
    "信息披露义务、违规认定、投诉与纠纷处理；\n"
    "2. 企业信息 —— 公司成立时间、股东背景、组织架构、投研体系、企业文化、"
    "所获荣誉、社会责任、销售网点、联系方式；\n"
    "3. 业务政策 —— 基金申购赎回规则、费率费用、份额确认、分红方式、"
    "开放期安排、账户与交易限制；\n"
    "4. 其他 —— 寒暄闲聊、与基金业务无关、或索要投资建议/买卖时点/收益预测。\n\n"
    "只输出类目名。"
)

PROMPT_LEGAL = (
    "你是华夏基金的**法务合规专家**，负责解答法律法规、合规要求、合同条款、"
    "投资者适当性、反洗钱、信息披露义务、纠纷处理相关问题。\n"
    "要求：\n"
    "1. 先看【参考资料】，资料有明确规定就严格按资料口径表述，不要自行发挥；\n"
    "2. 涉及「能不能做」「是否违规」的判断，必须说明依据；\n"
    "3. 资料没有的内容，直接说「这一点需要合规部门确认」，不要编造条文或编号；\n"
    "4. 不做投资建议，不承诺收益，不评价具体产品好坏。\n"
    "用简体中文，条理清晰，300 字以内。"
)

PROMPT_CORP = (
    "你是华夏基金的**企业信息助手**，负责解答公司基本情况、股东背景、组织架构、"
    "投研体系、企业文化、所获荣誉、社会责任、销售网点、联系方式等问题。\n"
    "要求：\n"
    "1. 严格依据【参考资料】作答，数字、日期、名称必须与资料一致；\n"
    "2. 资料未覆盖的细节不要猜测，说明「该信息建议以官网或客服口径为准」；\n"
    "3. 不评价公司或同业，不涉及投资建议。\n"
    "用简体中文，简洁准确，300 字以内。"
)

PROMPT_POLICY = (
    "你是华夏基金的**业务政策专家**，负责解答基金产品规则、申购赎回规则、"
    "费率与费用、份额确认、分红方式、开放期安排、账户与交易限制等问题。\n"
    "要求：\n"
    "1. 严格依据【参考资料】作答，规则类问题必须说清适用条件；\n"
    "2. 涉及具体费率、时间、限额时，资料没有明确数值就说「以产品合同/公告为准」，"
    "不要给出估算数字；\n"
    "3. 不做投资建议，不预测收益。\n"
    "用简体中文，简洁准确，300 字以内。"
)

PROMPT_GENERAL = (
    "你是华夏基金的**智能客服**。用户的问题不属于法务、企业信息、业务政策三类，"
    "请简短友好回应：\n"
    "1. 寒暄就礼貌回应，并说明你可以帮ta查法务合规、公司信息、业务政策；\n"
    "2. 涉及投资建议、买卖时点、收益预测的，明确说明不提供投资建议；\n"
    "3. 不要编造任何业务数据。\n"
    "用简体中文，不超过 150 字。"
)

TPL_WITH_REF = "【参考资料】\n{ref}\n\n【用户问题】\n{sys.query}"


def build_dsl():
    nodes = [
        {
            "id": "begin", "type": "beginNode", "position": {"x": -80, "y": 300},
            "data": {"label": "Begin", "name": "begin",
                     "form": {"mode": "conversational", "enablePrologue": True}},
        },
        {
            "id": "Agent:Router", "type": "agentNode", "position": {"x": 40, "y": 300},
            "data": {"label": "Agent", "name": "意图识别",
                     "form": form_agent(PROMPT_ROUTER, "{sys.query}", cite=False, max_tokens=32)},
        },
        {
            "id": "Switch:Route", "type": "switchNode", "position": {"x": 260, "y": 300},
            "data": {
                "label": "Switch", "name": "按意图分流",
                "form": {
                    "conditions": [
                        {"items": [{"cpn_id": "Agent:Router@content", "operator": "contains", "value": "法务"}],
                         "logical_operator": "and", "to": ["Retrieval:Legal"]},
                        {"items": [{"cpn_id": "Agent:Router@content", "operator": "contains", "value": "企业信息"}],
                         "logical_operator": "and", "to": ["Retrieval:Corp"]},
                        {"items": [{"cpn_id": "Agent:Router@content", "operator": "contains", "value": "业务政策"}],
                         "logical_operator": "and", "to": ["Retrieval:Policy"]},
                    ],
                    "end_cpn_ids": ["Agent:General"],
                },
            },
        },
        # 法务
        {"id": "Retrieval:Legal", "type": "retrievalNode", "position": {"x": 480, "y": 100},
         "data": {"label": "Retrieval", "name": "法务知识检索",
                  "form": form_retrieval([KB_LEGAL], "（法务知识库暂无相关内容）")}},
        {"id": "Agent:Legal", "type": "agentNode", "position": {"x": 720, "y": 100},
         "data": {"label": "Agent", "name": "调用法务专家",
                  "form": form_agent(PROMPT_LEGAL,
                                     TPL_WITH_REF.replace("{ref}", "{Retrieval:Legal@formalized_content}"))}},
        # 企业信息
        {"id": "Retrieval:Corp", "type": "retrievalNode", "position": {"x": 480, "y": 300},
         "data": {"label": "Retrieval", "name": "企业信息检索",
                  "form": form_retrieval([KB_CORP], "（企业信息库暂无相关内容）")}},
        {"id": "Agent:Corp", "type": "agentNode", "position": {"x": 720, "y": 300},
         "data": {"label": "Agent", "name": "企业信息助手",
                  "form": form_agent(PROMPT_CORP,
                                     TPL_WITH_REF.replace("{ref}", "{Retrieval:Corp@formalized_content}"))}},
        # 业务政策
        {"id": "Retrieval:Policy", "type": "retrievalNode", "position": {"x": 480, "y": 500},
         "data": {"label": "Retrieval", "name": "政策知识检索",
                  "form": form_retrieval([KB_POLICY], "（业务政策库暂无相关内容）")}},
        {"id": "Agent:Policy", "type": "agentNode", "position": {"x": 720, "y": 500},
         "data": {"label": "Agent", "name": "政策专家助手",
                  "form": form_agent(PROMPT_POLICY,
                                     TPL_WITH_REF.replace("{ref}", "{Retrieval:Policy@formalized_content}"))}},
        # 兜底
        {"id": "Agent:General", "type": "agentNode", "position": {"x": 720, "y": 700},
         "data": {"label": "Agent", "name": "通用客服",
                  "form": form_agent(PROMPT_GENERAL, "{sys.query}", cite=False, max_tokens=512)}},
        {
            "id": "VariableAggregator:Pick", "type": "variableAggregatorNode",
            "position": {"x": 960, "y": 360},
            "data": {"label": "VariableAggregator", "name": "取实际命中的回答",
                     "form": {"groups": [{
                         "group_name": "answer", "type": "string",
                         "variables": [
                             {"value": "{Agent:Legal@content}"},
                             {"value": "{Agent:Corp@content}"},
                             {"value": "{Agent:Policy@content}"},
                             {"value": "{Agent:General@content}"},
                         ]}], "outputs": {"answer": {"type": "string"}}}},
        },
        {
            "id": "Message:Reply", "type": "messageNode", "position": {"x": 1160, "y": 360},
            "data": {"label": "Message", "name": "回复消息",
                     "form": {"content": ["{VariableAggregator:Pick@answer}"]}},
        },
    ]

    edges = [
        {"id": "e1", "source": "begin", "sourceHandle": "start", "target": "Agent:Router", "targetHandle": "end"},
        {"id": "e2", "source": "Agent:Router", "sourceHandle": "start", "target": "Switch:Route", "targetHandle": "end"},
        # Switch 的分支边：sourceHandle 用 "Case N" 与 conditions 顺序对应
        {"id": "e3", "source": "Switch:Route", "sourceHandle": "Case 1", "target": "Retrieval:Legal", "targetHandle": "end"},
        {"id": "e4", "source": "Switch:Route", "sourceHandle": "Case 2", "target": "Retrieval:Corp", "targetHandle": "end"},
        {"id": "e5", "source": "Switch:Route", "sourceHandle": "Case 3", "target": "Retrieval:Policy", "targetHandle": "end"},
        {"id": "e6", "source": "Switch:Route", "sourceHandle": "end_cpn_ids", "target": "Agent:General", "targetHandle": "end"},
        {"id": "e7", "source": "Retrieval:Legal", "sourceHandle": "start", "target": "Agent:Legal", "targetHandle": "end"},
        {"id": "e8", "source": "Retrieval:Corp", "sourceHandle": "start", "target": "Agent:Corp", "targetHandle": "end"},
        {"id": "e9", "source": "Retrieval:Policy", "sourceHandle": "start", "target": "Agent:Policy", "targetHandle": "end"},
        {"id": "e10", "source": "Agent:Legal", "sourceHandle": "start", "target": "VariableAggregator:Pick", "targetHandle": "end"},
        {"id": "e11", "source": "Agent:Corp", "sourceHandle": "start", "target": "VariableAggregator:Pick", "targetHandle": "end"},
        {"id": "e12", "source": "Agent:Policy", "sourceHandle": "start", "target": "VariableAggregator:Pick", "targetHandle": "end"},
        {"id": "e13", "source": "Agent:General", "sourceHandle": "start", "target": "VariableAggregator:Pick", "targetHandle": "end"},
        {"id": "e14", "source": "VariableAggregator:Pick", "sourceHandle": "start", "target": "Message:Reply", "targetHandle": "end"},
    ]

    NAME = {
        "beginNode": "Begin",
        "agentNode": "Agent",
        "retrievalNode": "Retrieval",
        "messageNode": "Message",
        "switchNode": "Switch",
        "variableAggregatorNode": "VariableAggregator",
    }
    components = {}
    for n in nodes:
        cid = n["id"]
        components[cid] = {
            "obj": {"component_name": NAME[n["type"]], "params": n["data"].get("form", {})},
            "upstream": [e["source"] for e in edges if e["target"] == cid],
            "downstream": [e["target"] for e in edges if e["source"] == cid],
        }

    return {
        "components": components,
        "globals": {
            "sys.conversation_turns": 0, "sys.date": "", "sys.files": [],
            "sys.history": [], "sys.query": "", "sys.user_id": "",
        },
        "graph": {"nodes": nodes, "edges": edges},
        "variables": [],
    }


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "hx_dsl_v2.json"
    dsl = build_dsl()
    with open(out, "w", encoding="utf-8") as f:
        json.dump(dsl, f, ensure_ascii=False, indent=2)
    print(f"written: {out}  nodes={len(dsl['graph']['nodes'])} edges={len(dsl['graph']['edges'])}")
