#!/bin/bash
# 矩阵级权限守卫 —— 后端部分（setup / 断言 / teardown）
#
# 配套 e2e_matrix_guard.mjs 做前端断言。分开是因为：
# Playwright 在本地跑，setup 需要服务器上的 docker/mysql。
#
# 用法：
#   bash e2e_matrix_guard.sh            # setup + 后端断言 + teardown
#   bash e2e_matrix_guard.sh --setup    # 只 setup，打印两个 token（供前端脚本用）
#   bash e2e_matrix_guard.sh --teardown # 只清理
#
# 注意：注册的新用户会自动获得一个「自己的租户」，必须删掉那条 owner membership，
# 否则前端看到的是他自己的租户（他是 owner），矩阵拦截根本不会触发。

set -u
BASE="http://127.0.0.1/api/v1"
OWNER="8d5c79460d6c46efb58353c68d8bf729"
READER_EMAIL="e2e.reader@example.com"
READER_PWD="E2eReader!2026"
ROLE_NAME="E2E只读角色"

# 必须显式指定 utf8mb4：mysql 客户端默认字符集下，中文角色名比较会匹配不到，
# 表现为「删旧角色静默失败 → 创建遇同名 → 拿到空 id」，整条用例链全空。
q() { docker exec docker-mysql-1 mysql --default-character-set=utf8mb4 \
        -uroot -pinfini_rag_flow rag_flow -N -e "$1" 2>/dev/null | tr -d '\r'; }

pass=0; fail=0; declare -a FAILED
ck() {
  if [ "$2" = "$3" ]; then pass=$((pass+1)); echo "  PASS  $1"
  else fail=$((fail+1)); FAILED+=("$1 (want=$2 got=$3)"); echo "  FAIL  $1    want=[$2] got=[$3]"; fi
}

setup() {
  local T; T=$(/root/mktok.sh "$OWNER") || { echo "FATAL: owner token"; exit 1; }

  # 1. 角色（幂等：先删同名旧角色）
  local OLD; OLD=$(q "SELECT id FROM role WHERE tenant_id='$OWNER' AND name='$ROLE_NAME'")
  for r in $OLD; do
    curl -s -m 15 -X DELETE -H "Authorization: Bearer $T" "$BASE/tenants/$OWNER/roles/$r" >/dev/null
  done
  local RID; RID=$(curl -s -m 20 -X POST -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
    "$BASE/tenants/$OWNER/roles" -d "{\"name\":\"$ROLE_NAME\",\"description\":\"仅可查看成员，不可查看角色配置\"}" \
    | jq -r '.data.id // empty')

  # 2. 矩阵：member 可看、role 不可看
  curl -s -m 20 -X PUT -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
    "$BASE/tenants/$OWNER/roles/$RID/permissions" -d '{"permissions":[
      {"module":"member","can_view":true,"can_create":false,"can_edit":false,"can_delete":false,"can_manage":false},
      {"module":"role","can_view":false,"can_create":false,"can_edit":false,"can_delete":false,"can_manage":false}]}' >/dev/null

  # 3. 注册只读成员（已存在则复用）
  READER_UID=$(q "SELECT id FROM user WHERE email='$READER_EMAIL'")
  if [ -z "$READER_UID" ]; then
    READER_UID=$(curl -s -m 20 -X POST -H 'Content-Type: application/json' "$BASE/users" \
      -d "{\"email\":\"$READER_EMAIL\",\"password\":\"$READER_PWD\",\"nickname\":\"E2E只读成员\"}" \
      | jq -r '.data.id // empty')
  fi

  # 4. 先移除再邀请：成员已存在时 POST /members 是 no-op，role_id 不会更新，
  #    会继续沿用上一次绑定的角色，导致矩阵断言读到旧值。
  [ -n "$READER_UID" ] && curl -s -m 20 -X DELETE -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
    "$BASE/tenants/$OWNER/users" -d "{\"user_id\":\"$READER_UID\"}" >/dev/null
  sleep 1
  curl -s -m 20 -X POST -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
    "$BASE/tenants/$OWNER/members" -d "{\"email\":\"$READER_EMAIL\",\"role_id\":\"$RID\"}" >/dev/null

  # 5. 删掉他自己的 owner membership（关键，否则前端会选到他自己的租户）
  q "DELETE FROM user_tenant WHERE user_id='$READER_UID' AND role='owner'" >/dev/null

  echo "ROLE_ID=$RID"
  echo "READER_ID=$READER_UID"
  echo "TOKEN=$(/root/mktok.sh "$OWNER")"
  echo "TOKEN_READER=$(/root/mktok.sh "$READER_UID")"
}

