#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
华夏基金「华小夏」智能客服 · 配置脚本
=====================================
按《华夏基金_智能客服_配置方案_v2》落地配置。幂等：重复执行不产生重复对象。

凭据（不入库）：
    export RF_BASE_URL=http://172.30.20.51
    export RF_SECRET_KEY=<kvrocks ragflow:system:secret_key>
    export RF_ACCESS_TOKEN=<user.access_token>

子命令：
    status      打印租户现状快照（库/应用/智能体/质检/同义词）
    sandbox     建沙箱库 + 沙箱应用（复制生产 FAQ 文档）
    ivr         建 IVR 播报演示库 + 应用（tts 开、短答案）
    qc          建质检规则并绑定应用
    synonym     建同义词组
    similar     给高频标准问补相似问
    transfer    给「夏管家推送」加 transfer_enabled 开关（走 PUT /agents）
"""
import base64
import hashlib
import hmac
import json
import os
import struct
import sys
import time
import urllib.error
import urllib.request
import zlib

os.environ.setdefault("NO_PROXY", "172.30.20.51,127.0.0.1,localhost")
os.environ.setdefault("no_proxy", "172.30.20.51,127.0.0.1,localhost")

BASE_URL = os.environ.get("RF_BASE_URL", "http://127.0.0.1").rstrip("/")
SECRET_KEY = os.environ.get("RF_SECRET_KEY", "").strip()
ACCESS_TOKEN = os.environ.get("RF_ACCESS_TOKEN", "").strip()

TENANT_ID = "8d5c79460d6c46efb58353c68d8bf729"
EMBEDDING = "66efe49d791f41629de93675f4bf9a7c"  # 该租户现有库统一 embd_id
RERANK = "f9dac826d52c43f8b3799d78e73b4241"
LLM = "617d72a4b0c44995be2372940ddfebc8"

# 生产库（现状）
KB_FIRSTFAQ = "6995fa4b2ad24d5f9270fcfe18d12d1d"   # 华夏基金FAQ库（qa, 9 chunk）
KB_GREET = "01eea2cd12e1438ca7a06ef1031baeb0"     # 华夏基金寒暄库（qa, 2 chunk）
KB_FAQ = "ab87ed24c99f4dec92281414532f3bb1"       # 华夏基金FAQ话术（qa, 119 chunk）
KB_CHANNEL = "9d25d86e8bfc48ff9d7a50a515bd8180"   # 服务渠道（table, 45 chunk）

APP_PROD = "db888754c17946cbbc168d5408a13a58"     # 华小夏-客服
AGENT_TRANSFER = "8e19bc6c18eb42e093bd6bd7ae433e5b"  # 夏管家推送

OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


# ---------- 签名（与 internal/common/token.go 一致） ----------
def _b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def sign(token: str, secret: str) -> str:
    payload = json.dumps(token).encode()
    compressed = zlib.compress(payload)
    head = "." + _b64url(compressed) if len(compressed) < len(payload) - 1 else _b64url(payload)
    ts = _b64url(struct.pack(">Q", int(time.time())).lstrip(b"\x00"))
    value = head + "." + ts
    key = hashlib.sha1(("itsdangerous" + "signer" + secret).encode()).digest()
    return value + "." + _b64url(hmac.new(key, value.encode(), hashlib.sha1).digest())


class Api:
    def __init__(self):
        if not SECRET_KEY or not ACCESS_TOKEN:
            raise SystemExit("缺少 RF_SECRET_KEY / RF_ACCESS_TOKEN 环境变量")
        self.auth = sign(ACCESS_TOKEN, SECRET_KEY)

    def _call(self, method, path, body=None, expect_ok=True):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(BASE_URL + path, data=data, method=method)
        req.add_header("Authorization", self.auth)
        req.add_header("Content-Type", "application/json")
        req.add_header("Accept", "application/json")
        try:
            with OPENER.open(req, timeout=120) as r:
                raw, status = r.read().decode("utf-8", "replace"), r.status
        except urllib.error.HTTPError as e:
            raw, status = e.read().decode("utf-8", "replace"), e.code
        try:
            out = json.loads(raw)
        except Exception:
            raise RuntimeError(f"非JSON HTTP {status}: {raw[:300]}")
        if expect_ok and (status >= 400 or out.get("code") not in (0, None, "0")):
            raise RuntimeError(f"API错误 HTTP {status} {method} {path}: {json.dumps(out, ensure_ascii=False)[:500]}")
        return out

    def get(self, p):
        return self._call("GET", p)

    def post(self, p, b=None):
        return self._call("POST", p, b if b is not None else {})

    def put(self, p, b=None):
        return self._call("PUT", p, b if b is not None else {})

    def patch(self, p, b=None):
        return self._call("PATCH", p, b if b is not None else {})

    def delete(self, p, b=None):
        return self._call("DELETE", p, b if b is not None else {})

    def raw(self, path, method="GET", body=None, content_type=None):
        """对非 JSON 端点（下载/上传）发原始请求，返回 bytes。"""
        data = body
        req = urllib.request.Request(BASE_URL + path, data=data, method=method)
        req.add_header("Authorization", self.auth)
        if content_type:
            req.add_header("Content-Type", content_type)
        try:
            with OPENER.open(req, timeout=180) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"HTTP {e.code} {method} {path}: {e.read()[:300]!r}")

    def upload_file(self, path, filepath, fields):
        """multipart 上传一个文件 + 文本字段。"""
        import mimetypes
        import random
        import string
        import urllib.parse

        filename = os.path.basename(filepath)
        boundary = "----WB" + "".join(random.choices(string.ascii_letters + string.digits, k=16))
        parts = []
        for k, v in fields.items():
            parts.append(f"--{boundary}".encode())
            parts.append(f'Content-Disposition: form-data; name="{k}"'.encode())
            parts.append(b"")
            parts.append(str(v).encode())
        parts.append(f"--{boundary}".encode())
        disp = f'Content-Disposition: form-data; name="file"; filename="{filename}"'
        try:
            filename.encode("ascii")
        except UnicodeEncodeError:
            disp = ('Content-Disposition: form-data; name="file"; filename="doc%s"'
                    % os.path.splitext(filename)[1])
            disp += "; filename*=UTF-8''" + urllib.parse.quote(filename)
        parts.append(disp.encode())
        mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        parts.append(f"Content-Type: {mime}".encode())
        parts.append(b"")
        with open(filepath, "rb") as f:
            payload = b"\r\n".join(parts) + b"\r\n" + f.read() + b"\r\n"
        payload += f"--{boundary}--\r\n".encode()

        req = urllib.request.Request(BASE_URL + path, data=payload, method="POST")
        req.add_header("Authorization", self.auth)
        req.add_header("Content-Type", "multipart/form-data; boundary=" + boundary)
        try:
            with OPENER.open(req, timeout=300) as r:
                raw = r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"上传失败 HTTP {e.code}: {e.read()[:400]!r}")
        out = json.loads(raw)
        if out.get("code") not in (0, None, "0"):
            raise RuntimeError(f"上传失败：{out}")
        return out


# ---------- status ----------
def as_list(data, key=""):
    """兼容 {"chats":[...]} / {"agents":[...]} / [...] 三种返回形态。"""
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        if key and isinstance(data.get(key), list):
            return data[key]
        for v in data.values():
            if isinstance(v, list):
                return v
    return []


def cmd_status(api: Api):
    print("=" * 70)
    print("知识库")
    for d in as_list(api.get("/api/v1/datasets?page=1&page_size=100")["data"], "datasets"):
        chunk = d.get("chunk_num") or d.get("chunk_count") or 0
        doc = d.get("doc_num") or d.get("document_count") or 0
        print(f"  {d['name']:<28} {d['id']}  {str(d.get('language')):<8} {str(d.get('parser_id')):<8} "
              f"chunk={chunk:>4} doc={doc:>3}")

    print("\n问答应用")
    for d in as_list(api.get("/api/v1/chats?page=1&page_size=100")["data"], "chats"):
        print(f"  {d.get('name'):<20} {d.get('id')}  lang={d.get('language')} top_n={d.get('top_n')} "
              f"thr={d.get('similarity_threshold')} vw={d.get('vector_similarity_weight')} tts={d.get('tts')}")
        print(f"      kb_ids={d.get('kb_ids')}")

    print("\n智能体")
    for a in as_list(api.get("/api/v1/agents?page=1&page_size=100")["data"], "agents"):
        print(f"  {str(a.get('title')):<30} {a.get('id')}  release={a.get('release')}")

    print("\n质检规则")
    try:
        for r in as_list(api.get("/api/v1/qc/rules")["data"], "rules"):
            print(f"  {r.get('name')}  id={r.get('id')}  enabled={r.get('enabled')} scope={r.get('scope')}")
    except Exception as e:
        print(f"  [!] {e}")

    print("\n同义词组（按库统计；全局列表路由不存在，只能逐库查）")
    for kb in as_list(api.get("/api/v1/datasets?page=1&page_size=100")["data"], "datasets"):
        try:
            groups = as_list(api.get(f"/api/v1/datasets/{kb['id']}/synonym-groups")["data"], "groups")
        except Exception:
            continue
        if groups:
            print(f"  {kb['name']}（{len(groups)} 组）")
            for g in groups:
                words = g.get("words") or []
                print(f"    - {g.get('name')}  [{g.get('domain')}/{g.get('group_type')}] "
                      f"{len(words)} 词：{' / '.join(w.get('word', '') for w in words[:6])}")


def main():
    api = Api()
    action = sys.argv[1] if len(sys.argv) > 1 else "status"
    fn = globals().get(f"cmd_{action}")
    if not fn:
        print(__doc__)
        return
    fn(api)


# ======================================================================
# 同义词组
# ======================================================================
# 纪律（见方案 2.4）：
#   - 只放严格同义，不放上下位、不放相关推荐
#   - fund = 行业通用词；hx = 华夏专属（产品全称/简称/代码、渠道名）
#   - 反例不入表：基金=理财、赎回=卖出（方向相反的业务动作不合并）
#
# 重要：检索侧 GetDictionaryByDataset 只按 dataset_id 加载词典（不看 scope），
# 所以跨库生效的唯一办法是「每个库各建一套」，scope 填 kb 才与实现一致。
SYNONYMS = {
    KB_FAQ: [
        # (名称, domain, 类型, 词表[0]=主词, 备注)
        ("华夏成长混合", "hx", "proper",
         ["华夏成长混合", "华夏成长", "华夏成长基金", "华夏成长证券投资基金", "000001"],
         "产品别名族：全称/简称/代码"),
        ("申购", "fund", "synonym",
         ["申购", "买入", "购买", "申购基金"], "开放期买入动作"),
        ("认购", "fund", "synonym",
         ["认购", "认购新基金", "新基金认购"], "募集期买入动作，与申购严格区分"),
        ("赎回", "fund", "synonym",
         ["赎回", "卖出", "赎回基金", "卖出基金"], "卖出动作"),
        ("定投", "fund", "synonym",
         ["定投", "定期定额", "基金定投", "定期定投"], "定期定额投资"),
        ("净值", "fund", "synonym",
         ["净值", "单位净值", "基金净值"], "净值口径"),
        ("分红", "fund", "synonym",
         ["分红", "基金分红", "红利"], "分红"),
        ("客服电话", "hx", "synonym",
         ["客服电话", "客服热线", "服务电话", "人工客服电话", "投诉电话"],
         "华夏客服 400-818-6666 / 010-50919000"),
        ("风险测评", "fund", "synonym",
         ["风险测评", "风险承受能力测评", "风险评估", "风险问卷"], "适当性管理"),
        ("网上交易", "hx", "synonym",
         ["网上交易", "线上交易", "官网交易", "网上申购"], "华夏电子交易平台"),
    ],
    KB_CHANNEL: [
        ("线下网点", "hx", "synonym",
         ["线下网点", "网点", "营业网点", "理财中心", "分公司"], "线下渠道"),
        ("开户银行", "hx", "synonym",
         ["开户银行", "支持银行", "银行卡", "哪些银行"], "开户支持银行"),
        ("服务渠道", "hx", "synonym",
         ["服务渠道", "购买渠道", "交易渠道", "在哪买"], "渠道全集"),
    ],
}


def cmd_synonym(api: Api):
    """按库建同义词组，已存在同名组则跳过（幂等）。"""
    total_new = 0
    for kb_id, groups in SYNONYMS.items():
        existing = {g.get("name") for g in
                    as_list(api.get(f"/api/v1/datasets/{kb_id}/synonym-groups")["data"], "groups")}
        print(f"\n[{kb_id}] 已有 {len(existing)} 组")
        for name, domain, gtype, words, remark in groups:
            if name in existing:
                print(f"  跳过（已存在）{name}")
                continue
            body = {
                "name": name,
                "domain": domain,
                "scope": "kb",
                "group_type": gtype,
                "remark": remark,
                # 第一个词作主词，其余为别名
                "words": [{"word": w, "is_primary": i == 0} for i, w in enumerate(words)],
            }
            try:
                api.post(f"/api/v1/datasets/{kb_id}/synonym-groups", body)
                print(f"  + {name}  ({len(words)} 词, {domain}/{gtype})")
                total_new += 1
            except Exception as e:
                print(f"  [x] {name} 失败：{e}")
    print(f"\n同义词组：新建 {total_new} 个")


# ======================================================================
# 质检规则
# ======================================================================
# 现有（客户已配，不动）：
#   世界大势 / 国家政策  → 绑华小夏-客服，block，政治敏感词
#   禁止买卖基金V2 / 我的质检 → 绑旧应用「基金赎回客服」
# 缺的是金融合规红线，本批补齐（一律 warn + log_and_alert，只提示不拦截，
# 避免误伤真实咨询）。
QC_RULES = [
    ("QC-收益承诺-提示合规", "both", "warn",
     ["保证收益", "保本保收益", "稳赚", "一定赚", "承诺收益", "包赚", "无风险高收益",
      "保证赚钱", "稳赚不赔", "必赚"],
     "投顾合规提示：已识别到收益承诺类表述，请以基金合同和招募说明书为准，"
     "基金过往业绩不预示未来表现，我司不对收益作出任何承诺。"),
    ("QC-本金安全-提示风险", "ai_answer", "warn",
     ["保本", "不亏", "本金安全", "零风险", "绝对安全", "没有风险"],
     "风险提示：基金投资有风险，不保本、不保收益，请结合自身风险承受能力审慎决策。"),
    ("QC-投诉-提示转人工", "user_input", "warn",
     ["投诉", "我要投诉", "举报", "监管", "12386", "证监会", "起诉", "退钱"],
     "已识别到投诉诉求，正在为您转接人工坐席，也可拨打客服电话 400-818-6666 或"
     "发送邮件至 service@chinaamc.com。"),
    ("QC-适当性-提示测评", "ai_answer", "warn",
     ["高风险产品", "R4", "R5", "杠杆", "私募"],
     "适当性提示：该内容涉及较高风险产品，购买前请完成风险测评并确认与您的"
     "风险承受能力等级相匹配。"),
]


def cmd_qc(api: Api):
    """建金融合规质检规则，并把它们并入华小夏-客服的选用列表（幂等）。"""
    existing = {r.get("name"): r for r in as_list(api.get("/api/v1/qc/rules")["data"], "rules")}
    print(f"现有规则 {len(existing)} 条：{', '.join(existing)}")
    for name, scope, sev, kws, msg in QC_RULES:
        if name in existing:
            print(f"  跳过（已存在）{name}")
            continue
        body = {
            "app_type": "chat",
            "app_id": APP_PROD,
            "name": name,
            "keywords": kws,
            "match_mode": "contains",
            "scope": scope,
            "severity": sev,
            "action": "log_and_alert",
            "prompt_message": msg,
            "enabled": True,
        }
        try:
            api.post("/api/v1/qc/rules", body)
            print(f"  + {name}  ({len(kws)} 关键词, scope={scope})")
        except Exception as e:
            print(f"  [x] {name} 失败：{e}")

    # 选用列表是「完整集合」语义：必须把已有规则一起带上，否则会取消原规则。
    all_rules = as_list(api.get("/api/v1/qc/rules")["data"], "rules")
    prod_ids = [r["id"] for r in all_rules
                if r.get("app_id") == APP_PROD and r.get("app_type") == "chat"]
    api.put("/api/v1/qc/rules/selection",
            {"app_type": "chat", "app_id": APP_PROD, "rule_ids": prod_ids})
    print(f"\n华小夏-客服 已选用 {len(prod_ids)} 条规则")


# ======================================================================
# 相似问
# ======================================================================
# 只给高频标准问补（119 条全补不现实，按「客户真会怎么问」挑 15 条示范）。
# chunk_id -> 相似问列表（不含标准问本身，标准问已在 question_kwd 里）
SIMILAR_QUESTIONS = {
    "3a5d949edde2801d": ["华夏基金哪年成立的", "华夏基金成立多久了", "华夏基金几年了",
                         "公司什么时候成立的", "华夏基金历史多长"],
    "14babcd8a5e3dd14": ["客服电话多少", "华夏基金电话", "人工客服电话是多少", "怎么联系你们",
                         "客服邮箱是什么", "有没有投诉电话"],
    "6e0bceba0a941de6": ["客服几点上班", "人工客服几点下班", "服务时间是几点到几点",
                         "周末有人工客服吗", "晚上能联系客服吗"],
    "99d176b480806b13": ["怎么买基金", "网上怎么买基金", "在哪买基金", "申购流程是什么",
                         "手机怎么申购"],
    "008f6e0ff491211d": ["几点前买算今天", "交易截止时间", "15点前买算今天吗",
                         "下午三点后还能买吗", "基金交易时间"],
    "e8c3e5a9179b097f": ["什么时候能确认", "买了多久能查到", "T+1还是T+2", "申购几天确认",
                         "怎么查确认结果"],
    "253ba8dd28384e25": ["T日是什么意思", "T+1啥意思", "什么是T+1", "T日怎么算"],
    "a86d55bf139877be": ["我要投诉", "怎么投诉", "投诉渠道有哪些", "对服务不满意找谁",
                         "怎么提建议"],
    "2871eb370ef83ccc": ["保本吗", "能保证收益吗", "会不会亏", "基金能保本保收益吗",
                         "承诺收益吗"],
    "19ed090b999e7a07": ["货币基金保本吗", "货币基金等于存银行吗", "货币基金会亏吗"],
    "8a5ef15e44e82d3c": ["分红方式有哪些", "现金分红还是红利再投", "怎么选分红方式",
                         "分红怎么设置"],
    "dd9a11ff236acbe9": ["华夏基金app", "手机app在哪下载", "有没有官方app", "微信小程序叫什么"],
    "66b34e30624c7b5e": ["在哪买基金", "购买渠道有哪些", "怎么赎回", "从哪个渠道买最合适"],
    "6968d098ec70ff97": ["为什么要风险测评", "测评过期了怎么办", "风险测评多久有效",
                         "不做测评能买吗"],
    "962e4a119832411a": ["在哪买专户产品", "专户怎么买", "资产管理计划怎么购买",
                         "专户起点多少钱"],
}


def cmd_similar(api: Api):
    """给指定 chunk 追加相似问（幂等：已含则跳过；保留原标准问）。"""
    doc_id = "f086610274304cff8848aa8733d137cb"
    data = api.get(f"/api/v1/datasets/{KB_FAQ}/documents/{doc_id}/chunks?page=1&page_size=200")["data"]
    chunks = {c["chunk_id"]: c for c in data["chunks"]}
    print(f"FAQ 库共 {len(chunks)} 个 chunk，待补相似问 {len(SIMILAR_QUESTIONS)} 个")

    ok = skip = fail = 0
    for cid, extra in SIMILAR_QUESTIONS.items():
        c = chunks.get(cid)
        if not c:
            print(f"  [x] {cid} 不存在")
            fail += 1
            continue
        current = list(c.get("question_kwd") or [])
        missing = [q for q in extra if q not in current]
        if not missing:
            print(f"  跳过（已有）{current[0][:30]}")
            skip += 1
            continue
        merged = current + missing
        try:
            api.patch(f"/api/v1/datasets/{KB_FAQ}/documents/{doc_id}/chunks/{cid}",
                      {"questions": merged})
            print(f"  + {current[0][:26]:<28} +{len(missing):>2} 条 → 共 {len(merged)}")
            ok += 1
        except Exception as e:
            print(f"  [x] {current[0][:26]} 失败：{e}")
            fail += 1
    print(f"\n相似问：成功 {ok} / 跳过 {skip} / 失败 {fail}")


# ======================================================================
# 沙箱环境（方案 2.7 / 需求 7）
# ======================================================================
# 只复制「改动最频繁」的 FAQ 库；寒暄库与服务渠道库仅读不改，沙箱应用直接
# 绑生产库。这样沙箱既能验证 FAQ 变更，又不必维护三份副本。
KB_SANDBOX = "华夏基金FAQ话术-沙箱"
APP_SANDBOX = "华小夏-沙箱（模拟测试）"
FAQ_DOC = "f086610274304cff8848aa8733d137cb"
SANDBOX_PROMPT = (
    "【沙箱环境 · 仅供内部测试，请勿对外】\n"
    "你是华夏基金智能客服「华小夏」。回答要求与生产一致：只依据知识库作答、"
    "口语化、涉及收益风险不做承诺、保留引用标号。\n\n"
    "# 知识库\n{knowledge}\n"
)


def find_dataset(api: Api, name: str):
    for d in as_list(api.get("/api/v1/datasets?page=1&page_size=200")["data"], "datasets"):
        if d["name"] == name:
            return d
    return None


# ---------- 对象存储直取（RAGFlow 没有文档下载 API，沙箱复制需绕过） ----------
S3_ENDPOINT = os.environ.get("RF_S3_ENDPOINT", "http://172.30.20.51:9000")
S3_AK = os.environ.get("RF_S3_AK", "")
S3_SK = os.environ.get("RF_S3_SK", "")


def s3_get(bucket: str, obj: str) -> bytes:
    """SigV4 签名 GET 一个对象。RAGFlow 以 dataset_id 作 bucket。"""
    import urllib.parse

    if not S3_AK or not S3_SK:
        raise SystemExit("缺少 RF_S3_AK / RF_S3_SK")

    parsed = urllib.parse.urlparse(S3_ENDPOINT)
    host = parsed.netloc
    path = "/" + bucket + "/" + urllib.parse.quote(obj)
    now = time.gmtime()
    amz_date = time.strftime("%Y%m%dT%H%M%SZ", now)
    datestamp = time.strftime("%Y%m%d", now)
    region, service = "us-east-1", "s3"
    empty_hash = hashlib.sha256(b"").hexdigest()

    canonical_headers = (f"host:{host}\nx-amz-content-sha256:{empty_hash}\n"
                         f"x-amz-date:{amz_date}\n")
    signed_headers = "host;x-amz-content-sha256;x-amz-date"
    canonical_request = "\n".join([
        "GET", path, "", canonical_headers, signed_headers, empty_hash,
    ])
    scope = f"{datestamp}/{region}/{service}/aws4_request"
    string_to_sign = "\n".join([
        "AWS4-HMAC-SHA256", amz_date, scope,
        hashlib.sha256(canonical_request.encode()).hexdigest(),
    ])

    def _h(key, msg):
        return hmac.new(key, msg.encode(), hashlib.sha256).digest()

    k = _h(("AWS4" + S3_SK).encode(), datestamp)
    k = _h(k, region)
    k = _h(k, service)
    k = _h(k, "aws4_request")
    signature = hmac.new(k, string_to_sign.encode(), hashlib.sha256).hexdigest()

    auth = (f"AWS4-HMAC-SHA256 Credential={S3_AK}/{scope}, "
            f"SignedHeaders={signed_headers}, Signature={signature}")
    req = urllib.request.Request(S3_ENDPOINT + path)
    req.add_header("Authorization", auth)
    req.add_header("x-amz-content-sha256", empty_hash)
    req.add_header("x-amz-date", amz_date)
    with OPENER.open(req, timeout=180) as r:
        return r.read()


def find_chat(api: Api, name: str):
    for c in as_list(api.get("/api/v1/chats?page=1&page_size=200")["data"], "chats"):
        if c["name"] == name:
            return c
    return None


def cmd_sandbox(api: Api):
    """建沙箱库（复制 FAQ 文档）+ 沙箱应用。幂等。"""
    import tempfile

    kb = find_dataset(api, KB_SANDBOX)
    if kb:
        print(f"沙箱库已存在：{kb['id']}（chunk={kb.get('chunk_num')}）")
        kb_id = kb["id"]
    else:
        out = api.post("/api/v1/datasets", {
            "name": KB_SANDBOX,
            "embedding_model": EMBEDDING,
            "language": "Chinese",
            "permission": "me",
            "parse_type": 1,
            "parser_id": "qa",
        })
        kb_id = out["data"]["id"]
        print(f"+ 建库 {KB_SANDBOX} -> {kb_id}")

    docs = as_list(api.get(f"/api/v1/datasets/{kb_id}/documents?page=1&page_size=20")["data"], "docs")
    if docs:
        print(f"  沙箱库已有 {len(docs)} 个文档，跳过复制")
    else:
        blob = s3_get(KB_FAQ, "faq库.xlsx")
        tmp = os.path.join(tempfile.gettempdir(), "huaxia_faq_sandbox.xlsx")
        with open(tmp, "wb") as f:
            f.write(blob)
        print(f"  已从对象存储取到生产 FAQ 原文 {len(blob)} 字节 -> 上传沙箱库")
        api.upload_file(f"/api/v1/datasets/{kb_id}/documents", tmp,
                        {"parser_id": "qa", "run": "1"})
        print("  上传完成，已触发解析")

    app = find_chat(api, APP_SANDBOX)
    if app:
        print(f"沙箱应用已存在：{app['id']}")
    else:
        out = api.post("/api/v1/chats", {
            "name": APP_SANDBOX,
            "dataset_ids": [kb_id, KB_GREET, KB_CHANNEL],
            "llm_id": LLM,
            "rerank_id": RERANK,
            "language": "Chinese",
            "similarity_threshold": 0.35,
            "vector_similarity_weight": 0.63,
            "keywords_similarity_weight": 0.37,
            "top_n": 5,
            "top_k": 1024,
            "prompt_config": {"system": SANDBOX_PROMPT, "tts": False, "quote": True},
            "llm_setting": {"temperature": 0.2, "top_p": 0.75,
                            "presence_penalty": 0, "frequency_penalty": 0},
        })
        print(f"+ 建沙箱应用 {APP_SANDBOX} -> {out['data']['id']}")
    print("\n沙箱环境就绪")


# ======================================================================
# IVR 播报演示（需求 11，一期只做播报）
# ======================================================================
APP_IVR = "华小夏-IVR（语音播报）"
IVR_PROMPT = (
    "# 角色\n"
    "你是华夏基金电话客服的语音应答助手，回答会被 TTS 朗读给来电客户听。\n\n"
    "# 硬性要求\n"
    "1. 只依据知识库回答，不编造。\n"
    "2. **只输出纯口语**：不要 Markdown、不要列表、不要表格、不要括号注释、不要标点堆叠、"
    "不要出现「[1]」这类引用标号、不要念网址里的符号。\n"
    "3. **控制在 60 个字以内**，一句话说清结论；信息太多时只说最关键的一点，"
    "并提示「详细内容请转人工客服」。\n"
    "4. 数字念法要适合朗读：电话号码按位念，金额说「元」，日期说「月、日」。\n"
    "5. 涉及收益、风险时不作任何承诺。\n"
    "6. 知识库里没有答案时，只说：抱歉，这个问题我帮您转接人工客服。\n\n"
    "# 知识库\n{knowledge}\n"
)


def cmd_ivr(api: Api):
    """建 IVR 播报应用：tts 开、短答案 prompt、只绑短答案类库。"""
    app = find_chat(api, APP_IVR)
    if app:
        print(f"IVR 应用已存在：{app['id']}（tts={app.get('tts')}）")
        return
    out = api.post("/api/v1/chats", {
        "name": APP_IVR,
        "dataset_ids": [KB_FAQ, KB_GREET],
        "llm_id": LLM,
        "rerank_id": RERANK,
        "language": "Chinese",
        "similarity_threshold": 0.4,      # 语音场景宁可说"转人工"也不要答错
        "vector_similarity_weight": 0.6,
        "keywords_similarity_weight": 0.4,
        "top_n": 3,                        # 播报只要 1 条答案，多召回无益
        "top_k": 512,
        "prompt_config": {
            "system": IVR_PROMPT,
            "tts": True,
            "quote": False,                # 语音不念引用
            "prologue": "您好，这里是华夏基金智能语音助手，请讲。",
        },
        "llm_setting": {"temperature": 0.1, "top_p": 0.6,
                        "presence_penalty": 0, "frequency_penalty": 0},
    })
    print(f"+ 建 IVR 应用 {APP_IVR} -> {out['data']['id']}")


# ======================================================================
# 冒烟测试：跑智能体 / 问答应用，验证配置真的生效
# ======================================================================
def _sse(api: Api, path, body, method="POST"):
    """调用 SSE 端点，返回 (完整回答, 引用列表)。

    两种事件形态都要认：
      - 问答应用流式：data.answer（增量/整句重复送）
      - 智能体画布：event=message 时 data.content 是一次性整段
    引用在 message_end 事件的 data.reference 里。
    """
    data = json.dumps(body).encode()
    req = urllib.request.Request(BASE_URL + path, data=data, method=method)
    req.add_header("Authorization", api.auth)
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "text/event-stream")
    pieces, refs = [], []
    try:
        with OPENER.open(req, timeout=180) as r:
            for raw in r:
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                chunk = line[5:].strip()
                if not chunk or chunk == "[DONE]":
                    continue
                try:
                    ev = json.loads(chunk)
                except Exception:
                    continue
                if ev.get("code") not in (0, None, "0"):
                    return f"ERROR code={ev.get('code')} msg={ev.get('message')}", []
                d = ev.get("data")
                if not isinstance(d, dict):
                    continue
                for key in ("answer", "content"):
                    v = d.get(key)
                    if isinstance(v, str) and v:
                        pieces.append(v)
                if isinstance(d.get("reference"), list) and d["reference"]:
                    refs = d["reference"]
    except urllib.error.HTTPError as e:
        return f"HTTP {e.code}: {e.read()[:300].decode('utf-8', 'replace')}", []

    if not pieces:
        return "", refs
    # 这个实现会把整句重复送一遍，取最长片段才是完整答案；
    # 真增量流（每段几个字）则拼接。
    longest = max(pieces, key=len)
    text = longest if len(longest) * 2 >= sum(len(p) for p in pieces) else "".join(pieces)
    return text.strip(), refs


def cmd_test(api: Api):
    """跑三条用例验证：寒暄 / FAQ / 转人工。"""
    cases = ["在吗", "基金定投的起点金额是多少", "我要人工客服"]
    print("== 华小夏-客服（问答应用） ==")
    for q in cases:
        text, refs = _sse(api, "/api/v1/chat/completions",
                          {"chat_id": APP_PROD, "question": q, "stream": True})
        print(f"  Q: {q}")
        print(f"  A: {text[:200].replace(chr(10), ' ')}")
        print(f"  引用: {len(refs)} 条")
        print()

    ivr = find_chat(api, APP_IVR)
    if ivr:
        print("== 华小夏-IVR（语音播报） ==")
        for q in ["客服电话是多少", "基金保本吗"]:
            text, _ = _sse(api, "/api/v1/chat/completions",
                           {"chat_id": ivr["id"], "question": q, "stream": True})
            print(f"  Q: {q}")
            print(f"  A（将朗读）: {text[:150]}   [字数 {len(text)}]")
            print()

    print("== 夏管家推送（智能体） ==")
    for q in ["我要人工", "基金定投起点金额"]:
        text, _ = _sse(api, f"/api/v1/agents/{AGENT_TRANSFER}/run", {"question": q}, method="POST")
        print(f"  Q: {q}")
        print(f"  A: {text[:200].replace(chr(10), ' ')}")
        print()


# ======================================================================
# 回归验证：检查相似问 / 同义词是否真的影响命中
# ======================================================================
# (问法, 期望命中的 chunk_id, 说明) —— 期望值全部来自标准问的 chunk_id
EVAL_CASES = [
    ("华夏基金哪年成立的", "3a5d949edde2801d", "相似问（标准问是「什么时候成立的」）"),
    ("华夏基金几年了", "3a5d949edde2801d", "相似问"),
    ("客服电话多少", "14babcd8a5e3dd14", "相似问"),
    ("怎么投诉", "a86d55bf139877be", "相似问"),
    ("保本吗", "2871eb370ef83ccc", "相似问"),
    ("几点前买算今天", "008f6e0ff491211d", "相似问"),
    ("华夏基金是什么时候成立的？", "3a5d949edde2801d", "标准问原句（对照组）"),
    ("基金定投的起点金额是多少？", "6d06a13e3f4c9d5f", "标准问原句（对照组）"),
    ("怎么申购基金", "99d176b480806b13", "同义词展开（申购→买入/购买）"),
    ("定投最少多少钱", "6d06a13e3f4c9d5f", "同义词（定投→定期定额）+ 口语"),
    ("你们的服务电话是多少", "14babcd8a5e3dd14", "同义词（服务电话→客服电话）"),
]


def cmd_eval(api: Api):
    """直接调检索接口看召回，这是"配置是否生效"的直接证据。

    说明：为什么不用问答接口验证 —— 模型有时不输出 [ID:x] 标号，
    靠回答文本判断命中会得到假阴性。
    """
    ok = 0
    for q, expect, note in EVAL_CASES:
        body = {
            "dataset_ids": [KB_FAQ],
            "question": q,
            "page_size": 5,
            "similarity_threshold": 0.2,      # 放宽阈值，先看召回排序
            "vector_similarity_weight": 0.63,
            "keyword": True,
            "rerank_id": RERANK,
        }
        t0 = time.time()
        try:
            data = api.post("/api/v1/retrieval", body)["data"]
        except Exception as e:
            print(f"[ERR ] {q:<26} {e}")
            continue
        cost = time.time() - t0
        chunks = data.get("chunks") or []
        ids = [c.get("chunk_id") or c.get("id") for c in chunks]
        hit = expect in ids
        ok += 1 if hit else 0
        rank = ids.index(expect) + 1 if hit else "-"
        top = chunks[0] if chunks else {}
        # term_similarity 恒 0 说明关键词分词没生效（Infinity analyzer 建表即固定）
        ts = top.get("term_similarity")
        vs = top.get("vector_similarity")
        print(f"[{'PASS' if hit else 'FAIL'}] {q:<24} {cost:5.2f}s 排名={rank} "
              f"召回={len(chunks)} term={ts if ts is None else round(ts, 3)} "
              f"vec={vs if vs is None else round(vs, 3)}  ({note})")
    print(f"\n{ok}/{len(EVAL_CASES)} 通过")


# ======================================================================
# 转人工（需求 5）：上架「夏管家推送」智能体
# ======================================================================
# 关于「一键停用转人工」：结论是不改 DSL，用平台既有的发布开关。
# 原因：Begin 的 inputs 在 conversational 模式下会被用户输入覆盖
# （实测 begin.outputs = {"query":"我要人工","zuoxi_02":"我要人工"}，
#  配置的 zuoxi_02=1 并不生效），因此没法把开关塞进 Begin 再去 Switch 里判断。
# 停用转人工 = 下架这个智能体，入口即消失，这是现成且零风险的机制。
def cmd_transfer(api: Api):
    """检查「夏管家推送」的转人工链路，按需上架。

    默认只检查不发布：二维码素材还是占位符 xxxx，上架后客户点开是破图。
    客户给了真实二维码、替换掉 DSL 里的 URL 之后，再 `transfer --publish` 上架。
    """
    publish = "--publish" in sys.argv
    d = api.get(f"/api/v1/agents/{AGENT_TRANSFER}")["data"]
    print(f"{d.get('title')}  release={d.get('release')}")

    dsl = d["dsl"] if isinstance(d.get("dsl"), dict) else json.loads(d["dsl"])
    placeholders = []
    for k, v in dsl.get("components", {}).items():
        for line in (v.get("obj", {}).get("params", {}).get("content") or []):
            if "xxxx" in str(line) or "(http" not in str(line) and "![" in str(line):
                placeholders.append((k, str(line)[:100]))
    for k, line in placeholders:
        print(f"[素材待补] {k}：{line}")

    if not publish:
        print("\n仅检查。素材替换后加 --publish 上架。")
        return
    if placeholders:
        print("\n[拒绝上架] 二维码仍是占位符，上架会显示破图。先替换素材。")
        return
    api.post(f"/api/v1/agents/{AGENT_TRANSFER}/publish", {})
    print(f"已上架：release={api.get(f'/api/v1/agents/{AGENT_TRANSFER}')['data'].get('release')}")


if __name__ == "__main__":
    main()
