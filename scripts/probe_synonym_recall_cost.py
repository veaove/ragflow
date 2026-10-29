#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
同义词扩写 · minMatch 闸门的召回代价
====================================
已证：扩写把关键词通道打到 0，根因是 minimum_should_match(0.3) 按「扩写后的
词数」计算门槛（vsm 0.79->0.80 时该值变 0，分数从 0.55 跳到 0.76）。

本脚本量化两种修法的代价：
  A. minMatch 保持 0.3（现状）      -> 原词命中的 chunk 被整条过滤
  B. minMatch 归 0（扩写时）        -> 看召回是否泛滥（total 是否暴涨）

用 vsm 当开关：vsm=0.79 -> 0.3 闸门；vsm=0.80 -> 0 闸门。
纯关键词（term leg）用 vsm=0 单独看一条基线。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from huaxia_configure import Api  # noqa: E402

KB = "6995fa4b2ad24d5f9270fcfe18d12d1d"

CASES = [
    ("买基金", True),
    ("申购费率是多少", True),
    ("赎回基金", True),
    ("基金行业怎么样", True),
    ("基金怎么买", False),
    ("开户需要准备什么", False),
]


def query(api, q, vsm, size=10):
    out = api.post(
        f"/api/v1/datasets/{KB}/search",
        {
            "question": q,
            "top_k": size,
            "similarity_threshold": 0.0,
            "vector_similarity_weight": vsm,
            "page": 1,
            "size": size,
        },
    )
    d = out.get("data") or {}
    chunks = d.get("chunks") or []
    top = chunks[0].get("similarity", 0.0) if chunks else 0.0
    return top, len(chunks), (chunks[0].get("content_with_weight") or "")[:34].replace("\n", " ")


def main():
    api = Api()
    print(f"{'问句':<16}{'扩写':<6}{'闸门0.3 top':>11}{'条数':>5}   {'闸门0 top':>10}{'条数':>5}")
    print("-" * 72)
    for q, expands in CASES:
        t03, n03, c03 = query(api, q, 0.79)
        t00, n00, _ = query(api, q, 0.80)
        print(f"{q:<16}{'是' if expands else '否':<6}{t03:>11.4f}{n03:>5}   {t00:>10.4f}{n00:>5}")
        print(f"{'':<12}  top内容: {c03}")

    print("\n判读：")
    print("  扩写组：闸门0.3 时 top 低 = 原词命中的 chunk 被过滤；闸门0 后恢复才算修好")
    print("  对照组：两个闸门应基本一致（它们本来就没有扩写词来撑大门槛）")


if __name__ == "__main__":
    main()
