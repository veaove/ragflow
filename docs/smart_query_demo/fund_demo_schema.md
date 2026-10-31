# fund_demo 表结构说明（智能问数用）

> ⚠️ 本库中的净值、订单、份额、折扣、金额**全部为虚构测试数据**，与任何真实基金的历史业绩无关。

库名：`fund_demo` ｜ 字符集：`utf8mb4` ｜ 净值区间：`2026-09-01` ~ `2026-10-30`（共 39 个交易日）

这是**给大模型读的表结构知识库原文**。整篇灌进一个 `general` 类型的知识库，
Text-to-SQL 的检索节点只召回这张表的结构，不要和产品文档库混在一起，避免召回噪声。

## 一、表总览

| 表名 | 含义 | 行数量级 | 主要用途 |
| --- | --- | --- | --- |
| `fund_product` | 基金产品 | 14 | 单值查询、条件筛选、跨列比较 |
| `fund_nav` | 基金逐日净值 | 546 | 时序查询、区间涨幅、月均净值 |
| `fund_channel` | 销售渠道 | 8 | 渠道维度过滤、分组 |
| `fund_fee_discount` | 渠道申购费率折扣 | 40 | 实际申购费率计算 |
| `fund_redeem_rule` | 赎回费率分档 | 16 | 按持有天数查赎回费 |
| `fund_order` | 交易订单 | 640 | 多条件聚合、渠道排名 |

## 二、`fund_product` 基金产品

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `fund_code` | VARCHAR(6) | 基金代码，主键，如 `000001` |
| `fund_name` | VARCHAR(64) | 基金简称，如 `华夏成长混合` |
| `fund_type` | VARCHAR(16) | 基金类型，枚举：`混合型` / `债券型` / `指数型` / `QDII` / `货币型` |
| `risk_level` | TINYINT | 风险等级 1~5，数字越大风险越高。`3 级及以下` 写作 `risk_level <= 3` |
| `manage_fee_rate` | DECIMAL(6,2) | 年管理费率，单位 **%**（1.50 表示 1.5%） |
| `purchase_fee_rate` | DECIMAL(6,2) | 申购费率**基准**，单位 %；渠道实际费率 = 本列 × 折扣率 |
| `min_purchase_amount` | DECIMAL(12,2) | 起购金额，单位元 |
| `status` | VARCHAR(16) | 销售状态，枚举：`开放申购` / `暂停申购` / `开放赎回` |
| `established_date` | DATE | 成立日 |
| `latest_nav` | DECIMAL(8,4) | 最新单位净值，等于 `fund_nav` 中最新交易日的 `unit_nav` |
| `latest_nav_date` | DATE | 最新净值对应日期 |
| `fund_manager` | VARCHAR(32) | 基金经理 |
| `company` | VARCHAR(64) | 基金公司 |

已入库产品（14 只）：

| 代码 | 名称 | 类型 | 风险 | 管理费率% | 申购费率% | 起购(元) | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 000001 | 华夏成长混合 | 混合型 | 3 | 1.50 | 1.50 | 10.00 | 开放申购 |
| 000011 | 华夏大盘精选混合 | 混合型 | 4 | 1.50 | 1.50 | 100.00 | 开放申购 |
| 000014 | 华夏聚利债券 | 债券型 | 2 | 0.60 | 0.80 | 10.00 | 开放申购 |
| 000015 | 华夏纯债债券A | 债券型 | 2 | 0.50 | 0.60 | 10.00 | 开放申购 |
| 000021 | 华夏优势增长混合 | 混合型 | 4 | 1.50 | 1.50 | 100.00 | 开放申购 |
| 000031 | 华夏复兴混合 | 混合型 | 4 | 1.50 | 1.50 | 10.00 | 暂停申购 |
| 000041 | 华夏全球精选QDII | QDII | 5 | 1.80 | 1.60 | 100.00 | 开放申购 |
| 000047 | 华夏行业景气混合 | 混合型 | 4 | 1.50 | 1.50 | 10.00 | 开放申购 |
| 000051 | 华夏沪深300ETF联接A | 指数型 | 3 | 0.50 | 1.00 | 10.00 | 开放申购 |
| 000061 | 华夏盛世混合 | 混合型 | 4 | 1.50 | 1.50 | 100.00 | 开放申购 |
| 000071 | 华夏恒生ETF联接A | 指数型 | 4 | 0.60 | 1.00 | 10.00 | 开放申购 |
| 000121 | 华夏永福混合A | 混合型 | 3 | 1.00 | 1.20 | 10.00 | 开放申购 |
| 000343 | 华夏财富宝货币A | 货币型 | 1 | 0.33 | 0.00 | 1.00 | 开放申购 |
| 000353 | 华夏薪金宝货币 | 货币型 | 1 | 0.30 | 0.00 | 0.01 | 开放申购 |

