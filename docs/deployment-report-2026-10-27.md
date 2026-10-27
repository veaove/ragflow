# RAGFlow 生产环境部署报告

| 项 | 内容 |
|---|---|
| **报告编号** | DEP-20261027 |
| **环境** | 生产（内网单机）|
| **主机** | 内网 `172.30.20.51`，主机名 `debian`，SSH 别名 `ecs-ragflow` |
| **操作系统** | Debian GNU/Linux 13 (trixie)，内核 6.12.113+deb13-amd64 |
| **硬件** | 8 核 / 15 GiB 内存 / 196 GB 磁盘（当前用 31 GB，17%）|
| **部署形态** | 单机（Docker 承载中间件 + systemd 承载应用进程）|
| **出报告时版本** | 运行中 `f20a44e`（详见第十章"版本一致性"）|
| **业务入口** | `http://172.30.20.51/`（主站）、`http://172.30.20.51/admin`（超管后台）|

---

## 一、架构概览

```
                    ┌──────────────────────────────────────┐
   浏览器 / API      │  nginx 1.26.3  :80                   │
   ────────────────▶ │  /etc/nginx/nginx.conf               │
                    └───────┬──────────────┬───────────────┘
                            │ /api/v1/admin│ /api/v1        │ 其余
                            ▼              ▼                ▼
                  ┌──────────────┐ ┌──────────────┐ ┌─────────────────┐
                  │ ragflow-admin│ │  ragflow-api │ │ 静态资源         │
                  │   :9381      │ │   :9380      │ │ web/dist_<sha>  │
                  └──────┬───────┘ └──────┬───────┘ └─────────────────┘
                         │                │
                         │    ┌───────────┴────────┐
                         │    │ ragflow-ingestor   │  无端口，消费任务
                         │    └───────────┬────────┘
                         └────────────────┼──────────────────┐
                                          ▼                  ▼
        ┌────────────┬────────────┬────────────┬──────────┬──────────┐
        │ MySQL      │ Kvrocks    │ MinIO      │ NATS     │ Infinity │
        │ :3306      │ :6379      │ :9000/9001 │ :4222    │ :23817   │
        │ 元数据      │ 会话/缓存   │ 对象存储    │ 任务队列  │ 向量/全文 │
        └────────────┴────────────┴────────────┴──────────┴──────────┘
                    全部运行在 Docker 网络 docker_ragflow
```

**部署形态一句话**：应用层（3 个 Go 进程 + nginx）用 **systemd** 托管；中间件（5 个容器）用 **Docker Compose** 托管；两者通过 `127.0.0.1` 上的宿主机端口互通。

---

## 二、组件清单

### 2.1 应用层（systemd）

| 名称 | 形态 | 部署位置 | 监听 | 版本 |
|---|---|---|---|---|
| `ragflow-admin` | systemd service | `/etc/systemd/system/ragflow-admin.service` | `:9381` | 同二进制 |
| `ragflow-ingestor` | systemd service | `/etc/systemd/system/ragflow-ingestor.service` | 无（后台消费）| 同二进制 |
| `ragflow-api` | systemd service | `/etc/systemd/system/ragflow-api.service` | `:9380` | 同二进制 |
| 二进制 | 静态编译 | `/root/ragflow/bin/ragflow_server` | — | 运行中 `f20a44e`（详见第十章）|
| CLI | 静态编译 | `/root/ragflow/bin/ragflow-cli` | — | 同上 |
| 前端静态资源 | nginx 直出 | `/root/ragflow/web/dist_<sha>/` | — | 同 commit |

> 三个进程共用**同一个二进制**，靠 `--api` / `--admin` / `--ingestor` 参数区分角色。

### 2.2 接入层

| 名称 | 形态 | 部署位置 | 监听 | 版本 |
|---|---|---|---|---|
| `nginx` | systemd service | `/etc/nginx/nginx.conf`（**自包含，不走 sites-enabled**）| `:80` | 1.26.3 |

### 2.3 中间件（Docker）

