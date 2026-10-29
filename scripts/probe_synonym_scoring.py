#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
同义词检索诊断：把变更集对比的原始返回打出来
============================================
只读：GET 变更集 diff + POST retrieval-compare（不发布、不改任何配置）。

用第三张截图里那次对比的参数复现：
    question = 基金是怎么买, top_k = 5, similarity_threshold = 0.2

重点看四组字段：
  query_tokens          查询怎么被切词（字典是按 token 查的，切错了就永远不扩写）
  synonym_override_keys 哪些 token 拿到了变更集的扩写词（空 = 两边没碰上）
  extra_query_terms     新配置比原配置多出来的检索词
  baseline/candidate    两侧每条命中的 similarity

用法：
    export RF_BASE_URL=http://172.30.20.51
    export RF_SECRET_KEY=<kvrocks ragflow:system:secret_key>
    export RF_ACCESS_TOKEN=<user.access_token>
    python3 scripts/probe_synonym_scoring.py [question ...]
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from huaxia_configure import Api  # noqa: E402

KB = "6995fa4b2ad24d5f9270fcfe18d12d1d"  # 华夏基金FAQ库

# 截图里的三组参数：第三张是本次要复现的
CASES = [
    # (question, top_k, threshold, 备注)
    ("基金是怎么买", 5, 0.2, "截图3：同 chunk 0.909 -> 0.213"),
    ("我想买基金", 5, 0.2, "截图1：原 4 命中 -> 新 3 命中"),
    ("申购费率是多少", 5, 0.2, "无关组，对照"),
]


def open_change_sets(api):
    """取该库所有未发布的变更集（open 状态）。"""
    out = api.get(f"/api/v1/datasets/{KB}/change-sets?status=open&page=1&page_size=20")
    data = out.get("data")
    # 该接口直接返回数组；兼容将来包成 {change_sets: [...]} 的形状。
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get("change_sets") or data.get("items") or []
    return []


def show_side(label, side):
    hits = side.get("hits") or []
    print(f"  {label}: {len(hits)} 命中, total={side.get('total')}, {side.get('took_ms')}ms")
    for h in hits:
        content = (h.get("content") or "").replace("\n", " ")[:60]
        print(f"    #{h['rank']} sim={h['similarity']:.4f} chunk={h['chunk_id'][:12]} {content}")


def run_case(api, change_set_id, question, top_k, threshold, note):
    print("=" * 78)
    print(f"问题：{question}   ({note})")
    body = {
        "dataset_ids": [KB],
        "question": question,
        "top_k": top_k,
        "similarity_threshold": threshold,
    }
    out = api.post(
        f"/api/v1/datasets/{KB}/change-sets/{change_set_id}/retrieval-compare", body
    )
    d = out.get("data") or {}
    q = question

    print(f"  query_tokens         : {d.get('query_tokens')}")
    print(f"  synonym_override_keys: {d.get('synonym_override_keys')}")
    print(f"  extra_query_terms    : {d.get('extra_query_terms')}")

    cap = d.get("capability") or {}
    print(f"  capability           : {json.dumps(cap, ensure_ascii=False)}")

    show_side("原配置(已生效)", d.get("baseline") or {})
    show_side("新配置(+变更集)", d.get("candidate") or {})

    s = (d.get("diff") or {}).get("summary") or {}
    print(f"  diff: 交集{s.get('common_count')} 新增{s.get('added_count')} "
          f"丢失{s.get('removed_count')} 交集平均分差 {s.get('avg_delta_on_common'):+.4f}")

    sc = (d.get("diff") or {}).get("score_changed") or []
    for it in sc:
        print(f"    分数变化 chunk={it['chunk_id'][:12]} "
              f"{it['before_score']:.4f} -> {it['after_score']:.4f} "
              f"(rank {it['before_rank']} -> {it['after_rank']})")
    return d


def main():
    api = Api()
    sets = open_change_sets(api)
    print("open 变更集：")
    for cs in sets:
        print(f"  {cs.get('id')}  {cs.get('status')}  {cs.get('create_time') or cs.get('created_at')}")
    if not sets:
        print("没有 open 变更集，只有原配置可测")
    target = sets[0].get("id") if sets else None

    # 1) 不带变更集的普通检索：真实线上结果
    print("\n" + "=" * 78)
    print("【线上真实检索】POST /datasets/{kb}/search")
    for q, top_k, th, _ in CASES:
        out = api.post(
            f"/api/v1/datasets/{KB}/search",
            {"question": q, "top_k": top_k, "similarity_threshold": th, "page": 1, "size": top_k},
        )
        chunks = ((out.get("data") or {}).get("chunks")) or []
        print(f"\n  问题「{q}」: {len(chunks)} 命中")
        for i, c in enumerate(chunks, 1):
            content = (c.get("content_with_weight") or c.get("content") or "").replace("\n", " ")[:60]
            print(f"    #{i} sim={c.get('similarity'):.4f} tsim={c.get('term_similarity'):.4f} "
                  f"vsim={c.get('vector_similarity'):.4f} {content}")

    # 2) 变更集对比
    if target:
        for q, top_k, th, note in CASES:
            run_case(api, target, q, top_k, th, note)


if __name__ == "__main__":
    main()