## 三、`fund_nav` 基金净值

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `fund_code` | VARCHAR(6) | 基金代码，联合主键 |
| `nav_date` | DATE | 净值日期，联合主键。**仅交易日有数据**，周末与 2026-10-01~10-07 无记录 |
| `unit_nav` | DECIMAL(8,4) | 单位净值。**货币基金恒为 1.0000** |
| `acc_nav` | DECIMAL(8,4) | 累计净值 |
| `daily_return` | DECIMAL(8,4) | 日涨跌幅，单位 %。货币基金为 0 |

`fund_nav` 覆盖 `2026-09-01` ~ `2026-10-30`，共 **39 个交易日**。**2026-10-31 是周六，没有净值**。

## 四、`fund_channel` 销售渠道

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `channel_code` | VARCHAR(8) | 渠道编码，主键 |
| `channel_name` | VARCHAR(64) | 渠道名称 |
| `channel_type` | VARCHAR(16) | 枚举：`直销` / `银行代销` / `第三方代销` |
| `settle_days` | TINYINT | 确认天数 T+N |
| `support_auto_invest` | VARCHAR(2) | 是否支持定投：`是` / `否` |
| `status` | VARCHAR(8) | `正常` / `下线` |

| 编码 | 名称 | 类型 | T+N | 支持定投 |
| --- | --- | --- | --- | --- |
| ZX01 | 华夏基金官网直销 | 直销 | T+1 | 是 |
| ZX02 | 活期通App | 直销 | T+1 | 是 |
| ZX03 | 华夏基金微信服务号 | 直销 | T+1 | 是 |
| DX01 | 工商银行 | 银行代销 | T+2 | 是 |
| DX02 | 招商银行 | 银行代销 | T+2 | 是 |
| DX03 | 天天基金 | 第三方代销 | T+1 | 是 |
| DX04 | 蚂蚁财富 | 第三方代销 | T+1 | 是 |
| DX05 | 京东金融 | 第三方代销 | T+2 | 否 |

## 五、`fund_fee_discount` 渠道申购费率折扣

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `channel_code` | VARCHAR(8) | 渠道编码，联合主键 |
| `fund_type` | VARCHAR(16) | 基金类型，联合主键。**折扣按「渠道 × 基金类型」定价，不按单只基金** |
| `discount_rate` | DECIMAL(4,2) | 折扣率，`1.00` = 不打折，`0.10` = 1折，`0.00` = 免申购费 |
| `effective_date` | DATE | 生效日期 |
| `remark` | VARCHAR(64) | 备注 |

## 六、`fund_redeem_rule` 赎回费率分档

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | INT | 自增主键 |
| `fund_type` | VARCHAR(16) | 基金类型。**分档按类型定，不按单只基金** |
| `holding_days_min` | INT | 持有天数下限（含） |
| `holding_days_max` | INT | 持有天数上限（含）；`9999` 表示无上限 |
| `redeem_fee_rate` | DECIMAL(6,2) | 赎回费率，单位 % |
| `remark` | VARCHAR(64) | 备注 |

分档明细：

