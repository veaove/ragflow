#!/bin/bash
# 业务数据流端到端测试：文档全生命周期 / 对话 / 质检拦截
#
# 补 e2e_business_features.sh 的缺口：那份测「资源管理」，这份测「数据流」——
# 文件进去能不能变成 chunk、chunk 能不能被召回、规则配了到底拦不拦。
#
# 用法：bash e2e_business_flow.sh
# 退出码：0 全过；1 有失败

set -u
BASE="http://127.0.0.1/api/v1"

OWNER="8d5c79460d6c46efb58353c68d8bf729"
OUTSIDER="03420400140940c89bf0f74baa3ecf78"
# 这个 chat 应用原本 qc_rule_binding 为空（规则归属但不生效），
# 正好用来做「绑定/解绑」对照，不影响其它应用的绑定。
CHAT_APP="db888754c17946cbbc168d5408a13a58"
MARK="E2E拦截标记词"

TOK=$(/root/mktok.sh "$OWNER") || { echo "FATAL: owner token 失败"; exit 1; }
TOK_OUT=$(/root/mktok.sh "$OUTSIDER") || { echo "FATAL: outsider token 失败"; exit 1; }

pass=0; fail=0; declare -a FAILED

req() { local t="$1"; shift; curl -s -m 90 -H "Authorization: Bearer $t" -H "Content-Type: application/json" "$@"; }
ask() { # ask <question> -> 打印 answer 前 60 字
  req "$TOK" -X POST "$BASE/chat/completions" \
    -d "{\"chat_id\":\"$CHAT_APP\",\"question\":$1,\"stream\":false}" | jq -r '.data.answer // ""'
}
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
echo " 业务数据流端到端测试  $(date '+%F %T')"
echo " 覆盖：文档解析链路 / 对话 / 质检拦截"
echo "=============================================="

# ── F. 文档全生命周期 ─────────────────────────────────────────────────────
echo ""
echo "[F] 文档上传 → 解析 → 切片 → 召回"

DSC=$(req "$TOK" -X POST "$BASE/datasets" -d '{"name":"E2E文档链路库","parse_type":1,"parser_id":"naive"}')
DS=$(echo "$DSC" | jq -r '.data.id // empty')
ck "F1 创建知识库" "0" "$(echo "$DSC" | jq -r '.code')"

printf '这是一个端到端测试文档。紫罗兰色的测试标记词是 E2E专属标记。\n第二段用于验证切片是否正常生成。\n' > /tmp/e2e_flow_doc.txt

UP=$(curl -s -m 60 -H "Authorization: Bearer $TOK" -F "file=@/tmp/e2e_flow_doc.txt" \
  "$BASE/datasets/$DS/documents")
DOC=$(echo "$UP" | jq -r '.data[0].id // empty')
ck "F2 上传文档到知识库" "0" "$(echo "$UP" | jq -r '.code')"
ck "F3 文档已归属该知识库" "$DS" "$(echo "$UP" | jq -r '.data[0].dataset_id // ""')"
ck "F4 上传后状态为 UNSTART" "UNSTART" "$(echo "$UP" | jq -r '.data[0].ingestion_status // ""')"

LIST=$(req "$TOK" "$BASE/datasets/$DS/documents?page=1&page_size=10")
ck "F5 文档出现在列表" "1" "$(echo "$LIST" | jq '.data.docs | length')"

ING=$(req "$TOK" -X POST "$BASE/documents/ingest" -d "{\"doc_ids\":[\"$DOC\"],\"run\":\"1\"}")
ck "F6 触发解析" "0" "$(echo "$ING" | jq -r '.code')"

# 解析是异步的：轮询 chunk_count 直到 >0（最多 90 秒）
CH=0
for i in 1 2 3 4 5 6 7 8 9; do
  sleep 10
  CH=$(req "$TOK" "$BASE/datasets/$DS" | jq -r '.data.chunk_count // 0')
  [ "$CH" -gt 0 ] 2>/dev/null && break
done
ckgt "F7 解析产出 chunk" "0" "$CH"

SR=$(req "$TOK" -X POST "$BASE/datasets/$DS/search" -d '{"question":"紫罗兰色的测试标记词是什么","page":1,"page_size":5,"similarity_threshold":0.1,"vector_similarity_weight":0.3,"top_k":100,"doc_ids":[],"use_kg":false}')
ck "F8 检索可调用" "0" "$(echo "$SR" | jq -r '.code')"
ckgt "F9 检索召回 >0" "0" "$(echo "$SR" | jq '.data.chunks | length')"
ck "F10 召回内容含上传文本" "0" "$(echo "$SR" | jq -r 'if ([.data.chunks[].content] | join("") | contains("紫罗兰色")) then 0 else 1 end')"

# 删文档 → chunk 应归零
DELD=$(req "$TOK" -X DELETE "$BASE/datasets/$DS/documents" -d "{\"ids\":[\"$DOC\"]}")
ck "F11 删除文档" "0" "$(echo "$DELD" | jq -r '.code')"
sleep 3
CH2=$(req "$TOK" "$BASE/datasets/$DS" | jq -r '.data.chunk_count // -1')
ck "F12 删除后 chunk 归零" "0" "$CH2"

# ── G. 对话 ───────────────────────────────────────────────────────────────
echo ""
echo "[G] 对话（chat completions）"

CL=$(req "$TOK" "$BASE/chats?page=1&page_size=10")
ck "G1 对话应用列表" "0" "$(echo "$CL" | jq -r '.code')"
ckgt "G2 列表非空" "0" "$(echo "$CL" | jq '.data.chats | length')"

A1=$(ask '"你好"')
ckn "G3 对话返回非空回答" "" "$A1"

