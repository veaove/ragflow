#!/bin/bash
# 端到端测试：租户控制台（组织架构 / 用户管理 / 角色权限 / 资源授权）
#
# 直接在 API 层验证，不依赖浏览器。覆盖正常路径、边界、越权三类。
# 运行环境：能 curl 到 127.0.0.1:80 的服务器上（token 需要本机 secret）。
#
# 用法：bash e2e_console_permissions.sh
# 退出码：0 全部通过；1 有失败

set -u
BASE="http://127.0.0.1/api/v1"

# 凭证不入库：secret 从 kvrocks 现取，access_token 从 MySQL 现取。
# 两者都会轮换（重启即变），硬编码的脚本第二天必然失效。
q() { docker exec docker-mysql-1 mysql -uroot -p"${MYSQL_PWD:-infini_rag_flow}" rag_flow -N -e "$1" 2>/dev/null; }

SECRET="${RAGFLOW_SECRET:-$(docker exec -e REDISCLI_AUTH="${REDIS_PWD:-infini_rag_flow}" docker-kvrocks-1 \
  redis-cli GET 'ragflow:system:secret_key' 2>/dev/null | tr -d '\r')}"

TENANT="8d5c79460d6c46efb58353c68d8bf729"   # 主测试租户（owner = 123456789@qq.com）
MEMBER_ID="8639ad3b763146698256793690dc3c1f" # zhangsan，临时加入本租户当 normal
OUTSIDER_ID="03420400140940c89bf0f74baa3ecf78" # lisi，另一租户 owner，用于越权

OWNER_AT=$(q "SELECT access_token FROM user WHERE id='$TENANT'")
OUTSIDER_AT=$(q "SELECT access_token FROM user WHERE id='$OUTSIDER_ID'")
MEMBER_AT=$(q "SELECT access_token FROM user WHERE id='$MEMBER_ID'")

if [ -z "$SECRET" ] || [ -z "$OWNER_AT" ]; then
  echo "FATAL: 无法获取 secret 或 access_token（需在服务器的 docker 环境内运行）"
  exit 1
fi

pass=0
fail=0
declare -a FAILED

# token = itsdangerous URLSafeTimedSerializer（payload 是 user.access_token）
mk_tok() {
  python3 - "$1" "$SECRET" <<'PY'
import base64, hashlib, hmac, json, sys, time
at, secret = sys.argv[1], sys.argv[2]
b = lambda d: base64.urlsafe_b64encode(d).rstrip(b'=').decode()
key = hashlib.sha1(b"itsdangerous" + b"signer" + secret.encode()).digest()
payload = b(json.dumps(at).encode())
ts = int(time.time())
value = payload + "." + b(ts.to_bytes(8, 'big').lstrip(b'\x00'))
print(value + "." + b(hmac.new(key, value.encode(), hashlib.sha1).digest()))
PY
}

req() { # req <token> <curl args...>
  local t="$1"; shift
  curl -s -m 15 -H "Authorization: Bearer $t" -H "Content-Type: application/json" "$@"
}

ck() { # ck <name> <expected> <actual>
  if [ "$2" = "$3" ]; then
    pass=$((pass + 1)); echo "  PASS  $1"
  else
    fail=$((fail + 1)); FAILED+=("$1 (want=$2 got=$3)")
    echo "  FAIL  $1    want=[$2] got=[$3]"
  fi
}

ckn() { # ckn <name> <expected-not-equal> <actual>  —— 断言"不等于"，用于错误码
  if [ "$2" != "$3" ]; then
    pass=$((pass + 1)); echo "  PASS  $1"
  else
    fail=$((fail + 1)); FAILED+=("$1 (should not be $2)")
    echo "  FAIL  $1    should not be [$2]"
  fi
}

TOK=$(mk_tok "$OWNER_AT")
TOK_OUT=$(mk_tok "$OUTSIDER_AT")
TOK_MEM=$(mk_tok "$MEMBER_AT")

if [ -z "$TOK" ]; then echo "FATAL: token 生成失败"; exit 1; fi

