# RAGFlow 备份与恢复 Runbook

| 项 | 内容 |
|---|---|
| 适用环境 | 生产单机 `172.30.20.51`（`ecs-ragflow`）|
| 备份脚本 | `/root/backup_ragflow.sh`（仓库内 `scripts/backup_ragflow.sh`）|
| 备份位置 | `/root/backups/<YYYYMMDD_HHMMSS>/`（每次独立目录，不覆盖旧备份） |
| 调度 | cron 每日 **03:00** |
| 保留策略 | **7 天**（自动清理更早的）|
| 目录命名 | `YYYYMMDD_HHMMSS`，每次独立目录（同一天重跑不会覆盖）|
| 单次体积 | 约 **214 MB**（原始数据 4.5G，压缩比 21:1）|
| 最后更新 | 2026-10-27 |

---

## 一、备份内容

| 组件 | 备份方式 | 文件 | 原始大小 | 压缩后 |
|---|---|---|---|---|
| MySQL | `mysqldump --single-transaction` | `mysql_rag_flow.sql.zst` | 2.4 G | **4.1 M** |
| MinIO（对象存储）| `tar` + zstd | `minio_data.tar.zst` | 333 M | **136 M** |
| Infinity（索引）| `tar` + zstd（persistence/wal/catalog）| `infinity_data.tar.zst` | 1.3 G | **74 M** |
| Kvrocks | `tar` + zstd | `kvrocks_data.tar.zst` | 79 M | **1.2 M** |
| 配置 | `tar` + zstd | `config.tar.zst` | — | **19 K** |
| 清单 | 手工生成 | `MANIFEST.txt` | — | — |

**不备份**：NATS JetStream（消息队列，任务可重新投递，重建即可）、Infinity 的 `log/`（406M 纯日志）。

**MANIFEST.txt 内容**：备份时间、主机名、`git_commit` / `deployed_sha` / `frontend_sha`、各文件大小与 md5。

---

## 二、校验（每次恢复前必做）

```bash
cd /root/backups/<日期>

# 1) 文件级校验（对比 MANIFEST 里的 md5）
md5sum -c <(awk 'NF==3{print $3"  "$1}' MANIFEST.txt)

# 2) MySQL dump 完整性（必须能看到结尾标记）
zstd -dc mysql_rag_flow.sql.zst | tail -1
# 期望：-- Dump completed on ...

# 3) 压缩包可解（快速探测，不落盘）
zstd -t infinity_data.tar.zst && echo OK
```

---

## 三、恢复场景

> ⚠️ **所有恢复动作都会覆盖现有数据。动手前先给"当前状态"再打一份备份**：
> ```bash
> /root/backup_ragflow.sh        # 先把现状存一份
> ```

### 场景 A：MySQL 数据损坏或误删（最常见）

#### A-1 整库恢复

```bash
# 1) 停应用，避免恢复期间有新写入
systemctl stop ragflow-api ragflow-ingestor ragflow-admin

# 2) 恢复（-i 必须加，否则 stdin 不传给容器内 mysql）
MP=$(grep -E '^MYSQL_PASSWORD=' /root/ragflow/docker/.env | cut -d= -f2)
zstd -dc /root/backups/<时间戳>/mysql_rag_flow.sql.zst \
  | docker exec -i docker-mysql-1 mysql -uroot -p"$MP"

# 3) 起服务
systemctl start ragflow-admin ragflow-ingestor ragflow-api

# 4) 验证
curl -s http://127.0.0.1:9380/api/v1/system/healthz
docker exec docker-mysql-1 mysql -uroot -p"$MP" rag_flow -e "SELECT COUNT(*) FROM knowledgebase;"
```

#### A-2 只恢复某几张表（更安全的常用做法）

```bash
# 1) 把 dump 解到一个临时库，从里面挑数据
zstd -dc /root/backups/<时间戳>/mysql_rag_flow.sql.zst > /tmp/restore.sql
docker exec -i docker-mysql-1 mysql -uroot -p"$MP" -e "CREATE DATABASE rag_flow_restore;"
docker exec -i docker-mysql-1 mysql -uroot -p"$MP" rag_flow_restore < /tmp/restore.sql

# 2) 从临时库把目标表覆盖回生产（示例：knowledgebase）
docker exec docker-mysql-1 sh -c "mysqldump -uroot -p'$MP' rag_flow_restore knowledgebase \
  | mysql -uroot -p'$MP' rag_flow"
```

