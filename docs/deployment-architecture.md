# RAGFlow 生产环境部署文档

> 适用环境：内网单机部署（`172.30.20.51`）
> 文档基线：`2026-10-27`，线上版本 `1cb205e`
> 维护原则：**一切变更走 `/root/deploy.sh`，不手工改线上文件**

---

## 一、部署架构

### 1.1 拓扑

```
                        ┌─────────────────────────────┐
   浏览器 / API 调用     │   nginx :80                 │
   ───────────────────▶ │   /etc/nginx/nginx.conf      │
                        └──────────┬──────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │ /api/v1/admin      │ /api/v1            │ 其余路径
              ▼                    ▼                    ▼
        ┌──────────┐        ┌──────────┐        ┌──────────────────┐
        │ admin    │        │ api      │        │ 静态资源          │
        │ :9381    │        │ :9380    │        │ web/dist_<sha>   │
        └────┬─────┘        └────┬─────┘        └──────────────────┘
             │                   │
             │      ┌────────────┴────────────┐
             │      │  ingestor（无 HTTP 端口） │
             │      │  消费任务队列             │
             │      └────────────┬────────────┘
             └───────────────────┼─────────────────────────┐
                                 ▼                         ▼
        ┌──────────┬──────────┬──────────┬──────────┬──────────┐
        │  MySQL   │ Kvrocks  │  MinIO   │  NATS    │ Infinity │
        │ :3306    │ :6379    │ :9000    │ :4222    │ :23817   │
        │ 元数据   │ 缓存/会话│ 对象存储 │ 任务队列 │ 向量/全文 │
        └──────────┴──────────┴──────────┴──────────┴──────────┘
```

三个 Go 进程共用同一份二进制 `/root/ragflow/bin/ragflow_server`，靠 `--api / --admin / --ingestor` 区分角色。

### 1.2 组件清单

| 层 | 组件 | 版本 | 部署形态 |
|---|---|---|---|
| 接入 | nginx | 1.26.3 | systemd，`/etc/nginx/nginx.conf` |
| 应用 | ragflow_server `--api` | 源码 `1cb205e` | systemd `ragflow-api`，:9380 |
| 应用 | ragflow_server `--admin` | 同上 | systemd `ragflow-admin`，:9381 |
| 应用 | ragflow_server `--ingestor` | 同上 | systemd `ragflow-ingestor`，无端口 |
| 前端 | 静态产物 | 同 commit | 目录 `web/dist_<sha>`，由 nginx 直出 |
| 元数据 | MySQL | 8.0.40 | Docker `docker-mysql-1` |
| 缓存 | Kvrocks | 2.16.0 | Docker `docker-kvrocks-1` |
| 对象存储 | MinIO（pgsty/silo 分支） | RELEASE.2026-08-06 | Docker `docker-minio-1` |
| 消息队列 | NATS JetStream | 2.14.2 | Docker `docker-nats-1` |
| 文档引擎 | Infinity | v0.7.4-x64-v3 | Docker `docker-infinity-1` |

> **注意 MinIO 镜像用的是 `pgsty/silo`**（MinIO 的兼容分支），不是官方 `minio/minio`。换镜像时需确认 S3 兼容性。

### 1.3 数据流

1. 浏览器 → nginx :80 → 静态资源直出 / `/api/v1/*` 反代到 api:9380 / `/api/v1/admin*` 反代到 admin:9381。
2. 上传文档 → api 落 MinIO + 写 MySQL 记录 + 投递任务到 NATS。
3. ingestor 消费 NATS 任务 → 解析（DeepDoc 原生库）→ 切分 → 调 LLM 做向量化 → 写入 Infinity。
4. 检索/问答 → api → Infinity 混合检索（向量 + 全文）→ LLM → 返回，引用落 `conversation_reference`。

### 1.4 进程与端口

| 进程 | 监听 | 说明 |
|---|---|---|
| nginx | `0.0.0.0:80` | 唯一对外入口 |
| ragflow_server --api | `*:9380` | 主 API |
| ragflow_server --admin | `*:9381` | 管理后台 API |
| ragflow_server --ingestor | 无 | 后台消费 |
| docker-proxy | 3306 / 6379 / 9000 / 9001 / 4222 / 8222 / 23817 / 23820 / 5432 | 容器端口**全部映射到 0.0.0.0** |

