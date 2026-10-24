//
//  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
//
//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.
//

package admin

import (
	"context"
	"time"

	"gorm.io/gorm"

	"ragflow/internal/dao"
)

// overviewWindowDays 运营概览的统计窗口，含今天共 30 天。
const overviewWindowDays = 30

// OverviewMetric 单项指标。
//
// Prev 是「窗口起点时的存量」（即 30 天前的值），前端用它算环比。
// 为 0 时前端不展示涨跌幅——否则每个新平台都会显示 +∞%。
type OverviewMetric struct {
	Value int64 `json:"value"`
	Prev  int64 `json:"prev"`
}

// OverviewPoint 趋势序列的一个点，Date 固定为 YYYY-MM-DD（本地时区）。
type OverviewPoint struct {
	Date  string `json:"date"`
	Value int64  `json:"value"`
}

// PlatformOverview 平台级运营概览。
//
// 口径说明（都按「平台全量」，不区分租户）：
//   - Tenants              tenant 全表
//   - ActiveTenants        近 30 天产生过会话的租户数（conversation join dialog 取 tenant_id）
//   - Members              user 全表
//   - Datasets             knowledgebase 中 status='1'
//   - Documents            document 中 status='1'
//   - ActiveConversations  近 24 小时有更新的会话数
//
// 不提供「Token 用量」：当前 schema 里 tenant_llm.used_tokens 无任何写入方
// （现网整表为空），agent_run 的 prompt/completion_tokens 也恒为 0。
// 与其放一个永远 0 的卡片，不如先不占位，等用量记账落地再加。
type PlatformOverview struct {
	Tenants             OverviewMetric `json:"tenants"`
	ActiveTenants       OverviewMetric `json:"active_tenants"`
	Members             OverviewMetric `json:"members"`
	Datasets            OverviewMetric `json:"datasets"`
	Documents           OverviewMetric `json:"documents"`
	ActiveConversations OverviewMetric `json:"active_conversations"`
	// TenantTrend 近 30 天租户存量（累计值），按天补齐。
	TenantTrend []OverviewPoint `json:"tenant_trend"`
	// ConversationTrend 近 30 天每日新增会话数，按天补齐。
	ConversationTrend []OverviewPoint `json:"conversation_trend"`
	WindowDays        int             `json:"window_days"`
}

