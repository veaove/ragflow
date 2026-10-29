#!/usr/bin/env python3
"""探测 Agent 运行时对各类文件的解析能力（上传 → run → sys.files）。

用途：回答「画布智能体能不能当解析智能体用」这个问题。
做法：建一个临时 Agent（Begin[file 输入] → Message{{sys.files}}），
逐个上传不同格式的文件并运行，打印 sys.files 的实际内容。

用法：
    export RF_SECRET_KEY=... RF_ACCESS_TOKEN=...
    python3 scripts/probe_agent_file_parse.py [--keep]

--keep  保留临时 Agent 与已上传文件（默认结束时清理）。

结论口径：只报实测结果，不推断。run 失败时打印 backend 的原始错误。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
import mimetypes
import os
import random
import string
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

BASE_URL = os.environ.get("RF_BASE_URL", "http://172.30.20.51").rstrip("/")
SECRET_KEY = os.environ.get("RF_SECRET_KEY", "").strip()
ACCESS_TOKEN = os.environ.get("RF_ACCESS_TOKEN", "").strip()

os.environ.setdefault("NO_PROXY", "172.30.20.51,127.0.0.1,localhost")
os.environ.setdefault("no_proxy", "172.30.20.51,127.0.0.1,localhost")
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def sign(token: str, secret: str) -> str:
    payload = json.dumps(token).encode()
    compressed = zlib_compress(payload)
    head = "." + _b64url(compressed) if len(compressed) < len(payload) - 1 else _b64url(payload)
    ts = _b64url(struct.pack(">Q", int(time.time())).lstrip(b"\x00"))
    value = head + "." + ts
    key = hashlib.sha1(("itsdangerous" + "signer" + secret).encode()).digest()
    return value + "." + _b64url(hmac.new(key, value.encode(), hashlib.sha1).digest())


def zlib_compress(b: bytes) -> bytes:
    import zlib

    return zlib.compress(b)


class Api:
    def __init__(self) -> None:
        if not SECRET_KEY or not ACCESS_TOKEN:
            raise SystemExit("缺少 RF_SECRET_KEY / RF_ACCESS_TOKEN")
        self.auth = sign(ACCESS_TOKEN, SECRET_KEY)

    def call(self, method: str, path: str, body=None, timeout=180):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(BASE_URL + path, data=data, method=method)
        req.add_header("Authorization", self.auth)
        req.add_header("Content-Type", "application/json")
        try:
            with OPENER.open(req, timeout=timeout) as r:
                return r.status, r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode("utf-8", "replace")

    def json(self, method: str, path: str, body=None):
        status, raw = self.call(method, path, body)
        try:
            out = json.loads(raw)
        except Exception:
            raise RuntimeError(f"非 JSON HTTP {status}: {raw[:300]}")
        return status, out

    def upload(self, path: str, filepath: str):
        filename = os.path.basename(filepath)
        boundary = "----WB" + "".join(random.choices(string.ascii_letters + string.digits, k=16))
        disp = f'Content-Disposition: form-data; name="file"; filename="{filename}"'
        mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        with open(filepath, "rb") as f:
            blob = f.read()
        payload = b"\r\n".join([
            f"--{boundary}".encode(),
            disp.encode(),
            f"Content-Type: {mime}".encode(),
            b"",
            blob,
            f"--{boundary}--".encode(),
            b"",
        ])
        req = urllib.request.Request(BASE_URL + path, data=payload, method="POST")
        req.add_header("Authorization", self.auth)
        req.add_header("Content-Type", "multipart/form-data; boundary=" + boundary)
        try:
            with OPENER.open(req, timeout=300) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as e:
            return {"code": e.code, "message": e.read().decode("utf-8", "replace")[:400]}

    def run_sse(self, path: str, body, timeout=300):
        data = json.dumps(body).encode()
        req = urllib.request.Request(BASE_URL + path, data=data, method="POST")
        req.add_header("Authorization", self.auth)
        req.add_header("Content-Type", "application/json")
        req.add_header("Accept", "text/event-stream")
        events = []
        try:
            with OPENER.open(req, timeout=timeout) as r:
                for raw in r:
                    line = raw.decode("utf-8", "replace").strip()
                    if not line.startswith("data:"):
                        continue
                    payload = line[5:].strip()
                    if payload in ("", "[DONE]"):
                        continue
                    try:
                        events.append(json.loads(payload))
                    except Exception:
                        events.append({"raw": payload})
        except urllib.error.HTTPError as e:
            return [{"http_error": e.code, "body": e.read().decode("utf-8", "replace")[:600]}]
        except Exception as e:  # socket timeout / reset
            return events + [{"client_error": repr(e)}]
        return events


# ---------- 测试文件生成 ----------

def write(path: str, data: bytes) -> str:
    with open(path, "wb") as f:
        f.write(data)
    return path


def make_pdf(path: str) -> str:
    text = "Huaxia Fund minimum investment 100 CNY. Subscription fee 0.15 percent."
    stream = f"BT /F1 14 Tf 40 700 Td ({text}) Tj ET".encode()
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for i, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for off in offsets[1:]:
        out += f"{off:010d} 00000 n \n".encode()
    out += (f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n").encode()
    return write(path, bytes(out))


def make_xlsx(path: str) -> str:
    ct = """<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>"""
    rels = """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"""
    wb = """<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>"""
    wb_rels = """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>"""
    rows = [
        ("基金代码", "基金名称", "起购金额"),
        ("000001", "华夏成长", "100"),
        ("510050", "华夏上证50ETF", "100"),
    ]
    cells = []
    for r, row in enumerate(rows, start=1):
        c = "".join(
            f'<c r="{chr(65 + i)}{r}" t="inlineStr"><is><t>{v}</t></is></c>'
            for i, v in enumerate(row)
        )
        cells.append(f'<row r="{r}">{c}</row>')
    sheet = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f"<sheetData>{''.join(cells)}</sheetData></worksheet>"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", ct)
        z.writestr("_rels/.rels", rels)
        z.writestr("xl/workbook.xml", wb)
        z.writestr("xl/_rels/workbook.xml.rels", wb_rels)
        z.writestr("xl/worksheets/sheet1.xml", sheet)
    return write(path, buf.getvalue())


def make_docx(path: str) -> str:
    ct = """<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"""
    rels = """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""
    doc = """<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>华夏基金定投说明</w:t></w:r></w:p>
<w:p><w:r><w:t>本基金最低定投金额为 100 元，申购费率 0.15%。</w:t></w:r></w:p>
<w:p><w:r><w:t>赎回确认时间为 T+1 个工作日。</w:t></w:r></w:p>
</w:body></w:document>"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", ct)
        z.writestr("_rels/.rels", rels)
        z.writestr("word/document.xml", doc)
    return write(path, buf.getvalue())


def make_png(path: str, width: int = 64, height: int = 64) -> str:
    """纯色 PNG。

    尺寸不能是 1×1：qwen3-vl 会以「height:1 or width:1 must be larger
    than 10」拒绝整次请求（实测），看着像解析失败，其实是图太小。
    """
    import zlib

    raw = b"".join(b"\x00" + b"\xff\x00\x00" * width for _ in range(height))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )
    return write(path, png)


def make_mp3(path: str) -> str:
    # MPEG-1 Layer3 帧头 + 静音负载。AudioParser 只校验扩展名，
    # 内容不参与判断；这里只要能上传即可。
    frame = b"\xff\xfb\x90\x64" + b"\x00" * 413
    return write(path, frame * 8)


def make_mp4(path: str) -> str:
    ftyp = struct.pack(">I", 24) + b"ftypmp42" + b"\x00\x00\x00\x00mp42isom"
    mdat = struct.pack(">I", 16) + b"mdat" + b"\x00" * 8
    return write(path, ftyp + mdat)


# ---------- Agent DSL ----------

def build_dsl() -> dict:
    begin_params = {
        "mode": "conversational",
        "inputs": {
            "doc": {
                "key": "doc",
                "type": "file",
                "name": "文档",
                "value": "",
                "optional": False,
                "options": [],
            }
        },
        "prologue": "",
    }
    message_params = {
        "content": "{{sys.files}}",
        "outputs": {"content": {"type": "string", "value": ""}},
    }
    components = {
        "begin_0": {
            "obj": {"component_name": "Begin", "params": begin_params},
            "upstream": [],
            "downstream": ["message_0"],
        },
        "message_0": {
            "obj": {"component_name": "Message", "params": message_params},
            "upstream": ["begin_0"],
            "downstream": [],
        },
    }

    def node(cid, x, y):
        cpn = components[cid]["obj"]
        return {
            "id": cid,
            "type": "canvasNode",
            "position": {"x": x, "y": y},
            "data": {
                "label": cpn["component_name"],
                "name": cid,
                "form": cpn["params"],
            },
        }

    return {
        "components": components,
        "graph": {
            "nodes": [node("begin_0", 0, 0), node("message_0", 400, 0)],
            "edges": [
                {
                    "id": "begin_0-message_0",
                    "source": "begin_0",
                    "target": "message_0",
                    "type": "buttonEdge",
                }
            ],
        },
        "globals": {"sys.files": [], "sys.query": ""},
        "variables": {},
    }


def extract_message(events: list) -> tuple[str, str]:
    """从 SSE 事件里取 (答案文本, 错误信息)。"""
    content, error = "", ""
    for ev in events:
        if "http_error" in ev:
            error = f"HTTP {ev['http_error']}: {ev['body']}"
            continue
        if "client_error" in ev:
            error = error or ev["client_error"]
            continue
        data = ev.get("data") or {}
        if isinstance(data, dict):
            if data.get("content") and ev.get("event") == "message":
                content += data["content"]
            if data.get("error"):
                error = error or str(data["error"])
            outputs = data.get("outputs") or {}
            if isinstance(outputs, dict) and outputs.get("_ERROR"):
                error = error or str(outputs["_ERROR"])
        if ev.get("code") not in (None, 0, "0"):
            error = error or f"code={ev.get('code')} {ev.get('message')}"
    return content, error


def main() -> int:
    keep = "--keep" in sys.argv
    workdir = os.path.join("/tmp", "probe_parse")
    os.makedirs(workdir, exist_ok=True)

    files = {
        "pdf": make_pdf(os.path.join(workdir, "huaxia.pdf")),
        "docx": make_docx(os.path.join(workdir, "huaxia.docx")),
        "xlsx": make_xlsx(os.path.join(workdir, "huaxia.xlsx")),
        "csv": write(
            os.path.join(workdir, "huaxia.csv"),
            "基金代码,基金名称,起购金额\n000001,华夏成长,100\n510050,华夏上证50ETF,100\n".encode(),
        ),
        "md": write(
            os.path.join(workdir, "huaxia.md"),
            "# 华夏基金定投说明\n\n- 最低定投金额 100 元\n- 申购费率 0.15%\n".encode(),
        ),
        "png": make_png(os.path.join(workdir, "huaxia.png")),
        "mp3": make_mp3(os.path.join(workdir, "huaxia.mp3")),
        "mp4": make_mp4(os.path.join(workdir, "huaxia.mp4")),
    }

    api = Api()
    status, out = api.json("GET", "/api/v1/users/me")
    if out.get("code") not in (0, None):
        raise SystemExit(f"鉴权失败: {status} {out}")
    print(f"== 鉴权 OK · {BASE_URL} ==")

    status, out = api.json(
        "POST",
        "/api/v1/agents",
        {
            "title": "ZZ临时解析探测",
            "description": "probe",
            "permission": "me",
            "canvas_category": "agent_canvas",
            "dsl": build_dsl(),
        },
    )
    agent = (out.get("data") or {})
    agent_id = agent.get("id") or agent.get("canvas_id")
    if not agent_id:
        raise SystemExit(f"创建 Agent 失败: {out}")
    print(f"== 临时 Agent: {agent_id} ==")

    results = []
    try:
        for fmt, path in files.items():
            up = api.upload(f"/api/v1/agents/{agent_id}/upload", path)
            if up.get("code") not in (0, None):
                results.append((fmt, "UPLOAD_FAIL", str(up.get("message"))[:200]))
                print(f"\n--- {fmt}: 上传失败 {up}")
                continue
            desc = up.get("data")
            descs = desc if isinstance(desc, list) else [desc]
            body = {
                "agent_id": agent_id,
                "query": f"解析这个 {fmt} 文件",
                "inputs": {
                    "doc": {
                        "key": "doc",
                        "type": "file",
                        "name": "文档",
                        "value": descs[0].get("id", ""),
                        "optional": False,
                        "options": [],
                    }
                },
                "files": descs,
                "stream": True,
            }
            # 前端走的是 /agents/chat/completions；/agents/{id}/run 不接受
            # files（RunAgent 的 files 参数在 handler 里硬传 nil），
            # 用错端点会静默丢掉文件、sys.files 恒空。
            events = api.run_sse("/api/v1/agents/chat/completions", body)
            content, error = extract_message(events)
            preview = content.strip().replace("\n", "\\n")[:300]
            if error:
                results.append((fmt, "RUN_ERROR", error[:300]))
                print(f"\n--- {fmt}: 运行报错 {error[:300]}")
            elif not content.strip():
                results.append((fmt, "EMPTY", f"events={len(events)}"))
                print(f"\n--- {fmt}: 空输出 (events={len(events)})")
            else:
                results.append((fmt, "OK", preview))
                print(f"\n--- {fmt}: OK ({len(content)} 字符)\n    {preview}")
    finally:
        if not keep:
            api.json("DELETE", f"/api/v1/agents/{agent_id}")
            print(f"\n== 已删除临时 Agent {agent_id} ==")

    print("\n==== 汇总 ====")
    for fmt, state, detail in results:
        print(f"{fmt:6s} {state:11s} {detail}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