| 类型 | 持有天数 | 赎回费率% | 备注 |
| --- | --- | --- | --- |
| 混合型 | 0~6 天 | 1.50 | 惩罚性赎回费 |
| 混合型 | 7~29 天 | 0.75 |  |
| 混合型 | 30~364 天 | 0.50 |  |
| 混合型 | 365~729 天 | 0.25 |  |
| 混合型 | 730 天以上 | 0.00 | 两年以上免赎回费 |
| 债券型 | 0~6 天 | 1.50 | 惩罚性赎回费 |
| 债券型 | 7~29 天 | 0.10 |  |
| 债券型 | 30 天以上 | 0.00 | 持有满30天免赎回费 |
| 指数型 | 0~6 天 | 1.50 | 惩罚性赎回费 |
| 指数型 | 7~364 天 | 0.50 |  |
| 指数型 | 365 天以上 | 0.00 |  |
| QDII | 0~6 天 | 1.50 | 惩罚性赎回费 |
| QDII | 7~364 天 | 0.50 |  |
| QDII | 365~729 天 | 0.30 |  |
| QDII | 730 天以上 | 0.00 |  |
| 货币型 | 任意持有期 | 0.00 | 货币基金免赎回费 |

## 七、`fund_order` 交易订单

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | BIGINT | 自增主键 |
| `order_no` | VARCHAR(32) | 订单号，唯一 |
| `customer_id` | VARCHAR(16) | 客户号 |
| `fund_code` | VARCHAR(6) | 基金代码 |
| `channel_code` | VARCHAR(8) | 渠道编码 |
| `order_type` | VARCHAR(8) | 枚举：`申购` / `赎回` / `定投` |
| `amount` | DECIMAL(14,2) | 交易金额，单位元 |
| `shares` | DECIMAL(16,4) | 交易份额 |
| `order_date` | DATE | 下单日期 |
| `confirm_date` | DATE | 确认日期 |
| `status` | VARCHAR(8) | 枚举：`已确认` / `待确认` / `已撤单` |

## 八、业务口径（**必须写进知识库，否则模型会算错**）

1. **两类数值，处理方式完全不同，混用必算错**：
   - `manage_fee_rate` / `purchase_fee_rate` / `redeem_fee_rate` 是**百分数**，算金额时**除以 100**。
     例：`1.50` → 0.015。
   - `discount_rate` 是**倍数**（`0.10` = 1折、`1.00` = 不打折），**直接相乘，不要再除 100**。
   - 实际申购费率(%) = `purchase_fee_rate` × `discount_rate`，结果仍是百分数。
2. **申购费采用外扣法**：
   - 净申购金额 = 申购金额 ÷ (1 + 实际申购费率)
   - 申购费 = 申购金额 − 净申购金额
   - 实际申购费率(%) = `fund_product.purchase_fee_rate` × `fund_fee_discount.discount_rate`（**不再除 100**），
     再 ÷100 才得到小数比例，代入上面的公式
   - 例：买 10000 元、基准费率 1.50%、1折 → 实际费率 0.15% → 净申购 9985.02，申购费 **14.98**
3. **赎回费是全额收取**：赎回费 = 赎回金额 × 赎回费率 ÷ 100（不扣净值，直接从赎回款里扣）。
4. **持有天数分档**：`holding_days_min <= 持有天数 <= holding_days_max`，取唯一命中的那一档。
5. **货币基金**：`unit_nav` 恒为 `1.0000`，`daily_return` 恒为 0，申购费率与赎回费率均为 0。
   问「涨幅」时若用单位净值算货币基金会得 0，这是**正确结果**，不是数据缺失。
6. **非交易日无净值**：`fund_nav` 只有交易日数据。问某个周末或国庆假期（2026-10-01~10-07）的净值，
   应返回空结果并说明「当日休市」。
7. **金额统计要排除无效订单**：统计申购/定投金额时，`status` 必须限定 `'已确认'`，
   `'待确认'` 与 `'已撤单'` 不计入。
