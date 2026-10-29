#!/usr/bin/env python3
"""验证一条数据流解析流水线：建临时知识库 → 上传多格式文件 → 解析 → 看 chunk。

为什么要有这个脚本：画布保存成功 ≠ 解析链路跑得通。Parser 的每个格式
分支都有各自的模型依赖（音频要 ASR、图片要 OCR/视觉、PDF 要 DeepDOC），
只有真的把文件送进流水线、再读回 chunk，才知道配得对不对。

用法：
    export RF_SECRET_KEY=... RF_ACCESS_TOKEN=...
    python3 scripts/verify_ingest_pipeline.py <pipeline_id> [--keep]

默认结束时删除临时知识库（连带文档与分片），--keep 保留以便进界面看效果。
"""

from __future__ import annotations

import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from huaxia_configure import Api  # noqa: E402
from probe_agent_file_parse import (  # noqa: E402
    make_docx,
    make_pdf,
    make_png,
    make_xlsx,
    write,
)

EMBD_ID = "66efe49d791f41629de93675f4bf9a7c"  # text-embedding-v3 @ tongyi
WORKDIR = "/tmp/probe_parse"


def build_files() -> dict[str, str]:
    os.makedirs(WORKDIR, exist_ok=True)
    files = {
        "pdf": make_pdf(f"{WORKDIR}/pipe.pdf"),
        "docx": make_docx(f"{WORKDIR}/pipe.docx"),
        "xlsx": make_xlsx(f"{WORKDIR}/pipe.xlsx"),
        "png": make_png(f"{WORKDIR}/pipe.png", 320, 200),
        "md": write(f"{WORKDIR}/pipe.md", "# 华夏基金定投\n\n最低定投金额 100 元。\n".encode()),
    }
    wav = f"{WORKDIR}/huaxia_voice.wav"
    if os.path.exists(wav):
        files["wav"] = wav
    else:
        print("! 缺少语音样本，跳过音频验证（见 build_ingest_pipeline 说明）")
    return files


def upload(api: Api, kb_id: str, paths: dict[str, str]) -> dict[str, str]:
    """逐个上传，返回 格式 → document_id。"""
    docs: dict[str, str] = {}
    for fmt, path in paths.items():
        up = api.upload_file(f"/api/v1/datasets/{kb_id}/documents", path, {})
        data = up.get("data")
        rows = data if isinstance(data, list) else [data]
        doc_id = (rows[0] or {}).get("id") if rows else None
        if not doc_id:
            print(f"  {fmt}: 上传失败 {json.dumps(up, ensure_ascii=False)[:200]}")
            continue
        docs[fmt] = doc_id
        print(f"  {fmt}: 已上传 {doc_id}")
    return docs


def wait_done(api: Api, kb_id: str, doc_ids: list[str], timeout: int = 300) -> dict[str, str]:
    """轮询到每个文档都进终态（DONE/FAIL），返回 doc_id → ingestion_status。

    document 表里没有 run 字段（那是接口拼出来的展示值），状态真身是
    ingestion_status。早先按 run 取，取到空串就会一路轮询到超时，
    看着像解析卡死，其实早就完成了。
    """
    deadline = time.time() + timeout
    state: dict[str, str] = {}
    while time.time() < deadline:
        out = api.get(f"/api/v1/datasets/{kb_id}/documents?page=1&page_size=100")
        rows = ((out.get("data") or {}).get("docs")) or []
        state = {
            r.get("id"): str(r.get("ingestion_status") or "")
            for r in rows if r.get("id") in doc_ids
        }
        pending = [v for v in state.values() if v not in ("DONE", "FAIL")]
        if state and not pending:
            return state
        time.sleep(3)
    return state


def main() -> int:
    if len(sys.argv) < 2:
        raise SystemExit("用法: verify_ingest_pipeline.py <pipeline_id> [--keep]")
    pipeline_id = sys.argv[1]
    keep = "--keep" in sys.argv

    api = Api()
    name = f"ZZ流水线验证{int(time.time()) % 100000}"
    out = api.post("/api/v1/datasets", {
        "name": name,
        "embedding_model": EMBD_ID,
        "parse_type": 2,
        "pipeline_id": pipeline_id,
    })
    kb = (out.get("data") or {})
    kb_id = kb.get("id")
    if not kb_id:
        raise SystemExit(f"建知识库失败: {out}")
    print(f"== 临时知识库 {name}（{kb_id}），pipeline={pipeline_id} ==")

    exit_code = 0
    try:
        print("== 上传 ==")
        docs = upload(api, kb_id, build_files())
        if not docs:
            raise SystemExit("没有文件上传成功")

        print("== 触发解析 ==")
        api.post(f"/api/v1/datasets/{kb_id}/documents/parse",
                 {"document_ids": list(docs.values())})

        state = wait_done(api, kb_id, list(docs.values()))
        print("== 解析结果 ==")
        for fmt, doc_id in docs.items():
            st = state.get(doc_id, "?")
            chunks_out = api.get(
                f"/api/v1/datasets/{kb_id}/documents/{doc_id}/chunks?page=1&page_size=10"
            )
            payload = chunks_out.get("data") or {}
            chunks = payload.get("chunks") or []
            total = payload.get("total") or len(chunks)
            print(f"\n--- {fmt}: run={st} chunks={total}")
            if str(st).upper() == "FAIL":
                d = api.get(f"/api/v1/datasets/{kb_id}/documents?id={doc_id}")
                detail = ((d.get("data") or {}).get("docs") or [{}])[0]
                print(f"    失败原因：{detail.get('progress_msg') or detail.get('progress')}")
                exit_code = 1
                continue
            for c in chunks[:3]:
                text = (c.get("content") or c.get("content_with_weight") or "").strip()
                print("    · " + text[:260].replace("\n", "\n      "))
            if not chunks:
                exit_code = 1
    finally:
        if keep:
            print(f"\n== 保留知识库 {name}（{kb_id}）==")
        else:
            api.delete("/api/v1/datasets", {"ids": [kb_id]})
            print(f"\n== 已删除临时知识库 {kb_id} ==")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