FULL=$(req "$TOK" -X POST "$BASE/chat/completions" -d "{\"chat_id\":\"$CHAT_APP\",\"question\":\"你好\",\"stream\":false}")
ck "G4 对话响应含 code=0" "0" "$(echo "$FULL" | jq -r '.code')"
ck "G5 响应含 answer 字段" "0" "$(echo "$FULL" | jq -r 'if (.data.answer // null) == null then 1 else 0 end')"

EBAD=$(req "$TOK" -X POST "$BASE/chat/completions" -d '{"chat_id":"notexist000","question":"你好","stream":false}')
ckn "G6 不存在的对话应用被拒绝" "0" "$(echo "$EBAD" | jq -r '.code')"

GCROSS=$(req "$TOK_OUT" -X POST "$BASE/chat/completions" -d "{\"chat_id\":\"$CHAT_APP\",\"question\":\"你好\",\"stream\":false}")
ckn "G7 跨租户对话被拒绝" "0" "$(echo "$GCROSS" | jq -r '.code')"

# ── H. 质检真实拦截 ───────────────────────────────────────────────────────
echo ""
echo "[H] 质检拦截（绑定/解绑对照）"

# 原始绑定状态：直接查 qc_rule_binding，而不是 GET /qc/rules/selection。
# 后者会把「qc_rule.app_id 归属」的规则也返回，不等于真实生效集；
# 之前按它做全量替换，把 5 条生产规则误绑到了这个应用上。
BIND_CNT=$(docker exec docker-mysql-1 mysql -uroot -pinfini_rag_flow rag_flow -N \
  -e "SELECT COUNT(*) FROM qc_rule_binding WHERE app_id='$CHAT_APP'" 2>/dev/null | tr -d ' \r\n')

if [ "${BIND_CNT:-1}" != "0" ]; then
  # 已有绑定说明是生产在用的应用，不碰；跳过而不是"尽力恢复"。
  echo "  SKIP  H1-H6（$CHAT_APP 已有 ${BIND_CNT} 条绑定，跳过以免破坏生产配置）"
else
  QRULE=$(req "$TOK" -X POST "$BASE/qc/rules" -d "{\"name\":\"E2E拦截测试规则\",\"app_type\":\"chat\",\"app_id\":\"$CHAT_APP\",\"keywords\":[\"$MARK\"],\"severity\":\"block\",\"action\":\"block_and_alert\",\"match_mode\":\"contains\",\"scope\":\"both\",\"prompt_message\":\"命中E2E拦截规则，已阻断\"}")
  RULE=$(echo "$QRULE" | jq -r '.data.id // empty')
  ck "H1 创建测试规则" "0" "$(echo "$QRULE" | jq -r '.code')"

  # 单个 JSON 字符串字面量：外层单引号，内部是给 JSON 的双引号。
  # 写成 '\"...\"' 会被当成字面反斜杠，请求体非法 → answer 为空，
  # 让 H2/H6 的「不等于拦截提示」假阳性通过。
  Q='"这句话包含E2E拦截标记词，应该被阻断"'

  # 对照组：未绑定 → 不应拦截
  BEFORE=$(ask "$Q")
  ckn "H2 未绑定时回答不是拦截提示" "命中E2E拦截规则，已阻断" "$BEFORE"

  if [ -n "$RULE" ]; then
    BIND=$(req "$TOK" -X PUT "$BASE/qc/rules/selection" -d "{\"app_type\":\"chat\",\"app_id\":\"$CHAT_APP\",\"rule_ids\":[\"$RULE\"]}")
    ck "H3 绑定规则" "0" "$(echo "$BIND" | jq -r '.code')"

    # 实验组：绑定后 → 应拦截
    AFTER=$(ask "$Q")
    ck "H4 绑定后回答被替换为拦截提示" "命中E2E拦截规则，已阻断" "$AFTER"

    # 解绑：用 SQL 精确清空（原本就是 0 条），不依赖 PUT selection 的全量替换语义
    docker exec docker-mysql-1 mysql -uroot -pinfini_rag_flow rag_flow \
      -e "DELETE FROM qc_rule_binding WHERE app_id='$CHAT_APP'" >/dev/null 2>&1
    LEFT=$(docker exec docker-mysql-1 mysql -uroot -pinfini_rag_flow rag_flow -N \
      -e "SELECT COUNT(*) FROM qc_rule_binding WHERE app_id='$CHAT_APP'" 2>/dev/null | tr -d ' \r\n')
    ck "H5 解绑后绑定归零" "0" "$LEFT"

    AGAIN=$(ask "$Q")
    ckn "H6 解绑后恢复不拦截" "命中E2E拦截规则，已阻断" "$AGAIN"
  fi
fi

# ── 清理 ─────────────────────────────────────────────────────────────────
echo ""
echo "[清理] 删除测试数据"
cleanup_step() { local d="$1"; shift; local c; c=$(req "$TOK" "$@" | jq -r '.code // "no-response"'); echo "  $d → code=$c"; }

[ -n "${RULE:-}" ] && cleanup_step "删除测试规则" -X DELETE "$BASE/qc/rules/$RULE"
# 文档在 F11 已删，这里不再重复删（会返回 102 not found，掩盖真实失败）
[ -n "${DS:-}" ] && cleanup_step "删除测试知识库" -X DELETE "$BASE/datasets" -d "{\"ids\":[\"$DS\"]}"

echo ""
echo "=============================================="
echo " 合计：PASS=$pass  FAIL=$fail"
if [ "$fail" -ne 0 ]; then
  echo " 失败用例："; for f in "${FAILED[@]}"; do echo "   - $f"; done
fi
echo "=============================================="
[ "$fail" -eq 0 ] || exit 1