| 名称 | 容器名 | 镜像 | 部署位置（卷）|
|---|---|---|---|
| MySQL | `docker-mysql-1` | `mysql:8.0.40` | 卷 `docker_mysql_data` → `/var/lib/mysql` |
| Infinity | `docker-infinity-1` | `infiniflow/infinity:v0.7.4-x64-v3` | 卷 `docker_infinity_data` → `/var/infinity` |
| MinIO | `docker-minio-1` | `pgsty/silo:RELEASE.2026-08-06T00-00-00Z` | 卷 `docker_minio_data` → `/data` |
| Kvrocks | `docker-kvrocks-1` | `apache/kvrocks:2.16.0` | 卷 `docker_kvrocks_data` → `/var/lib/kvrocks` |
| NATS | `docker-nats-1` | `nats:2.14.2` | 卷 `docker_nats_data` → `/data` |

**编排文件**：`/root/ragflow/docker/docker-compose.yml`（主）+ `docker-compose-base.yml`（服务定义）+ `.env`（变量）

> ⚠️ **MinIO 用的是 `pgsty/silo` 分支，不是官方 `minio/minio`**。替换镜像前需确认 S3 兼容性。

---

## 三、Docker 组件详细配置

### 3.1 MySQL — `docker-mysql-1`

| 项 | 值 |
|---|---|
| 镜像 | `mysql:8.0.40` |
| 启动命令 | `--max_connections=1000 --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci --default-authentication-plugin=mysql_native_password --tls_version=TLSv1.2,TLSv1.3 --init-file=/data/application/init.sql --binlog_expire_logs_seconds=604800 --innodb-flush-log-at-trx-commit=1 --sync-binlog=1 --innodb-buffer-pool-size=1G --innodb-io-capacity=2000 --innodb-io-capacity-max=4000 --innodb-redo-log-capacity=1G` |
| 端口 | `3306 → 3306/tcp`（**映射到 0.0.0.0**）|
| 数据卷 | `docker_mysql_data` → `/var/lib/mysql` |
| 资源限制 | **无**（未设 mem_limit / cpus）|
| 重启策略 | `unless-stopped` |
| 健康检查 | `mysqladmin ping -uroot -p<MYSQL_PASSWORD>` |
| 网络 | `docker_ragflow` |
| 关键参数 | buffer pool **1G**、redo log **1G**、binlog 保留 **7 天**、`sync_binlog=1`（持久性优先）|

### 3.2 Infinity — `docker-infinity-1`

| 项 | 值 |
|---|---|
| 镜像 | `infiniflow/infinity:v0.7.4-x64-v3` |
| 启动命令 | `-f /infinity_conf.toml` |
| 端口 | `23817 → 23817`（Thrift）、`23820 → 23820`（HTTP）、`5432 → 5432`（PSQL），**均映射 0.0.0.0** |
| 数据卷 | `docker_infinity_data` → `/var/infinity` |
| 配置文件 | 宿主机 `/root/ragflow/docker/infinity_conf.toml` → 容器 `/infinity_conf.toml` |
| **资源限制** | **内存 10 GiB**（`MEM_LIMIT=10737418240`）、**CPU 2 核**（`cpus: "2.0"`）|
| 重启策略 | `unless-stopped` |
| 健康检查 | `curl http://localhost:23820/admin/node/current` |
| 网络 | `docker_ragflow` |

**`infinity_conf.toml` 关键项**：

| 配置 | 值 | 说明 |
|---|---|---|
| `buffer_manager_size` | **4GB** | 磁盘页缓存上限（数据 1.2G，4G 足够）|
| `memindex_memory_quota` | 1GB | 新写入向量的内存索引配额 |
| `persistence_dir` | `/var/infinity/persistence` | 数据 + 索引持久化 |
| `wal_dir` | `/var/infinity/wal` | 预写日志 |
| `optimize_interval` | 10s | 索引优化检查间隔（**重启后全量 optimize，CPU 会短时升高**）|
| `compact_interval` | 120s | compact 间隔 |

> **10G / 4G 这组数字是 2026-10-27 调整的**。改前为 `mem_limit 5.5G` + `buffer_manager_size 8GB`，缓存目标超容器上限，导致反复触发全局 OOM（当日 54 次，其中 15 次杀的就是它）。

### 3.3 MinIO — `docker-minio-1`

