#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成「智能问数（Text-to-SQL）」演示库 fund_demo 的建库脚本与配套文档。

产出（默认写到 docs/smart_query_demo/）：
  fund_demo.sql          建库 + 建表 + 造数 + 只读账号
  fund_demo_schema.md    表结构与业务口径说明（建议整篇灌进「表结构」知识库）
  fund_demo_qa.md        标准问 + 期望 SQL + 期望答案（验收用）

⚠️ 本脚本产出的净值、订单、折扣、份额、金额全部是**虚构测试数据**，
   与任何真实产品的历史业绩无关，仅用于验证 Text-to-SQL 链路。

用法：
    python scripts/gen_fund_demo_sql.py
    python scripts/gen_fund_demo_sql.py --out-dir /tmp/x
"""

import argparse
import os
import random
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP

# ---------------------------------------------------------------- 基础设定

SEED = 20261031
DB = "fund_demo"
RO_USER = "fund_ro"
RO_PASS = "FundDemo_2026"

START = date(2026, 9, 1)
END = date(2026, 10, 31)
HOLIDAYS = {date(2026, 10, d) for d in range(1, 8)}   # 国庆休市 10/1-10/7

Q2 = Decimal("0.01")
Q4 = Decimal("0.0001")

VOL = {
    "混合型": 0.0110,
    "债券型": 0.0016,
    "QDII": 0.0130,
    "指数型": 0.0100,
    "货币型": 0.0,
}

# code, name, type, risk, manage_fee, purchase_fee, min_amount, status, estab, start_nav, manager, company
PRODUCTS = [
    ("000001", "华夏成长混合",        "混合型", 3, "1.50", "1.50", "10.00",  "开放申购", "2001-12-18", "1.2830", "陈伟彦", "华夏基金管理有限公司"),
    ("000011", "华夏大盘精选混合",    "混合型", 4, "1.50", "1.50", "100.00", "开放申购", "2004-08-11", "12.4500", "孙轶佳", "华夏基金管理有限公司"),
    ("000014", "华夏聚利债券",        "债券型", 2, "0.60", "0.80", "10.00",  "开放申购", "2013-03-08", "1.6420", "何家琪", "华夏基金管理有限公司"),
    ("000015", "华夏纯债债券A",       "债券型", 2, "0.50", "0.60", "10.00",  "开放申购", "2013-01-22", "1.3180", "刘明宇", "华夏基金管理有限公司"),
    ("000021", "华夏优势增长混合",    "混合型", 4, "1.50", "1.50", "100.00", "开放申购", "2006-11-24", "3.8760", "郑泽鸿", "华夏基金管理有限公司"),
    ("000031", "华夏复兴混合",        "混合型", 4, "1.50", "1.50", "10.00",  "暂停申购", "2007-09-10", "2.9140", "周克平", "华夏基金管理有限公司"),
    ("000041", "华夏全球精选QDII",    "QDII",   5, "1.80", "1.60", "100.00", "开放申购", "2007-10-09", "0.8740", "李湘杰", "华夏基金管理有限公司"),
    ("000047", "华夏行业景气混合",    "混合型", 4, "1.50", "1.50", "10.00",  "开放申购", "2010-06-22", "2.1560", "钟帅",   "华夏基金管理有限公司"),
    ("000051", "华夏沪深300ETF联接A", "指数型", 3, "0.50", "1.00", "10.00",  "开放申购", "2009-07-10", "1.4620", "张弘弢", "华夏基金管理有限公司"),
    ("000061", "华夏盛世混合",        "混合型", 4, "1.50", "1.50", "100.00", "开放申购", "2009-12-11", "1.9280", "阳琨",   "华夏基金管理有限公司"),
    ("000071", "华夏恒生ETF联接A",    "指数型", 4, "0.60", "1.00", "10.00",  "开放申购", "2012-08-21", "0.9860", "徐猛",   "华夏基金管理有限公司"),
    ("000121", "华夏永福混合A",       "混合型", 3, "1.00", "1.20", "10.00",  "开放申购", "2013-10-15", "1.7340", "何家琪", "华夏基金管理有限公司"),
    ("000343", "华夏财富宝货币A",     "货币型", 1, "0.33", "0.00", "1.00",   "开放申购", "2013-10-28", "1.0000", "曲波",   "华夏基金管理有限公司"),
    ("000353", "华夏薪金宝货币",      "货币型", 1, "0.30", "0.00", "0.01",   "开放申购", "2014-05-20", "1.0000", "曲波",   "华夏基金管理有限公司"),
]

# code, name, type, settle_days, auto_invest, status
CHANNELS = [
    ("ZX01", "华夏基金官网直销", "直销",       1, "是", "正常"),
    ("ZX02", "活期通App",        "直销",       1, "是", "正常"),
    ("ZX03", "华夏基金微信服务号", "直销",     1, "是", "正常"),
    ("DX01", "工商银行",         "银行代销",   2, "是", "正常"),
    ("DX02", "招商银行",         "银行代销",   2, "是", "正常"),
    ("DX03", "天天基金",         "第三方代销", 1, "是", "正常"),
    ("DX04", "蚂蚁财富",         "第三方代销", 1, "是", "正常"),
    ("DX05", "京东金融",         "第三方代销", 2, "否", "正常"),
]

# (channel, fund_type) -> discount_rate ；0.10 = 1折，1.00 = 不打折，0.00 = 免申购费
DISCOUNT = {
    "ZX01": {"混合型": "0.10", "债券型": "0.10", "指数型": "0.10", "QDII": "0.10", "货币型": "0.00"},
    "ZX02": {"混合型": "0.10", "债券型": "0.10", "指数型": "0.10", "QDII": "0.10", "货币型": "0.00"},
    "ZX03": {"混合型": "0.10", "债券型": "0.10", "指数型": "0.10", "QDII": "0.10", "货币型": "0.00"},
    "DX01": {"混合型": "0.80", "债券型": "0.60", "指数型": "0.80", "QDII": "1.00", "货币型": "0.00"},
    "DX02": {"混合型": "0.80", "债券型": "0.60", "指数型": "0.80", "QDII": "1.00", "货币型": "0.00"},
    "DX03": {"混合型": "0.10", "债券型": "0.10", "指数型": "0.10", "QDII": "0.10", "货币型": "0.00"},
    "DX04": {"混合型": "0.10", "债券型": "0.10", "指数型": "0.10", "QDII": "0.10", "货币型": "0.00"},
    "DX05": {"混合型": "0.40", "债券型": "0.40", "指数型": "0.40", "QDII": "0.50", "货币型": "0.00"},
}

# fund_type -> [(min_days, max_days, rate, remark)]
REDEEM = {
    "混合型": [(0, 6, "1.50", "惩罚性赎回费"), (7, 29, "0.75", ""), (30, 364, "0.50", ""), (365, 729, "0.25", ""), (730, 9999, "0.00", "两年以上免赎回费")],
    "债券型": [(0, 6, "1.50", "惩罚性赎回费"), (7, 29, "0.10", ""), (30, 9999, "0.00", "持有满30天免赎回费")],
    "指数型": [(0, 6, "1.50", "惩罚性赎回费"), (7, 364, "0.50", ""), (365, 9999, "0.00", "")],
    "QDII":   [(0, 6, "1.50", "惩罚性赎回费"), (7, 364, "0.50", ""), (365, 729, "0.30", ""), (730, 9999, "0.00", "")],
    "货币型": [(0, 9999, "0.00", "货币基金免赎回费")],
}

CHANNEL_WEIGHT = {"ZX01": 0.24, "ZX02": 0.18, "ZX03": 0.10, "DX01": 0.14,
                  "DX02": 0.10, "DX03": 0.12, "DX04": 0.08, "DX05": 0.04}
PRODUCT_WEIGHT = {"000001": 0.16, "000011": 0.06, "000014": 0.07, "000015": 0.09,
                  "000021": 0.05, "000031": 0.01, "000041": 0.04, "000047": 0.07,
                  "000051": 0.11, "000061": 0.05, "000071": 0.08, "000121": 0.06,
                  "000343": 0.13, "000353": 0.02}

AMOUNT_BUCKETS = ["500.00", "1000.00", "2000.00", "3000.00", "5000.00",
                  "10000.00", "20000.00", "50000.00", "100000.00"]

ORDER_COUNT = 640
CUSTOMER_COUNT = 120


# ---------------------------------------------------------------- 工具

def q(x, quantum=Q2):
    return Decimal(x).quantize(quantum, rounding=ROUND_HALF_UP)


def dec(x):
    return Decimal(x)


def esc(s):
    return str(s).replace("\\", "\\\\").replace("'", "''")


def trading_days():
    out, d = [], START
    while d <= END:
        if d.weekday() < 5 and d not in HOLIDAYS:
            out.append(d)
        d += timedelta(days=1)
    return out


def next_trading_day(d, days):
    """days 已排序；返回 d 之后（含）的第一个交易日。"""
    for x in days:
        if x > d:
            return x
    return days[-1]


# ---------------------------------------------------------------- 造数

DAYS = trading_days()
FIRST_DAY, LAST_DAY = DAYS[0], DAYS[-1]


def build_nav():
    """fund_code -> [(nav_date, unit_nav, acc_nav, daily_return)]"""
    out = {}
    for idx, p in enumerate(PRODUCTS):
        code, ftype, start = p[0], p[2], dec(p[9])
        rng = random.Random(SEED + idx * 977)
        rows = []
        if ftype == "货币型":
            acc = start
            for d in DAYS:
                acc = q(acc + dec("0.0000568"), Q4)
                rows.append((d, dec("1.0000"), acc, dec("0.0000")))
        else:
            nav, prev = start, start
            vol = VOL[ftype]
            for i, d in enumerate(DAYS):
                if i == 0:
                    rows.append((d, nav, nav, dec("0.0000")))
                    continue
                r = rng.gauss(0.0003, vol)
                nav = q(nav * (dec(1) + dec(str(round(r, 6)))), Q4)
                if nav < dec("0.1000"):
                    nav = dec("0.1000")
                ret = q((nav - prev) / prev * 100, Q4)
                acc = nav   # 演示数据不含分红，累计净值 = 单位净值
                rows.append((d, nav, acc, ret))
                prev = nav
        out[code] = rows
    return out


NAV = build_nav()
NAV_INDEX = {code: {r[0]: r[1] for r in rows} for code, rows in NAV.items()}


def weighted_pick(rng, weights):
    keys = list(weights.keys())
    return rng.choices(keys, weights=[weights[k] for k in keys], k=1)[0]


def build_orders():
    rng = random.Random(SEED + 13)
    rows = []
    for i in range(ORDER_COUNT):
        code = weighted_pick(rng, PRODUCT_WEIGHT)
        chan = weighted_pick(rng, CHANNEL_WEIGHT)
        meta = next(p for p in PRODUCTS if p[0] == code)
        ftype, purchase_fee, min_amt = meta[2], dec(meta[5]), dec(meta[6])

        odate = rng.choice(DAYS)
        nav = NAV_INDEX[code][odate]
        cdate = next_trading_day(odate, DAYS)

        if ftype == "货币型":
            otype = "申购" if rng.random() < 0.70 else "赎回"
        elif rng.random() < 0.55:
            otype = "申购"
        elif rng.random() < 0.60:
            otype = "定投"
        else:
            otype = "赎回"

        if otype == "赎回":
            shares = q(dec(rng.choice(["500.0000", "1200.0000", "3000.0000", "8000.0000",
                                       "15000.0000", "26000.0000", "42000.0000"])) * dec(str(round(rng.uniform(0.6, 1.4), 4))), Q4)
            amount = q(shares * nav, Q2)
        else:
            base = dec(rng.choice(AMOUNT_BUCKETS))
            amount = q(base * dec(str(round(rng.uniform(0.7, 1.4), 4))), Q2)
            if amount < min_amt:
                amount = min_amt
            rate = purchase_fee * dec(DISCOUNT[chan][ftype]) / dec(100)
            net = amount / (dec(1) + rate)
            shares = q(net / nav, Q4)

        r = rng.random()
        status = "已确认" if r < 0.86 else ("待确认" if r < 0.94 else "已撤单")

        rows.append({
            "order_no": "FD%s%05d" % (odate.strftime("%Y%m%d"), i + 1),
            "customer_id": "C%05d" % rng.randint(1, CUSTOMER_COUNT),
            "fund_code": code,
            "channel_code": chan,
            "order_type": otype,
            "amount": amount,
            "shares": shares,
            "order_date": odate,
            "confirm_date": cdate,
            "status": status,
        })
    rows.sort(key=lambda x: (x["order_date"], x["order_no"]))
    return rows


ORDERS = build_orders()


# ---------------------------------------------------------------- 期望答案

def pct_gain(code):
    s = NAV_INDEX[code][FIRST_DAY]
    e = NAV_INDEX[code][LAST_DAY]
    return q((e - s) / s * 100, Q2)


def monthly_avg(code):
    buckets = {}
    for d, nav, acc, ret in NAV[code]:
        buckets.setdefault(d.strftime("%Y-%m"), []).append(nav)
    return [(k, len(v), q(sum(v) / len(v), Q4)) for k, v in sorted(buckets.items())]


def channel_totals():
    agg = {}
    for o in ORDERS:
        if o["order_type"] not in ("申购", "定投") or o["status"] != "已确认":
            continue
        a = agg.setdefault(o["channel_code"], [0, dec(0)])
        a[0] += 1
        a[1] += o["amount"]
    out = []
    for code, (cnt, total) in agg.items():
        name = next(c[1] for c in CHANNELS if c[0] == code)
        ctype = next(c[2] for c in CHANNELS if c[0] == code)
        out.append((name, ctype, cnt, q(total, Q2)))
    out.sort(key=lambda x: -x[3])
    return out


# ---------------------------------------------------------------- SQL 输出

def emit_sql():
    L = []
    w = L.append
    w("-- =====================================================================")
    w("-- fund_demo —— 智能问数（Text-to-SQL）演示库")
    w("-- 由 scripts/gen_fund_demo_sql.py 自动生成，随机种子 %d" % SEED)
    w("--")
    w("-- ⚠️ 数据声明：本文件中的基金净值、份额、订单、渠道折扣、金额")
    w("--    全部为**虚构测试数据**，仅用于验证 Text-to-SQL 链路，")
    w("--    不代表任何真实基金的历史业绩或真实交易。")
    w("--")
    w("-- 用法（任选其一）：")
    w("--   1) 宿主机：  mysql -h 127.0.0.1 -P 3306 -u root -p < fund_demo.sql")
    w("--   2) 容器内：  docker exec -i docker-mysql-1 mysql -uroot -p'<密码>' < fund_demo.sql")
    w("--   3) 客户端：  用 Navicat / DBeaver 打开本文件整体执行")
    w("--")
    w("-- 幂等：可重复执行，会先 DROP TABLE 再重建（不会动其他库）。")
    w("-- =====================================================================")
    w("")
    w("SET NAMES utf8mb4;")
    w("SET FOREIGN_KEY_CHECKS = 0;")
    w("")
    w("CREATE DATABASE IF NOT EXISTS `%s` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;" % DB)
    w("USE `%s`;" % DB)
    w("")
    w("DROP TABLE IF EXISTS `fund_order`;")
    w("DROP TABLE IF EXISTS `fund_redeem_rule`;")
    w("DROP TABLE IF EXISTS `fund_fee_discount`;")
    w("DROP TABLE IF EXISTS `fund_channel`;")
    w("DROP TABLE IF EXISTS `fund_nav`;")
    w("DROP TABLE IF EXISTS `fund_product`;")
    w("")

    # ---- fund_product
    w("-- ---------------------------------------------------------------------")
    w("-- 1. 基金产品表")
    w("-- ---------------------------------------------------------------------")
    w("CREATE TABLE `fund_product` (")
    w("  `fund_code`           VARCHAR(6)     NOT NULL COMMENT '基金代码',")
    w("  `fund_name`           VARCHAR(64)    NOT NULL COMMENT '基金简称',")
    w("  `fund_type`           VARCHAR(16)    NOT NULL COMMENT '基金类型：混合型/债券型/指数型/QDII/货币型',")
    w("  `risk_level`          TINYINT        NOT NULL COMMENT '风险等级 1-5，数字越大风险越高',")
    w("  `manage_fee_rate`     DECIMAL(6,2)   NOT NULL COMMENT '年管理费率，单位 %',")
    w("  `purchase_fee_rate`   DECIMAL(6,2)   NOT NULL COMMENT '申购费率基准，单位 %；渠道可打折，见 fund_fee_discount',")
    w("  `min_purchase_amount` DECIMAL(12,2)  NOT NULL COMMENT '起购金额，单位元',")
    w("  `status`              VARCHAR(16)    NOT NULL COMMENT '销售状态：开放申购/暂停申购/开放赎回',")
    w("  `established_date`    DATE           NOT NULL COMMENT '基金成立日',")
    w("  `latest_nav`          DECIMAL(8,4)   NOT NULL COMMENT '最新单位净值（= fund_nav 中最新交易日的 unit_nav）',")
    w("  `latest_nav_date`     DATE           NOT NULL COMMENT '最新净值日期',")
    w("  `fund_manager`        VARCHAR(32)    NOT NULL COMMENT '基金经理',")
    w("  `company`             VARCHAR(64)    NOT NULL COMMENT '基金公司',")
    w("  PRIMARY KEY (`fund_code`),")
    w("  KEY `idx_type` (`fund_type`),")
    w("  KEY `idx_risk` (`risk_level`)")
    w(") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='基金产品';")
    w("")
    w("INSERT INTO `fund_product` (`fund_code`,`fund_name`,`fund_type`,`risk_level`,`manage_fee_rate`,"
      "`purchase_fee_rate`,`min_purchase_amount`,`status`,`established_date`,`latest_nav`,`latest_nav_date`,"
      "`fund_manager`,`company`) VALUES")
    vals = []
    for p in PRODUCTS:
        code = p[0]
        last = NAV[code][-1]
        vals.append("('%s','%s','%s',%d,%s,%s,%s,'%s','%s',%s,'%s','%s','%s')" % (
            code, esc(p[1]), p[2], p[3], p[4], p[5], p[6], p[7], p[8],
            last[1], last[0].isoformat(), esc(p[10]), esc(p[11])))
    w(",\n".join(vals) + ";")
    w("")

    # ---- fund_nav
    w("-- ---------------------------------------------------------------------")
    w("-- 2. 基金净值表（逐交易日，已剔除周末与国庆休市 2026-10-01~10-07）")
    w("-- ---------------------------------------------------------------------")
    w("CREATE TABLE `fund_nav` (")
    w("  `fund_code`    VARCHAR(6)   NOT NULL COMMENT '基金代码',")
    w("  `nav_date`     DATE         NOT NULL COMMENT '净值日期（交易日）',")
    w("  `unit_nav`     DECIMAL(8,4) NOT NULL COMMENT '单位净值；货币基金恒为 1.0000',")
    w("  `acc_nav`      DECIMAL(8,4) NOT NULL COMMENT '累计净值',")
    w("  `daily_return` DECIMAL(8,4) NOT NULL COMMENT '日涨跌幅，单位 %；货币基金为 0',")
    w("  PRIMARY KEY (`fund_code`,`nav_date`)")
    w(") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='基金净值';")
    w("")
    w("INSERT INTO `fund_nav` (`fund_code`,`nav_date`,`unit_nav`,`acc_nav`,`daily_return`) VALUES")
    vals, batch = [], []
    for code in NAV:
        for d, unit, acc, ret in NAV[code]:
            batch.append("('%s','%s',%s,%s,%s)" % (code, d.isoformat(), unit, acc, ret))
            if len(batch) >= 60:
                vals.append(",\n".join(batch)); batch = []
    if batch:
        vals.append(",\n".join(batch))
    w(",\n".join(vals) + ";")
    w("")

    # ---- fund_channel
    w("-- ---------------------------------------------------------------------")
    w("-- 3. 销售渠道表")
    w("-- ---------------------------------------------------------------------")
    w("CREATE TABLE `fund_channel` (")
    w("  `channel_code`       VARCHAR(8)  NOT NULL COMMENT '渠道编码',")
    w("  `channel_name`       VARCHAR(64) NOT NULL COMMENT '渠道名称',")
    w("  `channel_type`       VARCHAR(16) NOT NULL COMMENT '渠道类型：直销/银行代销/第三方代销',")
    w("  `settle_days`        TINYINT     NOT NULL COMMENT '确认天数 T+N',")
    w("  `support_auto_invest` VARCHAR(2) NOT NULL COMMENT '是否支持定投：是/否',")
    w("  `status`             VARCHAR(8)  NOT NULL COMMENT '渠道状态：正常/下线',")
    w("  PRIMARY KEY (`channel_code`)")
    w(") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='销售渠道';")
    w("")
    w("INSERT INTO `fund_channel` (`channel_code`,`channel_name`,`channel_type`,`settle_days`,"
      "`support_auto_invest`,`status`) VALUES")
    vals = ["('%s','%s','%s',%d,'%s','%s')" % (c[0], esc(c[1]), c[2], c[3], c[4], c[5]) for c in CHANNELS]
    w(",\n".join(vals) + ";")
    w("")

    # ---- fund_fee_discount
    w("-- ---------------------------------------------------------------------")
    w("-- 4. 渠道申购费率折扣表（按 渠道 × 基金类型 定价）")
    w("-- ---------------------------------------------------------------------")
    w("CREATE TABLE `fund_fee_discount` (")
    w("  `channel_code`   VARCHAR(8)   NOT NULL COMMENT '渠道编码',")
    w("  `fund_type`      VARCHAR(16)  NOT NULL COMMENT '基金类型',")
    w("  `discount_rate`  DECIMAL(4,2) NOT NULL COMMENT '折扣率：1.00=不打折，0.10=1折，0.00=免申购费',")
    w("  `effective_date` DATE         NOT NULL COMMENT '生效日期',")
    w("  `remark`         VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '备注',")
    w("  PRIMARY KEY (`channel_code`,`fund_type`)")
    w(") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='渠道申购费率折扣';")
    w("")
    w("INSERT INTO `fund_fee_discount` (`channel_code`,`fund_type`,`discount_rate`,`effective_date`,`remark`) VALUES")
    vals = []
    for ch in ["ZX01", "ZX02", "ZX03", "DX01", "DX02", "DX03", "DX04", "DX05"]:
        for ftype in ["混合型", "债券型", "指数型", "QDII", "货币型"]:
            rate = DISCOUNT[ch][ftype]
            remark = "免申购费" if rate == "0.00" else ("不打折" if rate == "1.00" else "%d折" % round(float(rate) * 10))
            vals.append("('%s','%s',%s,'2026-01-01','%s')" % (ch, ftype, rate, esc(remark)))
    w(",\n".join(vals) + ";")
    w("")

    # ---- fund_redeem_rule
    w("-- ---------------------------------------------------------------------")
    w("-- 5. 赎回费率分档表（按 基金类型 × 持有天数区间）")
    w("-- ---------------------------------------------------------------------")
    w("CREATE TABLE `fund_redeem_rule` (")
    w("  `id`              INT          NOT NULL AUTO_INCREMENT,")
    w("  `fund_type`       VARCHAR(16)  NOT NULL COMMENT '基金类型',")
    w("  `holding_days_min` INT         NOT NULL COMMENT '持有天数下限（含）',")
    w("  `holding_days_max` INT         NOT NULL COMMENT '持有天数上限（含）；9999 表示无上限',")
    w("  `redeem_fee_rate` DECIMAL(6,2) NOT NULL COMMENT '赎回费率，单位 %',")
    w("  `remark`          VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '备注',")
    w("  PRIMARY KEY (`id`),")
    w("  KEY `idx_type` (`fund_type`)")
    w(") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='赎回费率分档';")
    w("")
    w("INSERT INTO `fund_redeem_rule` (`fund_type`,`holding_days_min`,`holding_days_max`,`redeem_fee_rate`,`remark`) VALUES")
    vals = []
    for ftype in ["混合型", "债券型", "指数型", "QDII", "货币型"]:
        for lo, hi, rate, remark in REDEEM[ftype]:
            vals.append("('%s',%d,%d,%s,'%s')" % (ftype, lo, hi, rate, esc(remark)))
    w(",\n".join(vals) + ";")
    w("")

    # ---- fund_order
    w("-- ---------------------------------------------------------------------")
    w("-- 6. 交易订单表（%d 笔，2026-09-01 ~ 2026-10-31）" % len(ORDERS))
    w("-- ---------------------------------------------------------------------")
    w("CREATE TABLE `fund_order` (")
    w("  `id`           BIGINT        NOT NULL AUTO_INCREMENT,")
    w("  `order_no`     VARCHAR(32)   NOT NULL COMMENT '订单号',")
    w("  `customer_id`  VARCHAR(16)   NOT NULL COMMENT '客户号',")
    w("  `fund_code`    VARCHAR(6)    NOT NULL COMMENT '基金代码',")
    w("  `channel_code` VARCHAR(8)    NOT NULL COMMENT '渠道编码',")
    w("  `order_type`   VARCHAR(8)    NOT NULL COMMENT '业务类型：申购/赎回/定投',")
    w("  `amount`       DECIMAL(14,2) NOT NULL COMMENT '交易金额，单位元',")
    w("  `shares`       DECIMAL(16,4) NOT NULL COMMENT '交易份额',")
    w("  `order_date`   DATE          NOT NULL COMMENT '下单日期',")
    w("  `confirm_date` DATE          NOT NULL COMMENT '确认日期',")
    w("  `status`       VARCHAR(8)    NOT NULL COMMENT '订单状态：已确认/待确认/已撤单',")
    w("  PRIMARY KEY (`id`),")
    w("  UNIQUE KEY `uk_order_no` (`order_no`),")
    w("  KEY `idx_date` (`order_date`),")
    w("  KEY `idx_fund` (`fund_code`),")
    w("  KEY `idx_channel` (`channel_code`)")
    w(") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='基金交易订单';")
    w("")
    w("INSERT INTO `fund_order` (`order_no`,`customer_id`,`fund_code`,`channel_code`,`order_type`,"
      "`amount`,`shares`,`order_date`,`confirm_date`,`status`) VALUES")
    vals, batch = [], []
    for o in ORDERS:
        batch.append("('%s','%s','%s','%s','%s',%s,%s,'%s','%s','%s')" % (
            o["order_no"], o["customer_id"], o["fund_code"], o["channel_code"], o["order_type"],
            o["amount"], o["shares"], o["order_date"].isoformat(), o["confirm_date"].isoformat(), o["status"]))
        if len(batch) >= 60:
            vals.append(",\n".join(batch)); batch = []
    if batch:
        vals.append(",\n".join(batch))
    w(",\n".join(vals) + ";")
    w("")

    # ---- 只读账号
    w("-- ---------------------------------------------------------------------")
    w("-- 7. 只读账号（供 ExeSQL / Text-to-SQL 使用）")
    w("--    mysql_native_password 是为了兼容部分 Go 驱动的 caching_sha2 握手问题；")
    w("--    若你的 MySQL 已禁用该插件，把下面这句换成普通 IDENTIFIED BY 即可。")
    w("-- ---------------------------------------------------------------------")
    w("CREATE USER IF NOT EXISTS '%s'@'%%' IDENTIFIED WITH mysql_native_password BY '%s';" % (RO_USER, RO_PASS))
    w("ALTER USER '%s'@'%%' IDENTIFIED WITH mysql_native_password BY '%s';" % (RO_USER, RO_PASS))
    w("GRANT SELECT ON `%s`.* TO '%s'@'%%';" % (DB, RO_USER))
    w("FLUSH PRIVILEGES;")
    w("")
    w("SET FOREIGN_KEY_CHECKS = 1;")
    w("")
    w("-- 自检：下面这条应返回 %d 行" % len(PRODUCTS))
    w("-- SELECT COUNT(*) FROM fund_product;")
    w("")
    return "\n".join(L) + "\n"


# ---------------------------------------------------------------- schema.md

def emit_schema():
    L = []
    w = L.append
    w("# fund_demo 表结构说明（智能问数用）")
    w("")
    w("> ⚠️ 本库中的净值、订单、份额、折扣、金额**全部为虚构测试数据**，与任何真实基金的历史业绩无关。")
    w("")
    w("库名：`fund_demo` ｜ 字符集：`utf8mb4` ｜ 净值区间：`%s` ~ `%s`（共 %d 个交易日）" % (FIRST_DAY, LAST_DAY, len(DAYS)))
    w("")
    w("这是**给大模型读的表结构知识库原文**。整篇灌进一个 `general` 类型的知识库，")
    w("Text-to-SQL 的检索节点只召回这张表的结构，不要和产品文档库混在一起，避免召回噪声。")
    w("")
    w("## 一、表总览")
    w("")
    w("| 表名 | 含义 | 行数量级 | 主要用途 |")
    w("| --- | --- | --- | --- |")
    w("| `fund_product` | 基金产品 | %d | 单值查询、条件筛选、跨列比较 |" % len(PRODUCTS))
    w("| `fund_nav` | 基金逐日净值 | %d | 时序查询、区间涨幅、月均净值 |" % sum(len(v) for v in NAV.values()))
    w("| `fund_channel` | 销售渠道 | %d | 渠道维度过滤、分组 |" % len(CHANNELS))
    w("| `fund_fee_discount` | 渠道申购费率折扣 | %d | 实际申购费率计算 |" % (len(CHANNELS) * 5))
    w("| `fund_redeem_rule` | 赎回费率分档 | %d | 按持有天数查赎回费 |" % sum(len(v) for v in REDEEM.values()))
    w("| `fund_order` | 交易订单 | %d | 多条件聚合、渠道排名 |" % len(ORDERS))
    w("")
    w("## 二、`fund_product` 基金产品")
    w("")
    w("| 字段 | 类型 | 说明 |")
    w("| --- | --- | --- |")
    w("| `fund_code` | VARCHAR(6) | 基金代码，主键，如 `000001` |")
    w("| `fund_name` | VARCHAR(64) | 基金简称，如 `华夏成长混合` |")
    w("| `fund_type` | VARCHAR(16) | 基金类型，枚举：`混合型` / `债券型` / `指数型` / `QDII` / `货币型` |")
    w("| `risk_level` | TINYINT | 风险等级 1~5，数字越大风险越高。`3 级及以下` 写作 `risk_level <= 3` |")
    w("| `manage_fee_rate` | DECIMAL(6,2) | 年管理费率，单位 **%**（1.50 表示 1.5%） |")
    w("| `purchase_fee_rate` | DECIMAL(6,2) | 申购费率**基准**，单位 %；渠道实际费率 = 本列 × 折扣率 |")
    w("| `min_purchase_amount` | DECIMAL(12,2) | 起购金额，单位元 |")
    w("| `status` | VARCHAR(16) | 销售状态，枚举：`开放申购` / `暂停申购` / `开放赎回` |")
    w("| `established_date` | DATE | 成立日 |")
    w("| `latest_nav` | DECIMAL(8,4) | 最新单位净值，等于 `fund_nav` 中最新交易日的 `unit_nav` |")
    w("| `latest_nav_date` | DATE | 最新净值对应日期 |")
    w("| `fund_manager` | VARCHAR(32) | 基金经理 |")
    w("| `company` | VARCHAR(64) | 基金公司 |")
    w("")
    w("已入库产品（%d 只）：" % len(PRODUCTS))
    w("")
    w("| 代码 | 名称 | 类型 | 风险 | 管理费率% | 申购费率% | 起购(元) | 状态 |")
    w("| --- | --- | --- | --- | --- | --- | --- | --- |")
    for p in PRODUCTS:
        w("| %s | %s | %s | %d | %s | %s | %s | %s |" % (p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7]))
    w("")
    w("## 三、`fund_nav` 基金净值")
    w("")
    w("| 字段 | 类型 | 说明 |")
    w("| --- | --- | --- |")
    w("| `fund_code` | VARCHAR(6) | 基金代码，联合主键 |")
    w("| `nav_date` | DATE | 净值日期，联合主键。**仅交易日有数据**，周末与 2026-10-01~10-07 无记录 |")
    w("| `unit_nav` | DECIMAL(8,4) | 单位净值。**货币基金恒为 1.0000** |")
    w("| `acc_nav` | DECIMAL(8,4) | 累计净值 |")
    w("| `daily_return` | DECIMAL(8,4) | 日涨跌幅，单位 %。货币基金为 0 |")
    w("")
    w("`fund_nav` 覆盖 `%s` ~ `%s`，共 **%d 个交易日**。**2026-10-31 是周六，没有净值**。" % (
        FIRST_DAY, LAST_DAY, len(DAYS)))
    w("")
    w("## 四、`fund_channel` 销售渠道")
    w("")
    w("| 字段 | 类型 | 说明 |")
    w("| --- | --- | --- |")
    w("| `channel_code` | VARCHAR(8) | 渠道编码，主键 |")
    w("| `channel_name` | VARCHAR(64) | 渠道名称 |")
    w("| `channel_type` | VARCHAR(16) | 枚举：`直销` / `银行代销` / `第三方代销` |")
    w("| `settle_days` | TINYINT | 确认天数 T+N |")
    w("| `support_auto_invest` | VARCHAR(2) | 是否支持定投：`是` / `否` |")
    w("| `status` | VARCHAR(8) | `正常` / `下线` |")
    w("")
    w("| 编码 | 名称 | 类型 | T+N | 支持定投 |")
    w("| --- | --- | --- | --- | --- |")
    for c in CHANNELS:
        w("| %s | %s | %s | T+%d | %s |" % (c[0], c[1], c[2], c[3], c[4]))
    w("")
    w("## 五、`fund_fee_discount` 渠道申购费率折扣")
    w("")
    w("| 字段 | 类型 | 说明 |")
    w("| --- | --- | --- |")
    w("| `channel_code` | VARCHAR(8) | 渠道编码，联合主键 |")
    w("| `fund_type` | VARCHAR(16) | 基金类型，联合主键。**折扣按「渠道 × 基金类型」定价，不按单只基金** |")
    w("| `discount_rate` | DECIMAL(4,2) | 折扣率，`1.00` = 不打折，`0.10` = 1折，`0.00` = 免申购费 |")
    w("| `effective_date` | DATE | 生效日期 |")
    w("| `remark` | VARCHAR(64) | 备注 |")
    w("")
    w("## 六、`fund_redeem_rule` 赎回费率分档")
    w("")
    w("| 字段 | 类型 | 说明 |")
    w("| --- | --- | --- |")
    w("| `id` | INT | 自增主键 |")
    w("| `fund_type` | VARCHAR(16) | 基金类型。**分档按类型定，不按单只基金** |")
    w("| `holding_days_min` | INT | 持有天数下限（含） |")
    w("| `holding_days_max` | INT | 持有天数上限（含）；`9999` 表示无上限 |")
    w("| `redeem_fee_rate` | DECIMAL(6,2) | 赎回费率，单位 % |")
    w("| `remark` | VARCHAR(64) | 备注 |")
    w("")
    w("分档明细：")
    w("")
    w("| 类型 | 持有天数 | 赎回费率% | 备注 |")
    w("| --- | --- | --- | --- |")
    for ftype in ["混合型", "债券型", "指数型", "QDII", "货币型"]:
        for lo, hi, rate, remark in REDEEM[ftype]:
            if hi >= 9999:
                span = "任意持有期" if lo == 0 else "%d 天以上" % lo
            else:
                span = "%d~%d 天" % (lo, hi) if lo else "0~%d 天" % hi
            w("| %s | %s | %s | %s |" % (ftype, span, rate, remark))
    w("")
    w("## 七、`fund_order` 交易订单")
    w("")
    w("| 字段 | 类型 | 说明 |")
    w("| --- | --- | --- |")
    w("| `id` | BIGINT | 自增主键 |")
    w("| `order_no` | VARCHAR(32) | 订单号，唯一 |")
    w("| `customer_id` | VARCHAR(16) | 客户号 |")
    w("| `fund_code` | VARCHAR(6) | 基金代码 |")
    w("| `channel_code` | VARCHAR(8) | 渠道编码 |")
    w("| `order_type` | VARCHAR(8) | 枚举：`申购` / `赎回` / `定投` |")
    w("| `amount` | DECIMAL(14,2) | 交易金额，单位元 |")
    w("| `shares` | DECIMAL(16,4) | 交易份额 |")
    w("| `order_date` | DATE | 下单日期 |")
    w("| `confirm_date` | DATE | 确认日期 |")
    w("| `status` | VARCHAR(8) | 枚举：`已确认` / `待确认` / `已撤单` |")
    w("")
    w("## 八、业务口径（**必须写进知识库，否则模型会算错**）")
    w("")
    w("1. **两类数值，处理方式完全不同，混用必算错**：")
    w("   - `manage_fee_rate` / `purchase_fee_rate` / `redeem_fee_rate` 是**百分数**，算金额时**除以 100**。")
    w("     例：`1.50` → 0.015。")
    w("   - `discount_rate` 是**倍数**（`0.10` = 1折、`1.00` = 不打折），**直接相乘，不要再除 100**。")
    w("   - 实际申购费率(%) = `purchase_fee_rate` × `discount_rate`，结果仍是百分数。")
    w("2. **申购费采用外扣法**：")
    w("   - 净申购金额 = 申购金额 ÷ (1 + 实际申购费率)")
    w("   - 申购费 = 申购金额 − 净申购金额")
    w("   - 实际申购费率(%) = `fund_product.purchase_fee_rate` × `fund_fee_discount.discount_rate`（**不再除 100**），")
    w("     再 ÷100 才得到小数比例，代入上面的公式")
    w("   - 例：买 10000 元、基准费率 1.50%、1折 → 实际费率 0.15% → 净申购 9985.02，申购费 **14.98**")
    w("3. **赎回费是全额收取**：赎回费 = 赎回金额 × 赎回费率 ÷ 100（不扣净值，直接从赎回款里扣）。")
    w("4. **持有天数分档**：`holding_days_min <= 持有天数 <= holding_days_max`，取唯一命中的那一档。")
    w("5. **货币基金**：`unit_nav` 恒为 `1.0000`，`daily_return` 恒为 0，申购费率与赎回费率均为 0。")
    w("   问「涨幅」时若用单位净值算货币基金会得 0，这是**正确结果**，不是数据缺失。")
    w("6. **非交易日无净值**：`fund_nav` 只有交易日数据。问某个周末或国庆假期（2026-10-01~10-07）的净值，")
    w("   应返回空结果并说明「当日休市」。")
    w("7. **金额统计要排除无效订单**：统计申购/定投金额时，`status` 必须限定 `'已确认'`，")
    w("   `'待确认'` 与 `'已撤单'` 不计入。")
    w("8. **销售状态**：`status = '暂停申购'` 的基金**不能买入**，问「能不能买」时要看这一列。")
    w("9. **产品 vs 类型**：申购折扣和赎回分档都是**按基金类型**给的，单只基金要先取到 `fund_type` 再关联。")
    w("")
    w("## 九、接入 RAGFlow 智能问数")
    w("")
    w("> 本库已于 2026-10-31 导入 `172.30.20.51` 的 MySQL（`docker-mysql-1`），6 张表数据齐备。")
    w("")
    w("1. 只读账号：用户 `%s`，密码 `%s`，仅 `SELECT` 到 `fund_demo.*`。" % (RO_USER, RO_PASS))
    w("   已实测：读 `fund_demo` 正常；读 `rag_flow` 被 `ERROR 1142` 拒绝；建表被拒绝。")
    w("2. 画布用 `Agent + Retrieval + ExeSQL` 三节点，或内置「问数专家」模板（`text2sql_data_expert`）。")
    w("3. `ExeSQL` 节点按下面填（字段与 `internal/agent/tool/exesql.go` 对齐）：")
    w("")
    w("| 字段 | 值 | 说明 |")
    w("| --- | --- | --- |")
    w("| `database_type` | `mysql` | 另支持 postgres / mariadb / mssql / oceanbase |")
    w("| `host` | `172.30.20.51` | **只写 IP，不要带端口**。代码用 `net.JoinHostPort(host, port)` 拼 DSN，写成 `ip:port` 会变成 `[ip:port]:3306` 直接连不上 |")
    w("| `port` | `3306` | 不填默认就是 3306 |")
    w("| `database` | `%s` | |" % DB)
    w("| `username` / `password` | `%s` / `%s` | |" % (RO_USER, RO_PASS))
    w("| `max_records` | `1024` | 默认值，够用 |")
    w("")
    w("4. ⚠️ **前置条件：必须打开 `ALLOW_ANY_HOST=1`**")
    w("   ")
    w("   `ExeSQL` 连库前会过 `ValidateDBHost()` 的 SSRF 校验，**默认拒绝一切内网地址**")
    w("   （`172.16/12`、`10/8`、`192.168/16`、`127.0.0.1` 全部返回 `ErrSSRFBlocked`）。")
    w("   不改这一项，节点会直接报错，连不到库。改法（drop-in，不动主 unit）：")
    w("   ")
    w("   ```bash")
    w("   mkdir -p /etc/systemd/system/ragflow-api.service.d")
    w("   printf '[Service]\\nEnvironment=ALLOW_ANY_HOST=1\\n' \\")
    w("     > /etc/systemd/system/ragflow-api.service.d/allow-any-host.conf")
    w("   systemctl daemon-reload && systemctl restart ragflow-api")
    w("   ```")
    w("   ")
    w("   注意：`/root/ragflow/docker/.env` 里的 `ALLOW_ANY_HOST=0` **不生效**——")
    w("   RAGFlow 在本部署里是宿主机 systemd 服务（`ragflow-api/admin/ingestor`），不读那个文件。")
    w("5. `Retrieval` 节点绑定的知识库里**只放本文档**，不要混产品文档，否则会召回无关表结构。")
    w("")
    w("> 随机种子固定为 %d，重跑 `scripts/gen_fund_demo_sql.py` 产出的数据完全一致。" % SEED)
    w("")
    return "\n".join(L) + "\n"


# ---------------------------------------------------------------- qa.md

def emit_qa():
    L = []
    w = L.append
    w("# fund_demo 验收问答（智能问数）")
    w("")
    w("> 配套 `fund_demo.sql` 使用。每题给出**标准问法**、**期望 SQL**、**期望答案**。")
    w("> 期望答案由生成脚本对同一份数据直接计算得出，与实际入库数据严格一致。")
    w("")
    w("判定标准建议：")
    w("")
    w("- **正确**：SQL 可执行且结果集与期望一致（数值允许 ±0.01 的四舍五入差异）。")
    w("- **口径错**：SQL 能跑，但费率没除 100、或没排掉已撤单、或把折扣当成了最终费率。")
    w("- **臆造**：编造了不存在的字段名/表名，或返回了数据里没有的产品。")
    w("")

    n = 0

    def block(title, question, sql, answer, note=None):
        nonlocal n
        n += 1
        w("## Q%d. %s" % (n, title))
        w("")
        w("**问**：%s" % question)
        w("")
        w("```sql")
        for line in sql.strip().split("\n"):
            w(line)
        w("```")
        w("")
        w("**期望答案**：%s" % answer)
        if note:
            w("")
            w("> %s" % note)
        w("")

    # Q1
    p1 = next(p for p in PRODUCTS if p[0] == "000001")
    last1 = NAV["000001"][-1]
    block("只查单值",
          "华夏成长混合（000001）最新净值是多少？",
          """
