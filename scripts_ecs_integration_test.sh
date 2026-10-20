#!/bin/bash
# Integration / E2E 测试配置与执行脚本
#
# 背景：QA 报告指出 integration tier 因缺测试账号 + 独立测试库而无法执行。
# test/api/config.go 其实已经支持环境变量（见下方 RAGFLOW_TEST_* ），
# 缺的是「把环境变量配好」这一步，本脚本补上。
#
# 用法：
#   bash scripts_ecs_integration_test.sh setup    # 写入 /etc/ragflow-test.env
#   bash scripts_ecs_integration_test.sh run      # 跑 integration tier
#   bash scripts_ecs_integration_test.sh e2e      # 跑 e2e tier（需 LLM key）
#   bash scripts_ecs_integration_test.sh show     # 查看当前配置
set -uo pipefail

PREFIX="[integration-test]"
ENV_FILE="/etc/ragflow-test.env"

# ── 测试账号（RSA 公钥加密后的密码，与 web/src/utils/index.ts 的前端一致）──
# 登录接口走 RSA：前端先 Base64(password) 再 RSA-PKCS1 加密。
# 下面的密文是 "QweAsd@123" 的 Base64 再 RSA 加密结果。
TEST_EMAIL="123456789@qq.com"
TEST_PASSWORD_RSA="nJEQNomgtlxhPkx/6CxV10czAu5P84+zSpv2OwPqX87AJ8nrT4ZjNd9tDpuNr7/8HA4gpE8hT2TcQYJpw4OXiJNMyUT6WeUnYgqsBw5QyMaOj+seshNzjlg6ytMWiAvlwNqsx1K+wKmDuXxywHAgoz+BaIsvcWsvajM764wac1AF9Q9dWCfDrcEt/lwHHsLLPCZB1GB4fuOyTGDEAuVt/fSi9mfRaWfbqOY+eh0F0QUe2B2QAiOzW/F+SD5kbqTqGAGHdMq6g8Jdises9LpQDi+YvApdQN83gZyZ6dCSx8DABs7xw5gZkcbR6JY7TJUmUtGDlKrYqWwPdtzWLDe33w=="

# ── 独立测试库（强烈建议：integration 测试会写数据，别污染 rag_flow）──
# 建库：docker exec docker-mysql-1 mysql -uroot -pinfini_rag_flow \
#         -e "CREATE DATABASE IF NOT EXISTS ragflow_test CHARACTER SET utf8mb4;"
TEST_DB_NAME="ragflow_test"
TEST_DB_USER="root"
TEST_DB_PASS="infini_rag_flow"

cmd_setup() {
  echo "$PREFIX 写入 $ENV_FILE"
  cat > "$ENV_FILE" <<EOF
# RAGFlow integration/e2e test environment
# 供 build.sh --test-integration / --test-e2e 与 test/api 使用
export RAGFLOW_TEST_EMAIL="$TEST_EMAIL"
export RAGFLOW_TEST_PASSWORD="$TEST_PASSWORD_RSA"
export RAGFLOW_TEST_MYSQL_DSN="$TEST_DB_USER:$TEST_DB_PASS@tcp(127.0.0.1:3306)/$TEST_DB_NAME?charset=utf8mb4&parseTime=True&loc=Local"
export HOST_ADDRESS="http://127.0.0.1:9380"
EOF
  chmod 600 "$ENV_FILE"
  echo "$PREFIX 创建独立测试库 $TEST_DB_NAME"
  docker exec docker-mysql-1 mysql -uroot -p"$TEST_DB_PASS" \
    -e "CREATE DATABASE IF NOT EXISTS $TEST_DB_NAME CHARACTER SET utf8mb4;" 2>/dev/null
  echo "$PREFIX 完成。跑测试：bash scripts_ecs_integration_test.sh run"
}

cmd_run() {
  # shellcheck disable=SC1090
  [ -f "$ENV_FILE" ] && source "$ENV_FILE"
  cd /root/ragflow || exit 1
  export PATH=$PATH:/usr/local/go/bin
  export DOC_ENGINE=infinity
  echo "$PREFIX 跑 integration tier（build.sh --test-integration）"
  ./build.sh --test-integration 2>&1 | tail -60
  return ${PIPESTATUS[0]}
}

cmd_e2e() {
  # shellcheck disable=SC1090
  [ -f "$ENV_FILE" ] && source "$ENV_FILE"
  cd /root/ragflow || exit 1
  export PATH=$PATH:/usr/local/go/bin
  export DOC_ENGINE=infinity
  if [ -z "${ZHIPU_AI_API_KEY:-}" ] && [ -z "${SILICONFLOW_API_KEY:-}" ]; then
    echo "$PREFIX e2e 需要 LLM key（ZHIPU_AI_API_KEY 或 SILICONFLOW_API_KEY），未配置则跳过"
    return 2
  fi
  echo "$PREFIX 跑 e2e tier（build.sh --test-e2e）"
  ./build.sh --test-e2e 2>&1 | tail -60
  return ${PIPESTATUS[0]}
}

cmd_show() {
  if [ -f "$ENV_FILE" ]; then
    echo "$PREFIX 当前配置（密码已截断）："
    sed -E 's/(RAGFLOW_TEST_PASSWORD=".{12}).*(")/\1...截断\2/' "$ENV_FILE"
  else
    echo "$PREFIX 尚未配置，先执行：bash scripts_ecs_integration_test.sh setup"
  fi
}

case "${1:-show}" in
  setup) cmd_setup ;;
  run)   cmd_run ;;
  e2e)   cmd_e2e ;;
  show)  cmd_show ;;
  *)     echo "用法: $0 {setup|run|e2e|show}"; exit 1 ;;
esac