---

## 二、部署文档（从零搭建）

### 2.1 前置条件

| 项 | 要求 |
|---|---|
| OS | Debian 13 (trixie) x86_64 |
| CPU / 内存 | 8C / 15G（最低建议 4C/8G） |
| 磁盘 | 196G（当前用 24G） |
| 网络 | 能访问 Gitee（拉代码）、npmmirror（前端依赖）、hf-mirror.com（模型） |
| 权限 | root |

### 2.2 基础环境

```bash
# 系统依赖：编译链 + 链接器 + 容器
apt-get update
apt-get install -y build-essential clang lld cmake libpcre2-dev unzip curl git nginx docker.io docker-compose-plugin

# CMake 必须是 4.0+（Debian 源自带 3.31，build.sh 会拒绝）
cd /tmp && curl -sSL -o cmake.tgz https://cmake.org/files/v4.1/cmake-4.1.6-linux-x86_64.tar.gz
mkdir -p /usr/local/lib/cmake && tar xzf cmake.tgz -C /usr/local/lib/cmake
ln -sf /usr/local/lib/cmake/cmake-4.1.6-linux-x86_64/bin/cmake /usr/local/bin/cmake

# Go 1.27.3
# 解压到 /usr/local/go，并在 /etc/profile.d/golang.sh 写入 PATH + GOPROXY

# Node 22（前端构建）
# /usr/local/lib/nodejs/v22，软链到 /usr/local/bin/{node,npm,npx}
```

**版本基线（线上实际）**：Go 1.27.3 / Node v22.22.2 / CMake 4.1.6 / clang 19.1.7 / lld 19.1.7 / Docker 29.7.2 / nginx 1.26.3

### 2.3 中间件（Docker）

```bash
cd /root/ragflow/docker
# 项目名必须是 docker，卷名 docker_xxx_data 依赖它（见 5.3）
docker compose -f docker-compose-base.yml up -d
docker ps   # 应有 mysql / kvrocks / minio / nats / infinity 五个 healthy
```

**Infinity 词典必须在宿主机的 `/usr/share/infinity`**（不在代码目录里，重装时要单独带）。

### 2.4 代码与原生依赖

```bash
git clone https://gitee.com/veaove/ragflow.git /root/ragflow
cd /root/ragflow

# 原生静态库（4 个，放到 ~/ragflow-native-libs/）
# 安装包通常在 ragflow_deps/ 下，解压后注意目录名：
#   office_oxide   → lib/liboffice_oxide.a
#   pdfium-static  → lib/libpdfium.a
#   pdf_oxide      → lib/linux_amd64/libpdf_oxide.a        （新版不要版本子目录）
#   onnxruntime    → onnxruntime-linux-x64-static_lib-1.29.0/lib/libonnxruntime.a
```

### 2.5 编译

```bash
cd /root/ragflow
export PATH=$PATH:/usr/local/go/bin
bash build.sh --all      # 产出 bin/ragflow_server 与 bin/ragflow-cli
```

首次全量约 6 分钟；缓存热之后增量编译 7 秒左右。

### 2.6 服务托管（systemd）

三个 unit 结构一致，差异只有 `ExecStart` 的参数与 `After`：

