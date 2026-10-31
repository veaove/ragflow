#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 fund_demo 问数演示真正配到 RAGFlow 上。

三个阶段，可单独跑：
    python scripts/setup_fund_demo_agent.py kb      # 建两个知识库 + 上传 + 解析
    python scripts/setup_fund_demo_agent.py agent   # 从内置模板建智能体并填参数
    python scripts/setup_fund_demo_agent.py test    # 跑验收问题

幂等：知识库/智能体按名字查找，已存在就复用，不重复建。
凭据全部走环境变量（见 scripts/huaxia_configure.py 顶部注释）。
"""

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from huaxia_configure import Api  # noqa: E402

DOCS = os.path.join("docs", "smart_query_demo")
SCHEMA_DOC = os.path.join(DOCS, "fund_demo_schema.md")
FEWSHOT_DOC = os.path.join(DOCS, "fund_demo_fewshot.md")
TEMPLATE = os.path.join("internal", "agent", "templates", "text2sql_data_expert.zh.json")

KB_SCHEMA_NAME = "问数-表结构-fund_demo"
KB_FEWSHOT_NAME = "问数-示例SQL-fund_demo"
AGENT_TITLE = "问数助手·fund_demo"

EMBD = "text-embedding-v3@tongyi@Tongyi-Qianwen"
LLM = "qwen-flash@tongyi@Tongyi-Qianwen"

EXESQL = {
    "db_type": "mysql",
    "host": "172.30.20.51",
    "port": 3306,
    "database": "fund_demo",
    "username": "fund_ro",
    "password": "FundDemo_2026",
    "max_records": 1024,
}


# ---------------------------------------------------------------- 知识库

def find_dataset(api, name):
    for d in api.get("/api/v1/datasets").get("data") or []:
        if d.get("name") == name:
            return d
    return None


def ensure_dataset(api, name, desc):
    d = find_dataset(api, name)
    if d:
        print("  [复用] %s  id=%s" % (name, d["id"]))
        return d["id"]
    r = api.post("/api/v1/datasets", {
        "name": name,
        "embedding_model": EMBD,
        "parser_id": "general",
        "parse_type": 1,          # 1 = 内置解析器（走 parser_id，不走向导流水线）
        # schemas 是表格密集型，默认 512 token 会把字段表切碎
        "parser_config": {"chunk_token_num": 1024},
        "language": "Chinese",
        "permission": "me",
    })
    did = (r.get("data") or {}).get("id") or r.get("data")
    print("  [新建] %s  id=%s" % (name, did))
    return did


def list_docs(api, ds_id):
    r = api.get("/api/v1/datasets/%s/documents?page=1&page_size=100" % ds_id)
    d = r.get("data") or {}
    return d.get("docs") or d.get("documents") or []


def ensure_doc(api, ds_id, path):
    name = os.path.basename(path)
    for doc in list_docs(api, ds_id):
        if doc.get("name") == name:
            print("  [复用] %s  doc_id=%s" % (name, doc.get("id")))
            return doc.get("id")
    r = api.upload_file("/api/v1/datasets/%s/documents" % ds_id, path, {})
    docs = (r.get("data") or [])
    if isinstance(docs, dict):
        docs = docs.get("docs") or [docs]
    doc_id = docs[0].get("id") if docs else None
    print("  [上传] %s  doc_id=%s" % (name, doc_id))
    return doc_id


def parse_and_wait(api, ds_id, doc_id, timeout=180):
    api.post("/api/v1/datasets/%s/chunks" % ds_id, {"document_ids": [doc_id]})
    t0 = time.time()
    while time.time() - t0 < timeout:
        for doc in list_docs(api, ds_id):
            if doc.get("id") != doc_id:
                continue
            prog = doc.get("progress")
            run = str(doc.get("run") or doc.get("ingestion_status") or "")
            if prog is not None and float(prog) >= 1.0:
                print("  [解析完成] progress=1.0  chunk=%s" % doc.get("chunk_count"))
                return True
            if run in ("4", "FAIL", "failed"):
                print("  [解析失败] %s" % json.dumps(doc, ensure_ascii=False)[:400])
                return False
        time.sleep(3)
    print("  [解析超时] 请到页面上看一眼")
    return False


def stage_kb(api):
    print("[1/2] 表结构知识库")
    schema_id = ensure_dataset(api, KB_SCHEMA_NAME, "fund_demo 表结构 + 业务口径，供 Text-to-SQL 检索")
    doc = ensure_doc(api, schema_id, SCHEMA_DOC)
    parse_and_wait(api, schema_id, doc)

    print("[2/2] 示例 SQL 知识库")
    fewshot_id = ensure_dataset(api, KB_FEWSHOT_NAME, "fund_demo 问法→SQL 对照示例（few-shot）")
    doc = ensure_doc(api, fewshot_id, FEWSHOT_DOC)
    parse_and_wait(api, fewshot_id, doc)
    return schema_id, fewshot_id


# ---------------------------------------------------------------- 智能体

def patch_params(node, key, value):
    """同时改 UI 侧 graph.nodes[].data.form 和运行侧 components[].obj.params。"""
    node["data"]["form"][key] = value


def build_dsl(schema_id, fewshot_id):
    tpl = json.load(open(TEMPLATE, encoding="utf-8"))
    dsl = tpl["dsl"]
    comps = dsl["components"]

    binding = {
        "Retrieval:HappyTiesFilm": [schema_id],       # Schema
        "Retrieval:SmartNewsHammer": [fewshot_id],    # Question to SQL
        "Retrieval:SweetDancersAppear": [schema_id],  # Database Description
    }

    for node in dsl["graph"]["nodes"]:
        nid = node["id"]
        if nid in binding:
            patch_params(node, "dataset_ids", binding[nid])
            patch_params(node, "similarity_threshold", 0.2)
            patch_params(node, "top_n", 8)
            if nid in comps:
                comps[nid]["obj"]["params"]["dataset_ids"] = binding[nid]
        elif nid.startswith("Agent:"):
            patch_params(node, "llm_id", LLM)
            if nid in comps:
                comps[nid]["obj"]["params"]["llm_id"] = LLM
        elif nid.startswith("ExeSQL:"):
            for k, v in EXESQL.items():
                patch_params(node, k, v)
            if nid in comps:
                comps[nid]["obj"]["params"].update(EXESQL)
    return dsl


def find_agent(api, title):
    r = api.get("/api/v1/agents?page=1&page_size=200")
    d = r.get("data") or {}
    rows = d.get("canvas") or d.get("agents") or (d if isinstance(d, list) else [])
    for a in rows:
        if a.get("title") == title:
            return a
    return None


def stage_agent(api, schema_id, fewshot_id):
    dsl = build_dsl(schema_id, fewshot_id)
    exist = find_agent(api, AGENT_TITLE)
    if exist:
        aid = exist.get("id") or exist.get("canvas_id")
        api.put("/api/v1/agents/%s" % aid, {"title": AGENT_TITLE, "dsl": dsl})
        print("  [更新] 智能体 %s  id=%s" % (AGENT_TITLE, aid))
        return aid
    r = api.post("/api/v1/agents", {
        "title": AGENT_TITLE,
        "description": "基于 fund_demo 演示库的智能问数（Text-to-SQL）",
        "permission": "me",
        "canvas_type": "Marketing",
        "canvas_category": "agent_canvas",
        "dsl": dsl,
    })
    aid = (r.get("data") or {}).get("id")
    print("  [新建] 智能体 %s  id=%s" % (AGENT_TITLE, aid))
    return aid


# ---------------------------------------------------------------- 验收

QUESTIONS = [
    "华夏成长混合（000001）最新净值是多少？",
    "现在能买到哪些货币型基金？",
    "2026-09-01 到 2026-10-30，单位净值涨幅最高的三只基金是哪几只？",
    "持有华夏成长混合满 100 天，赎回 10 万元，赎回费是多少？",
    "在天天基金买 1 万元华夏成长混合，申购费多少？",
    "2026 年 9 月到 10 月，各渠道的申购金额合计是多少？从高到低排。",
    "华夏复兴混合现在还能买吗？",
]


def run_agent(api, agent_id, question, timeout=300):
    """调 agents/:id/run，解析 SSE，返回最终 outputs。

    注意：这个接口即使传 stream=false 也回 SSE 流，必须按流解析。
    """
    import urllib.request
    from huaxia_configure import BASE_URL

    body = json.dumps({"question": question, "stream": True}).encode()
    req = urllib.request.Request(BASE_URL + "/api/v1/agents/%s/run" % agent_id,
                                 data=body, method="POST")
    req.add_header("Authorization", api.auth)
    req.add_header("Content-Type", "application/json")
    raw = urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8", "replace")

    out, err = "", None
    for line in raw.split("\n"):
        line = line.strip()
        if not line.startswith("data:"):
            continue
        try:
            o = json.loads(line[5:].strip())
        except Exception:
            continue
        ev, d = o.get("event"), o.get("data") or {}
        if ev == "workflow_finished":
            out = d.get("outputs") or ""
        elif ev == "workflow_failed":
            err = json.dumps(d, ensure_ascii=False)[:300]
    return out, err


# (题号, 问法, 必须出现的关键内容, 不能出现的内容, 空结果可接受的同义说法)
CASES = [
    ("Q1",  "华夏成长混合（000001）最新净值是多少？", ["1.2695"], [], None),
    ("Q2",  "现在能买到哪些货币型基金？", ["000343", "000353"], [], None),
    ("Q3",  "2026-09-01 到 2026-10-30，单位净值涨幅最高的三只基金是哪几只？", ["000041", "000047", "000071"], [], None),
    ("Q4",  "华夏成长混合 2026 年 9 月 30 日的单位净值是多少？", ["1.3020"], [], None),
    ("Q5",  "持有华夏成长混合满 100 天，赎回 10 万元，赎回费是多少？", ["500"], ["750"], None),
    ("Q6",  "在天天基金买 1 万元华夏成长混合，申购费多少？", ["14.98"], ["15.00"], None),
    ("Q7",  "2026 年 9 月到 10 月，各渠道的申购金额合计是多少？从高到低排。", ["2733920.10", "250911.40"], [], None),
    ("Q8",  "风险等级 3 级及以下、起购金额不超过 100 元的开放申购基金有哪些？", ["000343", "000121"], [], None),
    ("Q9",  "华夏成长混合 9 月和 10 月的月均单位净值分别是多少？", ["1.2900", "1.2830"], [], None),
    ("Q10", "哪些基金的申购费率高于管理费率？", ["000051", "000121"], [], None),
    ("Q11", "各类型基金的平均管理费率是多少？各有几只？", ["1.429", "1.800"], [], None),
    # 休市日无净值：只要不编造数字就算对。ExeSQL 的英文哨兵（Go 侧写死）也算正确。
    ("Q12", "华夏恒生ETF联接A 在 2026 年 10 月 3 日的净值是多少？", [],
     ["1.0", "0.98", "0.99"],
     ["休市", "无净值", "没有", "未查询", "No record", "无数据"]),
    ("Q13", "华夏复兴混合现在还能买吗？", ["暂停申购"], [], None),
    ("Q14", "买 QDII 基金，哪个渠道的申购费率最低？", ["0.16", "天天基金"], [], None),
]


def stage_test(api, agent_id):
    rows = []
    for cid, q, must, forbid, any_of in CASES:
        ans, err = run_agent(api, agent_id, q)
        if err:
            ok, note = "FAIL", "工作流失败：" + err
        else:
            hit = [m for m in must if m in ans]
            bad = [f for f in forbid if f in ans]
            if any_of is not None:
                hit = [1] if any(a in ans for a in any_of) else []
                must = [1]
            if len(hit) == len(must) and not bad:
                ok, note = "PASS", ""
            else:
                ok = "FAIL"
                note = "需包含 %s" % must if must else ""
                if bad:
                    note += "；出现了不该有的 %s" % ",".join(bad)
        rows.append((cid, ok, note))
        print("%-4s %-4s %s" % (cid, ok, note))
        print("     问：%s" % q)
        print("     答：%s" % ans.strip().replace("\n", " ")[:220])
    n_pass = sum(1 for _, ok, _ in rows if ok == "PASS")
    print("\n通过 %d/%d" % (n_pass, len(rows)))
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("stage", choices=["kb", "agent", "test", "all"])
    args = ap.parse_args()
    api = Api()

    if args.stage in ("kb", "all"):
        schema_id, fewshot_id = stage_kb(api)
    else:
        schema_id = (find_dataset(api, KB_SCHEMA_NAME) or {}).get("id")
        fewshot_id = (find_dataset(api, KB_FEWSHOT_NAME) or {}).get("id")

    if args.stage in ("agent", "all"):
        assert schema_id and fewshot_id, "知识库还没建，先跑 kb 阶段"
        agent_id = stage_agent(api, schema_id, fewshot_id)
        print("\n智能体 id: %s" % agent_id)
        if args.stage == "all":
            stage_test(api, agent_id)

    if args.stage == "test":
        a = find_agent(api, AGENT_TITLE)
        assert a, "还没建智能体"
        stage_test(api, a.get("id") or a.get("canvas_id"))


if __name__ == "__main__":
    main()