> **注意**：MySQL 恢复不涉及 Infinity，但 `knowledgebase` / `document` / `chunk` 与索引有对应关系，单表回滚后若索引里还留着已删除的 chunk，检索可能返回"找不到原文"的引用。出现这种情况按场景 C 重建索引。

### 场景 B：上传的原始文件丢失（MinIO）

```bash
# 1) 停 MinIO（避免恢复过程中被写入）
docker stop docker-minio-1

# 2) 备份现有目录（以防包是坏的）
mv /var/lib/docker/volumes/docker_minio_data/_data \
   /var/lib/docker/volumes/docker_minio_data/_data.bak.$(date +%s)

# 3) 恢复
mkdir -p /var/lib/docker/volumes/docker_minio_data/_data
zstd -dc /root/backups/<时间戳>/minio_data.tar.zst \
  | tar -C /var/lib/docker/volumes/docker_minio_data/_data -xf -

# 4) 起容器
docker start docker-minio-1
sleep 10 && docker ps --format '{{.Names}} {{.Status}}' | grep minio

# 5) 验证：从页面打开一个知识库的文件，或
curl -s http://127.0.0.1:9380/api/v1/system/healthz   # storage 应为 ok
```

### 场景 C：Infinity 索引损坏

**先判断需不需要恢复索引**：索引是**可重建的派生数据**（源数据在 MySQL 元数据 + MinIO 原始文件）。两条路：

#### C-1 从备份恢复索引（快，约 1 分钟，但索引可能与数据库不同步）

```bash
docker stop docker-infinity-1
mv /var/lib/docker/volumes/docker_infinity_data/_data \
   /var/lib/docker/volumes/docker_infinity_data/_data.bak.$(date +%s)
mkdir -p /var/lib/docker/volumes/docker_infinity_data/_data
zstd -dc /root/backups/<时间戳>/infinity_data.tar.zst \
  | tar -C /var/lib/docker/volumes/docker_infinity_data/_data -xf -
docker start docker-infinity-1
# 启动时会重放 wal，观察日志
docker logs -f docker-infinity-1 | head -40
```

#### C-2 重建索引（慢，需要重新解析+向量化，但保证一致）

```bash
# 1) 停 Infinity 并清空索引目录
docker stop docker-infinity-1
mv /var/lib/docker/volumes/docker_infinity_data/_data \
   /var/lib/docker/volumes/docker_infinity_data/_data.corrupt.$(date +%s)
mkdir -p /var/lib/docker/volumes/docker_infinity_data/_data

# 2) 起容器（空库）
cd /root/ragflow/docker && DOC_ENGINE=infinity docker compose --profile infinity up -d infinity

# 3) 在页面上对每个知识库触发"重新解析"
#    或走任务重投：把 document 的 run 状态重置后由 ingestor 重新处理
```

> **怎么选**：数据是当天/近期的 → C-1（快）；索引与数据库明显脱节（最近做过大量删除）→ C-2。

### 场景 D：整机故障 / 换机恢复

按以下顺序（**顺序不能乱**）：

```bash
# 1) 基础环境（见 docs/deployment-architecture.md 第 2 章）
#    OS 依赖 → Go/Node/CMake → Docker → 代码 → 原生静态库 → 编译

# 2) 恢复配置（拿到 .env 才有后续的密码）
zstd -dc /root/backups/<时间戳>/config.tar.zst | tar -C /root/ragflow -xf -

# 3) 起中间件（先空库）
cd /root/ragflow/docker
DOC_ENGINE=infinity docker compose --profile infinity up -d

# 4) 恢复数据（顺序：MySQL → MinIO → Infinity → Kvrocks）
#    按上面场景 A / B / C 的步骤分别执行

# 5) 起应用
systemctl start ragflow-admin ragflow-ingestor ragflow-api

# 6) 验证
curl -s http://127.0.0.1:9380/api/v1/system/version
curl -s http://127.0.0.1:9380/api/v1/system/healthz
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1/
```