```ini
[Unit]
Description=RAGFlow API Server
After=docker.service ragflow-admin.service ragflow-ingestor.service

[Service]
User=root
WorkingDirectory=/root/ragflow
Environment=DOC_ENGINE=infinity
Environment=DEVICE=cpu
Environment=HF_ENDPOINT=https://hf-mirror.com
Environment=GIN_MODE=release
Environment=PATH=/usr/local/go/bin:/usr/local/bin:/root/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=/root/ragflow/bin/ragflow_server --api
Restart=on-failure
RestartSec=10
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

- `ragflow-admin`：`ExecStart=... --admin`，`After=docker.service`
- `ragflow-ingestor`：`ExecStart=... --ingestor`，额外 `Environment=RAGFLOW_INGESTOR_MAX_CONCURRENT_WORKERS=3`

```bash
systemctl daemon-reload
systemctl enable --now ragflow-admin ragflow-ingestor ragflow-api
```

> **启动顺序有意义**：api 依赖 admin/ingestor 先起（`After=` 已声明）。

### 2.7 nginx

配置是**自包含**的 `/etc/nginx/nginx.conf`（不走 `sites-enabled`）：

| 位置 | 规则 |
|---|---|
| `root` | `/root/ragflow/web/dist_<sha>`（发版时 sed 替换） |
| `client_max_body_size` | `1024M`（知识库上传大文件） |
| `location ~ ^/api/v1/admin` | 反代 `127.0.0.1:9381` |
| `location ~ ^/api/v1` | 反代 `127.0.0.1:9380` |
| `location ~* ^/(chunk\|entry\|assets\|pdfjs-dist\|vs)/` | 强缓存 30 天 + `immutable` |
| `location = /index.html` | `no-cache, must-revalidate` |
| `location /` | `try_files $uri $uri/ /index.html`（SPA 兜底） |
| 反代共性 | `proxy_buffering off`、`proxy_read_timeout 3600s`、WebSocket Upgrade 透传 |

> 静态资源缺失必须返回 404，不能被 SPA 兜底成 200+HTML（否则前端资源挂了不报警）。

### 2.8 初始化

1. 访问 `http://<host>/` 注册首个账号，该账号自动成为超管。
2. 超管入口 `http://<host>/admin`（超管访问主站会被 403 拒绝，这是设计）。
3. 在「配置中心 → 模型配置」添加 provider（如 Tongyi-Qianwen）与模型实例（API Key）。
4. 建知识库、上传文档、配解析方法。

### 2.9 验证

```bash
curl -s http://127.0.0.1:9380/api/v1/system/version    # {"code":0,"data":"<短sha>"}
curl -s http://127.0.0.1:9380/api/v1/system/healthz    # db/redis/doc_engine/storage/message_queue 全 ok
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1/          # 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1/chunk/js/nope.js  # 必须 404
```

---

## 三、日常发版

### 3.1 一条命令

```bash
/root/deploy.sh                 # 发布 origin/main
/root/deploy.sh --dry-run       # 只看会做什么
/root/deploy.sh --force         # 强制全量重编
/root/deploy.sh <commit|branch> # 发布指定版本
```

脚本做六件事：`git fetch + reset` → 按改动范围重编后端/前端 → 切 nginx root → 重启三服务 → 校验 version → 清理旧产物。

### 3.2 双 marker 判断（关键设计）

| 文件 | 含义 | 作用 |
|---|---|---|
| `/root/ragflow/.deployed_sha` | 上次**成功部署**的 commit | 决定要不要重编后端 |
| `/root/ragflow/.frontend_sha` | 上次**构建前端**的 commit | 决定要不要重建前端 |

**为什么不能靠 `git reset` 前后的 diff**：代码若已被手工 reset 到目标版本，diff 全为空，脚本会误判“无改动”跳过编译，线上继续跑旧二进制 —— 而 `version` 接口读的是 `git describe`，会显示新版本号，极具迷惑性。

其他兜底：二进制缺失 / `node_modules` 缺失 / nginx 指向的 `dist_` 目录不存在，任一成立都强制重建。

### 3.3 回滚

```bash
cd /root/ragflow
git rev-parse <上一个正常版本> > .deployed_sha
git rev-parse <上一个正常版本> > .frontend_sha
/root/deploy.sh <上一个正常版本>
```

产物层面：`web/dist_<旧sha>` 保留最近 3 个，把 nginx root 改回去并 `systemctl reload nginx` 即可秒级回滚前端。

---

## 四、部署清单（Checklist）

### 4.1 全新环境

- [ ] OS/内核符合要求，磁盘 ≥100G
- [ ] 编译链：clang、lld、**cmake 4.1.6**、build-essential、unzip
- [ ] Go 1.27.3 / Node 22 就位，PATH 与 GOPROXY 已配
- [ ] Docker + compose 插件可用
- [ ] `docker/` 目录名保持 `docker`（卷名前缀依赖）
- [ ] `.env` 已按环境修改（`DOC_ENGINE=infinity`、密码）
- [ ] 五个中间件容器 healthy
- [ ] 四个原生静态库路径正确（`onnxruntime` 目录名带版本后缀）
- [ ] `/usr/share/infinity` 词典就位
- [ ] `build.sh --all` 通过，`bin/ragflow_server` 存在
- [ ] 三个 systemd unit 已 enable 且 active
- [ ] nginx root 指向真实存在的 `dist_*`
- [ ] `healthz` 五项 ok、`/` 返回 200、缺失资源返回 404
- [ ] 超管可登录 `/admin`，主站可注册/登录

