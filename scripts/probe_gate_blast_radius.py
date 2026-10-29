#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
minimum_should_match 的波及面：整库 9 条 FAQ 自问自答
========================================================
只读。用库里每条 chunk 自己的「问题：...」当问句，正确 chunk 应该排第一、
分数接近 1.0。分数掉到 0.2 附近 = 关键词通道被闸门掐死，只剩下向量腿。

问题在于线上没法直接「关闸门同时保持 vsm=0.3」，所以用融合公式反解：
    fused(vsm) = (1-vsm) * term + vsm * vector          （Infinity weighted_sum）
    三个采样点：
        s10 = search(vsm=1.0)  -> gate 必然为 0，且 term 权重为 0 => s10 = vector
        s80 = search(vsm=0.8)  -> gate 为 0（vsm>=0.8）         => s80 = 0.2*term + 0.8*vector
        s30 = search(vsm=0.3)  -> gate 为 0.3（今天的线上行为）
    反解 term = (s80 - 0.8*s10) / 0.2
    预测「闸门关闭 + vsm=0.3」= 0.7*term + 0.3*vector   <== 即修复后应得的分数

判据：
    s30 远低于 s80 的反推值 => 今天的闸门在吃分
    predicted - s30 > 0.2   => 这条问句今天被 bug 咬掉了 0.2 分以上

用法：
    export RF_BASE_URL=http://172.30.20.51
    export RF_SECRET_KEY=<kvrocks ragflow:system:secret_key>
    export RF_ACCESS_TOKEN=<user.access_token>
    python3 scripts/probe_gate_blast_radius.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from huaxia_configure import Api  # noqa: E402

KB = "6995fa4b2ad24d5f9270fcfe18d12d1d"  # 华夏基金FAQ库


def search(api, question, vsm, top_k=10):
    out = api.post(
        f"/api/v1/datasets/{KB}/search",
        {
            "question": question,
            "top_k": top_k,
            "similarity_threshold": 0.0,
            "vector_similarity_weight": vsm,
            "page": 1,
            "size": top_k,
        },
    )
    return ((out.get("data") or {}).get("chunks")) or []


def harvest_questions(api):
    """用一个大范围查询把库里所有 chunk 捞出来，取「问题：xxx」当问句。"""
    chunks = search(api, "基金", 0.0, top_k=30)
    seen = {}
    for c in chunks:
        text = (c.get("content") or c.get("content_with_weight") or "").replace("\n", " ")
        q = ""
        for marker in ("问题：", "问题:"):
            if marker in text:
                q = text.split(marker, 1)[1].split("回答", 1)[0].strip()
                break
        if not q:
            continue
        if q in seen:
            continue
        seen[q] = c.get("id") or c.get("chunk_id")
    return seen


def main():
    api = Api()
    questions = harvest_questions(api)
    print(f"库内自问句 {len(questions)} 条\n")

    head = (f"{'问句':<28}{'s30 今天':>10}{'term':>8}{'vector':>8}"
            f"{'预测(闸门0)':>12}{'Δ':>9}  判定")
    print(head)
    print("-" * len(head) * 1)

    damaged = []
    for q, cid in questions.items():
        s30 = search(api, q, 0.30)
        s80 = search(api, q, 0.80)
        s10 = search(api, q, 1.00)

        def top(hits, chunk_id):
            for h in hits:
                if (h.get("id") or h.get("chunk_id")) == chunk_id:
                    return h.get("similarity")
            return None

        a = top(s30, cid)
        b = top(s80, cid)
        c = top(s10, cid)
        if a is None or b is None or c is None:
            print(f"{q:<28}{'-':>10}{'-':>8}{'-':>8}{'-':>12}{'-':>9}  该 chunk 未返回")
            continue

        term = (b - 0.8 * c) / 0.2
        predicted = 0.7 * term + 0.3 * c
        delta = predicted - a
        flag = "被闸门吃掉" if delta > 0.2 else ("轻微" if delta > 0.02 else "正常")
        if delta > 0.2:
            damaged.append((q, a, predicted, delta))
        short = q if len(q) <= 26 else q[:25] + "…"
        print(f"{short:<28}{a:>10.4f}{term:>8.4f}{c:>8.4f}{predicted:>12.4f}{delta:>+9.4f}  {flag}")

    print()
    print(f"合计 {len(questions)} 条问句，其中 {len(damaged)} 条的正确答案被闸门压到 0.2 档。")
    if damaged:
        worst = max(damaged, key=lambda x: x[3])
        print(f"最严重：{worst[0]}  今天 {worst[1]:.4f} -> 修复后应得 {worst[2]:.4f}")


if __name__ == "__main__":
    main()
