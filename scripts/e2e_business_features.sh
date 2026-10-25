#!/bin/bash
# 业务功能端到端测试：知识库 / 知识检索 / 智能体 / 质检
#
# 与 e2e_console_permissions.sh 互补：那份测「权限组织」，这份测「业务功能」。
# 全部走真实 HTTP + 真实模型（embedding / chat 均在生产环境 active），
# 不 mock 任何内部函数 —— 检索要真的召回、智能体要真的产生事件流。
#
# 用法：bash e2e_business_features.sh
# 退出码：0 全过；1 有失败

set -u
BASE="http://127.0.0.1/api/v1"

OWNER="8d5c79460d6c46efb58353c68d8bf729"          # 主测试租户 owner
OUTSIDER="03420400140940c89bf0f74baa3ecf78"       # 另一租户 owner，用于越权
DATASET_ID="0066de8d0674470983d1c5fc180466c8"     # 已有知识库（客服语音，3 chunks）
AGENT_ID="3951d5c933c14725a4b3df9e183481fd"       # 已有智能体（聊天工具）
CHAT_APP="db888754c17946cbbc168d5408a13a58"       # dialog 表真实 chat 应用（质检绑定用）

TOK=$(/root/mktok.sh "$OWNER") || { echo "FATAL: owner token 失败"; exit 1; }
TOK_OUT=$(/root/mktok.sh "$OUTSIDER") || { echo "FATAL: outsider token 失败"; exit 1; }

pass=0; fail=0; declare -a FAILED

req() { local t="$1"; shift; curl -s -m 60 -H "Authorization: Bearer $t" -H "Content-Type: application/json" "$@"; }

ck() { # ck <name> <expect> <actual>
  if [ "$2" = "$3" ]; then pass=$((pass+1)); echo "  PASS  $1"
  else fail=$((fail+1)); FAILED+=("$1 (want=$2 got=$3)"); echo "  FAIL  $1    want=[$2] got=[$3]"; fi
}
ckn() { # 断言"不等于"
  if [ "$2" != "$3" ]; then pass=$((pass+1)); echo "  PASS  $1"
  else fail=$((fail+1)); FAILED+=("$1 (should not be $2)"); echo "  FAIL  $1    should not be [$2]"; fi
}
ckgt() { # 断言 数值 > 阈值
  if [ "$3" -gt "$2" ] 2>/dev/null; then pass=$((pass+1)); echo "  PASS  $1"
  else fail=$((fail+1)); FAILED+=("$1 (want >$2 got=$3)"); echo "  FAIL  $1    want >[$2] got=[$3]"; fi
}

echo "=============================================="
echo " 业务功能端到端测试  $(date '+%F %T')"
echo " 覆盖：知识库 / 知识检索 / 智能体 / 质检"
echo "=============================================="

# ── A. 知识库 ─────────────────────────────────────────────────────────────
echo ""
echo "[A] 知识库"

LIST=$(req "$TOK" "$BASE/datasets?page=1&page_size=100")
ck "A1 知识库列表" "0" "$(echo "$LIST" | jq -r '.code')"
ckgt "A2 列表非空" "0" "$(echo "$LIST" | jq '.data | length')"

DETAIL=$(req "$TOK" "$BASE/datasets/$DATASET_ID")
ck "A3 知识库详情" "0" "$(echo "$DETAIL" | jq -r '.code')"
ckgt "A4 详情含文档数" "0" "$(echo "$DETAIL" | jq '.data.document_count')"
ck "A5 详情 embedding 模型已配置" "0" "$(echo "$DETAIL" | jq -r 'if (.data.embedding_model // "") == "" then 1 else 0 end')"

CREATE=$(req "$TOK" -X POST "$BASE/datasets" -d '{"name":"E2E业务测试库","parse_type":1,"parser_id":"naive"}')
NEW_DS=$(echo "$CREATE" | jq -r '.data.id // empty')
ck "A6 创建知识库" "0" "$(echo "$CREATE" | jq -r '.code')"