teardown() {
  local T; T=$(/root/mktok.sh "$OWNER")
  local RID
  RID=$(q "SELECT id FROM role WHERE tenant_id='$OWNER' AND name='$ROLE_NAME'" | head -1)
  READER_UID=$(q "SELECT id FROM user WHERE email='$READER_EMAIL'")

  # 先移除成员（清 department_id），再删角色
  [ -n "$READER_UID" ] && curl -s -m 15 -X DELETE -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
    "$BASE/tenants/$OWNER/users" -d "{\"user_id\":\"$READER_UID\"}" >/dev/null
  sleep 1
  [ -n "$RID" ] && curl -s -m 15 -X DELETE -H "Authorization: Bearer $T" "$BASE/tenants/$OWNER/roles/$RID" >/dev/null
  # 禁用测试用户（没有删除用户的接口，置为停用）
  [ -n "$READER_UID" ] && q "UPDATE user SET is_active=0 WHERE id='$READER_UID'" >/dev/null
  echo "cleanup done: role=$RID reader=$READER_UID"
}

assert_backend() {
  local T M RID
  T=$(/root/mktok.sh "$OWNER")
  M=$(/root/mktok.sh "$READER_UID")
  RID=$(q "SELECT id FROM role WHERE tenant_id='$OWNER' AND name='$ROLE_NAME'" | head -1)

  echo ""
  echo "[后端] 矩阵拦截"
  ck "B1 owner 读角色 200" "0" "$(curl -s -m 20 -H "Authorization: Bearer $T" "$BASE/tenants/$OWNER/roles" | jq -r '.code')"
  ck "B2 只读成员读角色 403" "403" "$(curl -s -m 20 -H "Authorization: Bearer $M" "$BASE/tenants/$OWNER/roles" | jq -r '.code')"
  ck "B3 只读成员读部门 200" "0" "$(curl -s -m 20 -H "Authorization: Bearer $M" "$BASE/tenants/$OWNER/departments" | jq -r '.code')"
  ck "B4 只读成员建部门 403" "403" "$(curl -s -m 20 -X POST -H "Authorization: Bearer $M" -H 'Content-Type: application/json' "$BASE/tenants/$OWNER/departments" -d '{"name":"越权部门"}' | jq -r '.code')"
  ck "B5 只读成员改角色矩阵 403" "403" "$(curl -s -m 20 -X PUT -H "Authorization: Bearer $M" -H 'Content-Type: application/json' "$BASE/tenants/$OWNER/roles/$RID/permissions" -d '{"permissions":[]}' | jq -r '.code')"

  # 放行验证：把 role.view 打开，同一成员应立刻能读
  curl -s -m 20 -X PUT -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
    "$BASE/tenants/$OWNER/roles/$RID/permissions" -d '{"permissions":[
      {"module":"member","can_view":true,"can_create":false,"can_edit":false,"can_delete":false,"can_manage":false},
      {"module":"role","can_view":true,"can_create":false,"can_edit":false,"can_delete":false,"can_manage":false}]}' >/dev/null
  ck "B6 打开 role.view 后同成员可读（放行）" "0" "$(curl -s -m 20 -H "Authorization: Bearer $M" "$BASE/tenants/$OWNER/roles" | jq -r '.code')"

  # 改回不可见，保持后续前端用例的前提
  curl -s -m 20 -X PUT -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
    "$BASE/tenants/$OWNER/roles/$RID/permissions" -d '{"permissions":[
      {"module":"member","can_view":true,"can_create":false,"can_edit":false,"can_delete":false,"can_manage":false},
      {"module":"role","can_view":false,"can_create":false,"can_edit":false,"can_delete":false,"can_manage":false}]}' >/dev/null
}

case "${1:-}" in
  --setup)
    echo "=== SETUP ==="
    setup
    ;;
  --teardown)
    echo "=== TEARDOWN ==="
    teardown
    ;;
  *)
    echo "=============================================="
    echo " 矩阵级权限守卫（后端）  $(date '+%F %T')"
    echo "=============================================="
    echo "=== SETUP ==="
    setup >/dev/null
    assert_backend
    echo ""
    echo "=== TEARDOWN ==="
    teardown
    echo ""
    echo "=============================================="
    echo " 合计：PASS=$pass  FAIL=$fail"
    if [ "$fail" -ne 0 ]; then echo " 失败用例："; for f in "${FAILED[@]}"; do echo "   - $f"; done; fi
    echo "=============================================="
    [ "$fail" -eq 0 ] || exit 1
    ;;
esac