> **关键前置**：新机必须保持 `/root/ragflow/docker` 这个路径，否则 compose 项目名变化 → 挂到空卷上 → 看起来像"数据全丢"。

### 场景 E：只想取回某个文件/某行数据

```bash
# 从 MinIO 包里单独取一个对象（先列出路径）
zstd -dc minio_data.tar.zst | tar -tf - | grep -i "faq"
zstd -dc minio_data.tar.zst | tar -xf - -C /tmp ./<对象路径>

# 从 MySQL dump 里单独取一张表
zstd -dc mysql_rag_flow.sql.zst | sed -n '/CREATE TABLE `role`/,/^$/p' | head
```

---

## 四、演练记录（离线验证，不碰生产）

**目的**：确认备份包真的能恢复，而不只是"文件存在"。

```bash
# 1) 起一个一次性 MySQL 容器（不影响生产，端口不冲突）
docker run --rm -d --name restore-test \
  -e MYSQL_ROOT_PASSWORD=test123 -e MYSQL_DATABASE=rag_flow \
  -p 13306:3306 mysql:8.0.40

# 2) 等待就绪（约 20 秒）
until docker exec restore-test mysqladmin ping -uroot -ptest123 --silent 2>/dev/null; do sleep 2; done

# 3) 灌入备份
zstd -dc /root/backups/<时间戳>/mysql_rag_flow.sql.zst \
  | docker exec -i restore-test mysql -uroot -ptest123

# 4) 核对关键表行数（与生产对比）
docker exec restore-test mysql -uroot -ptest123 rag_flow -e "
  SELECT 'knowledgebase' t, COUNT(*) n FROM knowledgebase
  UNION ALL SELECT 'document', COUNT(*) FROM document
  UNION ALL SELECT 'user', COUNT(*) FROM user;"

# 5) 清理
docker rm -f restore-test
```

**2026-10-27 首次演练结果**：

| 项 | 结果 |
|---|---|
| dump 表数量 | 74 张 |
| dump 完整性标记 | `-- Dump completed on 2026-10-27 19:19:29` |
| MinIO 对象数 | 46,082 个文件 |
| Infinity 索引段 | persistence 目录结构完整 |
| 备份总大小 | 214 MB |
| 实际耗时 | 6 秒（数据已在 page cache）|
| MinIO 对象数（复验）| 45,762 |
| Infinity 条目数 | 12,313 |

> 本次只做了**内容可解析性验证**（解压、列表、完整性标记），未做完整灌库演练。建议每季度做一次第四节的一次性容器演练。

---

## 五、日常操作

```bash
# 手工触发一次备份
/root/backup_ragflow.sh

# 只看计划不执行
/root/backup_ragflow.sh --dry-run

# 看历史
tail -50 /root/backups/backup.log

# 看 cron 侧输出（脚本崩溃信息在这里）
tail -20 /root/backups/cron.log

# 列出所有备份与体积
du -sh /root/backups/*/ | sort -k2

# 临时改保留天数（默认 7）
RETENTION_DAYS=14 /root/backup_ragflow.sh
```

---

## 六、已知局限（必须知道）

| # | 局限 | 后果 | 缓解 |
|---|---|---|---|
| 1 | **备份与数据同盘**（都在 `/dev/sda1`）| 磁盘损坏或整机故障时备份一起丢 | 尽快配异地/远端存储（脚本已预留 `REMOTE` rsync 钩子）|
| 2 | Infinity 为**热拷贝** | 极端情况下索引不一致 | 启动时重放 wal；必要时按场景 C-2 重建 |
| 3 | MinIO 恢复需**停容器** | 恢复期间无法上传/下载文件 | 在维护窗口执行 |
| 4 | 未备份 NATS 数据 | 进行中的任务丢失 | 重启后任务可由 ingestion 重新投递 |
| 5 | 只保留 **7 天** | 更早的误删无法追溯 | 需要更长周期请调 `RETENTION_DAYS` 或加月度归档 |

---

## 七、待办（按优先级）

1. **配置异地备份**（P0，见局限 1）——需要提供远端目标（另一台机器 / NAS / 对象存储）
2. 每季度做一次场景 A-2 的单表恢复演练
3. 给备份加成功/失败告警（当前失败只写 `cron.log`，无人会主动看）