### 4.2 每次发版

- [ ] 发版前全量单测全绿（`build.sh --test -- ./internal/...`）
- [ ] `--dry-run` 确认重编范围符合预期
- [ ] 发版后 `version` 等于目标短 sha（脚本会自校验，不一致会 exit 1）
- [ ] `healthz` 五项 ok
- [ ] 抽查一个业务接口（如 `/api/v1/tenants`）
- [ ] 记得让用户硬刷新浏览器（前端资源有 30 天强缓存，`index.html` 虽 no-cache 但旧 chunk 仍在）

### 4.3 故障恢复

| 现象 | 首查 |
|---|---|
| 502 / 前端打不开 | `systemctl status ragflow-api`、`nginx -t`、`ls $(grep -oE '/root/ragflow/web/dist_\w+' /etc/nginx/nginx.conf)` |
| 页面白屏但接口正常 | nginx root 指到了被清理的 `dist_*` |
| `version` 与预期不符 | 二进制未重编（marker 误判）→ `/root/deploy.sh --force` |
| 上传文档一直不解析 | `systemctl status ragflow-ingestor`、NATS 存储、`docker logs docker-nats-1` |
| 检索无结果 | `conversation_reference` 表、Infinity 容器状态、知识库解析状态 |
| 中文乱码/日期错 | locale 与前端 `use-date-locale` hook |

---

## 五、资源清单

### 5.1 服务器

| 项 | 值 |
|---|---|
| 主机名 | `debian` |
| 内网地址 | `172.30.20.51`（SSH 别名 `ecs-ragflow`） |
| OS | Debian GNU/Linux 13 (trixie)，内核 6.12.113 |
| CPU / 内存 | 8 核 / 15G（常驻占用约 7G） |
| 磁盘 | `/dev/sda1` 196G，已用 24G（13%） |
| Docker | 29.7.2 |

### 5.2 端口

| 端口 | 归属 | 对外 | 用途 |
|---|---|---|---|
| 80 | nginx | ✅ | 唯一入口（HTTP，**无 TLS**） |
| 9380 | ragflow-api | 经 nginx | 主 API |
| 9381 | ragflow-admin | 经 nginx (`/api/v1/admin`) | 管理后台 API |
| 3306 | docker-mysql-1 | ⚠️ 内网可直连 | MySQL |
| 6379 | docker-kvrocks-1 | ⚠️ 内网可直连 | Kvrocks |
| 9000 / 9001 | docker-minio-1 | ⚠️ 内网可直连 | S3 API / 控制台 |
| 4222 / 8222 | docker-nats-1 | ⚠️ 内网可直连 | 客户端 / 监控 |
| 23817 / 23820 / 5432 | docker-infinity-1 | ⚠️ 内网可直连 | Thrift / HTTP / PSQL |

> Docker 发布端口会绕过 ufw，3306/6379/9000/23817 等在 `172.30.0.0/16` 内可直接访问，属待加固项。

### 5.3 数据卷

| 卷名 | 大小 | 内容 |
|---|---|---|
| `docker_mysql_data` | 2.4G | 元数据（账号、知识库、文档、任务、模型配置、权限矩阵） |
| `docker_infinity_data` | 1.6G | 向量索引 + 全文索引 |
| `docker_minio_data` | 333M | 原始文件对象 |
| `docker_kvrocks_data` | 79M | 会话/缓存 |
| `docker_nats_data` | 188K | JetStream 流 |

**卷名前缀 `docker_` 来自 compose 项目名**（目录名 `docker`）。迁移或重建时必须保持 `/root/ragflow/docker` 这个路径，否则会挂到一套空卷上。

### 5.4 关键目录

| 路径 | 大小 | 说明 |
|---|---|---|
| `/root/ragflow` | 2.5G | 代码 + 产物 |
| `/root/ragflow/bin` | 437M | `ragflow_server` / `ragflow-cli` |
| `/root/ragflow/web` | 1.6G | 含 `node_modules` 与多个 `dist_*` |
| `/root/ragflow/internal` | 147M | 后端源码 |
| `/root/ragflow/ragflow_deps` | 200M | 原生库安装包 |
| `/root/ragflow/logs` | 684K | 应用日志 |
| `/root/ragflow-native-libs` | 236M | 四个静态库 |
| `/usr/share/infinity` | 198M | Infinity 词典（**不在代码目录内**） |
| `/root/deploy-logs` | 588K / 13 份 | 每次发版日志 |
| `/var/log/nginx` | — | 访问/错误日志 |
| `/var/lib/docker` | 8.0G | 镜像 + 卷 |