| 项 | 值 |
|---|---|
| 镜像 | `pgsty/silo:RELEASE.2026-08-06T00-00-00Z` |
| 启动命令 | `server --console-address :9001 /data` |
| 端口 | `9000 → 9000`（S3 API）、`9001 → 9001`（控制台），**均映射 0.0.0.0** |
| 数据卷 | `docker_minio_data` → `/data` |
| 资源限制 | 无 |
| 重启策略 | `unless-stopped` |
| 健康检查 | `curl -f http://localhost:9000/minio/health/live` |
| 网络 | `docker_ragflow` |
| 凭据 | 用户 `rag_flow`，密码见 `docker/.env` 的 `MINIO_PASSWORD` |

### 3.4 Kvrocks — `docker-kvrocks-1`

| 项 | 值 |
|---|---|
| 镜像 | `apache/kvrocks:2.16.0` |
| 端口 | `6379 → 6379`（**映射 0.0.0.0**）|
| 数据卷 | `docker_kvrocks_data` |
| 资源限制 | 无 |
| 重启策略 | `unless-stopped` |
| 健康检查 | `redis-cli -a <REDIS_PASSWORD> ping` |
| 网络 | `docker_ragflow` |
| 用途 | 会话、缓存、**系统签名密钥**（`ragflow:system:secret_key`）|

### 3.5 NATS — `docker-nats-1`

| 项 | 值 |
|---|---|
| 镜像 | `nats:2.14.2` |
| 启动命令 | `-js -sd /data --http_port 8222`（JetStream 持久化）|
| 端口 | `4222 → 4222`（客户端）、`8222 → 8222`（监控）、`6222`（集群，未映射）|
| 数据卷 | `docker_nats_data` → `/data` |
| 资源限制 | 无 |
| 重启策略 | `unless-stopped` |
| 健康检查 | `nats-server --health-check` |
| 网络 | `docker_ragflow` |
| 用途 | ingestion 任务队列（`RAGFLOW_SYNC_TASKS` / `KV_RAGFLOW_SYNC_CHECKPOINTS` / `RAGFLOW_TASKS`）|

---

## 四、systemd 服务配置

三个服务的差异只在 `ExecStart` 参数与 `After` 依赖，其余相同：

| 服务 | ExecStart | After |
|---|---|---|
| `ragflow-admin` | `/root/ragflow/bin/ragflow_server --admin` | `docker.service` |
| `ragflow-ingestor` | `/root/ragflow/bin/ragflow_server --ingestor` | `docker.service ragflow-admin.service` |
| `ragflow-api` | `/root/ragflow/bin/ragflow_server --api` | `docker.service ragflow-admin.service ragflow-ingestor.service` |

**公共配置**：

```ini
User=root
WorkingDirectory=/root/ragflow
Environment=DOC_ENGINE=infinity          # 必须，否则会去连 Elasticsearch
Environment=DEVICE=cpu
Environment=HF_ENDPOINT=https://hf-mirror.com
Environment=GIN_MODE=release
Environment=PATH=/usr/local/go/bin:/usr/local/bin:/root/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Restart=on-failure
RestartSec=10
LimitNOFILE=65536
```

**ingestor 额外**：`Environment=RAGFLOW_INGESTOR_MAX_CONCURRENT_WORKERS=3`

---

## 五、系统级配置（2026-10-27 变更）

| 项 | 当前值 | 变更前 | 落盘位置 |
|---|---|---|---|
| **Swap** | **8 GiB**（`/swapfile`）| 无 | `/etc/fstab` |
| `vm.swappiness` | **10** | 默认 60 | `/etc/sysctl.conf` |
| **`/tmp`** | **根分区 ext4（155G 可用）** | tmpfs 3.9G | `systemctl mask tmp.mount` |
| 备份任务 | 每日 03:00 | 无 | `crontab`（root）|

**变更理由简述**：
- `swap`：内存紧张时提供缓冲，避免直接触发 OOM Killer
- `swappiness=10`：只在真正紧张时换出，不拖累数据库/向量库
- `/tmp` 落盘：Go 编译临时文件曾把 3.9G 的 tmpfs 写满（tmpfs 占物理内存），是当日 OOM 循环的点火器

---

## 六、网络与端口

