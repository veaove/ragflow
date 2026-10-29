#!/usr/bin/env python3
"""配置「全格式解析流水线」（数据流画布，幂等）。

做什么：在数据流画布上建一条 File → Parser → TokenChunker → Tokenizer 的
入库解析流水线，Parser 一次配齐 14 类格式，图片走「本地 OCR + 视觉模型描述」
双路、音频走 ASR 转写。

和「文件解析助手」的分工（两个是不同的东西，别混）：
  - 文件解析助手（agent_canvas）：聊天里丢文件问问题。文件在 run 前就被
    ParseAgentUploads 转成文本，音频只校验扩展名不转写、视频直接报错。
  - 本流水线（dataflow_canvas）：给知识库用的入库解析，走 Parser 组件的
    真实分派分支，音频能真转写。

已知边界（写清免得被当成 bug）：
  - 视频在这个版本里任何路径都不支持。`maybeDispatchVideo` 直接返回
    "video parsing is not yet supported"，因为底层没有抽帧能力（OpenAI 兼容
    驱动只认 image_url，Gemini 会静默丢掉 video_url）。这里仍然保留 video
    setup，是为了让上传视频时报出这句明确的原因，而不是掉进乱码兜底。

用法：
    export RF_SECRET_KEY=... RF_ACCESS_TOKEN=...
    python3 scripts/build_ingest_pipeline.py --dry-run   # 只打印 DSL
    python3 scripts/build_ingest_pipeline.py             # 建/更新
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from huaxia_configure import Api  # noqa: E402

PIPELINE_TITLE = "全格式解析流水线"

# 视觉模型：model_type=9（chat+vision），图片描述与 PDF 版面理解都用它。
VISION_LLM = "05f58e7067624c2aabba08eaf550df00"  # qwen3-vl-plus @ tongyi
# 语音转写：model_type=4（speech2text）。
ASR_LLM = "3a19f699c67e40e19392d4e83e17416e"  # qwen-audio-3.0-asr-flash @ tongyi

NODE_TYPE = {
    "File": "beginNode",
    "Parser": "parserNode",
    "TokenChunker": "chunkerNode",
    "Tokenizer": "tokenizerNode",
}

AUDIO_SUFFIX = [
    "da", "wave", "wav", "mp3", "aac", "flac", "ogg",
    "aiff", "au", "midi", "wma", "realaudio", "vqf", "oggvorbis", "ape",
]
CODE_SUFFIX = [
    "txt", "py", "js", "java", "c", "cpp", "h", "php",
    "go", "ts", "sh", "cs", "kt", "sql",
]
IMAGE_SUFFIX = ["jpg", "jpeg", "png", "gif", "bmp", "tif", "tiff", "webp", "svg"]
EMAIL_FIELDS = [
    "from", "to", "cc", "bcc", "date", "subject",
    "body", "attachments", "metadata",
]


def build_parser_params() -> dict:
    """Parser 参数：每个格式一个扁平 key（后端把人读的 setups 数组拍平成 map）。"""
    return {
        "pdf": {
            "order_index": 0,
            "output_format": "json",
            "pages": [],
            "parse_method": "DeepDOC",
            "remove_header_footer": False,
            "suffix": ["pdf"],
        },
        "spreadsheet": {
            "order_index": 1,
            "output_format": "json",
            "parse_method": "DeepDOC",
            "html4excel": False,
            "suffix": ["xls", "xlsx", "csv"],
        },
        "markdown": {
            "order_index": 2,
            "output_format": "json",
            "suffix": ["md", "markdown", "mdx"],
        },
        "text&code": {
            "order_index": 3,
            "output_format": "json",
            "suffix": CODE_SUFFIX,
        },
        "doc": {
            "order_index": 4,
            "output_format": "json",
            "remove_header_footer": False,
            "suffix": ["doc"],
        },
        "docx": {
            "order_index": 5,
            "output_format": "json",
            "remove_header_footer": False,
            "suffix": ["docx"],
        },
        "slides": {
            "order_index": 6,
            "output_format": "json",
            "parse_method": "DeepDOC",
            "suffix": ["ppt", "pptx"],
        },
        "html": {
            "order_index": 7,
            "output_format": "json",
            "remove_header_footer": False,
            "suffix": ["htm", "html"],
        },
        "image": {
            "order_index": 8,
            # ocr_enabled 是新的开关形态（老配置用 parse_method 编码同一件事）。
            # 开 OCR + 全局视觉增强 = 本地 OCR 出文字、视觉模型补语义描述。
            "ocr_enabled": True,
            "output_format": "json",
            "suffix": IMAGE_SUFFIX,
        },
        "audio": {
            "order_index": 9,
            "output_format": "text",
            "suffix": AUDIO_SUFFIX,
            # 这里显式钉 ASR 模型：留空会回退租户默认，换环境就可能换模型。
            "vlm": {"llm_id": ASR_LLM},
            "dialogue_split": False,
            "left_speaker": "坐席",
            "right_speaker": "客户",
        },
        "video": {
            "order_index": 10,
            "output_format": "json",
            "suffix": ["mp4", "avi", "mkv"],
            "prompt": "",
        },
        "email": {
            "order_index": 11,
            "output_format": "json",
            "fields": EMAIL_FIELDS,
            "suffix": ["eml", "msg"],
        },
        "epub": {
            "order_index": 12,
            "output_format": "json",
            "suffix": ["epub"],
        },
        "json": {
            "order_index": 13,
            "output_format": "json",
            "suffix": ["json", "jsonl", "ldjson"],
        },
        "enable_vision_enhancement": True,
        "vlm": {
            "llm_id": VISION_LLM,
            "system_prompt": (
                "请用中文客观描述这张图片：先一句话说明它是什么，"
                "再逐项列出图中可见的文字、数字、表格结构和关键信息。"
                "看不清的地方写「无法辨认」，不要猜测。"
            ),
        },
        "outputs": {
            "html": {"type": "string", "value": ""},
            "json": {"type": "Array<object>", "value": []},
            "markdown": {"type": "string", "value": ""},
            "text": {"type": "string", "value": ""},
        },
    }


def build_dsl() -> dict:
    comps: dict = {}
    nodes: list = []
    edges: list = []

    def add(cid, comp_name, params, upstream, pos, label, downstream=()):
        comps[cid] = {
            "downstream": list(downstream),
            "obj": {"component_name": comp_name, "params": params},
            "upstream": list(upstream),
        }
        nodes.append({
            "id": cid,
            "type": NODE_TYPE[comp_name],
            "position": {"x": pos[0], "y": pos[1]},
            "data": {"form": params, "label": label, "name": cid.split(":", 1)[-1]},
            "dragging": False,
            "selected": False,
            "sourcePosition": "right",
            "targetPosition": "left",
        })

    def link(src, tgt, handle="end"):
        edges.append({
            "id": f"xy-edge__{src}{handle}-{tgt}end",
            "source": src,
            "sourceHandle": handle,
            "target": tgt,
            "targetHandle": "end",
            "type": "buttonEdge",
            "markerEnd": "logo",
            "zIndex": 1001,
            "data": {"isHovered": False},
        })

    c_file, c_parser = "File", "Parser:AllFormats"
    c_chunk, c_tok = "TokenChunker:Text", "Tokenizer:Index"

    add(c_file, "File", {}, [], (0, 320), "File", [c_parser])
    link(c_file, c_parser, "start")

    add(c_parser, "Parser", build_parser_params(), [c_file], (320, 320),
        "Parser", [c_chunk])
    link(c_parser, c_chunk, "start")

    add(c_chunk, "TokenChunker", {
        "children_delimiters": [],
        "chunk_token_size": 512,
        "delimiter_mode": "delimiter",
        "delimiters": ["\n", "!", "?", ";", "。", "；", "！", "？"],
        "enable_children": False,
        "image_context_size": 0,
        "table_context_size": 0,
        "overlapped_percent": 0,
        "outputs": {"chunks": {"type": "Array<Object>", "value": []}},
    }, [c_parser], (700, 320), "TokenChunker", [c_tok])
    link(c_chunk, c_tok, "start")

    add(c_tok, "Tokenizer", {
        "fields": "text",
        "filename_embd_weight": 0.1,
        "outputs": {},
        "search_method": ["embedding", "full_text"],
    }, [c_chunk], (1060, 320), "Tokenizer")

    return {
        "components": comps,
        "globals": {"sys.history": []},
        "graph": {"nodes": nodes, "edges": edges},
        "variables": [],
    }


def check(dsl: dict) -> bool:
    comps = dsl["components"]
    errs = []
    for cid, c in comps.items():
        for d in c["downstream"]:
            if d not in comps:
                errs.append(f"{cid} 下游 {d} 不存在")
        for u in c["upstream"]:
            if u not in comps:
                errs.append(f"{cid} 上游 {u} 不存在")

    parser = comps["Parser:AllFormats"]["obj"]["params"]
    # image 必须至少有一个文本源，否则 Parser.Check() 直接拒绝构造
    img = parser.get("image", {})
    if not img.get("ocr_enabled") and not parser.get("enable_vision_enhancement"):
        errs.append("image 既没开 OCR 也没开视觉增强，Parser 会拒绝构造")
    # pdf 的 parse_method 不能为空（Check() 里硬校验）
    if not parser.get("pdf", {}).get("parse_method"):
        errs.append("pdf.parse_method 为空，Parser 会拒绝构造")
    # 音频没有模型时会回退租户默认，换环境就换模型，显式钉住更稳
    if not parser.get("audio", {}).get("vlm", {}).get("llm_id"):
        errs.append("audio.vlm.llm_id 为空，会回退租户默认 ASR")

    for e in errs:
        print(f"  ✗ {e}")
    return not errs


def find_pipeline(api: Api):
    data = api.get("/api/v1/agents?page=1&page_size=100")["data"]
    rows = data.get("canvas") if isinstance(data, dict) else data
    matches = [
        r for r in (rows or [])
        if (r.get("title") or "").startswith(PIPELINE_TITLE)
        and r.get("canvas_category") == "dataflow_canvas"
    ]
    if not matches:
        return None
    exact = [r for r in matches if r.get("title") == PIPELINE_TITLE]
    matches.sort(key=lambda r: r.get("create_time") or 0)
    chosen = exact[0] if exact else matches[0]
    for dup in matches:
        if dup is not chosen:
            print(f"  ! 发现同名副本 {dup.get('id')}（{dup.get('title')}），未处理")
    return chosen


def main() -> int:
    dsl = build_dsl()
    print("== 静态自检 ==")
    if not check(dsl):
        return 1
    print("  ✓ 通过")

    if "--dry-run" in sys.argv:
        print(json.dumps(dsl, ensure_ascii=False, indent=2))
        return 0

    api = Api()
    existing = find_pipeline(api)
    desc = (
        "一次配齐 14 类格式的入库解析：PDF/Word/Excel/CSV/Markdown/PPT/HTML/"
        "纯文本代码/图片(OCR+视觉)/音频(ASR)/邮件/EPUB/JSON。视频暂不支持（后端未实现抽帧）。"
    )
    if existing:
        pid = existing.get("id") or existing.get("canvas_id")
        old = existing.get("dsl")
        if isinstance(old, str):
            try:
                old = json.loads(old)
            except Exception:
                old = None
        if old == json.loads(json.dumps(dsl)):
            print(f"== {PIPELINE_TITLE}（{pid}）已是目标 DSL，跳过写入 ==")
            return 0
        api.put(f"/api/v1/agents/{pid}", {
            "title": PIPELINE_TITLE,
            "description": desc,
            "dsl": dsl,
            "release": bool(existing.get("release")),
        })
        print(f"== 已更新 {PIPELINE_TITLE}（{pid}）==")
    else:
        out = api.post("/api/v1/agents", {
            "title": PIPELINE_TITLE,
            "description": desc,
            "permission": "me",
            "canvas_category": "dataflow_canvas",
            "dsl": dsl,
        })
        payload = out.get("data") or {}
        pid = payload.get("id") or payload.get("canvas_id")
        if not pid:
            raise SystemExit(f"创建失败: {out}")
        print(f"== 已创建 {PIPELINE_TITLE}（{pid}）==")

    print(f"入口：/agent/{pid}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