SELECT fund_name, latest_nav, latest_nav_date
FROM fund_product
WHERE fund_code = '000001';
""",
          "`%s`，最新净值 **%s**，净值日期 %s。" % (p1[1], last1[1], last1[0]))

    # Q2
    money = [p for p in PRODUCTS if p[2] == "货币型" and p[7] == "开放申购"]
    block("条件筛选（枚举 + 状态）",
          "现在能买到哪些货币型基金？",
          """
SELECT fund_code, fund_name, min_purchase_amount, latest_nav
FROM fund_product
WHERE fund_type = '货币型' AND status = '开放申购'
ORDER BY fund_code;
""",
          "共 %d 只：%s。" % (len(money),
                            "；".join("%s %s（起购 %s 元）" % (m[0], m[1], m[6]) for m in money)),
          "注意 `status` 要限定 `开放申购`，否则会把暂停申购的产品也算进来。")

    # Q3
    gains = sorted(((p[0], p[1], pct_gain(p[0])) for p in PRODUCTS), key=lambda x: -x[2])[:3]
    block("区间涨幅排名（两表自连接）",
          "%s 到 %s，单位净值涨幅最高的三只基金是哪几只？" % (FIRST_DAY, LAST_DAY),
          """
SELECT p.fund_code, p.fund_name,
       ROUND((e.unit_nav - s.unit_nav) / s.unit_nav * 100, 2) AS gain_pct