// GetPlatformOverview 汇总运营概览所需的全部指标与趋势。
//
// 全部是只读聚合查询，不做缓存：管理端访问频率低，实时值比命中率重要。
func (s *Service) GetPlatformOverview(ctx context.Context) (*PlatformOverview, error) {
	db := dao.DB.WithContext(ctx)

	// 以「今天 0 点」为锚点，避免每次请求因为时分秒不同而把窗口切得前后不一。
	now := time.Now()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	windowStart := today.AddDate(0, 0, -(overviewWindowDays - 1))
	prevStart := windowStart.AddDate(0, 0, -overviewWindowDays)
	tomorrow := today.AddDate(0, 0, 1)
	last24h := now.Add(-24 * time.Hour)
	prev24h := now.Add(-48 * time.Hour)
	last30d := now.AddDate(0, 0, -overviewWindowDays)
	prev30d := now.AddDate(0, 0, -2*overviewWindowDays)

	out := &PlatformOverview{WindowDays: overviewWindowDays}

	var err error
	if out.Tenants.Value, err = countOf(db, "SELECT COUNT(*) FROM tenant"); err != nil {
		return nil, err
	}
	if out.Tenants.Prev, err = countOf(db, "SELECT COUNT(*) FROM tenant WHERE create_date < ?", prevStart); err != nil {
		return nil, err
	}

	// 活跃租户：会话本身没有 tenant_id（见 AGENTS 里的表结构说明），只能经 dialog 回捞。
	const activeTenantsSQL = `SELECT COUNT(DISTINCT d.tenant_id)
		FROM conversation c JOIN dialog d ON d.id = c.dialog_id
		WHERE c.update_date >= ? AND c.update_date < ?`
	if out.ActiveTenants.Value, err = countOf(db, activeTenantsSQL, last30d, tomorrow); err != nil {
		return nil, err
	}
	if out.ActiveTenants.Prev, err = countOf(db, activeTenantsSQL, prev30d, last30d); err != nil {
		return nil, err
	}

	if out.Members.Value, err = countOf(db, "SELECT COUNT(*) FROM `user`"); err != nil {
		return nil, err
	}
	if out.Members.Prev, err = countOf(db, "SELECT COUNT(*) FROM `user` WHERE create_date < ?", prevStart); err != nil {
		return nil, err
	}

	if out.Datasets.Value, err = countOf(db, "SELECT COUNT(*) FROM knowledgebase WHERE status = '1'"); err != nil {
		return nil, err
	}
	if out.Datasets.Prev, err = countOf(db,
		"SELECT COUNT(*) FROM knowledgebase WHERE status = '1' AND create_date < ?", prevStart); err != nil {
		return nil, err
	}

	if out.Documents.Value, err = countOf(db, "SELECT COUNT(*) FROM document WHERE status = '1'"); err != nil {
		return nil, err
	}
	if out.Documents.Prev, err = countOf(db,
		"SELECT COUNT(*) FROM document WHERE status = '1' AND create_date < ?", prevStart); err != nil {
		return nil, err
	}

	const activeConvSQL = "SELECT COUNT(*) FROM conversation WHERE update_date >= ? AND update_date < ?"
	if out.ActiveConversations.Value, err = countOf(db, activeConvSQL, last24h, tomorrow); err != nil {
		return nil, err
	}
	if out.ActiveConversations.Prev, err = countOf(db, activeConvSQL, prev24h, last24h); err != nil {
		return nil, err
	}

	// 租户趋势画「存量」：起点取窗口前的累计数，再按天累加当天新增。
	baseTenants, err := countOf(db, "SELECT COUNT(*) FROM tenant WHERE create_date < ?", windowStart)
	if err != nil {
		return nil, err
	}
	tenantDaily, err := dailyCounts(db, "tenant", windowStart, tomorrow)
	if err != nil {
		return nil, err
	}
	out.TenantTrend = buildSeries(windowStart, overviewWindowDays, tenantDaily, baseTenants, true)

	convDaily, err := dailyCounts(db, "conversation", windowStart, tomorrow)
	if err != nil {
		return nil, err
	}
	out.ConversationTrend = buildSeries(windowStart, overviewWindowDays, convDaily, 0, false)

	return out, nil
}

// countOf 执行只返回一列的聚合查询。
func countOf(db *gorm.DB, query string, args ...interface{}) (int64, error) {
	var n int64
	if err := db.Raw(query, args...).Scan(&n).Error; err != nil {
		return 0, err
	}
	return n, nil
}

// dailyCounts 按天统计某张表的创建数量，返回 date(YYYY-MM-DD) → count。
//
// table 只接受调用方写死的常量表名，不接收外部输入，因此这里直接拼字符串。
func dailyCounts(db *gorm.DB, table string, start, end time.Time) (map[string]int64, error) {
	var rows []struct {
		Day   string `gorm:"column:day"`
		Total int64  `gorm:"column:total"`
	}

	query := "SELECT DATE_FORMAT(create_date, '%Y-%m-%d') AS day, COUNT(*) AS total" +
		" FROM " + table +
		" WHERE create_date IS NOT NULL AND create_date >= ? AND create_date < ?" +
		" GROUP BY day"

	if err := db.Raw(query, start, end).Scan(&rows).Error; err != nil {
		return nil, err
	}

	result := make(map[string]int64, len(rows))
	for _, row := range rows {
		result[row.Day] = row.Total
	}
	return result, nil
}

// buildSeries 把稀疏的按天统计补成连续的 N 天序列。
//
// 缺数据的那天必须补 0，否则 recharts 会把断点连成直线，看起来像「那天有量」。
// cumulative 为 true 时输出存量曲线（起点 base + 逐日累加），否则输出当日增量。
func buildSeries(start time.Time, days int, daily map[string]int64, base int64, cumulative bool) []OverviewPoint {
	series := make([]OverviewPoint, 0, days)
	running := base

	for i := 0; i < days; i++ {
		day := start.AddDate(0, 0, i).Format("2006-01-02")
		count := daily[day]

		if cumulative {
			running += count
			series = append(series, OverviewPoint{Date: day, Value: running})
			continue
		}

		series = append(series, OverviewPoint{Date: day, Value: count})
	}

	return series
}