| 端口 | 归属 | 监听地址 | 对外暴露 | 用途 |
|---|---|---|---|---|
| **80** | nginx | `0.0.0.0` | ✅ **唯一业务入口** | 静态资源 + API 反代 |
| 9380 | ragflow-api | `*` | 经 nginx | 主 API |
| 9381 | ragflow-admin | `*` | 经 nginx（`/api/v1/admin`）| 管理后台 API |
| 3306 | MySQL 容器 | `0.0.0.0` | ⚠️ 内网可直连 | 数据库 |
| 6379 | Kvrocks 容器 | `0.0.0.0` | ⚠️ 内网可直连 | 缓存 |
| 9000 / 9001 | MinIO 容器 | `0.0.0.0` | ⚠️ 内网可直连 | 对象存储 |
| 4222 / 8222 | NATS 容器 | `0.0.0.0` | ⚠️ 内网可直连 | 队列 / 监控 |
| 23817 / 23820 / 5432 | Infinity 容器 | `0.0.0.0` | ⚠️ 内网可直连 | 向量库 |

**nginx 路由规则**：

| Location | 目标 | 特殊配置 |
|---|---|---|
| `~ ^/api/v1/admin` | `127.0.0.1:9381` | 长连接超时 3600s、WebSocket 透传 |
| `~ ^/api/v1` | `127.0.0.1:9380` | 同上 |
| `~* ^/(chunk\|entry\|assets\|pdfjs-dist\|vs)/` | 静态 | 强缓存 30 天 + `immutable` |
| `= /index.html` | 静态 | `no-cache, must-revalidate` |
| `/` | 静态 | `try_files $uri $uri/ /index.html`（SPA 兜底）|

其他：`client_max_body_size 1024M`（大文件上传）、`gzip on comp_level 9`、`proxy_buffering off`。

---

## 七、数据存储

### 7.1 Docker 数据卷

| 卷名 | 大小 | 内容 | 是否备份 |
|---|---|---|---|
| `docker_mysql_data` | 2.4 G | 账号、知识库、文档、任务、模型配置、权限矩阵 | ✅ 逻辑备份 |
| `docker_infinity_data` | 1.7 G | 向量索引 + 全文索引（含 406M 日志）| ✅ persistence/wal/catalog |
| `docker_minio_data` | 333 M | 原始上传文件 | ✅ |
| `docker_kvrocks_data` | 79 M | 会话/缓存/签名密钥 | ✅ |
| `docker_nats_data` | 188 K | JetStream 流 | ❌ 可重建 |

> **卷名前缀 `docker_` 来自 compose 项目名**，而项目名由目录名决定。迁移或重建必须保持 `/root/ragflow/docker` 这个路径，否则会挂到一套空卷，表现像"数据全丢"。

### 7.2 关键目录

| 路径 | 大小 | 说明 |
|---|---|---|
| `/root/ragflow` | 2.5 G | 代码 + 构建产物 |
| `/root/ragflow/bin` | 437 M | `ragflow_server` / `ragflow-cli` |
| `/root/ragflow/web` | 1.6 G | 含 `node_modules` + 多个 `dist_<sha>` |
| `/root/ragflow-native-libs` | 236 M | 4 个原生静态库（编译期链接）|
| `/usr/share/infinity` | 198 M | Infinity 词典（**不在代码目录内**，重装要单独带）|
| `/root/deploy-logs` | ~600 K | 每次发版日志 |
| `/root/backups` | ~850 M | 每日备份（保留 7 天）|
| `/root/ops-backup-20261027` | — | 2026-10-27 变更前配置备份 |

### 7.3 备份现状

| 项 | 值 |
|---|---|
| 脚本 | `/root/backup_ragflow.sh`（仓库 `scripts/backup_ragflow.sh`）|
| 调度 | `0 3 * * *`（root）|
| 保留 | 7 天，目录 `YYYYMMDD_HHMMSS` |
| 单次体积 | **214 MB**（原始 4.5 G，压缩比 21:1）|
| 耗时 | 约 6 秒 |
| 恢复手册 | `docs/backup-restore-runbook.md` |

---

## 八、风险清单

