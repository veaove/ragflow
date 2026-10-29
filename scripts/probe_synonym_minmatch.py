#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
同义词扩写 · minimum_should_match 判别实验
==========================================
假设：扩写把 minimum_should_match(0.3) 的分母撑大，导致「只命中原词」的
chunk 被判为不达标、整条文字召回被过滤掉 -> term 通道分数归零。

验证手法（利用代码里的一个开关）：
    minMatch(vsm, 0.3) = 0.0  当 vsm >= 0.8
    minMatch(vsm, 0.3) = 0.3  当 vsm <  0.8
    （internal/service/nlp/retrieval.go:704）

所以在 vsm 从 0.79 扫到 0.80 时，权重只变了 1%，但闸门从 0.3 变成 0。
如果分数在这里**跳变**，就证明是 minMatch 在卡，而不是权重摊薄。

对照组：不扩写的问句在同一次扫描里不应出现同样的跳变。
全程只读。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from huaxia_configure import Api  # noqa: E402

KB = "6995fa4b2ad24d5f9270fcfe18d12d1d"

CASES = [
    ("买基金", True),        # 扩写
    ("申购费率是多少", True),  # 扩写
    ("基金怎么买", False),    # 不扩写（对照）
    ("开户需要准备什么", False),  # 不扩写（对照）
]

SWEEP = [0.0, 0.3, 0.5, 0.79, 0.80, 0.90]


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
    head = f"{'问句':<16}{'扩写':<6}" + "".join(f"{'vsm=' + str(v):>10}" for v in SWEEP)
    print(head)
    print("-" * len(head))
    rows = {}
    for q, expands in CASES:
        vals = [score(api, q, v) for v in SWEEP]
        rows[q] = vals
        cells = "".join(f"{'-' if v is None else f'{v:.4f}':>10}" for v in vals)
        print(f"{q:<16}{'是' if expands else '否':<6}{cells}")

    print("\n跳变检查（0.79 -> 0.80，权重只动 1%，闸门 0.3 -> 0）：")
    for q, expands in CASES:
        vals = rows[q]
        i79, i80 = SWEEP.index(0.79), SWEEP.index(0.80)
        a, b = vals[i79], vals[i80]
        if a is None or b is None:
            print(f"  {q}: 有缺失，跳过")
            continue
        jump = b - a
        flag = "  <== 跳变" if abs(jump) > 0.08 else ""
        print(f"  {q:<16} 扩写={'是' if expands else '否'}  "
              f"{a:.4f} -> {b:.4f}  Δ={jump:+.4f}{flag}")


if __name__ == "__main__":
    main()
