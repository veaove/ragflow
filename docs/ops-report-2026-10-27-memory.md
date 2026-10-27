# RAGFlow 生产环境内存治理运维报告

| 项 | 内容 |
|---|---|
| **报告编号** | OPS-20261027-MEM |
| **环境** | 生产（内网单机 `172.30.20.51`，SSH 别名 `ecs-ragflow`）|
| **系统** | Debian GNU/Linux 13 (trixie)，内核 6.12.113，8 核 / 15G / 196G |
| **变更窗口** | 2026-10-27 18:44 – 19:55（GMT+8）|
| **执行人** | 运维自动化（AI 辅助执行，用户授权）|
| **变更级别** | 中等（涉及容器重建、文件系统挂载、交换分区）|
| **业务影响** | Infinity 容器重建期间（约 1 分钟）检索不可用，其余无中断 |
| **结论** | 内存压力已根治，可用内存从 6.4G 提升至 8.3G，OOM 触发条件已消除 |

---

## 一、执行摘要

### 1.1 一句话结论

**这不是"跑了两天内存自然上涨"，而是「编译临时文件占用 tmpfs + Infinity 缓存配置与容器限额互相矛盾 + 无 swap 兜底」三者叠加造成的 OOM 循环。**

### 1.2 关键数据变化

| 指标 | 变更前 | 变更后 | 变化 |
|---|---|---|---|
| 系统可用内存 | 6.4 GiB | **8.3 GiB** | +1.9 GiB |
| `shared`（tmpfs 占用）| 3.8 GiB | **19 MiB** | −3.8 GiB |
| Swap | **0** | **8 GiB** | 新增兜底 |
| `/tmp` 可用空间 | 30.7 MB（上限 3.9G）| **156 GB** | 容量 ×5000 |
| Infinity 内存占比 | 3.9G / 5.5G = **71%** | 4.1G / 10G = **41%** | 余量翻倍 |
| Infinity CPU 限制 | 1 核 | **2 核** | ×2 |
| 系统负载（15min）| **26.32** | 11.82 → 0.8 | 恢复常态 |
| OOM 次数（当日）| **54 次**（其中 infinity 15 次）| 0（变更后）| 消除 |

---

## 二、问题诊断

### 2.1 现象描述

用户反馈："这台机器昨天拿到时 CPU/内存没这么高，跑两天后 CPU 80.8%、内存 86.2% 持续升高，尤其是内存。"

同时另一个调试会话报出：`/tmp 分区满了`（而 `df -h /` 显示磁盘仅用 12%）。

### 2.2 诊断过程与关键证据

#### 第 1 步：识别口径矛盾

```bash
free -h          # used 9.3Gi / shared 3.8Gi / available 6.4Gi
findmnt -no FSTYPE,SIZE,USED,AVAIL /tmp
# tmpfs  3.9G  3.8G  30.7M     ← tmpfs 已满
df -h /          # /dev/sda1  196G  22G  164G  12%   ← 磁盘完全正常
```

**判断：不是磁盘满，是 tmpfs 满。** tmpfs 占用的是物理内存，所以 `shared 3.8Gi` 直接解释了"内存虚高"。

#### 第 2 步：定位 tmpfs 占用来源

```bash
du -sh /tmp/* | sort -hr | head
# 3.1G  /tmp/go-build323899038
# 303M  /tmp/go-build1242495781
# 136M  /tmp/jest_0
# 126M  /tmp/go-link-1855957048
```

全部是 **Go 编译/链接的中间文件**与前端 jest 缓存。根因：`go build/link/test` 的临时目录默认取 `$TMPDIR`（= `/tmp`）。

#### 第 3 步：确认历史影响面

```bash
journalctl --since "2 days ago" | grep -c -iE "out of memory|oom-kill"   # 54
journalctl --since "2 days ago" | grep -i "out of memory: killed" | awk '{print $1,$2,$3}' | sort | uniq -c
```

**OOM 时间分布（全部集中在 1 小时内）：**

