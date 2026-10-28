#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
给内置解析流程模板补 help 段（卡片问号提示用）。

为什么不写在前端：模板能力（支持格式、切分粒度、产出什么）是模板自身的属性。
写死在前端会导致「加模板要改前端」，而且中英文各写一遍容易漂移。

formats 用展示用短名（PDF / DOCX），不写 MIME —— 面向使用者，不是给程序判断。
"""

import json
import io
import os

TEMPLATE_DIR = "internal/ingestion/pipeline/template"

HELP = {
    "general": {
        "zh": {
            "formats": ["PDF", "DOCX", "TXT", "MD", "HTML", "XLSX", "PPTX", "PNG", "JPG"],
            "usage": "没有固定版式的普通文档。不确定该选哪个模板时，先用它。",
            "output": "按 token 数切块，跨页内容会合并。适合通用问答检索。",
        },
        "en": {
            "formats": ["PDF", "DOCX", "TXT", "MD", "HTML", "XLSX", "PPTX", "PNG", "JPG"],
            "usage": "Everyday documents without a fixed layout. Pick this when unsure.",
            "output": "Chunks by token count, merging across pages. Good for general Q&A retrieval.",
        },
    },
    "qa": {
        "zh": {
            "formats": ["XLSX", "CSV", "TXT"],
            "usage": "已有整理好的问答对，一行一问一答，不需要模型再组织。",
            "output": "一问一答成一个块，检索直接命中标准答案，准确率最高。文件需有「问题」「答案」两列。",
        },
        "en": {
            "formats": ["XLSX", "CSV", "TXT"],
            "usage": "Prepared Q&A pairs, one per row — no need for the model to organise them.",
            "output": "One Q&A per chunk, so retrieval hits the canonical answer directly. Requires question and answer columns.",
        },
    },
    "manual": {
        "zh": {
            "formats": ["PDF", "DOCX"],
            "usage": "操作手册、产品说明书、实施 SOP。",
            "output": "按章节层级切分，保留「第X章 / X.X」结构，检索时能带出操作步骤。",
        },
        "en": {
            "formats": ["PDF", "DOCX"],
            "usage": "Operation manuals, product guides, SOPs.",
            "output": "Splits along section hierarchy and keeps chapter numbering, so retrieved chunks carry the full procedure.",
        },
    },
    "table": {
        "zh": {
            "formats": ["XLSX", "CSV"],
            "usage": "结构化表格：费率表、参数表、产品清单、财务数据。",
            "output": "按行切块，每块带上表头，数值和字段名一起进入检索。",
        },
        "en": {
            "formats": ["XLSX", "CSV"],
            "usage": "Structured sheets: rate tables, parameter tables, product lists, financials.",
            "output": "One row per chunk with the header repeated, so values stay attached to their column names.",
        },
    },
    "paper": {
        "zh": {
            "formats": ["PDF"],
            "usage": "学术论文、技术白皮书、研究综述。",
            "output": "按摘要与章节切分，保留公式、图表标题和参考文献编号。",
        },
        "en": {
            "formats": ["PDF"],
            "usage": "Academic papers, technical whitepapers, literature reviews.",
            "output": "Splits by abstract and sections, preserving formulas, figure captions and reference numbers.",
        },
    },
    "book": {
        "zh": {
            "formats": ["PDF", "DOCX", "EPUB"],
            "usage": "长篇书籍、制度汇编、培训教材。",
            "output": "按章节切分，块较大以保留上下文，适合需要连贯理解的问答。",
        },
        "en": {
            "formats": ["PDF", "DOCX", "EPUB"],
            "usage": "Long books, policy compilations, training material.",
            "output": "Splits by chapter with larger chunks to keep context, suited to questions that span passages.",
        },
    },
    "laws": {
        "zh": {
            "formats": ["PDF", "DOCX"],
            "usage": "法律法规、监管文件、合同条款。",
            "output": "按「第X条」切分，一条一块，引用时能精确带出条文号。",
        },
        "en": {
            "formats": ["PDF", "DOCX"],
            "usage": "Statutes, regulatory filings, contract clauses.",
            "output": "One article per chunk so citations carry the exact clause number.",
        },
    },
    "presentation": {
        "zh": {
            "formats": ["PPTX", "PDF"],
            "usage": "汇报材料、方案演示、培训课件。",
            "output": "按页切分，保留页面标题与要点，尽量复原页内阅读顺序。",
        },
        "en": {
            "formats": ["PPTX", "PDF"],
            "usage": "Deck-style material: proposals, demos, training slides.",
            "output": "One slide per chunk, keeping the slide title and reading order.",
        },
    },
    "picture": {
        "zh": {
            "formats": ["PNG", "JPG", "JPEG", "MP4"],
            "usage": "截图、扫描件、产品图片、演示视频。",
            "output": "OCR 提取图中文字并生成图注；视频按关键帧与音轨分段。图片本身会保留引用。",
        },
        "en": {
            "formats": ["PNG", "JPG", "JPEG", "MP4"],
            "usage": "Screenshots, scans, product shots, demo videos.",
            "output": "Runs OCR and generates captions; videos are split by keyframe and audio track. The image itself stays referenceable.",
        },
    },
    "one": {
        "zh": {
            "formats": ["PDF", "DOCX", "TXT", "MD"],
            "usage": "短文档（一两页），需要整篇一起理解，不能被切断。",
            "output": "整篇作为一个块，不做切分。适合通知、函件、简短合同。",
        },
        "en": {
            "formats": ["PDF", "DOCX", "TXT", "MD"],
            "usage": "Short documents (a page or two) that must stay intact to make sense.",
            "output": "The whole document becomes one chunk, no splitting. Good for notices, letters, short contracts.",
        },
    },
    "audio": {
        "zh": {
            "formats": ["MP3", "WAV", "M4A"],
            "usage": "客服通话录音、会议录音、培训音频。",
            "output": "先语音转写，再按时间或说话人分段；转写文本进入检索，音频可回听定位。",
        },
        "en": {
            "formats": ["MP3", "WAV", "M4A"],
            "usage": "Call recordings, meeting audio, training audio.",
            "output": "Transcribes first, then splits by time or speaker. Transcripts are searchable and link back to the audio.",
        },
    },
    "email": {
        "zh": {
            "formats": ["EML", "MSG"],
            "usage": "邮件归档、客户往来记录。",
            "output": "按单封邮件切分，保留发件人、时间和正文，忽略签名与免责声明。",
        },
        "en": {
            "formats": ["EML", "MSG"],
            "usage": "Email archives, customer correspondence.",
            "output": "One email per chunk with sender, timestamp and body kept; signatures and disclaimers dropped.",
        },
    },
}


def main():
    changed = 0
    for key, help_content in HELP.items():
        path = os.path.join(TEMPLATE_DIR, f"ingestion_pipeline_{key}.json")
        if not os.path.exists(path):
            print(f"MISSING: {path}")
            continue

        with io.open(path, encoding="utf-8-sig") as f:
            data = json.load(f)

        if data.get("help") == help_content:
            print(f"skip  {key} (unchanged)")
            continue

        data["help"] = help_content
        # CRLF + 2 空格：与原文件一致，diff 只落在新增的 help 段
        with io.open(path, "w", encoding="utf-8", newline="\r\n") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        changed += 1
        print(f"write {key}")

    print(f"\nupdated {changed} template(s)")


if __name__ == "__main__":
    main()
