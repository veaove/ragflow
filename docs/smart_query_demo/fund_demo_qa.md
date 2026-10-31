# fund_demo 验收问答（智能问数）

> 配套 `fund_demo.sql` 使用。每题给出**标准问法**、**期望 SQL**、**期望答案**。
> 期望答案由生成脚本对同一份数据直接计算得出，与实际入库数据严格一致。

判定标准建议：

- **正确**：SQL 可执行且结果集与期望一致（数值允许 ±0.01 的四舍五入差异）。
- **口径错**：SQL 能跑，但费率没除 100、或没排掉已撤单、或把折扣当成了最终费率。
- **臆造**：编造了不存在的字段名/表名，或返回了数据里没有的产品。

## Q1. 只查单值

**问**：华夏成长混合（000001）最新净值是多少？

```sql
SELECT fund_name, latest_nav, latest_nav_date
FROM fund_product
WHERE fund_code = '000001';
```

**期望答案**：`华夏成长混合`，最新净值 **1.2695**，净值日期 2026-10-30。

## Q2. 条件筛选（枚举 + 状态）

**问**：现在能买到哪些货币型基金？

```sql
SELECT fund_code, fund_name, min_purchase_amount, latest_nav
FROM fund_product
WHERE fund_type = '货币型' AND status = '开放申购'
ORDER BY fund_code;
```

**期望答案**：共 2 只：000343 华夏财富宝货币A（起购 1.00 元）；000353 华夏薪金宝货币（起购 0.01 元）。

> 注意 `status` 要限定 `开放申购`，否则会把暂停申购的产品也算进来。

## Q3. 区间涨幅排名（两表自连接）

**问**：2026-09-01 到 2026-10-30，单位净值涨幅最高的三只基金是哪几只？

```sql
SELECT p.fund_code, p.fund_name,
       ROUND((e.unit_nav - s.unit_nav) / s.unit_nav * 100, 2) AS gain_pct
FROM fund_product p
JOIN fund_nav s ON s.fund_code = p.fund_code AND s.nav_date = '2026-09-01'
JOIN fund_nav e ON e.fund_code = p.fund_code AND e.nav_date = '2026-10-30'
ORDER BY gain_pct DESC
LIMIT 3;
```

**期望答案**：1) 000041 华夏全球精选QDII **15.31%**；2) 000047 华夏行业景气混合 **10.44%**；3) 000071 华夏恒生ETF联接A **9.49%**。

> 起止日期必须是**实际有净值的交易日**：区间末 2026-10-31 是周六，最后一条净值在 2026-10-30。

## Q4. 时序点查

**问**：华夏成长混合 2026 年 9 月 30 日的单位净值是多少？

```sql
SELECT nav_date, unit_nav, daily_return
FROM fund_nav
WHERE fund_code = '000001' AND nav_date = '2026-09-30';
```

**期望答案**：单位净值 **1.3020**，当日涨跌幅 0.94%。

## Q5. 规则分档 + 金额计算

**问**：持有华夏成长混合满 100 天，赎回 10 万元，赎回费是多少？

```sql
SELECT r.fund_type, r.holding_days_min, r.holding_days_max, r.redeem_fee_rate,
       ROUND(100000 * r.redeem_fee_rate / 100, 2) AS redeem_fee
FROM fund_redeem_rule r
JOIN fund_product p ON p.fund_type = r.fund_type
WHERE p.fund_code = '000001'
  AND 100 BETWEEN r.holding_days_min AND r.holding_days_max;
```

**期望答案**：命中「30~364 天」档，费率 **0.50%**，赎回费 **500.00 元**。

> 100 天落在 `30~364 天` 档，**不是** `7~29 天` 档；分档区间两端都是闭区间。

## Q6. 渠道折扣 + 外扣法

**问**：在天天基金买 1 万元华夏成长混合，申购费多少？

```sql
SELECT c.channel_name, p.purchase_fee_rate, d.discount_rate,
       ROUND(p.purchase_fee_rate * d.discount_rate, 4) AS actual_rate_pct,
       ROUND(10000 - 10000 / (1 + p.purchase_fee_rate * d.discount_rate / 100), 2) AS purchase_fee
FROM fund_product p
JOIN fund_fee_discount d ON d.fund_type = p.fund_type
JOIN fund_channel c ON c.channel_code = d.channel_code
WHERE p.fund_code = '000001' AND c.channel_name = '天天基金';
```