8. **销售状态**：`status = '暂停申购'` 的基金**不能买入**，问「能不能买」时要看这一列。
9. **产品 vs 类型**：申购折扣和赎回分档都是**按基金类型**给的，单只基金要先取到 `fund_type` 再关联。

## 九、接入 RAGFlow 智能问数

> **2026-10-31 已全部配好并验证**：MySQL 建库、两个知识库、智能体、发布，14 道验收题全部通过。

| 资源 | 名称 / ID |
| --- | --- |
| MySQL 库 | `fund_demo` @ `172.30.20.51:3306`（6 表，行数见第一节） |
| 只读账号 | `fund_ro` / `FundDemo_2026`（仅 SELECT 到本库） |
| 表结构库 | `问数-表结构-fund_demo`，id `5e668a1a4dfd44ba83af5c8e5e923126`，19 个 chunk |
| 示例 SQL 库 | `问数-示例SQL-fund_demo`，id `1febaf3eee7e44e0b1052af560f40d30`，16 个 chunk |
| 智能体 | `问数助手·fund_demo`，id `ac58a0c258d5478db0cfd6572de38e2b`，已发布 |

重新配置跑 `python scripts/setup_fund_demo_agent.py all`（幂等，已存在则复用）。

1. 只读账号：用户 `fund_ro`，密码 `FundDemo_2026`，仅 `SELECT` 到 `fund_demo.*`。
   已实测：读 `fund_demo` 正常；读 `rag_flow` 被 `ERROR 1142` 拒绝；建表被拒绝。
2. 画布用 `Agent + Retrieval + ExeSQL` 三节点，或内置「问数专家」模板（`text2sql_data_expert`）。
3. `ExeSQL` 节点按下面填（字段与 `internal/agent/tool/exesql.go` 对齐）：

| 字段 | 值 | 说明 |
| --- | --- | --- |
| `database_type` | `mysql` | 另支持 postgres / mariadb / mssql / oceanbase |
| `host` | `172.30.20.51` | **只写 IP，不要带端口**。代码用 `net.JoinHostPort(host, port)` 拼 DSN，写成 `ip:port` 会变成 `[ip:port]:3306` 直接连不上 |
| `port` | `3306` | 不填默认就是 3306 |
| `database` | `fund_demo` | |
| `username` / `password` | `fund_ro` / `FundDemo_2026` | |
| `max_records` | `1024` | 默认值，够用 |

4. ⚠️ **前置条件：必须打开 `ALLOW_ANY_HOST=1`**
   
   `ExeSQL` 连库前会过 `ValidateDBHost()` 的 SSRF 校验，**默认拒绝一切内网地址**
   （`172.16/12`、`10/8`、`192.168/16`、`127.0.0.1` 全部返回 `ErrSSRFBlocked`）。
   不改这一项，节点会直接报错，连不到库。改法（drop-in，不动主 unit）：
   
   ```bash
   mkdir -p /etc/systemd/system/ragflow-api.service.d
   printf '[Service]\nEnvironment=ALLOW_ANY_HOST=1\n' \
     > /etc/systemd/system/ragflow-api.service.d/allow-any-host.conf
   systemctl daemon-reload && systemctl restart ragflow-api
   ```
   
   注意：`/root/ragflow/docker/.env` 里的 `ALLOW_ANY_HOST=0` **不生效**——
   RAGFlow 在本部署里是宿主机 systemd 服务（`ragflow-api/admin/ingestor`），不读那个文件。
5. `Retrieval` 节点绑定的知识库里**只放本文档**，不要混产品文档，否则会召回无关表结构。
6. **已知文案问题**：SQL 查不到记录时，ExeSQL 会返回英文哨兵 `No record in the database!`，
   这个串写死在 `internal/agent/tool/exesql.go`（为与 Python 版对齐），不是配置项。
   行为是对的（没有编数据），只是文案是英文，要给客户看可以改那一行常量后重新编译。

> 随机种子固定为 20261031，重跑 `scripts/gen_fund_demo_sql.py` 产出的数据完全一致。

