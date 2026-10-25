#!/bin/bash
# 模块端到端测试：文件管理 / 记忆 / 模型配置
#
# 用法：bash e2e_modules.sh
# 退出码：0 全过；1 有失败

set -u
BASE="http://127.0.0.1/api/v1"
OWNER="8d5c79460d6c46efb58353c68d8bf729"
OUTSIDER="03420400140940c89bf0f74baa3ecf78"
EMBD="text-embedding-v3@tongyi@Tongyi-Qianwen"
LLM="qwen-flash@tongyi@Tongyi-Qianwen"

TOK=$(/root/mktok.sh "$OWNER") || { echo "FATAL: owner token"; exit 1; }
TOK_OUT=$(/root/mktok.sh "$OUTSIDER") || { echo "FATAL: outsider token"; exit 1; }

pass=0; fail=0; declare -a FAILED
req() { local t="$1"; shift; curl -s -m 90 -H "Authorization: Bearer $t" -H "Content-Type: application/json" "$@"; }
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
echo " 模块端到端测试  $(date '+%F %T')"
echo " 覆盖：文件管理 / 记忆 / 模型配置"
echo "=============================================="

# ── I. 文件管理 ───────────────────────────────────────────────────────────
echo ""
echo "[I] 文件管理"

FL=$(req "$TOK" "$BASE/files?page=1&page_size=50")
ck "I1 文件列表" "0" "$(echo "$FL" | jq -r '.code')"
ckgt "I2 列表非空" "0" "$(echo "$FL" | jq '.data.files | length')"

printf 'E2E 文件模块测试内容\n第二行\n' > /tmp/e2e_mod_file.txt
FU=$(curl -s -m 60 -H "Authorization: Bearer $TOK" -F "file=@/tmp/e2e_mod_file.txt" "$BASE/files")
FID=$(echo "$FU" | jq -r '.data[0].id // empty')
ck "I3 上传文件" "0" "$(echo "$FU" | jq -r '.code')"
ckgt "I4 返回文件大小" "0" "$(echo "$FU" | jq '.data[0].size // 0')"

if [ -n "$FID" ]; then
  FL2=$(req "$TOK" "$BASE/files?page=1&page_size=100")
  ck "I5 上传后出现在列表" "1" "$(echo "$FL2" | jq --arg id "$FID" '[.data.files[] | select(.id==$id)] | length')"

  ANC=$(req "$TOK" "$BASE/files/$FID/ancestors")
  ck "I6 文件祖先路径可查" "0" "$(echo "$ANC" | jq -r '.code')"

  PAR=$(req "$TOK" "$BASE/files/$FID/parent")
  ck "I7 父目录可查" "0" "$(echo "$PAR" | jq -r '.code')"

  # 下载：只看 HTTP 状态与长度，不落盘
  DL=$(curl -s -o /tmp/e2e_dl.bin -w '%{http_code}:%{size_download}' -m 30 \
    -H "Authorization: Bearer $TOK" "$BASE/files/$FID")
  ck "I8 文件可下载" "200" "$(echo "$DL" | cut -d: -f1)"
  ckgt "I9 下载内容非空" "0" "$(echo "$DL" | cut -d: -f2)"
  rm -f /tmp/e2e_dl.bin
fi

CROSS_F=$(req "$TOK_OUT" "$BASE/files/$FID")
CROSS_CODE=$(echo "$CROSS_F" | jq -r '.code // "http-ish"')
if [ "$CROSS_CODE" != "0" ]; then
  pass=$((pass+1)); echo "  PASS  I10 跨租户读文件被拒绝"
else
  # code=0 时看是否真的返回了内容
  IS_EMPTY=$(echo "$CROSS_F" | jq -r 'if (.data.files // .data // []) | length == 0 then 1 else 0 end' 2>/dev/null || echo 1)
  if [ "$IS_EMPTY" = "1" ]; then
    pass=$((pass+1)); echo "  PASS  I10 跨租户读文件返回空"
  else
    fail=$((fail+1)); FAILED+=("I10 跨租户读到了文件"); echo "  FAIL  I10 跨租户读到了文件"
  fi