| # | 风险 | 等级 | 影响 | 建议动作 |
|---|---|---|---|---|
| 1 | **备份与数据同盘**（都在 `/dev/sda1`）| **P0** | 磁盘故障/整机宕机时备份一起丢 | 配异地目标（脚本已预留 `REMOTE` rsync 钩子）|
| 2 | **备份失败无告警**（只写 `cron.log`）| P1 | 静默失败，误以为有备份 | 加失败通知 |
| 3 | **中间件端口全映射 `0.0.0.0`** | P1 | 3306/6379/9000/23817 内网可直连；Docker 发布端口**绕过 ufw** | 绑 `127.0.0.1` 或用 `iptables DOCKER-USER` 拦截 |
| 4 | **HTTP 无 TLS** | P1 | 凭据明文传输 | 上 443 + 证书（内网可自签）|
| 5 | **`docker/.env` 被 git 跟踪** | P1 | 配置随 `git reset` 回退；且默认密码入库 | `git rm --cached docker/.env` + `.env.example` 模板 |
| 6 | **默认密码** `infini_rag_flow`（MySQL/MinIO/Kvrocks）| P1 | 弱口令 | 轮换并同步改 `service_conf.yaml` |
| 7 | **版本三处不一致**（见第十章）| P1 | 无法确认线上到底跑的哪份代码 | 执行一次完整发版对齐 |
| 8 | **OOM 无告警**（当日发生 54 次无人知晓）| P1 | 故障发现滞后 | 监控 `journalctl` OOM 关键字 |
| 9 | 单机部署，无高可用 | P2 | 机器故障即服务全停 | 中期规划多节点 |
| 10 | 部门管理员权限与普通成员相同（只读）| P2 | 角色梯度中间档为空 | 按产品需要补本部门写权限 |
| 11 | `chatResource` 租户操作集复用 owner 全套 | P2 | 普通成员可删他人问答应用 | 与 file 同样收紧 |
| 12 | Infinity 索引随业务增长 | P3 | 当前 4.1G/10G，数据翻倍需重估 | 定期观测 `buffer_manager_size` |

---

## 九、后续使用注意点

### 9.1 发版

| 要点 | 说明 |
|---|---|
| **只用 `/root/deploy.sh`** | 不要手工 `git reset` + 编译，会绕过 marker 判断 |
| 先 `--dry-run` | 确认重编范围符合预期再执行 |
| 版本校验 | 脚本末尾比对 `/system/version`，不一致会 `exit 1` **且不更新 marker** |
| 前端缓存 | 静态 chunk 强缓存 30 天，发版后**必须让用户硬刷新**（Ctrl+Shift+R）|
| 纯后端改动 | 不会重建前端（`.frontend_sha` 与 `.deployed_sha` 独立）|

### 9.2 配置变更

| 变更对象 | 注意 |
|---|---|
| **容器配置**（`docker/.env` / `*-compose*.yml`）| 改完必须 `DOC_ENGINE=infinity docker compose --profile infinity up -d <svc>`；**infinity 带 profiles，不传 profile 它不在服务列表里** |
| **`MEM_LIMIT`** | 多引擎共用（ES/infinity/serenedb/oceanbase），改前确认哪些在跑 |
| **`infinity_conf.toml`** | 改完需重启容器；`buffer_manager_size` 不要超过 `MEM_LIMIT` |
| **nginx** | 改完先 `nginx -t`，再 `reload`；若报 `invalid PID number ""`，用 `kill -HUP $(systemctl show nginx -p MainPID --value)` |
| **systemd** | 改 `Environment=` 后 `daemon-reload` + `restart` |

### 9.3 日常运维

| 场景 | 操作 |
|---|---|
| 看服务日志 | `journalctl -u ragflow-api -n 200 --no-pager`（**不是** `logs/` 目录）|
| 查数据库 | `docker exec docker-mysql-1 mysql -uroot -p"$MP" rag_flow -e "<SQL>"` |
| 健康检查 | `curl -s http://127.0.0.1:9380/api/v1/system/healthz`（五项全 ok 才正常）|
| 手工备份 | `/root/backup_ragflow.sh` |
| 看备份日志 | `tail -50 /root/backups/backup.log`（cron 侧错误在 `cron.log`）|

### 9.4 不要做的事