```
17:28  17:31  17:36  17:49  17:50(×3)  17:53  17:57
18:08  18:20  18:24  18:28  18:32
```

**受害进程统计：** `infinity` 15 次、`systemd` 1 次、`mysqld` 1 次。**10-26 全天 0 次。**

> 结论：不是"两天累积"，而是 10-27 下午集中爆发——那一小时正在跑编译与全量测试。

#### 第 4 步：排除内存泄漏

| 进程 | 当前 RSS | 历史峰值 HWM | 判定 |
|---|---|---|---|
| ragflow-api | 231 M | 357 M | 已回落，GC 正常 |
| ragflow-ingestor | 268 M | 379 M | 已回落 |
| ragflow-admin | 49 M | 119 M | 已回落 |
| infinity | 3879 M | 4699 M | 已回落 |

**RSS < HWM 说明触发过 GC 并回收，排除泄漏。**

#### 第 5 步：深挖 Infinity 配置（关键发现）

```bash
docker inspect docker-infinity-1 --format '{{.HostConfig.Memory}}'   # 5905580032 = 5.5G
docker exec docker-infinity-1 cat /infinity_conf.toml
```

```toml
[buffer]
buffer_manager_size   = "8GB"    # ← 授权缓存到 8G
memindex_memory_quota = "1GB"
[storage]
optimize_interval     = "10s"    # 每 10 秒检查优化
compact_interval      = "120s"   # 每 2 分钟 compact
```

**三个数字互相矛盾：**

| 项 | 值 | 矛盾点 |
|---|---|---|
| 缓存目标 | 8 GB | — |
| 容器内存上限 | 5.5 GB | **目标 > 上限**，必然撞墙 |
| 实际数据量 | 1.2 GB | **目标 > 数据 6.7 倍**，纯浪费 |

### 2.3 根因归纳（三层）

```
① 点火器：Go 并发编译把 /tmp（3.9G tmpfs）写满
   └─ tmpfs 占物理内存 → 瞬间吃掉 3.8G

② 放大器：Infinity 按 8G 目标扩张缓存，却只有 5.5G 上限
   └─ 撞墙即触发全局 OOM（global_oom，容器 mem_limit 无法保护）

③ 无缓冲：Swap = 0
   └─ 内存一紧张直接杀进程，没有任何回旋余地

→ 内核按 RSS 排序，每次先杀 infinity（它最大）
→ 容器重启 → 立刻执行 Compact / Optimize all indexes → 再次吃满
→ 循环：这就是"内存老是往上飙"的机制
```

**佐证**：容器日志显示重启后立即开始全量索引优化

```
[10:56:06] [info] Compact begin ts: 79539
[10:56:16] [info] Optimize all indexes begin ts: 79539
```

---

## 三、变更清单（改前 vs 改后）

### 3.1 变更总表

| # | 变更项 | 文件 / 位置 | 改前 | 改后 | 风险 | 是否入库 |
|---|---|---|---|---|---|---|
| 1 | Infinity 内存上限 | `docker/.env` → `MEM_LIMIT` | `5905580032`（5.5G）| `10737418240`（10G）| 中 | ✅ `06238ca38` |
| 2 | Infinity 缓存目标 | `docker/infinity_conf.toml` → `buffer_manager_size` | `"8GB"` | `"4GB"` | 低 | ✅ `06238ca38` |
| 3 | Infinity CPU 限额 | `docker/docker-compose-base.yml` → `cpus` | `"1.0"` | `"2.0"` | 低 | ✅ `06238ca38` |
| 4 | `/tmp` 落盘 | `/etc/systemd/system/tmp.mount`（mask）| tmpfs 3.9G | 根分区 | 中 | ❌ 系统级 |
| 5 | 新增 Swap | `/swapfile` + `/etc/fstab` + `/etc/sysctl.conf` | 无 | 8G，swappiness=10 | 低 | ❌ 系统级 |
| 6 | 构建临时目录 | `build.sh`（`ensure_build_tmpdir`）| 写 `/tmp` | tmpfs 小时自动切 `/var/tmp/ragflow-build` | 低 | ✅ `7dda85d` |