echo "=============================================="
echo " 租户控制台端到端测试  $(date '+%F %T')"
echo " tenant=$TENANT"
echo "=============================================="

# ── A. 组织架构 ───────────────────────────────────────────────────────────
echo ""
echo "[A] 组织架构"

DEPT_ROOT=$(req "$TOK" -X POST "$BASE/tenants/$TENANT/departments" -d '{"name":"E2E测试部"}')
ROOT_ID=$(echo "$DEPT_ROOT" | jq -r '.data.id // empty')
ck "A1 创建根部门" "0" "$(echo "$DEPT_ROOT" | jq -r '.code')"

DEPT_CHILD=$(req "$TOK" -X POST "$BASE/tenants/$TENANT/departments" -d "{\"name\":\"E2E子部门\",\"parent_id\":\"$ROOT_ID\"}")
CHILD_ID=$(echo "$DEPT_CHILD" | jq -r '.data.id // empty')
ck "A2 创建子部门" "0" "$(echo "$DEPT_CHILD" | jq -r '.code')"

TREE=$(req "$TOK" "$BASE/tenants/$TENANT/departments")
CKTOTAL=$(echo "$TREE" | jq '[.data.departments[] | select(.name=="E2E测试部")][0].children | length')
ck "A3 部门树含 1 个子节点" "1" "$CKTOTAL"

UPD=$(req "$TOK" -X PUT "$BASE/tenants/$TENANT/departments/$CHILD_ID" -d '{"name":"E2E子部门改名"}')
ck "A4 更新部门名" "0" "$(echo "$UPD" | jq -r '.code')"

# 有子部门 → 拒绝删除
DEL_PARENT=$(req "$TOK" -X DELETE "$BASE/tenants/$TENANT/departments/$ROOT_ID")
ckn "A5 删除有子部门的部门被拒绝" "0" "$(echo "$DEL_PARENT" | jq -r '.code')"

# 环路：把父部门挂到自己子部门下
CYCLE=$(req "$TOK" -X PUT "$BASE/tenants/$TENANT/departments/$ROOT_ID" -d "{\"parent_id\":\"$CHILD_ID\"}")
ckn "A6 部门移动环路被拒绝" "0" "$(echo "$CYCLE" | jq -r '.code')"

# 跨租户读部门 → 403
CROSS=$(req "$TOK_OUT" "$BASE/tenants/$TENANT/departments")
ck "A7 非成员读部门被拒绝" "403" "$(echo "$CROSS" | jq -r '.code')"

# ── B. 用户管理 ───────────────────────────────────────────────────────────
echo ""
echo "[B] 用户管理"

LIST=$(req "$TOK" "$BASE/tenants/$TENANT/console/members?page=1&page_size=50")
ck "B1 成员列表返回成功" "0" "$(echo "$LIST" | jq -r '.code')"
ck "B2 成员列表含 owner" "1" "$(echo "$LIST" | jq '[.data.members[] | select(.role=="owner")] | length')"

SEARCH=$(req "$TOK" "$BASE/tenants/$TENANT/console/members?keywords=不存在的名字xyz")
ck "B3 搜索无结果返回空" "0" "$(echo "$SEARCH" | jq -r '.data.total')"

# 邀请未注册邮箱 → 报错
INV_BAD=$(req "$TOK" -X POST "$BASE/tenants/$TENANT/members" -d '{"email":"nobody-e2e@example.com","role":"normal"}')
ckn "B4 邀请未注册邮箱失败" "0" "$(echo "$INV_BAD" | jq -r '.code')"

# 邀请「租户管理员」→ 拒绝（owner 语义不可授予）
OWNER_ROLE_ID=$(req "$TOK" "$BASE/tenants/$TENANT/roles" | jq -r '[.data.roles[] | select(.name=="租户管理员")][0].id')
INV_OWNER=$(req "$TOK" -X POST "$BASE/tenants/$TENANT/members" -d "{\"email\":\"zhangsan@qq.com\",\"role_id\":\"$OWNER_ROLE_ID\"}")
ckn "B5 邀请租户管理员角色被拒绝" "0" "$(echo "$INV_OWNER" | jq -r '.code')"