FROM fund_product p
JOIN fund_nav s ON s.fund_code = p.fund_code AND s.nav_date = '%s'
JOIN fund_nav e ON e.fund_code = p.fund_code AND e.nav_date = '%s'
ORDER BY gain_pct DESC
LIMIT 3;
""" % (FIRST_DAY, LAST_DAY),
          "1) %s %s **%s%%**；2) %s %s **%s%%**；3) %s %s **%s%%**。" % (
              gains[0][0], gains[0][1], gains[0][2],
              gains[1][0], gains[1][1], gains[1][2],
              gains[2][0], gains[2][1], gains[2][2]),
          "起止日期必须是**实际有净值的交易日**：区间末 2026-10-31 是周六，最后一条净值在 %s。" % LAST_DAY)

    # Q4
    nav930 = NAV_INDEX["000001"].get(date(2026, 9, 30))
    block("时序点查",
          "华夏成长混合 2026 年 9 月 30 日的单位净值是多少？",
          """
SELECT nav_date, unit_nav, daily_return
FROM fund_nav
WHERE fund_code = '000001' AND nav_date = '2026-09-30';
""",
          "单位净值 **%s**，当日涨跌幅 %s%%。" % (nav930, q((nav930 - NAV_INDEX["000001"][date(2026, 9, 29)]) /
                                                     NAV_INDEX["000001"][date(2026, 9, 29)] * 100, Q2)))

    # Q5
    rule = next(r for r in REDEEM["混合型"] if r[0] <= 100 <= r[1])
    fee5 = q(dec("100000") * dec(rule[2]) / dec(100), Q2)
    block("规则分档 + 金额计算",
          "持有华夏成长混合满 100 天，赎回 10 万元，赎回费是多少？",
          """
