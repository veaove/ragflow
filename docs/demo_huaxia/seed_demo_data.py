#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
华夏基金智能客服 · 一键灌入演示数据
----------------------------------
在已运行的 RAGFlow 上自动完成：
  1. 创建 2 个知识库（寒暄库 / 基金FAQ库，qa 解析）
  2. 上传对应的 txt 问答文件（tab 分隔：问题<TAB>答案，同一行）并触发解析
  3. 创建 1 个对话助手，绑定两个知识库
  4. 自动发若干条消息，生成「用户咨询日志」演示数据

用法：
  pip install requests
  python seed_demo_data.py --base-url http://localhost \
      --api-key <API_KEY> \
      --embedding-model BAAI/bge-large-zh-v1.5 \
      --llm-id <已配置的LLM_ID>

说明：
  - 不依赖评估/批量测试 API（本版 Go 未注册），检索测试请到 Web 界面用 测试集.md 手动跑。
  - 建好的 ID 写入 demo_state.json，方便一次性清理。
"""

import argparse
import json
import os
import sys
import time

import requests

HERE = os.path.dirname(os.path.abspath(__file__))


def log(msg):
    print(f"[seed] {msg}", flush=True)


def api(base_url, api_key):
    s = requests.Session()
    s.headers.update({
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
    })
    s.base_url = base_url.rstrip("/")
    return s


def _ok(resp):
    try:
        body = resp.json()
    except Exception:
        raise RuntimeError(f"非JSON响应 HTTP {resp.status_code}: {resp.text[:200]}")
    if resp.status_code >= 400 or body.get("code") not in (0, None, "0"):
        raise RuntimeError(f"API错误 HTTP {resp.status_code}: {body}")
    return body


def create_dataset(s, name, embedding_model):
    body = _ok(s.post(f"{s.base_url}/api/v1/datasets", json={
        "name": name,
        "embedding_model": embedding_model,
        "language": "Chinese",
        "permission": "me",
        "parser_id": "qa",
    }))
    ds = body["data"]
    log(f"创建知识库成功: {name} -> {ds['id']}")
    return ds["id"]


def upload_document(s, dataset_id, filepath):
    with open(filepath, "rb") as f:
        resp = s.post(
            f"{s.base_url}/api/v1/datasets/{dataset_id}/documents",
            files={"file": (os.path.basename(filepath), f, "text/plain")},
            data={"parser_id": "qa", "run": "1"},
        )
    _ok(resp)
    log(f"上传文档成功: {os.path.basename(filepath)}")
    # 等解析完成（status "1" = 已解析；"2" = 解析中；"3" = 失败）
    # 注意：run=="1" 仅表示已触发解析，不能据此判定完成，必须看 status。
    for _ in range(60):
        r = _ok(s.get(f"{s.base_url}/api/v1/datasets/{dataset_id}/documents"))
        docs = r["data"].get("docs") or r["data"]
        if not docs:
            time.sleep(3)
            continue
        st = docs[0].get("status")
        if st == "1":
            log("文档解析完成")
            return
        if st == "3":
            raise RuntimeError("文档解析失败，请到 Web 界面查看文档详情")
        time.sleep(3)
    log("警告：等待解析超时，请到 Web 界面确认文档状态")


def create_chat(s, name, kb_ids, llm_id):
    body = _ok(s.post(f"{s.base_url}/api/v1/chats", json={
        "name": name,
        "kb_ids": kb_ids,
        "llm_id": llm_id,
        "prompt_type": "simple",
        "prompt_config": {
            "prompt": (
                "你是华夏基金智能客服「小夏」，语气亲切专业。"
                "只依据提供的知识库内容回答基金相关问题；"
                "知识库没有的内容，请礼貌说明并建议转人工，不要编造。"
                "遇到客户寒暄（打招呼、谢谢、再见等）直接用寒暄库回应。"
            )
        },
        "similarity_threshold": 0.2,
        "top_n": 6,
        "top_k": 1024,
        "do_refer": "1",
        "rerank_id": "",
    }))
    cid = body["data"]["id"]
    log(f"创建对话助手成功: {name} -> {cid}")
    return cid


def chat(s, chat_id, question):
    body = _ok(s.post(
        f"{s.base_url}/api/v1/openai/{chat_id}/chat/completions",
        json={
            "model": chat_id,
            "messages": [{"role": "user", "content": question}],
        },
    ))
    # OpenAI 兼容返回：choices[0].message.content（可能流式，这里取非流式）
    try:
        ans = body["choices"][0]["message"]["content"]
    except Exception:
        ans = str(body)[:80]
    log(f"对话: {question[:20]}... -> {ans[:40]}")
    return ans


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--base-url", default="http://localhost")
    p.add_argument("--api-key", required=True)
    p.add_argument("--embedding-model", default="BAAI/bge-large-zh-v1.5")
    p.add_argument("--llm-id", required=True)
    args = p.parse_args()

    s = api(args.base_url, args.api_key)

    state = {}

    # 1) 寒暄库
    hanxuan_id = create_dataset(s, "华夏基金-寒暄库(演示)", args.embedding_model)
    upload_document(s, hanxuan_id, os.path.join(HERE, "华夏基金-寒暄知识库.txt"))
    state["hanxuan_dataset_id"] = hanxuan_id

    # 2) 基金FAQ库
    faq_id = create_dataset(s, "华夏基金-基金FAQ库(演示)", args.embedding_model)
    upload_document(s, faq_id, os.path.join(HERE, "华夏基金-基金FAQ知识库.txt"))
    state["faq_dataset_id"] = faq_id

    # 3) 对话助手
    chat_id = create_chat(s, "华夏基金智能客服-小夏(演示)",
                          [hanxuan_id, faq_id], args.llm_id)
    state["chat_id"] = chat_id

    # 4) 生成咨询日志
    demo_msgs = [
        "你好",
        "我想买基金，怎么操作？",
        "赎回一般几天到账",
        "买基金手续费多少",
        "基金净值在哪查",
        "谢谢啦",
    ]
    for m in demo_msgs:
        chat(s, chat_id, m)
        time.sleep(1)

    with open(os.path.join(HERE, "demo_state.json"), "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)

    log("全部完成。建好的 ID 已写入 demo_state.json")
    log(f"知识库: 寒暄={hanxuan_id}  FAQ={faq_id}  对话={chat_id}")


if __name__ == "__main__":
    main()
