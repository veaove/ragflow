# fund_demo 问数示例（自然语言 → SQL）

> ⚠️ 演示数据，净值与订单为虚构。本文件是 **few-shot 示例库**，
> 与 `fund_demo_schema.md`（表结构库）分开放，分别绑到不同的检索节点。

目标库：`fund_demo`（MySQL）。下面每条 SQL 都已在真实库上执行验证过。

## Q1 ｜ 只查单值

**用户问**：华夏成长混合（000001）最新净值是多少？

**正确 SQL**：

```sql
SELECT fund_name, latest_nav, latest_nav_date
FROM fund_product
WHERE fund_code = '000001';
```

**返回结果**：`华夏成长混合`，最新净值 **1.2695**，净值日期 2026-10-30。

---

## Q2 ｜ 条件筛选（枚举 + 状态）

**用户问**：现在能买到哪些货币型基金？

**正确 SQL**：

```sql
SELECT fund_code, fund_name, min_purchase_amount, latest_nav
FROM fund_product
WHERE fund_type = '货币型' AND status = '开放申购'
ORDER BY fund_code;
```

**返回结果**：共 2 只：000343 华夏财富宝货币A（起购 1.00 元）；000353 华夏薪金宝货币（起购 0.01 元）。

---

## Q3 ｜ 区间涨幅排名（两表自连接）

**用户问**：2026-09-01 到 2026-10-30，单位净值涨幅最高的三只基金是哪几只？

**正确 SQL**：

```sql
SELECT p.fund_code, p.fund_name,
       ROUND((e.unit_nav - s.unit_nav) / s.unit_nav * 100, 2) AS gain_pct
FROM fund_product p
JOIN fund_nav s ON s.fund_code = p.fund_code AND s.nav_date = '2026-09-01'
JOIN fund_nav e ON e.fund_code = p.fund_code AND e.nav_date = '2026-10-30'
ORDER BY gain_pct DESC
LIMIT 3;
```

**返回结果**：1) 000041 华夏全球精选QDII **15.31%**；2) 000047 华夏行业景气混合 **10.44%**；3) 000071 华夏恒生ETF联接A **9.49%**。

---

## Q4 ｜ 时序点查

**用户问**：华夏成长混合 2026 年 9 月 30 日的单位净值是多少？

**正确 SQL**：

```sql
SELECT nav_date, unit_nav, daily_return
FROM fund_nav
WHERE fund_code = '000001' AND nav_date = '2026-09-30';
```

**返回结果**：单位净值 **1.3020**，当日涨跌幅 0.94%。

---

## Q5 ｜ 规则分档 + 金额计算

**用户问**：持有华夏成长混合满 100 天，赎回 10 万元，赎回费是多少？

**正确 SQL**：

```sql
SELECT r.fund_type, r.holding_days_min, r.holding_days_max, r.redeem_fee_rate,
       ROUND(100000 * r.redeem_fee_rate / 100, 2) AS redeem_fee
FROM fund_redeem_rule r
JOIN fund_product p ON p.fund_type = r.fund_type
WHERE p.fund_code = '000001'
  AND 100 BETWEEN r.holding_days_min AND r.holding_days_max;
```

**返回结果**：命中「30~364 天」档，费率 **0.50%**，赎回费 **500.00 元**。

---

## Q6 ｜ 渠道折扣 + 外扣法

**用户问**：在天天基金买 1 万元华夏成长混合，申购费多少？

**正确 SQL**：

```sql
SELECT c.channel_name, p.purchase_fee_rate, d.discount_rate,
       ROUND(p.purchase_fee_rate * d.discount_rate, 4) AS actual_rate_pct,
       ROUND(10000 - 10000 / (1 + p.purchase_fee_rate * d.discount_rate / 100), 2) AS purchase_fee
FROM fund_product p
JOIN fund_fee_discount d ON d.fund_type = p.fund_type
JOIN fund_channel c ON c.channel_code = d.channel_code
WHERE p.fund_code = '000001' AND c.channel_name = '天天基金';
```

**返回结果**：基准费率 1.50%，天天基金 1 折 → 实际费率 **0.1500%**；净申购 **9985.02 元**，申购费 **14.98 元**。

---

## Q7 ｜ 多条件聚合 + 分组排名

**用户问**：2026 年 9 月到 10 月，各渠道的申购金额合计是多少？从高到低排。

**正确 SQL**：

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

**返回结果**：共 8 个渠道有已确认申购（单位：元）：

---

## Q8 ｜ 多条件与运算

**用户问**：风险等级 3 级及以下、起购金额不超过 100 元的开放申购基金有哪些？

**正确 SQL**：