SELECT r.fund_type, r.holding_days_min, r.holding_days_max, r.redeem_fee_rate,
       ROUND(100000 * r.redeem_fee_rate / 100, 2) AS redeem_fee
FROM fund_redeem_rule r
JOIN fund_product p ON p.fund_type = r.fund_type
WHERE p.fund_code = '000001'
  AND 100 BETWEEN r.holding_days_min AND r.holding_days_max;
""",
          "命中「%d~%d 天」档，费率 **%s%%**，赎回费 **%s 元**。" % (rule[0], rule[1], rule[2], fee5),
          "100 天落在 `30~364 天` 档，**不是** `7~29 天` 档；分档区间两端都是闭区间。")

    # Q6
    fee_base = dec("1.50")
    disc = dec(DISCOUNT["DX03"]["混合型"])
    actual = q(fee_base * disc, Q4)
    net = q(dec("10000") / (dec(1) + actual / dec(100)), Q2)
    fee6 = q(dec("10000") - net, Q2)
    block("渠道折扣 + 外扣法",
          "在天天基金买 1 万元华夏成长混合，申购费多少？",
          """
SELECT c.channel_name, p.purchase_fee_rate, d.discount_rate,
       ROUND(p.purchase_fee_rate * d.discount_rate, 4) AS actual_rate_pct,
       ROUND(10000 - 10000 / (1 + p.purchase_fee_rate * d.discount_rate / 100), 2) AS purchase_fee