if [ -n "$NEW_DS" ]; then
  R=$(req "$TOK" "$BASE/datasets/$NEW_DS")
  ck "A7 新建库回读名称一致" "E2E业务测试库" "$(echo "$R" | jq -r '.data.name')"
  UPD=$(req "$TOK" -X PUT "$BASE/datasets/$NEW_DS" -d '{"name":"E2E业务测试库改名"}')
  ck "A8 更新知识库名称" "0" "$(echo "$UPD" | jq -r '.code')"
fi

# 标签聚合要求显式传 dataset_ids（不传报 102 Lack of dataset_ids）
TAGS=$(req "$TOK" "$BASE/datasets/tags/aggregation?dataset_ids=$DATASET_ID")
ck "A9 标签聚合" "0" "$(echo "$TAGS" | jq -r '.code')"

REFS=$(req "$TOK" "$BASE/datasets/$DATASET_ID/references")
ck "A10 引用关系" "0" "$(echo "$REFS" | jq -r '.code')"

CROSS=$(req "$TOK_OUT" "$BASE/datasets/$DATASET_ID")
ckn "A11 跨租户读知识库被拒绝" "0" "$(echo "$CROSS" | jq -r '.code')"

BAD=$(req "$TOK" -X POST "$BASE/datasets" -d '{"parse_type":1}')
ckn "A12 创建缺 name 被拒绝" "0" "$(echo "$BAD" | jq -r '.code')"

# ── B. 知识检索 ───────────────────────────────────────────────────────────
echo ""
echo "[B] 知识检索"

SEARCH_BODY='{"question":"额度测评","page":1,"page_size":10,"similarity_threshold":0.1,"vector_similarity_weight":0.3,"top_k":100,"doc_ids":[],"use_kg":false}'
S1=$(req "$TOK" -X POST "$BASE/datasets/$DATASET_ID/search" -d "$SEARCH_BODY")
ck "B1 单库检索" "0" "$(echo "$S1" | jq -r '.code')"
N1=$(echo "$S1" | jq '.data.chunks | length')
ckgt "B2 检索召回 >0 条" "0" "$N1"
ck "B3 chunk 含相似度字段" "0" "$(echo "$S1" | jq -r 'if (.data.chunks[0].similarity // null) == null then 1 else 0 end')"
ck "B4 chunk 含内容字段" "0" "$(echo "$S1" | jq -r 'if ((.data.chunks[0].content // "") | length) > 0 then 0 else 1 end')"

MULTI=$(req "$TOK" -X POST "$BASE/datasets/search" -d "{\"dataset_ids\":[\"$DATASET_ID\"],\"question\":\"额度测评\",\"page\":1,\"page_size\":10,\"similarity_threshold\":0.1,\"vector_similarity_weight\":0.3,\"top_k\":100}")
ck "B5 多库检索" "0" "$(echo "$MULTI" | jq -r '.code')"

# 阈值提高到 0.99：召回应不增加
HIGH=$(req "$TOK" -X POST "$BASE/datasets/$DATASET_ID/search" -d '{"question":"额度测评","page":1,"page_size":10,"similarity_threshold":0.99,"vector_similarity_weight":0.3,"top_k":100,"doc_ids":[],"use_kg":false}')
NHIGH=$(echo "$HIGH" | jq '.data.chunks | length')
if [ "${NHIGH:-0}" -le "${N1:-0}" ] 2>/dev/null; then
  pass=$((pass+1)); echo "  PASS  B6 高阈值召回不增加（$NHIGH <= $N1）"
else
  fail=$((fail+1)); FAILED+=("B6 高阈值召回反增 $NHIGH > $N1"); echo "  FAIL  B6 高阈值召回反增 $NHIGH > $N1"
fi

