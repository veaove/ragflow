#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
同义词扩写 · 通路拆分实验
=========================
把 vector_similarity_weight 推到两个极端，看扩写到底把哪一路打死了。

    vsm = 0.0  纯关键词通道（term leg）  -> 分数 = atan(BM25) 归一化
    vsm = 1.0  纯向量通道（vector leg）  -> 分数 = 1 - cosine_distance
    vsm = 0.3  默认（term 0.7 / vector 0.3）

判读：
  扩写组 vsm=1.0 与不扩写组相同，而 vsm=0.0 时扩写组塌到 0
      -> 关键词通道被扩写打死了（查询串/权重问题）
  两组 vsm=1.0 都低
      -> 向量通道的问题（不该发生，扩写只改关键词串）

全程只读。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from huaxia_configure import Api  # noqa: E402

KB = "6995fa4b2ad24d5f9270fcfe18d12d1d"

# (问句, 期望是否扩写)
CASES = [
    ("基金怎么买", False),   # token=基金买，字典无 key
    ("买基金", True),        # token=买基金，字典有 key
    ("申购费率是多少", True),  # token=申购费率，字典有 key
]


def score(api, q, vsm):
    out = api.post(
        f"/api/v1/datasets/{KB}/search",
        {
            "question": q,
            "top_k": 3,
            "similarity_threshold": 0.0,
            "vector_similarity_weight": vsm,
            "page": 1,
            "size": 3,
        },
    )
    chunks = ((out.get("data") or {}).get("chunks")) or []
    if not chunks:
        return None
    return chunks[0].get("similarity", 0.0)


def main():
    api = Api()
    print(f"{'问句':<14}{'扩写':<6}{'vsm=0(纯词)':>12}{'vsm=0.3(默认)':>14}{'vsm=1(纯向量)':>14}")
    print("-" * 66)
    for q, expands in CASES:
        s_term = score(api, q, 0.0)
        s_def = score(api, q, 0.3)
        s_vec = score(api, q, 1.0)
        fmt = lambda v: "-" if v is None else f"{v:.4f}"  # noqa: E731
        print(f"{q:<14}{'是' if expands else '否':<6}{fmt(s_term):>12}{fmt(s_def):>14}{fmt(s_vec):>14}")


if __name__ == "__main__":
    main()