FROM fund_product p
JOIN fund_fee_discount d ON d.fund_type = p.fund_type
JOIN fund_channel c ON c.channel_code = d.channel_code
WHERE p.fund_code = '000001' AND c.channel_name = '天天基金';
""",
          "基准费率 %s%%，天天基金 1 折 → 实际费率 **%s%%**；净申购 **%s 元**，申购费 **%s 元**。" % (
              fee_base, actual, net, fee6),
          "两个坑：① 折扣率是**倍数**不是百分数，要乘回基准费率；② 申购费用**外扣法**，`10000×0.15%` 得 15.00 是错的，正确是 14.98。")

    # Q7
    totals = channel_totals()
    tbl = ["| 排名 | 渠道 | 渠道类型 | 已确认笔数 | 申购金额合计（元） |",
           "| --- | --- | --- | --- | --- |"]
    for i, t in enumerate(totals, 1):
        tbl.append("| %d | %s | %s | %d | %s |" % (i, t[0], t[1], t[2], t[3]))
    block("多条件聚合 + 分组排名",
          "2026 年 9 月到 10 月，各渠道的申购金额合计是多少？从高到低排。",
          """
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
""",
          "共 %d 个渠道有已确认申购（单位：元）：\n\n%s" % (len(totals), "\n".join(tbl)),
          "三个过滤条件都不能漏：业务类型要含 `定投`、状态要排掉 `待确认`/`已撤单`、日期区间要卡住。")

    # Q8
    cand = sorted([p for p in PRODUCTS if p[3] <= 3 and dec(p[6]) <= dec("100") and p[7] == "开放申购"],
                  key=lambda p: (p[3], p[0]))
    block("多条件与运算",
          "风险等级 3 级及以下、起购金额不超过 100 元的开放申购基金有哪些？",
          """