NONE=$(req "$TOK" -X POST "$BASE/datasets/notexist000/search" -d "$SEARCH_BODY")
ckn "B7 检索不存在的知识库被拒绝" "0" "$(echo "$NONE" | jq -r '.code')"

SC=$(req "$TOK_OUT" -X POST "$BASE/datasets/$DATASET_ID/search" -d "$SEARCH_BODY")
ckn "B8 跨租户检索被拒绝" "0" "$(echo "$SC" | jq -r '.code')"

EMPTY=$(req "$TOK" -X POST "$BASE/datasets/$DATASET_ID/search" -d '{"question":"","page":1,"page_size":10}')
EMPTY_OK=$(echo "$EMPTY" | jq -r '.code')
EMPTY_N=$(echo "$EMPTY" | jq '.data.chunks | length' 2>/dev/null)
if [ "$EMPTY_OK" != "0" ] || [ "${EMPTY_N:-1}" = "0" ]; then
  pass=$((pass+1)); echo "  PASS  B9 空问题不返回结果"
else
  fail=$((fail+1)); FAILED+=("B9 空问题返回了结果"); echo "  FAIL  B9 空问题返回了结果"
fi

# ── C. 智能体 ─────────────────────────────────────────────────────────────
echo ""
echo "[C] 智能体"

ALIST=$(req "$TOK" "$BASE/agents?page=1&page_size=50")
ck "C1 智能体列表" "0" "$(echo "$ALIST" | jq -r '.code')"
ckgt "C2 列表非空" "0" "$(echo "$ALIST" | jq '.data.canvas | length')"

ADETAIL=$(req "$TOK" "$BASE/agents/$AGENT_ID")
ck "C3 智能体详情" "0" "$(echo "$ADETAIL" | jq -r '.code')"
ck "C4 详情含 DSL" "0" "$(echo "$ADETAIL" | jq -r 'if (.data.dsl // null) == null then 1 else 0 end')"

ACREATE=$(req "$TOK" -X POST "$BASE/agents" -d '{"title":"E2E业务测试智能体","dsl":{"components":{},"path":[],"graph":{"nodes":[],"edges":[]}}}')
NEW_AGENT=$(echo "$ACREATE" | jq -r '.data.id // empty')
ck "C5 创建智能体" "0" "$(echo "$ACREATE" | jq -r '.code')"

if [ -n "$NEW_AGENT" ]; then
  AR=$(req "$TOK" "$BASE/agents/$NEW_AGENT")
  ck "C6 新建智能体回读标题一致" "E2E业务测试智能体" "$(echo "$AR" | jq -r '.data.title')"
  AUPD=$(req "$TOK" -X PUT "$BASE/agents/$NEW_AGENT" -d '{"title":"E2E业务测试智能体改名"}')
  ck "C7 更新智能体标题" "0" "$(echo "$AUPD" | jq -r '.code')"
  VER=$(req "$TOK" "$BASE/agents/$NEW_AGENT/versions?page=1&page_size=10")
  ck "C8 版本列表" "0" "$(echo "$VER" | jq -r '.code')"
  PUB=$(req "$TOK" -X POST "$BASE/agents/$NEW_AGENT/publish" -d '{"remark":"e2e"}')
  ck "C9 发布智能体" "0" "$(echo "$PUB" | jq -r '.code')"
fi

TPL=$(req "$TOK" "$BASE/agents/templates")
ck "C10 模板列表" "0" "$(echo "$TPL" | jq -r '.code')"
ATAGS=$(req "$TOK" "$BASE/agents/tags")
ck "C11 标签列表" "0" "$(echo "$ATAGS" | jq -r '.code')"

ACROSS=$(req "$TOK_OUT" "$BASE/agents/$AGENT_ID")
ckn "C12 跨租户读智能体被拒绝" "0" "$(echo "$ACROSS" | jq -r '.code')"