### 3.2 逐项说明

#### 变更 1：Infinity 内存上限 5.5G → 10G

**理由**：5.5G 的天花板对它太紧（实际数据 1.2G，缓存目标 8G），容器内 OOM 会先带走进程；抬到 10G 后，内存上限从"约束"变成"保护"。
**注意**：`MEM_LIMIT` 被多个文档引擎共用（ES / infinity / serenedb / oceanbase），当前仅 infinity 运行，故只影响它。

#### 变更 2：缓存目标 8GB → 4GB

**理由**：实际数据 1.2G，4G 缓存足以覆盖热数据；原 8G 既超容器上限、又超数据量，是"看起来能涨、实际只会撞墙"的配置。
**性能影响**：数据可全量装入 4G 缓存，查询命中率不受影响。

#### 变更 3：CPU 1 核 → 2 核

**理由**：原注释按 2 核小机器编写（防止索引重建时饿死 API/SSH），本机 8 核，1 核会让重启后的全量 `optimize all indexes` 拖很久。

#### 变更 4：`/tmp` 从 tmpfs 落盘

**做法**：

```bash
lsof +D /tmp                      # 确认无进程占用（实测为空）
systemctl mask tmp.mount          # 阻止 systemd 重新挂载 tmpfs
umount /tmp                       # 立即生效，无需重启
```

**验证**：`/tmp` 现为根分区，权限仍是 `1777`（sticky bit 保留），`systemd-tmpfiles` 会按"10 天未访问"自动清理。

#### 变更 5：新增 8G Swap

**做法**：

```bash
fallocate -l 8G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
echo "/swapfile none swap sw 0 0" >> /etc/fstab    # 持久化
sysctl -w vm.swappiness=10                          # 优先用内存
echo "vm.swappiness=10" >> /etc/sysctl.conf
```

**说明**：`swappiness=10` 表示仅在内存真正紧张时才换出，避免数据库/向量库频繁页换出导致性能抖动。

#### 变更 6：`build.sh` 自动避让 tmpfs

**理由**：治本措施。即使将来 `/tmp` 又被改回 tmpfs，构建链也不会再把它写满。
**触发条件**：`TMPDIR` 未显式指定 **且** `/tmp` 是 tmpfs **且** 可用空间 < 8G。
**兼容性**：CI 环境 `/tmp` 为磁盘时行为不变；显式传入 `TMPDIR` 时也保持原逻辑。

---

## 四、效果验证

### 4.1 内存

| 指标 | 变更前 | 变更后 |
|---|---|---|
| total | 15 GiB | 15 GiB |
| used | 9.3 GiB | **7.5 GiB** |
| shared（tmpfs）| 3.8 GiB | **19 MiB** |
| buff/cache | 8.5 GiB | 2.4 GiB |
| available | 6.4 GiB | **8.3 GiB** |
| Swap | 0 | **8 GiB（使用 0）** |

### 4.2 磁盘

| 项 | 变更前 | 变更后 |
|---|---|---|
| `/` 使用 | 22 G（12%）| 30 G（17%）|
| 增量来源 | — | swapfile 8G |
| `/tmp` 可用 | 30.7 MB | **156 GB** |

### 4.3 Infinity 运行状态

| 指标 | 变更前 | 变更后 |
|---|---|---|
| 内存限制 | 5.5 G | **10 G** |
| 实际占用 | 3.9 G（71%）| **4.1 G（41%）** |
| CPU 限制 | 1 核 | **2 核** |
| CPU 使用 | 重启后 103–207% | **0.01%（稳定后）** |
| 重启次数 | OOM 触发 15 次 | 0 |

> 重启后短暂 207% 属正常：需重新加载 1.2G 索引并执行全量 `optimize`，约 2 分钟后归零。

### 4.4 服务可用性验证

```bash
curl -s http://127.0.0.1:9380/api/v1/system/healthz
# {"db":"ok","redis":"ok","doc_engine":"ok","storage":"ok","message_queue":"ok","status":"ok"}
```