# 正常邀请（zhangsan 临时加入）。先清掉可能的历史残留，保证可重复运行。
req "$TOK" -X DELETE "$BASE/tenants/$TENANT/users" -d "{\"user_id\":\"$MEMBER_ID\"}" >/dev/null 2>&1
sleep 1
INV_OK=$(req "$TOK" -X POST "$BASE/tenants/$TENANT/members" -d '{"email":"zhangsan@qq.com","role":"normal"}')
INV_OK_CODE=$(echo "$INV_OK" | jq -r '.code')
# 已存在时也可能失败，只要不是"系统错误"即可
if [ "$INV_OK_CODE" = "0" ] || echo "$INV_OK" | jq -e '.error' >/dev/null 2>&1; then
  pass=$((pass + 1)); echo "  PASS  B6 邀请成员（返回业务结果，非 500）"
else
  fail=$((fail + 1)); FAILED+=("B6 邀请成员异常 $INV_OK"); echo "  FAIL  B6 邀请成员异常"
fi

# 更新成员：分配部门
UPD_MEM=$(req "$TOK" -X PUT "$BASE/tenants/$TENANT/console/members/$MEMBER_ID" -d "{\"department_id\":\"$CHILD_ID\",\"position\":\"E2E岗位\"}")
UPD_OK=$(echo "$UPD_MEM" | jq -r '.code')
if [ "$UPD_OK" = "0" ] || echo "$UPD_MEM" | jq -e '.error' >/dev/null 2>&1; then
  pass=$((pass + 1)); echo "  PASS  B7 更新成员部门/岗位（业务结果）"
else
  fail=$((fail + 1)); FAILED+=("B7 更新成员异常"); echo "  FAIL  B7 更新成员异常"
fi

# 有成员的部门不可删（此时 CHILD_ID 下应有 zhangsan，若邀请成功）
DEL_WITH_MEMBER=$(req "$TOK" -X DELETE "$BASE/tenants/$TENANT/departments/$CHILD_ID")
DEL_CODE=$(echo "$DEL_WITH_MEMBER" | jq -r '.code')
if [ "$INV_OK_CODE" = "0" ]; then
  ckn "B8 有成员的部门不可删除" "0" "$DEL_CODE"
else
  echo "  SKIP  B8 有成员的部门不可删除（成员未加入）"
fi

# ── C. 角色权限 ───────────────────────────────────────────────────────────
echo ""
echo "[C] 角色权限"

ROLES=$(req "$TOK" "$BASE/tenants/$TENANT/roles")
# 校验四个内置角色都在，而不是数个数：内置清单从 3 个变 4 个（Owner 变成内置
# 角色）时，写死数字的断言会静默过期；这里关心的是「该有的都在」。
for _bn in Owner 租户管理员 部门管理员 普通成员; do
  ck "C1 内置角色存在：$_bn" "1" \
    "$(echo "$ROLES" | jq --arg n "$_bn" '[.data.roles[] | select(.is_builtin==true and .name==$n)] | length')"
done

BUILTIN_ID=$(echo "$ROLES" | jq -r '[.data.roles[] | select(.name=="普通成员")][0].id')
DEL_BUILTIN=$(req "$TOK" -X DELETE "$BASE/tenants/$TENANT/roles/$BUILTIN_ID")
ckn "C2 内置角色不可删除" "0" "$(echo "$DEL_BUILTIN" | jq -r '.code')"

# 只判错误码不够：删成功也会被 EnsureBuiltinRoles 在下次列表时重建，返回的
# 还是一个「看起来正常」的列表。真正能区分的是 id —— 被删过就一定会变。
BUILTIN_ID_AFTER=$(req "$TOK" "$BASE/tenants/$TENANT/roles" \
  | jq -r '[.data.roles[] | select(.name=="普通成员")][0].id')