# 真实运行：SSE 事件流（chat 模型在生产环境 active）
SSE=$(timeout 50 curl -sN -m 45 -X POST -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  "$BASE/agents/$AGENT_ID/run" -d '"你好"' 2>&1 | head -c 8000)
ck "C13 运行产生 workflow_started 事件" "1" "$(echo "$SSE" | grep -c 'workflow_started')"
# 断言"没有 error 事件"，所以用 ck（等于 0），不是 ckn
ck "C14 运行未返回错误事件" "0" "$(echo "$SSE" | grep -c '"event":"error"')"

# ── D. 质检 ───────────────────────────────────────────────────────────────
echo ""
echo "[D] 质检"

QR=$(req "$TOK" "$BASE/qc/rules?page=1&page_size=100")
ck "D1 规则列表" "0" "$(echo "$QR" | jq -r '.code')"
ckgt "D2 规则非空" "0" "$(echo "$QR" | jq '.data | length')"

EXIST_RULE=$(echo "$QR" | jq -r '.data[0].id // empty')
if [ -n "$EXIST_RULE" ]; then
  QD=$(req "$TOK" "$BASE/qc/rules/$EXIST_RULE")
  ck "D3 规则详情" "0" "$(echo "$QD" | jq -r '.code')"
  QREF=$(req "$TOK" "$BASE/qc/rules/$EXIST_RULE/references")
  ck "D4 规则引用关系" "0" "$(echo "$QREF" | jq -r '.code')"
fi

QCREATE=$(req "$TOK" -X POST "$BASE/qc/rules" -d "{\"name\":\"E2E业务测试规则\",\"app_type\":\"chat\",\"app_id\":\"$CHAT_APP\",\"keywords\":[\"E2E测试关键词\"],\"severity\":\"block\",\"action\":\"block_and_alert\",\"match_mode\":\"contains\",\"scope\":\"both\",\"prompt_message\":\"E2E拦截提示\"}")
NEW_RULE=$(echo "$QCREATE" | jq -r '.data.id // empty')
ck "D5 创建质检规则" "0" "$(echo "$QCREATE" | jq -r '.code')"

if [ -n "$NEW_RULE" ]; then
  QR2=$(req "$TOK" "$BASE/qc/rules/$NEW_RULE")
  ck "D6 新建规则回读名称一致" "E2E业务测试规则" "$(echo "$QR2" | jq -r '.data.name')"

  # PUT /qc/rules/:id 是全量替换语义：只传 name 会报 "at least one keyword is required"，
  # 必须把关键词等必填项一并带上。
  QUPD=$(req "$TOK" -X PUT "$BASE/qc/rules/$NEW_RULE" -d "{\"name\":\"E2E业务测试规则改名\",\"app_type\":\"chat\",\"app_id\":\"$CHAT_APP\",\"keywords\":[\"E2E测试关键词\"],\"severity\":\"block\",\"action\":\"block_and_alert\",\"match_mode\":\"contains\",\"scope\":\"both\",\"prompt_message\":\"E2E拦截提示\"}")
  ck "D7 更新规则名称" "0" "$(echo "$QUPD" | jq -r '.code')"

  QTOG=$(req "$TOK" -X POST "$BASE/qc/rules/$NEW_RULE/toggle" -d '{"enabled":false}')
  ck "D8 关闭规则" "0" "$(echo "$QTOG" | jq -r '.code')"
  QR3=$(req "$TOK" "$BASE/qc/rules/$NEW_RULE")
  ck "D9 关闭后 enabled=false" "false" "$(echo "$QR3" | jq -r '.data.enabled')"
fi

