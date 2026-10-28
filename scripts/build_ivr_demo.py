#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
华夏基金客服热线 · IVR 流程演示生成器
=====================================
中国移动那种「按 1 按 9」的按键菜单 IVR。

产出（都在 docs/huaxia_kefu/ivr-demo/ 下）：
    index.html     可点击的 IVR 模拟器（拨号键盘 + 语音播报 + 分支跳转）
    audio/*.wav    全部播报语音（用 RAGFlow 的 TTS 接口预生成，音色统一）

用法：
    export RF_BASE_URL=http://172.30.20.51
    export RF_SECRET_KEY=... RF_ACCESS_TOKEN=...
    python scripts/build_ivr_demo.py          # 生成音频 + HTML
    python scripts/build_ivr_demo.py --html   # 只重建 HTML（音频已在，省时间）

设计原则（照搬运营商 IVR 的通行做法）：
  1. 一级菜单 5 个选项以内，选项名称先说「做什么」再说「按几」；
  2. 每层都留「返回上级」和「重听」，不让客户挂死；
  3. 按键无效要说清楚并自动重听，不能沉默；
  4. 转人工永远放在 9（运营商习惯），且要播报服务时间；
  5. 每段播报控制在 15 秒内（约 60 字），太长客户会按键打断。
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
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "docs", "huaxia_kefu", "ivr-demo")


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


def tts(text: str) -> bytes:
    """调 RAGFlow 的 TTS 接口，返回 WAV 字节。"""
    body = json.dumps({"text": text}).encode()
    req = urllib.request.Request(BASE_URL + "/api/v1/chat/audio/speech", data=body, method="POST")
    req.add_header("Authorization", sign(ACCESS_TOKEN, SECRET_KEY))
    req.add_header("Content-Type", "application/json")
    try:
        with OPENER.open(req, timeout=120) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"TTS 失败 HTTP {e.code}: {e.read()[:200]!r}")


# ======================================================================
# IVR 流程定义（唯一事实来源：改这里，音频和 HTML 一起变）
# ======================================================================
# 节点字段：
#   id      节点标识，也是音频文件名
#   say     播报文本（会合成语音 + 在页面上显示字幕）
#   keys    {按键: 目标节点 id}；按 * 回上级，按 0 重听本级
#   parent  上级节点（用于 * 返回）
#   end     True 表示挂机节点
#
# 说明：话术按运营商习惯写 —— 先说要办什么，再说按几；数字念法统一用汉字，
# 避免 TTS 把「1」念成「一」还是「幺」不一致（运营商一般念「幺」，这里统一「一」）。
NODES = {
    "welcome": {
        "say": "您好，欢迎致电华夏基金客户服务中心。基金有风险，投资需谨慎。"
               "基金交易请按一，账户与净值查询请按二，产品与费率请按三，"
               "转人工服务请按九，重听请按零。",
        "keys": {"1": "trade", "2": "account", "3": "product", "9": "human", "0": "welcome"},
        "parent": None,
    },
    # ---------------- 一级：1 基金交易 ----------------
    "trade": {
        "say": "基金交易。申购和认购请按一，赎回请按二，定投设置请按三，"
               "返回上级请按星号。",
        "keys": {"1": "trade_buy", "2": "trade_sell", "3": "trade_aip",
                 "*": "welcome", "0": "trade"},
        "parent": "welcome",
    },
    "trade_buy": {
        "say": "申购和认购。开放期内买入基金叫申购，新基金募集期内买入叫认购。"
               "可在官网、手机客户端或代销渠道办理，交易日十五点前提交按当日净值计算。"
               "如需了解具体操作，请按一并转智能客服，返回上级请按星号。",
        "keys": {"1": "smart", "*": "trade", "0": "trade_buy"},
        "parent": "trade",
    },
    "trade_sell": {
        "say": "赎回。赎回申请提交后，货币基金一般一个交易日内到账，"
               "股票型基金一般三到五个交易日到账，具体以基金合同为准。"
               "如需了解所持基金的赎回到账时间，请按一并转智能客服，返回上级请按星号。",
        "keys": {"1": "smart", "*": "trade", "0": "trade_sell"},
        "parent": "trade",
    },
    "trade_aip": {
        "say": "定投设置。基金定投起点金额为一百元，单次定投金额上限一般为二十万元。"
               "定投协议可在官网或手机客户端设置和修改。"
               "如需了解定投费率优惠，请按一并转智能客服，返回上级请按星号。",
        "keys": {"1": "smart", "*": "trade", "0": "trade_aip"},
        "parent": "trade",
    },
    # ---------------- 一级：2 账户与净值查询 ----------------
    "account": {
        "say": "账户与净值查询。基金净值请按一，账户份额请按二，分红查询请按三，"
               "返回上级请按星号。",
        "keys": {"1": "acc_nav", "2": "acc_share", "3": "acc_dividend",
                 "*": "welcome", "0": "account"},
        "parent": "welcome",
    },
    "acc_nav": {
        "say": "基金净值。基金净值每个交易日收市后更新，可在官网、手机客户端查询，"
               "也可以直接说出基金名称，由智能客服为您查询。"
               "现在转智能客服请按一，返回上级请按星号。",
        "keys": {"1": "smart", "*": "account", "0": "acc_nav"},
        "parent": "account",
    },
    "acc_share": {
        "say": "账户份额查询需要先验证身份。请通过手机客户端登录后查询，"
               "或按九转人工服务，返回上级请按星号。",
        "keys": {"9": "human", "*": "account", "0": "acc_share"},
        "parent": "account",
    },
    "acc_dividend": {
        "say": "分红查询。基金分红有现金分红和红利再投资两种方式，"
               "分红款到账时间以基金公告为准。想变更分红方式，需要在权益登记日之前办理。"
               "返回上级请按星号。",
        "keys": {"*": "account", "0": "acc_dividend"},
        "parent": "account",
    },
    # ---------------- 一级：3 产品与费率 ----------------
    "product": {
        "say": "产品与费率。基金费率请按一，产品类型请按二，风险等级请按三，"
               "返回上级请按星号。",
        "keys": {"1": "prod_fee", "2": "prod_type", "3": "prod_risk",
                 "*": "welcome", "0": "product"},
        "parent": "welcome",
    },
    "prod_fee": {
        "say": "基金费率。网上交易申购费率通常有折扣，具体费率以各基金公告为准。"
               "大额申购、定投和基金转换适用不同的费率规则。想了解具体某只基金的费率，"
               "请按一并转智能客服，返回上级请按星号。",
        "keys": {"1": "smart", "*": "product", "0": "prod_fee"},
        "parent": "product",
    },
    "prod_type": {
        "say": "产品类型。按投资对象分为股票型、混合型、债券型、货币市场基金，"
               "还有ETF、QDII、FOF和公募REITs。想知道哪类产品适合自己，"
               "请按一并转智能客服，返回上级请按星号。",
        "keys": {"1": "smart", "*": "product", "0": "prod_type"},
        "parent": "product",
    },
    "prod_risk": {
        "say": "风险等级。基金产品按风险从低到高分为五个等级，"
               "购买前需要完成风险测评，并确认与您的风险承受能力相匹配。"
               "基金不保本、不保收益。返回上级请按星号。",
        "keys": {"*": "product", "0": "prod_risk"},
        "parent": "product",
    },
    # ---------------- 智能客服 ----------------
    "smart": {
        "say": "正在为您转接智能客服，请直接说出您的问题，例如"
               "华夏基金客服电话是多少，或者基金定投起点金额是多少。",
        "keys": {"9": "human", "*": "welcome", "0": "smart"},
        "parent": "welcome",
        "smart": True,   # 标记：这个节点之后接收自然语言
    },
    # ---------------- 转人工 ----------------
    "human": {
        "say": "正在为您转接人工客服。人工服务时间为工作日八点三十分至二十一点，"
               "周末及节假日八点三十分至十七点。当前通话将为您转接，请稍候。"
               "也可以关注华夏基金微信公众号，通过在线客服联系我们。",
        "keys": {},          # 终点节点：播完即挂机，不给按键避免自我循环
        "parent": "welcome",
        "end": True,
    },
    # ---------------- 无效按键 ----------------
    "invalid": {
        "say": "抱歉，您输入的按键无效，请重新选择。",
        "keys": {},
        "parent": None,
        "silent": True,   # 不单独出页面，播完自动回上级
    },
}


# ======================================================================
# HTML 生成
# ======================================================================
HTML_TPL = r"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>华夏基金客服热线 · IVR 流程演示</title>
<style>
  :root {
    --bg: #0f172a; --panel: #1e293b; --panel2: #263449;
    --line: #334155; --text: #e2e8f0; --muted: #94a3b8;
    --accent: #10b981; --accent2: #0ea5e9; --warn: #f59e0b;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; background: radial-gradient(1200px 600px at 50% -10%, #1e3a5f 0%, #0f172a 60%);
    color: var(--text); font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
    display: flex; align-items: center; justify-content: center; padding: 24px;
  }
  .wrap { width: 100%; max-width: 1060px; display: grid; grid-template-columns: 360px 1fr; gap: 24px; }
  @media (max-width: 900px) { .wrap { grid-template-columns: 1fr; } }

  .phone {
    background: var(--panel); border: 1px solid var(--line); border-radius: 24px;
    padding: 20px; box-shadow: 0 24px 60px rgba(0,0,0,.45);
  }
  .status { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); margin-bottom: 14px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 10px var(--accent); }
  .dot.idle { background: #64748b; box-shadow: none; }
  .dot.busy { background: var(--warn); box-shadow: 0 0 10px var(--warn); }
  .node-name { margin-left: auto; font-family: ui-monospace, monospace; font-size: 12px; color: #64748b; }

  .caption {
    min-height: 96px; background: var(--panel2); border: 1px solid var(--line); border-radius: 14px;
    padding: 14px; font-size: 14px; line-height: 1.7; margin-bottom: 16px;
  }
  .caption .playing { color: var(--accent); font-size: 12px; margin-bottom: 6px; display: flex; align-items: center; gap: 6px; }
  .bars { display: inline-flex; gap: 2px; align-items: flex-end; height: 12px; }
  .bars i { width: 2px; background: var(--accent); animation: bounce .9s infinite; }
  .bars i:nth-child(2) { animation-delay: .15s } .bars i:nth-child(3) { animation-delay: .3s }
  @keyframes bounce { 0%,100% { height: 3px } 50% { height: 12px } }

  .keys { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .key {
    aspect-ratio: 1.5; border: 1px solid var(--line); background: var(--panel2); color: var(--text);
    border-radius: 12px; font-size: 20px; font-weight: 600; cursor: pointer; transition: .12s;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  }
  .key small { font-size: 10px; font-weight: 400; color: var(--muted); }
  .key:hover:not(:disabled) { background: #31445e; transform: translateY(-1px); }
  .key:active:not(:disabled) { transform: translateY(1px); }
  .key:disabled { opacity: .32; cursor: not-allowed; }
  .key.hot { border-color: var(--accent); color: var(--accent); }

  .hint { margin-top: 14px; font-size: 12px; color: var(--muted); line-height: 1.6; }
  .row { display: flex; gap: 10px; margin-top: 12px; }
  .btn {
    flex: 1; padding: 9px; border-radius: 10px; border: 1px solid var(--line);
    background: transparent; color: var(--text); font-size: 13px; cursor: pointer;
  }
  .btn:hover { background: var(--panel2); }
  .btn.primary { background: var(--accent); border-color: var(--accent); color: #052e21; font-weight: 600; }

  .side { background: var(--panel); border: 1px solid var(--line); border-radius: 24px; padding: 22px; }
  .side h1 { font-size: 17px; margin: 0 0 4px; }
  .side .sub { font-size: 12px; color: var(--muted); margin-bottom: 18px; }

  .log { display: flex; flex-direction: column; gap: 8px; max-height: 420px; overflow-y: auto; }
  .msg { padding: 10px 12px; border-radius: 10px; font-size: 13px; line-height: 1.65; }
  .msg.ivr { background: var(--panel2); border-left: 3px solid var(--accent2); }
  .msg.user { background: #1e3a5f; border-left: 3px solid var(--accent); align-self: flex-end; max-width: 88%; }
  .msg .k { font-size: 11px; color: var(--muted); display: block; margin-bottom: 3px; }

  .tree { margin-top: 18px; border-top: 1px solid var(--line); padding-top: 14px; }
  .tree h2 { font-size: 13px; color: var(--muted); margin: 0 0 10px; font-weight: 500; }
  .tree .item { display: flex; gap: 8px; font-size: 12px; padding: 4px 0; color: var(--muted); cursor: pointer; }
  .tree .item:hover { color: var(--text); }
  .tree .item.active { color: var(--accent); font-weight: 600; }
  .tree .item .code { font-family: ui-monospace, monospace; width: 42px; flex: none; }
</style>
</head>
<body>
<div class="wrap">
  <div class="phone">
    <div class="status">
      <span class="dot idle" id="dot"></span>
      <span id="statusText">未拨号</span>
      <span class="node-name" id="nodeName">—</span>
    </div>

    <div class="caption" id="caption">
      <div class="playing" id="playing" style="display:none">
        <span class="bars"><i></i><i></i><i></i></span> 正在播报
      </div>
      <div id="say">点击下方「拨号」开始，然后按 1 / 2 / 3 / 9 试操作。</div>
    </div>

    <div class="keys" id="keys"></div>

    <div class="row">
      <button class="btn primary" id="callBtn">拨号</button>
      <button class="btn" id="hangBtn" disabled>挂断</button>
    </div>
    <div class="hint">
      提示：按 <b>*</b> 返回上级，按 <b>0</b> 重听。按键选项会亮绿边。
    </div>
  </div>

  <div class="side">
    <h1>华夏基金客服热线 · IVR 流程演示</h1>
    <div class="sub">按键菜单 + 智能问答兜底。语音由平台 TTS 实时合成，流程与线上配置一致。</div>
    <div class="log" id="log"></div>
    <div class="tree" id="tree"></div>
  </div>
</div>

<script>
const NODES = __NODES__;

const el = (id) => document.getElementById(id);
const keysBox = el('keys'), logBox = el('log'), treeBox = el('tree');
let current = null, audio = null, calling = false, log = [], playToken = 0;

// 固定键盘布局（运营商习惯）
const LAYOUT = [
  ['1',''],['2',''],['3',''],
  ['4',''],['5',''],['6',''],
  ['7',''],['8',''],['9',''],
  ['*','返回'],['0','重听'],['#','']
];

function renderKeys() {
  const keys = (current && NODES[current].keys) || {};
  keysBox.innerHTML = '';
  LAYOUT.forEach(([k, sub]) => {
    const b = document.createElement('button');
    b.className = 'key' + (keys[k] ? ' hot' : '');
    b.innerHTML = k + (keys[k] && sub ? `<small>${sub}</small>` : (keys[k] ? '<small>可用</small>' : ''));
    b.disabled = !calling || !keys[k];
    b.onclick = () => press(k);
    keysBox.appendChild(b);
  });
}

function renderTree() {
  treeBox.innerHTML = '<h2>流程节点（点一下可直接跳）</h2>';
  Object.keys(NODES).forEach((id) => {
    if (NODES[id].silent) return;
    const d = document.createElement('div');
    d.className = 'item' + (id === current ? ' active' : '');
    d.innerHTML = `<span class="code">${id}</span><span>${NODES[id].say.slice(0, 26)}…</span>`;
    d.onclick = () => { if (calling) goto(id); else { start(); goto(id); } };
    treeBox.appendChild(d);
  });
}

function addLog(who, text, key) {
  log.push({ who, text, key });
  logBox.innerHTML = log.map((m) =>
    `<div class="msg ${m.who}">${m.key ? `<span class="k">按键 ${m.key}</span>` : ''}${m.text}</div>`
  ).join('');
  logBox.scrollTop = logBox.scrollHeight;
}

function stopAudio() {
  if (audio) { audio.pause(); audio.currentTime = 0; audio = null; }
  el('playing').style.display = 'none';
}

function play(nodeId, then) {
  const node = NODES[nodeId];
  stopAudio();
  el('say').textContent = node.say;
  el('playing').style.display = 'flex';
  el('dot').className = 'dot busy';
  el('statusText').textContent = '播报中';

  // 只允许 finish 触发一次：onended / onerror / 兜底超时抢跑会让状态机错乱
  // playToken 再防一层：上一段播报的兜底定时器不能干扰新的一段
  const my = ++playToken;
  let fired = false;
  const finish = () => {
    if (fired || my !== playToken) return;
    fired = true;
    el('playing').style.display = 'none';
    el('dot').className = 'dot';
    el('statusText').textContent = '请按键';
    if (then) then();
  };

  audio = new Audio(`audio/${nodeId}.wav`);
  audio.onended = finish;
  audio.onerror = finish;                 // 音频缺失：立刻恢复可按键，别让演示卡住
  audio.play().catch(() => setTimeout(finish, 1200));
  // 播放卡住（解码失败/被拦截）兜底：3 秒后还没开始播就放行
  setTimeout(() => {
    if (my === playToken && !fired && audio && audio.currentTime === 0) finish();
  }, 3000);
}

function goto(nodeId, pressedKey) {
  const node = NODES[nodeId];
  if (!node) return;
  current = nodeId;
  el('nodeName').textContent = nodeId;
  addLog('ivr', node.say, pressedKey);
  renderKeys();
  renderTree();
  play(nodeId, () => {
    if (node.end) {
      el('statusText').textContent = '已挂机';
      setTimeout(hangup, 900);
    }
  });
}

function press(k) {
  if (!calling || !current) return;
  const node = NODES[current];
  const target = node.keys[k];
  // 按键打断当前播报：运营商 IVR 的标准行为（barge-in）
  if (audio) { audio.onended = null; audio.onerror = null; stopAudio(); playToken += 1; }
  if (!target) {
    addLog('user', `按 ${k}`, k);
    // 无效按键：播提示再回本级
    stopAudio();
    el('say').textContent = NODES.invalid.say;
    el('playing').style.display = 'flex';
    let fired = false;
    const back = () => {
      if (fired) return;
      fired = true;
      el('playing').style.display = 'none';
      goto(current);
    };
    const a = new Audio('audio/invalid.wav');
    audio = a;
    a.onended = back;
    a.onerror = back;
    a.play().catch(() => setTimeout(back, 1000));
    return;
  }
  addLog('user', `按 ${k}`, k);
  goto(target, k);
}

function start() {
  calling = true;
  log = [];
  logBox.innerHTML = '';
  el('callBtn').textContent = '重拨';
  el('hangBtn').disabled = false;
  el('dot').className = 'dot';
  goto('welcome');
}

function hangup() {
  calling = false;
  current = null;
  stopAudio();
  el('dot').className = 'dot idle';
  el('statusText').textContent = '已挂机';
  el('say').textContent = '通话已结束。点击「重拨」重新开始。';
  el('playing').style.display = 'none';
  el('hangBtn').disabled = true;
  renderKeys();
  renderTree();
}

el('callBtn').onclick = () => { stopAudio(); start(); };
el('hangBtn').onclick = hangup;

// 支持键盘数字键，演示时不用鼠标点
document.addEventListener('keydown', (e) => {
  if (!calling || !current) return;
  if (/^[0-9*#]$/.test(e.key)) press(e.key);
});

renderKeys();
renderTree();
</script>
</body>
</html>
"""


def build_html():
    os.makedirs(OUT_DIR, exist_ok=True)
    # 只把页面需要的字段传给前端：去掉 silent 节点的文案细节无妨
    nodes = {k: {"say": v["say"], "keys": v.get("keys", {}),
                 "end": v.get("end", False), "silent": v.get("silent", False),
                 "smart": v.get("smart", False)}
             for k, v in NODES.items()}
    html = HTML_TPL.replace("__NODES__", json.dumps(nodes, ensure_ascii=False, indent=1))
    path = os.path.join(OUT_DIR, "index.html")
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"HTML 已生成：{path}")


def build_audio():
    audio_dir = os.path.join(OUT_DIR, "audio")
    os.makedirs(audio_dir, exist_ok=True)
    total = 0
    for node_id, node in NODES.items():
        path = os.path.join(audio_dir, f"{node_id}.wav")
        if os.path.exists(path) and os.path.getsize(path) > 1000:
            print(f"  跳过（已存在）{node_id}.wav")
            continue
        try:
            blob = tts(node["say"])
        except Exception as e:
            print(f"  [x] {node_id} 合成失败：{e}")
            continue
        with open(path, "wb") as f:
            f.write(blob)
        total += 1
        print(f"  + {node_id}.wav  {len(blob):>7} bytes  {node['say'][:24]}…")
    print(f"音频：新生成 {total} 段")


def check():
    """流程自检：死链 / 不可达 / 死胡同 / 自循环 / 音频缺失。

    改完 NODES 一定要跑一遍 —— 上次就是靠它抓到「转人工节点按 0 自我循环」。
    """
    errs = []
    for nid, n in NODES.items():
        outs = set((n.get("keys") or {}).values())
        for k, t in (n.get("keys") or {}).items():
            if t not in NODES:
                errs.append(f"{nid} 按 {k} → 目标 {t} 不存在")
        # 「按 0 重听本级」指向自己是设计意图，只有出口全指向自己才是死锁
        if outs and outs == {nid}:
            errs.append(f"{nid} 的出口全部指向自己，形成死锁")

    seen, stack = set(), ["welcome"]
    while stack:
        cur = stack.pop()
        if cur in seen:
            continue
        seen.add(cur)
        stack.extend((NODES[cur].get("keys") or {}).values())
    unreachable = set(NODES) - seen - {"invalid"}
    if unreachable:
        errs.append(f"从 welcome 不可达：{unreachable}")

    for nid, n in NODES.items():
        if not os.path.exists(os.path.join(OUT_DIR, "audio", f"{nid}.wav")):
            errs.append(f"缺音频 {nid}.wav")
        if not n.get("end") and not n.get("silent") and not (n.get("keys") or {}):
            errs.append(f"{nid} 是死胡同（无出口、也非结束节点）")

    print(f"节点 {len(NODES)} 个，可达 {len(seen)} 个，"
          f"按键分支 {sum(len(n.get('keys') or {}) for n in NODES.values())} 条")
    if errs:
        print("发现问题：")
        for e in errs:
            print("  [x]", e)
        return False
    print("校验通过：无死链、无死胡同、无自循环、音频齐全")
    return True


if __name__ == "__main__":
    if "--check" in sys.argv:
        sys.exit(0 if check() else 1)
    if "--html" not in sys.argv:
        build_audio()
    build_html()
    check()