**期望答案**：基准费率 1.50%，天天基金 1 折 → 实际费率 **0.1500%**；净申购 **9985.02 元**，申购费 **14.98 元**。

> 两个坑：① 折扣率是**倍数**不是百分数，要乘回基准费率；② 申购费用**外扣法**，`10000×0.15%` 得 15.00 是错的，正确是 14.98。

## Q7. 多条件聚合 + 分组排名

**问**：2026 年 9 月到 10 月，各渠道的申购金额合计是多少？从高到低排。

```sql
SELECT c.channel_name, c.channel_type,
       COUNT(*) AS order_cnt,
       ROUND(SUM(o.amount), 2) AS total_amount
FROM fund_order o
JOIN fund_channel c ON c.channel_code = o.channel_code
WHERE o.order_type IN ('申购', '定投')
  AND o.status = '已确认'
  AND o.order_date BETWEEN '2026-09-01' AND '2026-10-31'
GROUP BY c.channel_name, c.channel_type
ORDER BY total_amount DESC;
```

**期望答案**：共 8 个渠道有已确认申购（单位：元）：

| 排名 | 渠道 | 渠道类型 | 已确认笔数 | 申购金额合计（元） |
| --- | --- | --- | --- | --- |
| 1 | 活期通App | 直销 | 95 | 2733920.10 |
| 2 | 华夏基金官网直销 | 直销 | 96 | 2352020.95 |
| 3 | 工商银行 | 银行代销 | 60 | 1508769.60 |
| 4 | 华夏基金微信服务号 | 直销 | 44 | 1166324.45 |
| 5 | 天天基金 | 第三方代销 | 61 | 1072702.05 |
| 6 | 蚂蚁财富 | 第三方代销 | 36 | 787149.95 |
| 7 | 招商银行 | 银行代销 | 37 | 700414.90 |
| 8 | 京东金融 | 第三方代销 | 12 | 250911.40 |

> 三个过滤条件都不能漏：业务类型要含 `定投`、状态要排掉 `待确认`/`已撤单`、日期区间要卡住。

## Q8. 多条件与运算

**问**：风险等级 3 级及以下、起购金额不超过 100 元的开放申购基金有哪些？

```sql
SELECT fund_code, fund_name, fund_type, risk_level, min_purchase_amount
FROM fund_product
WHERE risk_level <= 3
  AND min_purchase_amount <= 100
  AND status = '开放申购'
ORDER BY risk_level, fund_code;
```

**期望答案**：共 7 只（按风险等级升序）：000343 华夏财富宝货币A（风险 1 级，起购 1.00 元）；000353 华夏薪金宝货币（风险 1 级，起购 0.01 元）；000014 华夏聚利债券（风险 2 级，起购 10.00 元）；000015 华夏纯债债券A（风险 2 级，起购 10.00 元）；000001 华夏成长混合（风险 3 级，起购 10.00 元）；000051 华夏沪深300ETF联接A（风险 3 级，起购 10.00 元）；000121 华夏永福混合A（风险 3 级，起购 10.00 元）。

> 「3 级及以下」是 `<= 3` 不是 `= 3`；「不超过 100 元」是 `<= 100`。

## Q9. 时序按月聚合

**问**：华夏成长混合 9 月和 10 月的月均单位净值分别是多少？

```sql
SELECT DATE_FORMAT(nav_date, '%Y-%m') AS ym,
       COUNT(*) AS days,
       ROUND(AVG(unit_nav), 4) AS avg_nav
FROM fund_nav
WHERE fund_code = '000001'
  AND nav_date BETWEEN '2026-09-01' AND '2026-10-31'
GROUP BY ym
ORDER BY ym;
```

**期望答案**：2026-09：22 个交易日，月均净值 **1.2900**；2026-10：17 个交易日，月均净值 **1.2830**。

> 9 月 22 个交易日、10 月 17 个交易日（10/1~10/7 国庆休市已剔除）。

## Q10. 同表跨列比较

**问**：哪些基金的申购费率高于管理费率？