# 规则命中测试：包含关键词的文本应命中
HIT=$(req "$TOK" -X POST "$BASE/qc/rules/test" -d '{"keywords":["E2E测试关键词"],"match_mode":"contains","text":"这句话里包含E2E测试关键词，应当命中"}')
ck "D10 命中测试接口可用" "0" "$(echo "$HIT" | jq -r '.code')"
MISS=$(req "$TOK" -X POST "$BASE/qc/rules/test" -d '{"keywords":["完全不存在的词xyz"],"match_mode":"contains","text":"这句话里没有那个词"}')
ck "D11 不命中测试接口可用" "0" "$(echo "$MISS" | jq -r '.code')"

QHITS=$(req "$TOK" "$BASE/qc/hits?page=1&page_size=10")
ck "D12 命中记录列表" "0" "$(echo "$QHITS" | jq -r '.code')"

QCFG=$(req "$TOK" "$BASE/qc/config")
ck "D13 质检配置读取" "0" "$(echo "$QCFG" | jq -r '.code')"

QSEL=$(req "$TOK" "$BASE/qc/rules/selection?app_type=chat&app_id=$CHAT_APP")
ck "D14 规则选用读取" "0" "$(echo "$QSEL" | jq -r '.code')"

# 路由优先级：/rules/test 不能被 /rules/:id 吞掉（返回 404 说明被当成 id 了）
ROUTING=$(req "$TOK" -X POST "$BASE/qc/rules/test" -d '{"keywords":["x"],"match_mode":"contains","text":"x"}')
ckn "D15 /rules/test 未被 /rules/:id 吞掉" "404" "$(echo "$ROUTING" | jq -r '.code')"

# ── E. 端到端串联 ─────────────────────────────────────────────────────────
echo ""
echo "[E] 串联场景"

# E1 新建空库检索：应能调用，但不返回 chunk（没有文档）
if [ -n "$NEW_DS" ]; then
  ES=$(req "$TOK" -X POST "$BASE/datasets/$NEW_DS/search" -d "$SEARCH_BODY")
  ck "E1 空知识库检索可调用" "0" "$(echo "$ES" | jq -r '.code')"
  ck "E2 空知识库无召回" "0" "$(echo "$ES" | jq '.data.chunks | length')"
fi

# E3 智能体运行事件流完整性（started + 至少一个 node 事件）
ck "E3 运行含节点事件" "1" "$(echo "$SSE" | grep -c 'node_started' | head -1 | awk '{print ($1>0)?1:0}')"

# E4 规则选用写入（再读回）
SEL_W=$(req "$TOK" -X PUT "$BASE/qc/rules/selection" -d "{\"app_type\":\"chat\",\"app_id\":\"$CHAT_APP\",\"rule_ids\":[]}")
ck "E4 规则选用可写入" "0" "$(echo "$SEL_W" | jq -r '.code')"
SEL_R=$(req "$TOK" "$BASE/qc/rules/selection?app_type=chat&app_id=$CHAT_APP")
ck "E5 规则选用可读回" "0" "$(echo "$SEL_R" | jq -r '.code')"

# ── 清理 ─────────────────────────────────────────────────────────────────
echo ""
echo "[清理] 删除测试数据"

cleanup_step() { local desc="$1"; shift; local c; c=$(req "$TOK" "$@" | jq -r '.code // "no-response"'); echo "  $desc → code=$c"; }

[ -n "$NEW_RULE" ] && cleanup_step "删除测试规则" -X DELETE "$BASE/qc/rules/$NEW_RULE"
[ -n "$NEW_AGENT" ] && cleanup_step "删除测试智能体" -X DELETE "$BASE/agents/$NEW_AGENT"
[ -n "$NEW_DS" ] && cleanup_step "删除测试知识库" -X DELETE "$BASE/datasets" -d "{\"ids\":[\"$NEW_DS\"]}"

echo ""
echo "=============================================="
echo " 合计：PASS=$pass  FAIL=$fail"
if [ "$fail" -ne 0 ]; then
  echo " 失败用例："
  for f in "${FAILED[@]}"; do echo "   - $f"; done
fi
echo "=============================================="
[ "$fail" -eq 0 ] || exit 1