| ❌ 不要 | 原因 |
|---|---|
| 在服务器上直接跑全量 Go 测试/编译（不设 `TMPDIR`）| 会把临时文件写到 `/tmp`；虽然已落盘 + `build.sh` 有防护，但仍占 IO |
| 手工 `git reset --hard` | 会丢弃未提交改动（2026-10-26 已因此丢过一次 WIP）|
| 直接改 `docker/.env` 不提交 | 该文件在 git 里，下次 `reset` 会被覆盖回旧值 |
| 用超管账号调主站 API | 必返 `403 Super user shouldn't access the URL`（设计如此，超管只走 `/admin`）|
| 删除 `web/dist_*` 目录 | nginx root 可能指向它，删了页面直接 404 |
| 迁移时改 `docker/` 目录名 | compose 项目名变化 → 挂空卷 → 看起来像数据全丢 |

### 9.5 调试常用

```bash
# 单测 / 端到端（TMPDIR 已由 build.sh 自动处理）
export PATH=$PATH:/usr/local/go/bin
bash build.sh --test -- ./internal/...
bash build.sh --test-e2e

# API 调试 token 的正确签法（payload 必须是 access_token，不是 user id）
MP=$(grep -E '^MYSQL_PASSWORD=' /root/ragflow/docker/.env | cut -d= -f2)
AT=$(docker exec docker-mysql-1 mysql -uroot -p"$MP" rag_flow -N \
     -e "SELECT access_token FROM user WHERE email='<邮箱>';" | tr -d '\r')
RP=$(grep -E '^REDIS_PASSWORD=' /root/ragflow/docker/.env | cut -d= -f2)
SECRET=$(docker exec docker-kvrocks-1 redis-cli -a "$RP" --no-auth-warning \
         GET ragflow:system:secret_key | tr -d '\r')     # 64 位；若得 31 位说明没认证上
TZ=$(python3 /root/sign_token.py "$SECRET" "$AT")
curl -s -H "Authorization: $TZ" http://127.0.0.1:9380/api/v1/tenants
```

---

## 十、版本一致性（需关注）

出报告时的实际状态：

| 项 | 值 | 含义 |
|---|---|---|
| 运行中 `version` | `f20a44e` | 服务启动时读到的 git 版本（**实际跑的就是它**）|
| 部署标记 `.deployed_sha` | `ad96240` | 上次成功部署记录的版本 |
| 前端 `.frontend_sha` | `ad96240` | 上次构建前端的版本 |
| nginx root | `dist_ad96240` | 前端产物 |
| 工作区 `HEAD` | `da1a7fd` | 当前代码（多会话并行提交，已领先）|

**影响**：`ad96240` 是 `f20a44e` 的祖先，两者差异 8 文件（其中 518 行是新增测试）、**无 `web/` 改动**——所以前端停在旧提交功能等价，后端跑的是更新的版本，**当前不影响运行**。

**唯一后果**：下次发版时 `deploy.sh` 会按 `ad96240 → 新 HEAD` 的 diff 判断，会把中间几个提交一起重编（多花几分钟，无风险）。

**建议**：找一个窗口执行一次完整发版，把三者对齐到同一 commit，并核对 `/system/version`。

---

## 附录 A：本次报告采集的实测命令

```bash
# 容器配置
docker inspect <container> | python3 -c "…"      # JSON 解析，比 --format 稳
docker stats --no-stream
# 服务
systemctl cat ragflow-{api,admin,ingestor}
systemctl is-enabled tmp.mount
# 系统
free -h; findmnt -no FSTYPE,SIZE,USED /tmp; sysctl vm.swappiness
# 版本
git rev-parse --short HEAD; cat .deployed_sha; curl -s …/system/version
# 备份
crontab -l; du -sh /root/backups/*/
```

## 附录 B：相关文档索引

| 文档 | 用途 |
|---|---|
| `docs/deployment-architecture.md` | 从零部署的完整步骤（含编译链、原生库路径）|
| `docs/backup-restore-runbook.md` | 5 个恢复场景 + 校验 + 演练 |
| `docs/ops-report-2026-10-27-memory.md` | 内存治理的完整过程与证据 |
| `/root/deploy.sh` | 发版脚本（双 marker 机制）|

---

**报告结束**（DEP-20261027）
