#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
同义词扩写 · 修复后预期效果量化
================================
不发布、不改配置，只读。

思路：修复（query_builder.go 的 rebaseMinMatchForSynonyms）做的是让
minimum_should_match 按「原词 clause 数 / 扩写后 clause 数」缩放。对下面这个
单段 + 6 个别名词的问题，缩放后闸门落到 ~2%，等价于关闭闸门。

而闸门「关闭」这件事，线上有一个现成的等价开关：
    minMatch(vsm, 0.3) = 0.0  当 vsm >= 0.8
    minMatch(vsm, 0.3) = 0.3  当 vsm <  0.8
（internal/service/nlp/retrieval.go:704）

所以同一套数据跑三次对比：
    A 原配置    vsm=0.30   -> 今天用户看到的基线分
    B 新配置    vsm=0.30   -> 今天用户看到的「分数反降」
    C 新配置    vsm=0.80   -> 闸门=0，即修复后新配置应得的分数

判据：
    C ≈ A  => 修复把分数还原了，扩写不再惩罚原词命中
    B << A  => 今天的 bug 幅度

用法：
    export RF_BASE_URL=http://172.30.20.51
    export RF_SECRET_KEY=<kvrocks ragflow:system:secret_key>
    export RF_ACCESS_TOKEN=<user.access_token>
    python3 scripts/probe_synonym_fix_expected.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from huaxia_configure import Api  # noqa: E402

KB = "6995fa4b2ad24d5f9270fcfe18d12d1d"  # 华夏基金FAQ库

CASES = [
    ("基金是怎么买", "扩写（截图3 的原始场景）"),
    ("买基金", "扩写"),
    ("申购费率是多少", "扩写"),
    ("基金怎么买", "不扩写（对照）"),
    ("我想买基金", "不扩写（切词切不出字典词）"),
]

TOP_K = 5
THRESHOLD = 0.2

# (标签, side, vector_similarity_weight)
#
# A/B 是今天两个配置在线上真实权重下的表现：A-B 就是用户看到的掉分幅度。
# C/D 把两侧同时抬到 vsm>=0.8 —— 那里 minMatch() 直接返回 0，闸门关闭。
# 「C ≈ D」= 闸门一放开，扩写对分数完全没有影响；于是修复（把闸门 rebase 到
# ~2%，等价于 0）之后，candidate 在 vsm=0.3 上的分数必然回到 A。
RUNS = [
    ("A 原配置 gate=0.3", 0.30, "baseline"),
    ("B 新配置 gate=0.3", 0.30, "candidate"),
    ("D 原配置 gate=0", 0.80, "baseline"),
    ("C 新配置 gate=0", 0.80, "candidate"),
]


def open_change_sets(api):
    out = api.get(f"/api/v1/datasets/{KB}/change-sets?status=open&page=1&page_size=20")
    data = out.get("data")
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get("change_sets") or data.get("items") or []
    return []


def compare(api, change_set_id, question, vsm):
    out = api.post(
        f"/api/v1/datasets/{KB}/change-sets/{change_set_id}/retrieval-compare",
        {
            "dataset_ids": [KB],
            "question": question,
            "top_k": TOP_K,
            "similarity_threshold": THRESHOLD,
            "vector_similarity_weight": vsm,
        },
    )
    return out.get("data") or {}


def index_hits(side):
    return {h["chunk_id"]: h for h in (side.get("hits") or [])}


def main():
    api = Api()
    sets = open_change_sets(api)
    if not sets:
        print("没有 open 变更集，无法做新配置对比")
        return
    cs = sets[0]["id"]
    print(f"变更集：{cs}\n")

    for question, note in CASES:
        print("=" * 92)
        print(f"问题「{question}」  ({note})   top_k={TOP_K} threshold={THRESHOLD}")

        probes = {}
        meta = {}
        for label, vsm, side in RUNS:
            d = compare(api, cs, question, vsm)
            meta[label] = d
            probes[label] = index_hits(d.get(side) or {})

        d0 = meta["A 原配置 gate=0.3"]
        print(f"  query_tokens          : {d0.get('query_tokens')}")
        print(f"  synonym_override_keys : {d0.get('synonym_override_keys')}")
        print(f"  extra_query_terms     : {d0.get('extra_query_terms')}")

        labels = [r[0] for r in RUNS]
        chunk_ids = set()
        for hits in probes.values():
            chunk_ids |= set(hits)
        ordered = sorted(
            chunk_ids,
            key=lambda cid: -(probes[labels[0]].get(cid, {}).get("similarity") or 0.0),
        )

        head = (f"  {'chunk':<14}{'A 原 gate.3':>12}{'B 新 gate.3':>12}"
                f"{'D 原 gate0':>12}{'C 新 gate0':>12}{'B-A':>9}{'C-D':>9}")
        print(f"\n{head}  内容")
        print("  " + "-" * 100)
        for cid in ordered:
            cells = [probes[lbl].get(cid) for lbl in labels]
            sims = [(c or {}).get("similarity") for c in cells]
            content = next((c.get("content") for c in cells if c), "") or ""
            content = content.replace("\n", " ")[:24]

            def fmt(v):
                return "   -   " if v is None else f"{v:7.4f}"

            sa, sb, sd, sc = sims
            db = "   -   " if (sa is None or sb is None) else f"{sb - sa:+7.4f}"
            dcd = "   -   " if (sc is None or sd is None) else f"{sc - sd:+7.4f}"
            print(f"  {cid[:12]:<14}{fmt(sa):>10}{fmt(sb):>12}"
                  f"{fmt(sd):>12}{fmt(sc):>12}{db:>9}{dcd:>9}  {content}")

        # 汇总
        lens = {lbl: len(probes[lbl]) for lbl in labels}
        print("\n  命中条数: " + "  ".join(f"{lbl.split()[0]}={lens[lbl]}" for lbl in labels))
        common = set.intersection(*(set(probes[lbl]) for lbl in labels))
        if common:
            def avg_delta(left, right):
                return sum(
                    probes[left][cid]["similarity"] - probes[right][cid]["similarity"]
                    for cid in common
                ) / len(common)

            print(f"  四者交集 {len(common)} 条："
                  f"今天(B-A) {avg_delta(labels[1], labels[0]):+.4f}；"
                  f"闸门关闭时扩写的净影响(C-D) {avg_delta(labels[3], labels[2]):+.4f}")
        print()

    print("=" * 92)
    print("读法：")
    print("  B-A  = 今天用户看到的掉分幅度（闸门 0.3 掐死了关键词通道）")
    print("  C-D  = 闸门关闭时，扩写本身对同一 chunk 的净影响；≈0 说明扩写不掉分")
    print("  既然 C≈D，把闸门 rebase 到 ~2%（修复）后，B 就会回到 A。")


if __name__ == "__main__":
    main()