SELECT fund_code, fund_name, fund_type, risk_level, min_purchase_amount
FROM fund_product
WHERE risk_level <= 3
  AND min_purchase_amount <= 100
  AND status = '开放申购'
ORDER BY risk_level, fund_code;
""",
          "共 %d 只（按风险等级升序）：%s。" % (
              len(cand), "；".join("%s %s（风险 %d 级，起购 %s 元）" % (c[0], c[1], c[3], c[6]) for c in cand)),
          "「3 级及以下」是 `<= 3` 不是 `= 3`；「不超过 100 元」是 `<= 100`。")

    # Q9
    ma = monthly_avg("000001")
    block("时序按月聚合",
          "华夏成长混合 9 月和 10 月的月均单位净值分别是多少？",
          """
SELECT DATE_FORMAT(nav_date, '%Y-%m') AS ym,
       COUNT(*) AS days,
       ROUND(AVG(unit_nav), 4) AS avg_nav
FROM fund_nav
WHERE fund_code = '000001'
  AND nav_date BETWEEN '2026-09-01' AND '2026-10-31'
GROUP BY ym
ORDER BY ym;
""",
          "；".join("%s：%d 个交易日，月均净值 **%s**" % (m[0], m[1], m[2]) for m in ma) + "。",
          "9 月 %d 个交易日、10 月 %d 个交易日（10/1~10/7 国庆休市已剔除）。" % (ma[0][1], ma[1][1]))

    # Q10
    cross = sorted([p for p in PRODUCTS if dec(p[5]) > dec(p[4])], key=lambda p: -(dec(p[5]) - dec(p[4])))
    block("同表跨列比较",
          "哪些基金的申购费率高于管理费率？",
          """
