#!/usr/bin/env bash
#
# RAGFlow 生产数据备份
#
# 覆盖范围：MySQL（逻辑）+ MinIO（对象）+ Infinity（索引）+ Kvrocks（缓存/会话）+ 配置
# 不备份：NATS JetStream（消息队列，重建即可；任务会由 ingestion 重新投递）
#
# 用法：
#   ./backup_ragflow.sh              正常备份
#   ./backup_ragflow.sh --dry-run    只打印计划与空间，不写盘
#
# 部署：
#   /root/backup_ragflow.sh          生产位置
#   crontab: 0 3 * * * /root/backup_ragflow.sh >> /root/backups/backup.log 2>&1
#
# 恢复：见 docs/backup-restore-runbook.md

set -euo pipefail

BACKUP_ROOT=${BACKUP_ROOT:-/root/backups}
RETENTION_DAYS=${RETENTION_DAYS:-7}
MIN_FREE_GB=${MIN_FREE_GB:-15}
MYSQL_CONTAINER=${MYSQL_CONTAINER:-docker-mysql-1}
RAGFLOW_DIR=${RAGFLOW_DIR:-/root/ragflow}
VOLUME_ROOT=/var/lib/docker/volumes

DATE_DIR=$(date +%Y%m%d_%H%M%S)
DEST="$BACKUP_ROOT/$DATE_DIR"
LOG="$BACKUP_ROOT/backup.log"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

mkdir -p "$BACKUP_ROOT"
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }
fail() { log "ERROR: $*"; exit 1; }

# ── 前置检查 ────────────────────────────────────────────────────────────
FREE_GB=$(df -BG / | tail -1 | awk '{print $4}' | tr -d 'G')
[ "${FREE_GB:-0}" -ge "$MIN_FREE_GB" ] || fail "磁盘可用 ${FREE_GB}G，低于阈值 ${MIN_FREE_GB}G，拒绝备份"

MP=$(grep -E '^MYSQL_PASSWORD=' "$RAGFLOW_DIR/docker/.env" 2>/dev/null | cut -d= -f2)
[ -n "$MP" ] || fail "无法从 $RAGFLOW_DIR/docker/.env 读取 MYSQL_PASSWORD"

if [ "$DRY" = 1 ]; then
    log "=== DRY RUN ==="
    log "目标目录：$DEST"
    log "保留策略：$RETENTION_DAYS 天"
    log "磁盘可用：${FREE_GB}G（阈值 ${MIN_FREE_GB}G）"
    log "计划备份：mysql / minio / infinity(persistence+wal+catalog) / kvrocks / config"
    du -sh "$VOLUME_ROOT"/docker_*_data 2>/dev/null | sed 's/^/  /'
    exit 0
fi

mkdir -p "$DEST"
log "=== 备份开始 → $DEST ==="

# 卷目录热备份：tar 读到正在写的文件会返回 exit 1（"file changed as we read it"），
# 对运行中的服务这是常态而非故障。这里容忍它，真正的失败交给后面的产物大小校验。
pack_volume() {
    local src="$1" out="$2"; shift 2
    tar -C "$src" -cf - --warning=no-file-changed "$@" 2>/dev/null \
        | zstd -T2 -3 -q -f -o "$out" || true
}

# ── 1. MySQL：逻辑备份 ──────────────────────────────────────────────────
# --single-transaction 给 InnoDB 一致性快照且不锁表，业务无感；
# --quick 逐行流式导出，避免大表把 mysqldump 的内存顶起来。
log "MySQL（mysqldump）..."
docker exec "$MYSQL_CONTAINER" mysqldump -uroot -p"$MP" \
    --single-transaction --quick --routines --triggers --events \
    --default-character-set=utf8mb4 \
    --databases rag_flow 2>/dev/null \
    | zstd -T2 -3 -q -f -o "$DEST/mysql_rag_flow.sql.zst" \
    || fail "mysqldump 失败"

# ── 2. MinIO：对象存储（原始上传文件）──────────────────────────────────
log "MinIO（对象）..."
pack_volume "$VOLUME_ROOT/docker_minio_data/_data" "$DEST/minio_data.tar.zst" .