| 验证项 | 结果 |
|---|---|
| healthz（五项）| 全部 ok |
| 知识库数量 | 11 个（与变更前一致，数据完整）|
| Infinity 容器 | Up (healthy) |
| 其余 4 个容器 | 未受影响，持续运行 |
| 系统负载 | 0.80 / 1.89 / 11.82（峰值 26.32 已回落）|

---

## 五、回滚方案

**备份位置**：`/root/ops-backup-20261027/`

| 文件 | 内容 |
|---|---|
| `env.bak` | 变更前的 `docker/.env` |
| `infinity_conf.toml.bak` | 变更前的 Infinity 配置 |
| `fstab.bak` | 变更前的 `/etc/fstab` |
| `mem-before.txt` | 变更前内存与容器占用快照 |

**回滚命令（按需执行）：**

```bash
# ① Infinity 配置回退
cp /root/ops-backup-20261027/env.bak /root/ragflow/docker/.env
cp /root/ops-backup-20261027/infinity_conf.toml.bak /root/ragflow/docker/infinity_conf.toml
cd /root/ragflow/docker && DOC_ENGINE=infinity docker compose --profile infinity up -d infinity
#   ⚠ 必须带 DOC_ENGINE + --profile，否则 infinity 不在服务列表中

# ② /tmp 恢复 tmpfs
systemctl unmask tmp.mount && mount -t tmpfs -o size=4G tmpfs /tmp

# ③ 撤销 swap
swapoff /swapfile && rm -f /swapfile
sed -i '/^\/swapfile/d' /etc/fstab
```

> 代码层面回滚：三个配置文件已入库（`06238ca38`），回退该提交即可恢复仓库配置。

---

## 六、执行过程中的三个坑（已记录，供后续复用）

### 坑 1：`infinity` 不在默认 compose 服务列表

`docker-compose-base.yml` 中 infinity 带 `profiles: [infinity]`，而 `.env` 里 `DOC_ENGINE=${DOC_ENGINE:-elasticsearch}` 是**自引用**（实际值来自 shell 环境变量）。因此正确命令必须显式传：

```bash
DOC_ENGINE=infinity docker compose --profile infinity up -d infinity
```

直接 `docker compose up -d` 只会操作默认的 5 个服务（mysql/minio/kvrocks/nats/es01）。

### 坑 2：`MEM_LIMIT` 是多个引擎共用变量

`grep mem_limit docker-compose-base.yml` 显示它出现在 ES、infinity、serenedb、oceanbase 四处。修改前必须确认哪些引擎正在运行，否则会同时放大多个容器的上限。

### 坑 3：`docker/.env` 被 git 跟踪

```bash
git ls-files --error-unmatch docker/.env   # 成功 → 已跟踪
grep -nE "^\.env" .gitignore                # 155: .env  ← 对已跟踪文件无效
```

后果：`deploy.sh` 的 `git reset --hard` 会把本地配置覆盖回仓库版本。所以 `MEM_LIMIT` 优化**必须入库**（`06238ca38`），否则下次发版即失效。

**安全检查结论**：`MYSQL_PASSWORD` / `MINIO_PASSWORD` / `REDIS_PASSWORD` 均为默认值 `infini_rag_flow`，`.env` 中无 API Key / Token / Secret 类项，本次提交**不构成凭据泄露**（但默认密码本身是待办隐患）。

---

## 七、遗留风险与后续建议