---

## 六、关键配置

### 6.1 后端连接配置 `conf/service_conf.yaml`

```yaml
general:
  heartbeat_interval: 3s
api:
  host: 0.0.0.0
  http_port: 9380
admin:
  host: 0.0.0.0
  http_port: 9381
mysql:
  name: rag_flow
  user: root
  host: localhost
  port: 3306
  max_connections: 900
  stale_timeout: 300
  max_allowed_packet: 1073741824
minio:
  user: rag_flow
  host: localhost:9000
infinity:
  uri: localhost:23817
  postgres_port: 5432
  db_name: default_db
```

> 该文件里 **密码是明文**（默认 `infini_rag_flow`）。生产环境应替换并限制 `conf/` 的读权限。

### 6.2 环境变量 `docker/.env`（关键项）

| 变量 | 值/作用 |
|---|---|
| `DOC_ENGINE` | `infinity`（**必须**，换 ES 要同步改所有服务） |
| `DB_TYPE` | 元数据库类型 |
| `DEVICE` | `cpu` |
| `MEM_LIMIT` | 容器内存上限 |
| `INFINITY_HOST` / `INFINITY_THRIFT_PORT` / `INFINITY_HTTP_PORT` / `INFINITY_PSQL_PORT` | Infinity 连接参数 |
| `DISABLE_PASSWORD_LOGIN` | 是否禁用密码登录（仅留 OAuth） |
| `OAUTH_AUTO_REGISTER` | OAuth 首次登录是否自动建号 |
| `WIKI_*` / `DOC_STRUCTURE_*` / `KNOWLEDGE_GRAPH_*` | 知识编译、文档结构化、知识图谱的并发与超时 |
| `LLM_POOL_RATE_LIMIT_*` | LLM 池限流重试策略 |

`MYSQL_PASSWORD` / `MINIO_PASSWORD` / `S3_PASSWORD` 等**敏感值只在 `.env` 内**，文档不复制明文；运维取用方式见 7.3。

### 6.3 systemd 关键项

见 2.6。三个服务共同的三个易忘点：

1. `WorkingDirectory=/root/ragflow` —— 相对路径依赖它
2. `DOC_ENGINE=infinity` —— 不设会连 ES
3. `Restart=on-failure` + `RestartSec=10` —— 崩溃自动拉起

### 6.4 nginx 关键项

见 2.7。两个高频坑：

- `systemctl reload nginx` 可能因 `/run/nginx.pid` 为 0 字节失败（`invalid PID number ""`）。修法：`echo $(systemctl show nginx -p MainPID --value) > /run/nginx.pid`，或直接 `kill -HUP <master_pid>`。
- 发版只替换 `root` 一行，务必先 `nginx -t`；`deploy.sh` 校验失败会自动回滚配置副本。

### 6.5 数据模型要点

| 主题 | 要点 |
|---|---|
| 软删除 | `status` 是软删除标记；**启停是独立列 `enabled` / `is_active`** |
| 租户模型 | `tenant.id` 绑定创建者 `user.id`；成员关系在 `user_tenant`（`role=owner/normal`，`role_id` 指向权限角色） |
| 权限 | 权限矩阵 `role_permission`（按模块 × 查看/创建/编辑/删除）；`role_id=租户管理员` ≠ `role=owner` |
| 模型配置 | 在 `tenant_model_provider` → `tenant_model_instance` → `tenant_model` 三张表，**不是 `tenant_llm`** |
| 引用溯源 | `conversation_reference` 记录问答引用的 chunk |

---

## 七、关键信息

### 7.1 账号

| 账号 | 角色 | 入口 | 说明 |
|---|---|---|---|
| `liumin30000@126.com` | 超管 | `/admin` | **保持超管**；访问主站会 403（设计） |
| `123456789@qq.com` | nick's Kingdom **owner** | `/` | 主力租户（11 知识库 / 104 文档） |
| `hjzd@hjzd.com` | nick's Kingdom 租户管理员 | `/` | 和君纵达账号 |
| `zhangsan@qq.com` | nick's Kingdom 租户管理员 | `/` | 测试账号 |
| `lisi@qq.com` | nick's Kingdom 普通成员 | `/` | 未绑定 role_id |
| `qa.e2e@example.com` | 无可用租户 | — | E2E 测试账号，原租户已停用 |