# ── 3. Infinity：索引持久化 ─────────────────────────────────────────────
# 只取 persistence/wal/catalog，跳过 log（406M，纯日志无恢复价值）。
# 热拷贝可能不一致，但 wal 会在启动时重放；若索引损坏可从 MySQL+MinIO 重建。
log "Infinity（索引）..."
pack_volume "$VOLUME_ROOT/docker_infinity_data/_data" "$DEST/infinity_data.tar.zst" \
    persistence wal catalog

# ── 4. Kvrocks：会话/缓存 ───────────────────────────────────────────────
log "Kvrocks（缓存）..."
pack_volume "$VOLUME_ROOT/docker_kvrocks_data/_data" "$DEST/kvrocks_data.tar.zst" .

# ── 5. 配置 ─────────────────────────────────────────────────────────────
log "配置..."
tar -C "$RAGFLOW_DIR" -cf - \
    docker/.env \
    docker/infinity_conf.toml \
    docker/docker-compose.yml \
    docker/docker-compose-base.yml \
    conf/service_conf.yaml 2>/dev/null \
    | zstd -T2 -3 -q -f -o "$DEST/config.tar.zst" \
    || fail "配置打包失败"

# ── 6. 产物校验（防止"成功但空文件"）───────────────────────────────────
# 每个产物按经验值设下限：只校验"非空"发现不了半截包（例如 tar 只读了前几个文件就断）
declare -A MIN_SIZE=(
    [mysql_rag_flow.sql.zst]=1048576      # ≥ 1 MB
    [minio_data.tar.zst]=10485760         # ≥ 10 MB
    [infinity_data.tar.zst]=10485760      # ≥ 10 MB
    [kvrocks_data.tar.zst]=102400         # ≥ 100 KB
    [config.tar.zst]=1024                 # ≥ 1 KB
)
for name in "${!MIN_SIZE[@]}"; do
    f="$DEST/$name"
    [ -f "$f" ] || fail "缺少产物 $name"
    sz=$(stat -c%s "$f" 2>/dev/null || echo 0)
    [ "$sz" -ge "${MIN_SIZE[$name]}" ] \
        || fail "$name 只有 $((sz/1024)) KB，低于下限 $((MIN_SIZE[$name]/1024)) KB，判定为不完整"
done

# ── 7. 清单 ─────────────────────────────────────────────────────────────
{
    echo "backup_time  : $(date '+%Y-%m-%d %H:%M:%S %Z')"
    echo "host         : $(hostname)"
    echo "git_commit   : $(cd "$RAGFLOW_DIR" && git rev-parse HEAD 2>/dev/null || echo unknown)"
    echo "deployed_sha : $(cat "$RAGFLOW_DIR/.deployed_sha" 2>/dev/null || echo unknown)"
    echo "frontend_sha : $(cat "$RAGFLOW_DIR/.frontend_sha" 2>/dev/null || echo unknown)"
    echo "---"
    ( cd "$DEST" && for f in *.zst; do
        printf "%-28s %10s  %s\n" "$f" "$(du -h "$f" | cut -f1)" "$(md5sum "$f" | cut -d' ' -f1)"
      done )
} > "$DEST/MANIFEST.txt"

# ── 8. 清理过期 ─────────────────────────────────────────────────────────
find "$BACKUP_ROOT" -maxdepth 1 -type d -name '20*' -mtime +"$RETENTION_DAYS" \
    -exec rm -rf {} + 2>/dev/null || true

TOTAL=$(du -sh "$DEST" | cut -f1)
log "=== 完成：$TOTAL → $DEST ==="

# ── 9. 异地留存（默认关闭）───────────────────────────────────────────────
# 单机部署时备份与数据同盘，只防误删不防整机故障。有远端目标时取消注释：
# REMOTE=${REMOTE:-user@backup-host:/data/ragflow-backups/}
# [ -n "${REMOTE:-}" ] && rsync -a --delete-after "$DEST" "$REMOTE" \
#     && log "已同步到 $REMOTE"