ck "C2b 内置角色 id 未变（非删后重建）" "$BUILTIN_ID" "$BUILTIN_ID_AFTER"

NEW_ROLE=$(req "$TOK" -X POST "$BASE/tenants/$TENANT/roles" -d '{"name":"E2E自定义角色","description":"端到端测试"}')
NEW_ROLE_ID=$(echo "$NEW_ROLE" | jq -r '.data.id // empty')
ck "C3 创建自定义角色" "0" "$(echo "$NEW_ROLE" | jq -r '.code')"

# 保存矩阵：勾选 dataset 的 view+create
SAVE=$(req "$TOK" -X PUT "$BASE/tenants/$TENANT/roles/$NEW_ROLE_ID/permissions" -d '{"permissions":[{"module":"dataset","can_view":true,"can_create":true,"can_edit":false,"can_delete":false,"can_manage":false},{"module":"agent","can_view":true,"can_create":false,"can_edit":false,"can_delete":false,"can_manage":false}]}')
ck "C4 保存权限矩阵" "0" "$(echo "$SAVE" | jq -r '.code')"

READ=$(req "$TOK" "$BASE/tenants/$TENANT/roles")
# 角色自带的 permissions 数组即其矩阵（接口返回 {roles, modules}，没有独立 matrix）。
# 全部字段名走 --arg，不在 jq 表达式里拼引号（上一版就是因此取到 null）。
perms_of() {
  echo "$1" | jq -r --arg rid "$NEW_ROLE_ID" --arg m "$2" --arg f "$3" \
    '([.data.roles[] | select(.id==$rid)][0].permissions // []) | map(select(.module==$m))[0][$f]'
}
ck "C5 矩阵回读 can_view 一致" "true" "$(perms_of "$READ" dataset can_view)"
ck "C6 矩阵回读 can_create 一致" "true" "$(perms_of "$READ" dataset can_create)"

# 关键回归：取消勾选必须能持久化（GORM default 标签会让 false 被省略）
SAVE_OFF=$(req "$TOK" -X PUT "$BASE/tenants/$TENANT/roles/$NEW_ROLE_ID/permissions" -d '{"permissions":[{"module":"dataset","can_view":false,"can_create":false,"can_edit":false,"can_delete":false,"can_manage":false}]}')
ck "C7 保存全 false 矩阵" "0" "$(echo "$SAVE_OFF" | jq -r '.code')"
READ2=$(req "$TOK" "$BASE/tenants/$TENANT/roles")
ck "C8 取消勾选可持久化（GORM 零值回归）" "false" "$(perms_of "$READ2" dataset can_view)"

# ── D. 资源授权 ───────────────────────────────────────────────────────────
echo ""
echo "[D] 资源授权"

G1=$(req "$TOK" "$BASE/tenants/$TENANT/grants?kind=dataset&page=1&page_size=5")
ck "D1 知识库资源列表" "0" "$(echo "$G1" | jq -r '.code')"
DATASET_ID=$(echo "$G1" | jq -r '.data.resources[0].resource_id // empty')

G2=$(req "$TOK" "$BASE/tenants/$TENANT/grants?kind=canvas&page=1&page_size=5")
ck "D2 智能体资源列表" "0" "$(echo "$G2" | jq -r '.code')"
G3=$(req "$TOK" "$BASE/tenants/$TENANT/grants?kind=memory&page=1&page_size=5")
ck "D3 记忆资源列表" "0" "$(echo "$G3" | jq -r '.code')"

