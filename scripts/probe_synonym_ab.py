#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
同义词扩写对分数的影响 · 判别实验
=================================
目的：分清「扩写本身把分数打下去」和「扩写根本没发生」。

判别手法：挑一对只差切词的问句，一个的 token 恰好等于字典里的词（会扩写），
一个不等于（不会扩写）。两边命中的是同一个 chunk，所以分数可直接比。

    买基金        token=买基金   == 字典 key「买基金」  -> 会扩写
    基金怎么买    token=基金买   != 任何字典 key        -> 不扩写

如果「买基金」的分数塌到 0.2 附近而「基金怎么买」是 0.9，说明扩写把关键词通道
打死了（查询串非法或权重被摊薄）；如果两者都高，说明扩写没问题，真正的毛病在
状态隔离。全程只读，只调 /datasets/{kb}/search。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from huaxia_configure import Api  # noqa: E402

KB = "6995fa4b2ad24d5f9270fcfe18d12d1d"

# 会扩写 / 不扩写 的成对问句（目标 chunk 都是 972c1a18… 那条「基金怎么买」）
CASES = [
    ("买基金", "token 恰等于字典词 -> 会扩写"),
    ("基金怎么买", "token=基金买，字典无此 key -> 不扩写"),
    ("申购", "token 恰等于字典词（申购费组 + 购买基金组）-> 会扩写"),
    ("申购费", "token 恰等于字典词 -> 会扩写"),
    ("申购费率", "token 在字典值里、也是 key -> 会扩写"),
    ("赎回基金", "token 恰等于字典词 -> 会扩写"),
    ("卖基金", "token 在「赎回基金」组的值里 -> 不扩写"),
]


def tune(api, q):
    out = api.post(
        f"/api/v1/datasets/{KB}/search",
        {"question": q, "top_k": 5, "similarity_threshold": 0.0, "page": 1, "size": 5},
    )
    return ((out.get("data") or {}).get("chunks")) or []


def main():
    api = Api()
    print(f"{'问句':<12} {'#1 sim':>8} {'#1 tsim':>8} {'#1 vsim':>8}  说明")
    print("-" * 86)
    for q, note in CASES:
        chunks = tune(api, q)
        if not chunks:
            print(f"{q:<12} {'-':>8} {'-':>8} {'-':>8}  {note}  (0 命中)")
            continue
        c = chunks[0]
        content = (c.get("content_with_weight") or "").replace("\n", " ")[:28]
        print(f"{q:<12} {c.get('similarity', 0):>8.4f} {c.get('term_similarity', 0):>8.4f} "
              f"{c.get('vector_similarity', 0):>8.4f}  {note}")
        print(f"{'':<12} -> {content}")


if __name__ == "__main__":
    main()
