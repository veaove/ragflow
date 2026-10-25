#!/bin/bash
# 实时通道测试：流式对话（SSE）/ 质检 WebSocket 推送
#
# WebSocket 不能只用 curl -I 验：-I 发的是 HEAD，路由只认 GET，会假 404。
# 这里用 python 手写握手 + 帧解析，验证「真能收到 qc_hit 事件」。
#
# 用法：bash e2e_realtime.sh
# 退出码：0 全过；1 有失败

set -u
BASE="http://127.0.0.1/api/v1"
OWNER="8d5c79460d6c46efb58353c68d8bf729"
# 这个 chat 应用已绑定「我的质检」规则（关键词「你好」，block），
# 用它触发真实拦截，不需要改动任何配置。
CHAT_APP="89f5898eea16403baaeebbdeb45e1043"

TOK=$(/root/mktok.sh "$OWNER") || { echo "FATAL: token"; exit 1; }

pass=0; fail=0; declare -a FAILED
ck() {
  if [ "$2" = "$3" ]; then pass=$((pass+1)); echo "  PASS  $1"
  else fail=$((fail+1)); FAILED+=("$1 (want=$2 got=$3)"); echo "  FAIL  $1    want=[$2] got=[$3]"; fi
}
ckn() {
  if [ "$2" != "$3" ]; then pass=$((pass+1)); echo "  PASS  $1"
  else fail=$((fail+1)); FAILED+=("$1 (should not be $2)"); echo "  FAIL  $1    should not be [$2]"; fi
}
ckgt() {
  if [ "$3" -gt "$2" ] 2>/dev/null; then pass=$((pass+1)); echo "  PASS  $1"
  else fail=$((fail+1)); FAILED+=("$1 (want >$2 got=$3)"); echo "  FAIL  $1    want >[$2] got=[$3]"; fi
}

echo "=============================================="
echo " 实时通道测试  $(date '+%F %T')"
echo " 覆盖：流式对话 SSE / 质检 WebSocket"
echo "=============================================="

# ── R. 流式对话 ───────────────────────────────────────────────────────────
echo ""
echo "[R] 流式对话（stream=true）"

SSE=$(timeout 70 curl -sN -m 65 -X POST -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  "$BASE/chat/completions" \
  -d "{\"chat_id\":\"$CHAT_APP\",\"question\":\"知识库怎么用\",\"stream\":true}" 2>&1 | head -c 6000)

NCHUNK=$(echo "$SSE" | grep -c 'data:')
ckgt "R1 流式返回多个 chunk" "1" "$NCHUNK"
# 注意响应体是 "answer": "..."（冒号后有空格），正则必须容忍空白
NANS=$(echo "$SSE" | grep -c '"answer"')
ckgt "R2 多数 chunk 含 answer 字段" "1" "$NANS"
ckgt "R3 含 final 标记" "0" "$(echo "$SSE" | grep -c 'final')"
# 拼接后的正文应有实质内容（不是全是空字符串）
TOTAL_LEN=$(echo "$SSE" | grep -oE '"answer": *"[^"]*"' | sed -E 's/"answer": *"//;s/"$//' | tr -d '\n' | wc -c)
ckgt "R4 拼接正文非空" "5" "$TOTAL_LEN"

# ── S. 质检 WebSocket ─────────────────────────────────────────────────────
echo ""
echo "[S] 质检 WebSocket"

# S1: 无 token 握手不应升级
NOTOK=$(curl -s -i -N -m 5 -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  "$BASE/qc/stream" 2>&1 | head -1)
ckn "S1 无 token 不升级为 101" "101" "$(echo "$NOTOK" | grep -c '101')"

# S2/S3: 带 token 握手 + 触发真实命中后收帧
WS_OUT=$(python3 "$(dirname "$0")/ws_qc.py" "$TOK" "$CHAT_APP" 2>&1)
ck "S2 带 token 握手成功" "1" "$(echo "$WS_OUT" | grep -c '101 Switching Protocols')"
ckgt "S3 收到 WebSocket 帧" "0" "$(echo "$WS_OUT" | grep -o 'TOTAL_FRAMES=[0-9]*' | cut -d= -f2)"
ck "S4 收到 qc_hit 事件" "1" "$(echo "$WS_OUT" | grep -c 'qc_hit')"

echo ""
echo "=============================================="
echo " 合计：PASS=$pass  FAIL=$fail"
if [ "$fail" -ne 0 ]; then echo " 失败用例："; for f in "${FAILED[@]}"; do echo "   - $f"; done; fi
echo "=============================================="
[ "$fail" -eq 0 ] || exit 1