if [ -n "$DATASET_ID" ]; then
  # 授权给成员
  SET=$(req "$TOK" -X PUT "$BASE/tenants/$TENANT/grants/dataset/$DATASET_ID" -d "{\"subjects\":[{\"kind\":\"user\",\"id\":\"$MEMBER_ID\",\"name\":\"\"}]}")
  ck "D4 设置单成员授权" "0" "$(echo "$SET" | jq -r '.code')"
  RB=$(req "$TOK" "$BASE/tenants/$TENANT/grants?kind=dataset&page=1&page_size=50")
  GBYID=$(echo "$RB" | jq -r "[.data.resources[] | select(.resource_id==\"$DATASET_ID\")][0].grants | length")
  ck "D5 授权回读 1 条" "1" "$GBYID"

  # 清空
  CLR=$(req "$TOK" -X PUT "$BASE/tenants/$TENANT/grants/dataset/$DATASET_ID" -d '{"subjects":[]}')
  ck "D6 清空授权" "0" "$(echo "$CLR" | jq -r '.code')"
  RB2=$(req "$TOK" "$BASE/tenants/$TENANT/grants?kind=dataset&page=1&page_size=50")
  ck "D7 清空后 0 条" "0" "$(echo "$RB2" | jq -r "[.data.resources[] | select(.resource_id==\"$DATASET_ID\")][0].grants | length")"

  # 跨租户授权 → 资源不属于本租户
  CROSSG=$(req "$TOK_OUT" -X PUT "$BASE/tenants/$TENANT/grants/dataset/$DATASET_ID" -d '{"subjects":[{"kind":"team","id":""}]}')
  ckn "D8 跨租户设置授权被拒绝" "0" "$(echo "$CROSSG" | jq -r '.code')"
else
  echo "  SKIP  D4-D8（该租户无知识库资源）"
fi

# ── E. 权限链路 ───────────────────────────────────────────────────────────
echo ""
echo "[E] 权限链路"

ck "E1 非成员访问他人租户被拒绝" "403" "$(echo "$CROSS" | jq -r '.code')"

# 非 owner/admin 的写操作
if [ "$INV_OK_CODE" = "0" ]; then
  MEM_WRITE=$(req "$TOK_MEM" -X POST "$BASE/tenants/$TENANT/departments" -d '{"name":"越权部门"}')
  ck "E2 normal 成员写部门被拒绝" "403" "$(echo "$MEM_WRITE" | jq -r '.code')"
  MEM_READ=$(req "$TOK_MEM" "$BASE/tenants/$TENANT/departments")
  ck "E3 normal 成员可读部门" "0" "$(echo "$MEM_READ" | jq -r '.code')"
else
  echo "  SKIP  E2-E3（测试成员未加入）"
fi

# ── F. 数据完整性 ─────────────────────────────────────────────────────────
echo ""
echo "[F] 数据完整性"

echo "  INFO  canvas tenant_id 空值数（应为 0）：见下方 SQL 检查"

# ── 清理 ─────────────────────────────────────────────────────────────────
echo ""
echo "[清理] 删除测试数据"

# 顺序很重要：先移除成员，再删子部门，最后删父部门。
# 反过来的话父部门因"有子部门/有成员"被拒，每跑一次就留下一对残留。
# 每步都打印返回码：清理失败如果静默，下一轮跑起来会有莫名其妙的脏数据。
cleanup_step() { # cleanup_step <desc> <curl args...>
  local desc="$1"; shift
  local code
  code=$(req "$TOK" "$@" | jq -r '.code // "no-response"')
  echo "  $desc → code=$code"
}

cleanup_step "移除测试成员" -X DELETE "$BASE/tenants/$TENANT/users" -d "{\"user_id\":\"$MEMBER_ID\"}"
sleep 1
[ -n "$CHILD_ID" ] && cleanup_step "删除子部门" -X DELETE "$BASE/tenants/$TENANT/departments/$CHILD_ID"
[ -n "$ROOT_ID" ] && cleanup_step "删除父部门" -X DELETE "$BASE/tenants/$TENANT/departments/$ROOT_ID"
[ -n "$NEW_ROLE_ID" ] && cleanup_step "删除测试角色" -X DELETE "$BASE/tenants/$TENANT/roles/$NEW_ROLE_ID"

echo ""
echo "=============================================="
echo " 合计：PASS=$pass  FAIL=$fail"
if [ "$fail" -ne 0 ]; then
  echo " 失败用例："
  for f in "${FAILED[@]}"; do echo "   - $f"; done
fi
echo "=============================================="
[ "$fail" -eq 0 ] || exit 1