SELECT fund_code, fund_name, purchase_fee_rate, manage_fee_rate
FROM fund_product
WHERE purchase_fee_rate > manage_fee_rate
ORDER BY purchase_fee_rate - manage_fee_rate DESC;
""",
          "共 %d 只：%s。" % (len(cross),
                            "；".join("%s %s（申购 %s%% > 管理 %s%%）" % (c[0], c[1], c[5], c[4]) for c in cross)))

    # Q11
    bytype = {}
    for p in PRODUCTS:
        bytype.setdefault(p[2], []).append(dec(p[4]))
    rows = sorted(((k, len(v), q(sum(v) / len(v), Decimal("0.001"))) for k, v in bytype.items()), key=lambda x: -x[2])
    block("分组聚合",
          "各类型基金的平均管理费率是多少？各有几只？",
          """
SELECT fund_type, COUNT(*) AS cnt, ROUND(AVG(manage_fee_rate), 3) AS avg_manage_fee
FROM fund_product
GROUP BY fund_type
ORDER BY avg_manage_fee DESC;
""",
          "；".join("%s %d 只，平均 %s%%" % (r[0], r[1], r[2]) for r in rows) + "。",
          "管理费率是 `DECIMAL(6,2)`，平均值要 `ROUND(... , 3)` 才看得出差异，否则会被截成整数。")

    # Q12 陷阱
    block("陷阱：非交易日无数据",
          "华夏恒生ETF联接A 在 2026 年 10 月 3 日的净值是多少？",
          """