| # | 风险项 | 影响 | 优先级 | 建议动作 |
|---|---|---|---|---|
| 1 | **无任何数据备份** | MySQL / Infinity / MinIO 数据丢失即不可恢复 | **P0** | 每日 `mysqldump` + 卷快照，异地留存 |
| 2 | `.env` 入库且用默认密码 | 配置漂移 + 凭据弱 | P1 | `git rm --cached docker/.env`，改 `.env.example` 模板，轮换密码 |
| 3 | 中间件端口全映射 `0.0.0.0` | 3306/6379/9000/23817 内网可直连（Docker 绕过 ufw）| P1 | 绑 `127.0.0.1` 或用 `iptables DOCKER-USER` 拦截 |
| 4 | **OOM 无告警**（54 次无人知晓）| 故障发现依赖事后翻日志 | P1 | 加 `journalctl` OOM 关键字告警 |
| 5 | HTTP 无 TLS | 凭据明文传输 | P2 | 上 443 + 证书（内网可自签）|
| 6 | IDE 远程服务常驻 1G + 36% CPU | 纯资源浪费 | P2 | 不使用时停掉 `trae-cn-server` |
| 7 | 单机部署无高可用 | 机器故障即服务中断 | P3 | 中期规划多节点 |
| 8 | Infinity 索引随业务增长 | 4.1G 已占 41%，数据翻倍需重估 | P3 | 定期观测，必要时调 `buffer_manager_size` |

---

## 八、附录：诊断命令速查

```bash
# ── 内存真实构成（关键：区分 shared 与 buff/cache）
free -h
grep -E "^(MemTotal|MemAvailable|Shmem|Cached|AnonPages|Slab)" /proc/meminfo

# ── /tmp 是否 tmpfs（df -h / 正常但内存高时必查）
findmnt -no FSTYPE,SIZE,USED,AVAIL /tmp
du -sh /tmp/* | sort -hr | head

# ── OOM 历史与受害进程
journalctl --since "2 days ago" | grep -c -iE "out of memory|oom-kill"
journalctl --since "2 days ago" | grep -ioE "Killed process [0-9]+ \([a-z_-]+\)" | sort | uniq -c

# ── 判断是否泄漏：RSS 与历史峰值对比
grep -E "VmRSS|VmHWM" /proc/$(pgrep -f bin/ragflow_server | head -1)/status

# ── 容器真实限额（不是 .env 里的声明值）
docker inspect <container> --format '{{.HostConfig.Memory}} {{.HostConfig.NanoCpus}}'
docker stats --no-stream

# ── 磁盘真实写吞吐（判断能否承载构建临时文件）
dd if=/dev/zero of=/var/tmp/iotest bs=1M count=512 oflag=direct   # 真实落盘
dd if=/dev/zero of=/dev/shm/iotest bs=1M count=512                # 内存对照

# ── Infinity 侧确认
docker exec docker-infinity-1 cat /infinity_conf.toml | grep -E "buffer|mem|interval"
docker logs docker-infinity-1 --since 40m | grep -iE "compact|optimize|error"
ls -lh /var/lib/docker/volumes/docker_infinity_data/_data
```

---

## 九、变更时间线

| 时间 | 动作 | 结果 |
|---|---|---|
| 18:44 | 清理 `/tmp` 残留（go-build 3.1G + go-link 306M + jest 136M）| 可用 31MB → 3939MB；内存释放 2.5G |
| 18:50 | 修改 `build.sh` 增加 `ensure_build_tmpdir`（`7dda85d`）| 构建链自动避让 tmpfs |
| 19:06 | `MEM_LIMIT` → 10G、`buffer_manager_size` → 4G、`cpus` → 2 | 容器 recreate，healthz 通过 |
| 19:35 | `systemctl mask tmp.mount` + `umount /tmp` | `/tmp` 并入根分区，156G 可用 |
| 19:39 | 创建 8G swapfile + swappiness=10 | Swap 启用并持久化 |
| 19:51 | 三个配置文件入库（`06238ca38`）| 下次发版不会回退 |
| 19:56 | 最终验证 | Infinity 4.1G/10G，CPU 0.01%，available 8.3G |

---

**报告结束**

> 附录：同期发现但**未处理**的两项代码级问题（已记录，另案处理）
> 1. `chatResource` 的租户操作集复用了 Owner 全套，普通成员可删除他人问答应用（与 file 同类问题，file 已在 `5c55645` 修复）
> 2. 「部门管理员」角色的 `role_permission` 全部为只读，与「普通成员」权限相同，中间权限档位实际为空