```sql
SELECT fund_code, fund_name, fund_type, risk_level, min_purchase_amount
FROM fund_product
WHERE risk_level <= 3
  AND min_purchase_amount <= 100
  AND status = '开放申购'
ORDER BY risk_level, fund_code;
```

**返回结果**：共 7 只（按风险等级升序）：000343 华夏财富宝货币A（风险 1 级，起购 1.00 元）；000353 华夏薪金宝货币（风险 1 级，起购 0.01 元）；000014 华夏聚利债券（风险 2 级，起购 10.00 元）；000015 华夏纯债债券A（风险 2 级，起购 10.00 元）；000001 华夏成长混合（风险 3 级，起购 10.00 元）；000051 华夏沪深300ETF联接A（风险 3 级，起购 10.00 元）；000121 华夏永福混合A（风险 3 级，起购 10.00 元）。

---

## Q9 ｜ 时序按月聚合

**用户问**：华夏成长混合 9 月和 10 月的月均单位净值分别是多少？

**正确 SQL**：

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

**返回结果**：2026-09：22 个交易日，月均净值 **1.2900**；2026-10：17 个交易日，月均净值 **1.2830**。

---

## Q10 ｜ 同表跨列比较

**用户问**：哪些基金的申购费率高于管理费率？

**正确 SQL**：

```sql
SELECT fund_code, fund_name, purchase_fee_rate, manage_fee_rate
FROM fund_product
WHERE purchase_fee_rate > manage_fee_rate
ORDER BY purchase_fee_rate - manage_fee_rate DESC;
```

**返回结果**：共 5 只：000051 华夏沪深300ETF联接A（申购 1.00% > 管理 0.50%）；000071 华夏恒生ETF联接A（申购 1.00% > 管理 0.60%）；000014 华夏聚利债券（申购 0.80% > 管理 0.60%）；000121 华夏永福混合A（申购 1.20% > 管理 1.00%）；000015 华夏纯债债券A（申购 0.60% > 管理 0.50%）。

---

## Q11 ｜ 分组聚合

**用户问**：各类型基金的平均管理费率是多少？各有几只？

**正确 SQL**：

```sql
SELECT fund_type, COUNT(*) AS cnt, ROUND(AVG(manage_fee_rate), 3) AS avg_manage_fee
FROM fund_product
GROUP BY fund_type
ORDER BY avg_manage_fee DESC;
```

**返回结果**：QDII 1 只，平均 1.800%；混合型 7 只，平均 1.429%；债券型 2 只，平均 0.550%；指数型 2 只，平均 0.550%；货币型 2 只，平均 0.315%。

---

## Q12 ｜ 陷阱：非交易日无数据

**用户问**：华夏恒生ETF联接A 在 2026 年 10 月 3 日的净值是多少？

**正确 SQL**：

```sql
SELECT nav_date, unit_nav
FROM fund_nav
WHERE fund_code = '000071'
  AND nav_date BETWEEN '2026-10-01' AND '2026-10-07';
```

**返回结果**：**空结果集**（0 行）。

---

## Q13 ｜ 陷阱：暂停申购

**用户问**：华夏复兴混合现在还能买吗？

**正确 SQL**：

```sql
SELECT fund_code, fund_name, status
FROM fund_product
WHERE fund_code = '000031';
```

**返回结果**：**不能买**。`status = '暂停申购'`（该基金仍可赎回，但申购通道关闭）。

---

## Q14 ｜ 折扣横向对比

**用户问**：买 QDII 基金，哪个渠道的申购费率最低？

**正确 SQL**：

```sql
SELECT c.channel_name, d.discount_rate,
       ROUND(p.purchase_fee_rate * d.discount_rate, 4) AS actual_rate_pct
FROM fund_fee_discount d
JOIN fund_channel c ON c.channel_code = d.channel_code
JOIN fund_product p ON p.fund_type = d.fund_type AND p.fund_code = '000041'
ORDER BY actual_rate_pct ASC;
```

**返回结果**：基准费率 1.60%。最低 **0.1600%**（1 折）：华夏基金官网直销、活期通App、华夏基金微信服务号、天天基金、蚂蚁财富；最高 **1.6000%**（不打折）：工商银行、招商银行。

---

## 通用写法约定

- 连接串已指定库，SQL 里直接写表名即可。
- 费率类（`manage_fee_rate` / `purchase_fee_rate` / `redeem_fee_rate`）单位是 %，算钱要 `/100`。
- `discount_rate` 是**倍数**（0.10 = 1折），直接乘，不再除 100。
- 申购费走外扣法：`申购金额 - 申购金额/(1+实际费率/100)`。
- 统计金额只算 `order_type IN ('申购','定投') AND status='已确认'`。
- 日期条件用实际交易日：`fund_nav` 里没有周末，也没有 2026-10-01~10-07。