SELECT nav_date, unit_nav
FROM fund_nav
WHERE fund_code = '000071'
  AND nav_date BETWEEN '2026-10-01' AND '2026-10-07';
""",
          "**空结果集**（0 行）。",
          "2026-10-01~10-07 是国庆休市，`fund_nav` 里没有记录；且 10 月 3 日是周六。"
          "模型应回答「当日休市，无净值」，而不是编一个数字，也不应回落成「查不到这只基金」。")

    # Q13 陷阱
    block("陷阱：暂停申购",
          "华夏复兴混合现在还能买吗？",
          """
SELECT fund_code, fund_name, status
FROM fund_product
WHERE fund_code = '000031';
""",
          "**不能买**。`status = '暂停申购'`（该基金仍可赎回，但申购通道关闭）。",
          "只看「产品存在」就回答「可以买」是典型错误，必须读 `status`。")

    # Q14
    qdii_fee = dec("1.60")
    qrows = []
    for c in CHANNELS:
        dr = dec(DISCOUNT[c[0]]["QDII"])
        qrows.append((c[1], dr, q(dr * qdii_fee, Q4)))
    qrows.sort(key=lambda x: x[2])
    lo, hi = qrows[0][2], qrows[-1][2]
    lo_names = "、".join(r[0] for r in qrows if r[2] == lo)
    hi_names = "、".join(r[0] for r in qrows if r[2] == hi)
    block("折扣横向对比",
          "买 QDII 基金，哪个渠道的申购费率最低？",
          """
SELECT c.channel_name, d.discount_rate,
       ROUND(p.purchase_fee_rate * d.discount_rate, 4) AS actual_rate_pct
FROM fund_fee_discount d
JOIN fund_channel c ON c.channel_code = d.channel_code
JOIN fund_product p ON p.fund_type = d.fund_type AND p.fund_code = '000041'
ORDER BY actual_rate_pct ASC;
""",
          "基准费率 1.60%%。最低 **%s%%**（1 折）：%s；最高 **%s%%**（不打折）：%s。" % (
              lo, lo_names, hi, hi_names),
          "折扣是**按基金类型**给的，不是按单只基金，所以要先取到 `fund_type` 再关联 `fund_fee_discount`。"
          "另外 5 个渠道并列最低，只答一个会漏。")

    w("## 附：批量冒烟脚本")
    w("")
    w("把上面 14 题逐条丢给智能体，按下表记分：")
    w("")
    w("| 题号 | 考点 | 结果 | 备注 |")
    w("| --- | --- | --- | --- |")
    for i, tag in enumerate(["单值查询", "枚举筛选", "区间排名", "时序点查", "规则分档",
                             "折扣 + 外扣", "多条件聚合", "多条件与", "按月聚合",
                             "跨列比较", "分组聚合", "非交易日", "暂停申购", "折扣对比"], start=1):
        w("| Q%d | %s | | |" % (i, tag))
    w("")
    w("通过线建议：**12/14 正确，且 Q5、Q6、Q7 三题必须正确**——这三题分别对应规则分档、费率口径、聚合过滤，")
    w("是真实客服问数里最容易出错的三个点。")
    w("")
    return "\n".join(L) + "\n"


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", default=os.path.join("docs", "smart_query_demo"))
    args = ap.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    files = {
        "fund_demo.sql": emit_sql(),
        "fund_demo_schema.md": emit_schema(),
        "fund_demo_qa.md": emit_qa(),
    }
    for name, content in files.items():
        path = os.path.join(args.out_dir, name)
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(content)
        print("%-24s %8.1f KB" % (name, len(content.encode("utf-8")) / 1024))

    print("\n交易日 %d 天（%s ~ %s）｜产品 %d ｜净值 %d 行｜订单 %d 笔" % (
        len(DAYS), FIRST_DAY, LAST_DAY, len(PRODUCTS),
        sum(len(v) for v in NAV.values()), len(ORDERS)))


if __name__ == "__main__":
    main()