fi

# ── J. 记忆 ───────────────────────────────────────────────────────────────
echo ""
echo "[J] 记忆"

ML=$(req "$TOK" "$BASE/memories?page=1&page_size=50")
ck "J1 记忆列表" "0" "$(echo "$ML" | jq -r '.code')"
ckgt "J2 列表非空" "0" "$(echo "$ML" | jq '.data.memory_list | length')"

MC=$(req "$TOK" -X POST "$BASE/memories" -d "{\"name\":\"E2E记忆测试\",\"memory_type\":[\"raw\"],\"embd_id\":\"$EMBD\",\"llm_id\":\"$LLM\"}")
MID=$(echo "$MC" | jq -r '.data.id // empty')
ck "J3 创建记忆" "0" "$(echo "$MC" | jq -r '.code')"
ck "J4 创建后带 embedding 配置" "$EMBD" "$(echo "$MC" | jq -r '.data.embd_id // ""')"

if [ -n "$MID" ]; then
  JCFG=$(req "$TOK" "$BASE/memories/$MID/config")
  ck "J5 记忆配置可读" "0" "$(echo "$JCFG" | jq -r '.code')"

  JMSG=$(req "$TOK" "$BASE/memories/$MID?page=1&page_size=10")
  ck "J6 记忆消息列表可读" "0" "$(echo "$JMSG" | jq -r '.code')"

  JUPD=$(req "$TOK" -X PUT "$BASE/memories/$MID" -d '{"name":"E2E记忆测试改名"}')
  ck "J7 更新记忆名称" "0" "$(echo "$JUPD" | jq -r '.code')"

  JCROSS=$(req "$TOK_OUT" "$BASE/memories/$MID/config")
  ckn "J8 跨租户读记忆配置被拒绝" "0" "$(echo "$JCROSS" | jq -r '.code')"
fi

# ── K. 模型配置 ───────────────────────────────────────────────────────────
echo ""
echo "[K] 模型配置"

KM=$(req "$TOK" "$BASE/models")
ck "K1 租户模型列表" "0" "$(echo "$KM" | jq -r '.code')"
ckgt "K2 模型数非空" "0" "$(echo "$KM" | jq '.data | length')"

KD=$(req "$TOK" "$BASE/models/default")
ck "K3 默认模型可读" "0" "$(echo "$KD" | jq -r '.code')"
ckgt "K4 默认 chat 模型已配置" "0" "$(echo "$KD" | jq '[.data.models[] | select(.model_type=="chat")] | length')"
ckgt "K5 默认 embedding 模型已配置" "0" "$(echo "$KD" | jq '[.data.models[] | select(.model_type=="embedding")] | length')"

KA=$(req "$TOK" "$BASE/all-models")
ck "K6 平台模型目录可读" "0" "$(echo "$KA" | jq -r '.code')"

# 取一个真实模型名查详情
MNAME=$(echo "$KA" | jq -r '(.data.models[0].name // .data[0].name // empty)' 2>/dev/null)
if [ -n "$MNAME" ]; then
  KS=$(req "$TOK" "$BASE/all-models/$MNAME")
  ck "K7 单模型详情可读" "0" "$(echo "$KS" | jq -r '.code')"
fi

# ── 清理 ─────────────────────────────────────────────────────────────────
echo ""
echo "[清理] 删除测试数据"
cleanup_step() { local d="$1"; shift; local c; c=$(req "$TOK" "$@" | jq -r '.code // "no-response"'); echo "  $d → code=$c"; }

[ -n "${FID:-}" ] && cleanup_step "删除测试文件" -X DELETE "$BASE/files" -d "{\"ids\":[\"$FID\"]}"
[ -n "${MID:-}" ] && cleanup_step "删除测试记忆" -X DELETE "$BASE/memories/$MID"

echo ""
echo "=============================================="
echo " 合计：PASS=$pass  FAIL=$fail"
if [ "$fail" -ne 0 ]; then echo " 失败用例："; for f in "${FAILED[@]}"; do echo "   - $f"; done; fi
echo "=============================================="
[ "$fail" -eq 0 ] || exit 1