```sql
SELECT fund_code, fund_name, purchase_fee_rate, manage_fee_rate
FROM fund_product
WHERE purchase_fee_rate > manage_fee_rate
ORDER BY purchase_fee_rate - manage_fee_rate DESC;
```

**期望答案**：共 5 只：000051 华夏沪深300ETF联接A（申购 1.00% > 管理 0.50%）；000071 华夏恒生ETF联接A（申购 1.00% > 管理 0.60%）；000014 华夏聚利债券（申购 0.80% > 管理 0.60%）；000121 华夏永福混合A（申购 1.20% > 管理 1.00%）；000015 华夏纯债债券A（申购 0.60% > 管理 0.50%）。

## Q11. 分组聚合

**问**：各类型基金的平均管理费率是多少？各有几只？

```sql
SELECT fund_type, COUNT(*) AS cnt, ROUND(AVG(manage_fee_rate), 3) AS avg_manage_fee
FROM fund_product
GROUP BY fund_type
ORDER BY avg_manage_fee DESC;
```

**期望答案**：QDII 1 只，平均 1.800%；混合型 7 只，平均 1.429%；债券型 2 只，平均 0.550%；指数型 2 只，平均 0.550%；货币型 2 只，平均 0.315%。

> 管理费率是 `DECIMAL(6,2)`，平均值要 `ROUND(... , 3)` 才看得出差异，否则会被截成整数。

## Q12. 陷阱：非交易日无数据

**问**：华夏恒生ETF联接A 在 2026 年 10 月 3 日的净值是多少？

```sql
SELECT nav_date, unit_nav
FROM fund_nav
WHERE fund_code = '000071'
  AND nav_date BETWEEN '2026-10-01' AND '2026-10-07';
```

**期望答案**：**空结果集**（0 行）。

> 2026-10-01~10-07 是国庆休市，`fund_nav` 里没有记录；且 10 月 3 日是周六。模型应回答「当日休市，无净值」，而不是编一个数字，也不应回落成「查不到这只基金」。

## Q13. 陷阱：暂停申购

**问**：华夏复兴混合现在还能买吗？

```sql
SELECT fund_code, fund_name, status
FROM fund_product
WHERE fund_code = '000031';
```

**期望答案**：**不能买**。`status = '暂停申购'`（该基金仍可赎回，但申购通道关闭）。

> 只看「产品存在」就回答「可以买」是典型错误，必须读 `status`。

## Q14. 折扣横向对比

**问**：买 QDII 基金，哪个渠道的申购费率最低？

```sql
SELECT c.channel_name, d.discount_rate,
       ROUND(p.purchase_fee_rate * d.discount_rate, 4) AS actual_rate_pct
FROM fund_fee_discount d
JOIN fund_channel c ON c.channel_code = d.channel_code
JOIN fund_product p ON p.fund_type = d.fund_type AND p.fund_code = '000041'
ORDER BY actual_rate_pct ASC;
```

**期望答案**：基准费率 1.60%。最低 **0.1600%**（1 折）：华夏基金官网直销、活期通App、华夏基金微信服务号、天天基金、蚂蚁财富；最高 **1.6000%**（不打折）：工商银行、招商银行。

> 折扣是**按基金类型**给的，不是按单只基金，所以要先取到 `fund_type` 再关联 `fund_fee_discount`。另外 5 个渠道并列最低，只答一个会漏。

## 附：批量冒烟脚本

把上面 14 题逐条丢给智能体，按下表记分：

| 题号 | 考点 | 结果 | 备注 |
| --- | --- | --- | --- |
| Q1 | 单值查询 | | |
| Q2 | 枚举筛选 | | |
| Q3 | 区间排名 | | |
| Q4 | 时序点查 | | |
| Q5 | 规则分档 | | |
| Q6 | 折扣 + 外扣 | | |
| Q7 | 多条件聚合 | | |
| Q8 | 多条件与 | | |
| Q9 | 按月聚合 | | |
| Q10 | 跨列比较 | | |
| Q11 | 分组聚合 | | |
| Q12 | 非交易日 | | |
| Q13 | 暂停申购 | | |
| Q14 | 折扣对比 | | |

通过线建议：**12/14 正确，且 Q5、Q6、Q7 三题必须正确**——这三题分别对应规则分档、费率口径、聚合过滤，
是真实客服问数里最容易出错的三个点。