> 口令统一为 `AsdQwe@123`（2026-10-26 批量重置），**上线前应全部轮换**。

**登录排错要点**：`109` 同时代表“验证码错误”和“密码错误”，前端一律显示 `email and password do not match`。判定方法：查 `login_attempt` 表 —— 只有验证码通过才会写，**有记录=密码错，无记录=卡验证码**。

### 7.2 路径速查

| 用途 | 路径 |
|---|---|
| 代码 | `/root/ragflow` |
| 二进制 | `/root/ragflow/bin/ragflow_server`、`ragflow-cli` |
| 前端产物 | `/root/ragflow/web/dist_<sha>` |
| 发版脚本 | `/root/deploy.sh` |
| 部署日志 | `/root/deploy-logs/deploy_*.log` |
| 原生静态库 | `/root/ragflow-native-libs/` |
| Infinity 词典 | `/usr/share/infinity` |
| nginx 配置 | `/etc/nginx/nginx.conf` |
| systemd unit | `/etc/systemd/system/ragflow-{api,admin,ingestor}.service` |
| 容器编排 | `/root/ragflow/docker/docker-compose{,-base}.yml` |
| 环境变量 | `/root/ragflow/docker/.env` |
| 后端连接 | `/root/ragflow/conf/service_conf.yaml` |

### 7.3 命令速查

```bash
# ── 服务 ────────────────────────────────────────────
systemctl {status|restart|stop} ragflow-{api,admin,ingestor}
journalctl -u ragflow-api -n 200 --no-pager      # 看日志（不是文件）

# ── 发版 ────────────────────────────────────────────
/root/deploy.sh --dry-run        # 计划
/root/deploy.sh                  # 执行
tail -50 /root/deploy-logs/$(ls -t /root/deploy-logs | head -1)

# ── 单测 / e2e ──────────────────────────────────────
export PATH=$PATH:/usr/local/go/bin
TMPDIR=/root/tmpgo bash build.sh --test -- ./internal/...   # 全量单测（TMPDIR 必带）
TMPDIR=/root/tmpgo bash build.sh --test-e2e                 # 端到端

# ── 数据库 ──────────────────────────────────────────
MP=$(grep -E '^MYSQL_PASSWORD=' /root/ragflow/docker/.env | cut -d= -f2)
docker exec docker-mysql-1 mysql -uroot -p"$MP" rag_flow -e "<SQL>"

# ── 健康检查 ────────────────────────────────────────
curl -s http://127.0.0.1:9380/api/v1/system/healthz
curl -s http://127.0.0.1:9380/api/v1/system/version
```

**调试用 API token 的正确姿势**（易错）：`Authorization` 里放的是 itsdangerous 签名串，payload 必须是 `user` 表的 `access_token`（32 位），**不是 user id**。

```bash
# 1) 取用户的 access_token（32 位，存在 user 表）
MP=$(grep -E '^MYSQL_PASSWORD=' /root/ragflow/docker/.env | cut -d= -f2)
AT=$(docker exec docker-mysql-1 mysql -uroot -p"$MP" rag_flow -N \
     -e "SELECT access_token FROM user WHERE email='zhangsan@qq.com';" | tr -d '\r')

# 2) 取签名密钥（存 Kvrocks 的 ragflow:system:secret_key，64 位十六进制）
#    注意：宿主机没装 redis-cli，必须走容器；且 Kvrocks 开了密码认证，
#    不传 -a 只会拿到 "NOAUTH Authentication required."（31 字符，极易误判成"读到了值"）
RP=$(grep -E '^REDIS_PASSWORD=' /root/ragflow/docker/.env | cut -d= -f2)
SECRET=$(docker exec docker-kvrocks-1 redis-cli -a "$RP" --no-auth-warning \
         GET ragflow:system:secret_key | tr -d '\r')
echo "${#SECRET}"      # 应为 64；若是 31 就是没认证成功

# 3) 签发并调用
TZ=$(python3 /root/sign_token.py "$SECRET" "$AT")
curl -s -H "Authorization: $TZ" http://127.0.0.1:9380/api/v1/tenants
```

