#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
标书助手 · 一期：会话内按章节输出内容（不生成文件）

拓扑：
    begin
     → Agent:ParseSections   把用户随手写的章节清单整理成「序号. 章节名：要求」
     → StringTransform:Split 按换行切成 Array<string>
     → Iteration:PerSection  遍历每个章节
          IterationItem:PerSectionStart   ← 当前项锚点
          → Retrieval:Section             query = 当前章节
          → Agent:WriteSection            按章节写
        outputs.sections ← Array<string>  收集每轮结果
     → StringTransform:Join  拼回全文
     → Message:Output        在会话里打出来

为什么一期不碰 docx：
    生成文件就要处理样式继承（模板的字体/行距/缩进），那是整个方案里
    唯一可能做不成的环节。一期只输出文本，失败成本接近零——写歪了重跑，
    不会留下坏文件。而且它验证的是最贵的东西：检索质量。

关键机制（来自 dsl/testdata/all.json 的实例）：
    - split：method=split + delimiters + split_ref → Array<string>
    - Iteration：items_ref 指向数组，outputs.ref 指向循环内某节点的输出
    - 循环内引用当前项：{IterationItem:xxxStart@item}
    - merge：method=merge + script 做变量插值，把数组拼回字符串
"""

import json
import sys

LLM = "qwen-flash@tongyi@Tongyi-Qianwen"

# 占位知识库（华夏基金 FAQ 库）。理想项目建好库后换掉这里即可，
# 其余节点不用动。
KB_PLACEHOLDER = "6995fa4b2ad24d5f9270fcfe18d12d1d"

PROMPT_PARSE = (
    "你是标书结构整理助手。用户会给出一份章节清单，格式可能不统一"
    "（有的写「项目背景：检索+模型排版」，有的只写标题，有的带序号）。\n"
    "请把它整理成规范格式，**每行一个章节**，形如：\n"
    "1. 项目背景：检索知识库中关于项目与客户背景的资料，写出项目缘起与目标\n\n"
    "整理规则：\n"
    "1. 严格保持用户给出的章节顺序，不要增删章节；\n"
    "2. 冒号前是章节名，冒号后是该章的写作要求；\n"
    "3. 用户只给了章节名没给要求时，按标书惯例补一句要求"
    "（如「概述本章要点」），不要编造具体业务内容；\n"
    "4. 项目名出现在用户输入里时，把它写进每一章的要求里，"
    "便于后续检索定位；\n"
    "5. 章节之间不要空行，除清单外不要输出任何解释、前言或结尾语。\n\n"
    "只输出章节清单本身。"
)

PROMPT_WRITE = (
    "你是标书撰写专家，正在写标书中的**一章**。\n\n"
    "写作要求：\n"
    "1. 只写本章内容，不要重复输出其它章节；\n"
    "2. 【参考资料】里有依据的，严格按资料表述，不要发挥；\n"
    "3. 资料没有覆盖的部分，写通用表述并在句末标注（待补充），"
    "**不要编造数字、案例名称、客户名**；\n"
    "4. 涉及金额、比例、日期时，资料里没有就留空并标注（待补充）；\n"
    "5. 输出格式：先一行 `## 章节标题`，然后正文段落；\n"
    "6. 正文 300-600 字，分 2-4 段，不要用列表堆砌。\n\n"
    "用简体中文，语言平实、像正式标书，不要营销腔。"
)

# 传给 WriteSection 的用户消息模板：本章要求 + 检索素材
USER_TEMPLATE_WRITE = (
    "【本章要求】\n{item}\n\n"
    "【参考资料】\n{ref}\n\n"
    "请按上面的要求写这一章。"
)


def build_dsl():
    nodes = [
        {
            "id": "begin",
            "type": "beginNode",
            "position": {"x": -80, "y": 240},
            "data": {
                "label": "Begin",
                "name": "begin",
                "form": {"mode": "conversational", "enablePrologue": True},
            },
        },
        {
            "id": "Agent:ParseSections",
            "type": "agentNode",
            "position": {"x": 80, "y": 240},
            "data": {
                "label": "Agent",
                "name": "整理章节清单",
                "form": {
                    "llm_id": LLM,
                    "sys_prompt": PROMPT_PARSE,
                    "prompts": [{"role": "user", "content": "{sys.query}"}],
                    "cite": False,
                    "temperature": 0.1,
                    "temperatureEnabled": True,
                    "top_p": 0.3,
                    "topPEnabled": True,
                    "presence_penalty": 0.4,
                    "presencePenaltyEnabled": True,
                    "frequency_penalty": 0.7,
                    "frequencyPenaltyEnabled": False,
                    "max_tokens": 1024,
                    "maxTokensEnabled": False,
                    "max_rounds": 1,
                    "max_retries": 3,
                    "delay_after_error": 1,
                    "message_history_window_size": 4,
                    "description": "把用户输入的章节清单规范成一行一章",
                    "exception_method": "",
                    "exception_goto": [],
                    "exception_default_value": "",
                    "tools": [],
                    "mcp": [],
                    "outputs": {"content": {"type": "string", "value": ""}},
                    "visual_files_var": "",
                    "showStructuredOutput": False,
                },
            },
        },
        {
            "id": "StringTransform:Split",
            "type": "ragNode",
            "position": {"x": 320, "y": 240},
            "data": {
                "label": "StringTransform",
                "name": "按行切分章节",
                "form": {
                    "method": "split",
                    "delimiters": ["\n"],
                    "split_ref": "Agent:ParseSections@content",
                    "script": "",
                    "outputs": {"result": {"type": "Array<string>"}},
                },
            },
        },
        {
            "id": "Parallel:PerSection",
            "type": "iterationNode",
            "position": {"x": 540, "y": 240},
            "data": {
                "label": "Parallel",
                "name": "逐章生成",
                "form": {
                    "items_ref": "StringTransform:Split@result",
                    "max_concurrency": 1,
                    "outputs": {
                        "sections": {
                            "ref": "Agent:WriteSection@content",
                            "type": "Array<string>",
                        }
                    },
                },
            },
        },
        {
            "id": "Retrieval:Section",
            "type": "retrievalNode",
            "position": {"x": 740, "y": 380},
            "parentId": "Parallel:PerSection",
            "data": {
                "label": "Retrieval",
                "name": "章节检索",
                "form": {
                    "kb_ids": [KB_PLACEHOLDER],
                    # 用「当前章节（含项目名与写作要求）」作检索词：
                    # 比只取章节名更准，用户输入里的项目名会被自然带入。
                    "query": "{item}",
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
                    "empty_response": "（本章暂无匹配资料）",
                    "outputs": {
                        "formalized_content": {"type": "string", "value": ""},
                        "json": {"type": "Array<Object>", "value": []},
                    },
                },
            },
        },
        {
            "id": "Agent:WriteSection",
            "type": "agentNode",
            "position": {"x": 960, "y": 380},
            "parentId": "Parallel:PerSection",
            "data": {
                "label": "Agent",
                "name": "撰写本章",
                "form": {
                    "llm_id": LLM,
                    "sys_prompt": PROMPT_WRITE,
                    "prompts": [
                        {
                            "role": "user",
                            "content": USER_TEMPLATE_WRITE.replace(
                                "{ref}", "{Retrieval:Section@formalized_content}"
                            ),
                        }
                    ],
                    "cite": True,
                    "temperature": 0.2,
                    "temperatureEnabled": True,
                    "top_p": 0.3,
                    "topPEnabled": True,
                    "presence_penalty": 0.4,
                    "presencePenaltyEnabled": True,
                    "frequency_penalty": 0.7,
                    "frequencyPenaltyEnabled": False,
                    "max_tokens": 2048,
                    "maxTokensEnabled": False,
                    "max_rounds": 1,
                    "max_retries": 3,
                    "delay_after_error": 1,
                    "message_history_window_size": 4,
                    "description": "按章节要求与检索素材撰写本章",
                    "exception_method": "",
                    "exception_goto": [],
                    "exception_default_value": "",
                    "tools": [],
                    "mcp": [],
                    "outputs": {"content": {"type": "string", "value": ""}},
                    "visual_files_var": "",
                    "showStructuredOutput": False,
                },
            },
        },
        {
            "id": "StringTransform:Join",
            "type": "ragNode",
            "position": {"x": 1180, "y": 240},
            "data": {
                "label": "StringTransform",
                "name": "拼接全文",
                "form": {
                    "method": "merge",
                    "delimiters": ["\n\n"],
                    # merge 的 script 支持变量插值：把 Iteration 收集到的
                    # Array<string> 渲染成整篇文本。
                    "script": "{Parallel:PerSection@sections}",
                    "split_ref": "",
                    "outputs": {"result": {"type": "string"}},
                },
            },
        },
        {
            "id": "Message:Output",
            "type": "messageNode",
            "position": {"x": 1400, "y": 240},
            "data": {
                "label": "Message",
                "name": "输出标书内容",
                "form": {"content": ["{StringTransform:Join@result}"]},
            },
        },
    ]

    edges = [
        {"id": "b1", "source": "begin", "sourceHandle": "start",
         "target": "Agent:ParseSections", "targetHandle": "end"},
        {"id": "b2", "source": "Agent:ParseSections", "sourceHandle": "start",
         "target": "StringTransform:Split", "targetHandle": "end"},
        {"id": "b3", "source": "StringTransform:Split", "sourceHandle": "start",
         "target": "Parallel:PerSection", "targetHandle": "end"},
        # 循环体内：Retrieval → Agent。归属靠 parentId，不是靠入口边。
        {"id": "b4", "source": "Retrieval:Section", "sourceHandle": "start",
         "target": "Agent:WriteSection", "targetHandle": "end"},
        {"id": "b5", "source": "Parallel:PerSection", "sourceHandle": "start",
         "target": "StringTransform:Join", "targetHandle": "end"},
        {"id": "b7", "source": "StringTransform:Join", "sourceHandle": "start",
         "target": "Message:Output", "targetHandle": "end"},
    ]

    NAME = {
        "beginNode": "Begin",
        "agentNode": "Agent",
        "retrievalNode": "Retrieval",
        "messageNode": "Message",
        "ragNode": "StringTransform",
        "iterationNode": "Parallel",
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
    out = sys.argv[1] if len(sys.argv) > 1 else "bid_agent_v1.json"
    dsl = build_dsl()
    with open(out, "w", encoding="utf-8") as f:
        json.dump(dsl, f, ensure_ascii=False, indent=2)
    print(f"written: {out}  nodes={len(dsl['graph']['nodes'])} edges={len(dsl['graph']['edges'])} components={len(dsl['components'])}")