> `sign_token.py` 的算法：`key = sha1("itsdangerous"+"signer"+secret)`，payload 为 zlib 压缩后的 JSON 字符串，尾部拼 `>Q` 时间戳，HMAC-SHA1 签名。

### 7.4 前端约定（避免踩坑）

| 主题 | 约定 |
|---|---|
| 接口失败 | umi-request 在 `code != 0` 时**不抛异常**，页面会拿到 `{code,message,data:undefined}`。列表页写 `?? []` 会把失败伪装成空列表，必须自己判 `code !== 0` |
| 日期本地化 | 三套渲染源（dayjs / date-fns / react-day-picker）都不读 i18next，统一走 `hooks/use-date-locale.ts` |
| 前端缓存 | 静态 chunk 强缓存 30 天，`index.html` no-cache；发版后必须硬刷新 |
| 类型检查 | `npx tsc --noEmit` 全量有约 207 条历史错误，**不是发版闸门**（vite 用 esbuild）；判自己的改动只能 grep 改动路径 |

---

## 八、已知风险与待改进

| # | 风险 | 影响 | 建议 |
|---|---|---|---|
| 1 | **无任何备份** | MySQL/Infinity/MinIO 数据丢失即不可恢复 | 立做 `mysqldump` + 卷快照，至少每日一次并异地留存 |
| 2 | **中间件端口全映射 0.0.0.0** | 局域网内任何人可直连 3306/6379/9000/23817 | 绑 `127.0.0.1` 或用 `iptables DOCKER-USER` 拦截 |
| 3 | **HTTP 无 TLS** | 凭据明文传输 | 上 443 + 证书（内网可用自签） |
| 4 | `service_conf.yaml` 明文密码 | 文件泄露即失守 | 改权限 600，或引入 secret 管理 |
| 5 | 账号统一弱口令 `AsdQwe@123` | 撞库风险 | 上线前全部轮换 |
| 6 | `docker/` 目录名即卷名前缀 | 迁移时改名会挂空卷、误以为数据丢失 | 严格保持路径，或显式 `name:` 固定卷名 |
| 7 | `/tmp` 是 tmpfs 3.9G | 内嵌 NATS 等测试会因“存储不足”失败 | 跑测试统一带 `TMPDIR=/root/tmpgo` |
| 8 | `chatResource` 的租户操作集复用 owner 全套 | 普通成员可删他人问答应用 | 与 file 同样收紧（待改） |
| 9 | 部门管理员与普通成员权限相同（都只读） | 角色梯度中间档为空 | 按产品需要补本部门写权限 |
| 10 | 单机部署，无高可用 | 机器故障即服务中断 | 中期规划多节点 + 外部化中间件 |

---

## 附录：发版脚本核心逻辑（`/root/deploy.sh`）

```bash
# 1. 同步代码
git fetch origin && git reset --hard "$TARGET"
SHA=$(git rev-parse HEAD); SHORT=${SHA:0:7}

# 2. 后端：与 .deployed_sha 比
PREV=$(cat .deployed_sha)
if git diff --name-only "$PREV" "$SHA" | grep -qE '^(internal/|cmd/|go\.mod|build\.sh)'; then
    bash build.sh --all
fi

# 3. 前端：与 .frontend_sha 比（与后端解耦，纯后端改动不重建前端）
PREV_FRONT=$(cat .frontend_sha)
if git diff --name-only "$PREV_FRONT" "$SHA" | grep -qE '^web/'; then
    (cd web && npx vite build --outDir "dist_$SHORT")
    sed -i "s#root .*web/dist_[^;]*;#root /root/ragflow/web/dist_$SHORT;#" /etc/nginx/nginx.conf
    nginx -t && systemctl reload nginx      # 失败自动回滚配置
    echo "$SHA" > .frontend_sha
fi

# 4. 重启 + 校验（version 不等于目标 sha 则 exit 1 且不写 marker）
systemctl restart ragflow-{admin,ingestor,api}
[ "$(curl -s .../version | jq -r .data)" = "$SHORT" ] && echo "$SHA" > .deployed_sha

# 5. 清理旧 dist（跳过 nginx 正在用的那个，其余留 2 个）
```
