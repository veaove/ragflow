/*
 *  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

package service

import (
	"context"
	"errors"
	"sort"
	"time"

	"ragflow/internal/dao"
	"ragflow/internal/entity"
)

// ErrAnalyticsNotFound is returned when a session id does not belong to the
// caller's tenant, or does not exist in the requested chain.
var ErrAnalyticsNotFound = errors.New("consultation not found")

// ConsultationFilter describes a consultation log query.
type ConsultationFilter struct {
	From       int64 // UnixMilli, inclusive
	To         int64 // UnixMilli, inclusive
	AppID      string
	Rating     string // good / bad / none / "" (any)
	Keyword    string
	CustomerID string
	Page       int
	Size       int
}

// AnalyticsService merges the chat pipeline and agent canvas chains into one
// consultation view. Both chains keep their own tables; this layer is the only
// place that knows about that split.
type AnalyticsService struct {
	dao *dao.AnalyticsDAO
}

// NewAnalyticsService builds the analytics service.
func NewAnalyticsService() *AnalyticsService {
	return &AnalyticsService{dao: dao.NewAnalyticsDAO()}
}

func normalizePage(page, size int) (int, int) {
	if page < 1 {
		page = 1
	}
	if size < 1 {
		size = 20
	}
	if size > 200 {
		size = 200
	}
	return page, size
}

// ListConsultations returns a merged, time-ordered page of sessions.
//
// Each chain is queried for its first (offset+limit) rows rather than only its
// own page, because the merged order can interleave the two chains arbitrarily;
// slicing after the merge is the only way to get a correct global page.
func (s *AnalyticsService) ListConsultations(ctx context.Context, tenantID string, f ConsultationFilter) ([]entity.ConsultationLogItem, int64, error) {
	if dao.DB == nil {
		return nil, 0, errors.New("database not ready")
	}
	page, size := normalizePage(f.Page, f.Size)

	chatTotal, err := s.dao.CountChatSessions(ctx, dao.DB, tenantID, f.From, f.To, f.AppID)
	if err != nil {
		return nil, 0, err
	}
	canvasTotal, err := s.dao.CountCanvasSessions(ctx, dao.DB, tenantID, f.From, f.To, f.AppID)
	if err != nil {
		return nil, 0, err
	}
	total := chatTotal + canvasTotal
	if total == 0 {
		return []entity.ConsultationLogItem{}, 0, nil
	}

	need := page * size
	chatItems, err := s.dao.ListChatSessions(ctx, dao.DB, tenantID, f.From, f.To, f.AppID, f.Keyword, f.Rating, 0, need)
	if err != nil {
		return nil, 0, err
	}
	canvasItems, err := s.dao.ListCanvasSessions(ctx, dao.DB, tenantID, f.From, f.To, f.AppID, f.Keyword, f.Rating, 0, need)
	if err != nil {
		return nil, 0, err
	}

	items := make([]entity.ConsultationLogItem, 0, len(chatItems)+len(canvasItems))
	if f.CustomerID == "" {
		items = append(items, chatItems...)
		items = append(items, canvasItems...)
	} else {
		for _, it := range chatItems {
			if it.CustomerID == f.CustomerID {
				items = append(items, it)
			}
		}
		for _, it := range canvasItems {
			if it.CustomerID == f.CustomerID {
				items = append(items, it)
			}
		}
	}

	sort.SliceStable(items, func(i, j int) bool { return items[i].StartTime > items[j].StartTime })

	start := (page - 1) * size
	if start >= len(items) {
		return []entity.ConsultationLogItem{}, total, nil
	}
	end := start + size
	if end > len(items) {
		end = len(items)
	}
	return items[start:end], total, nil
}

// GetDetail returns the transcript of one session.
func (s *AnalyticsService) GetDetail(ctx context.Context, tenantID, chain, sessionID string) (*entity.ConsultationDetail, error) {
	if dao.DB == nil {
		return nil, errors.New("database not ready")
	}
	var (
		detail *entity.ConsultationDetail
		err    error
	)
	switch chain {
	case entity.AnalyticsChainCanvas:
		detail, err = s.dao.GetCanvasDetail(ctx, dao.DB, tenantID, sessionID)
	default:
		detail, err = s.dao.GetChatDetail(ctx, dao.DB, tenantID, sessionID)
	}
	if err != nil {
		return nil, ErrAnalyticsNotFound
	}
	return detail, nil
}

// totalsFor merges the two chains into a single totals block.
type mergedTotals struct {
	consultations int
	customers     int
	chatMS        float64
	canvasMS      float64
	good          int64
	rated         int64
	success       int64
	runs          int64
	rounds        float64
}

func (s *AnalyticsService) totalsFor(ctx context.Context, tenantID string, from, to int64, appID string) (*mergedTotals, error) {
	chat, err := s.dao.TotalsChat(ctx, dao.DB, tenantID, from, to, appID)
	if err != nil {
		return nil, err
	}
	canvas, err := s.dao.TotalsCanvas(ctx, dao.DB, tenantID, from, to, appID)
	if err != nil {
		return nil, err
	}
	customers, err := s.dao.CountDistinctCustomers(ctx, dao.DB, tenantID, from, to, appID)
	if err != nil {
		return nil, err
	}
	success, runs, err := s.dao.CountSuccessRuns(ctx, dao.DB, tenantID, from, to, appID)
	if err != nil {
		return nil, err
	}

	out := &mergedTotals{
		consultations: int(chat.Sessions + canvas.Sessions),
		customers:     int(customers),
		chatMS:        chat.AvgMS,
		canvasMS:      canvas.AvgMS,
		good:          chat.Good + canvas.Good,
		rated:         chat.Rated + canvas.Rated,
		success:       success,
		runs:          runs,
	}
	sessionCount := chat.Sessions + canvas.Sessions
	if sessionCount > 0 {
		out.rounds = (chat.Rounds*float64(chat.Sessions) + canvas.Rounds*float64(canvas.Sessions)) /
			float64(sessionCount)
	}
	return out, nil
}

func rateOrNil(good, rated int64) *float64 {
	if rated == 0 {
		return nil
	}
	v := float64(good) / float64(rated)
	return &v
}

func ratioOrNil(num, den int64) *float64 {
	if den == 0 {
		return nil
	}
	v := float64(num) / float64(den)
	return &v
}

func deltaOrNil(current, previous float64) *float64 {
	if previous == 0 {
		return nil
	}
	v := (current - previous) / previous
	return &v
}

// Stats returns the headline metrics for a window plus period-over-period
// deltas against the immediately preceding window of the same length.
func (s *AnalyticsService) Stats(ctx context.Context, tenantID string, from, to int64, appID string) (*entity.AnalyticsStats, error) {
	if dao.DB == nil {
		return nil, errors.New("database not ready")
	}
	cur, err := s.totalsFor(ctx, tenantID, from, to, appID)
	if err != nil {
		return nil, err
	}

	span := to - from
	prev, err := s.totalsFor(ctx, tenantID, from-span, from-1, appID)
	if err != nil {
		// A missing previous window must not fail the request; deltas simply
		// stay absent.
		prev = &mergedTotals{}
	}

	stats := &entity.AnalyticsStats{
		From: from,
		To:   to,
		Metrics: entity.AnalyticsMetrics{
			Consultations: cur.consultations,
			Customers:     cur.customers,
			ResponseMS: entity.AnalyticsResponseMetrics{
				Chat:   positiveOrNil(cur.chatMS),
				Canvas: positiveOrNil(cur.canvasMS),
			},
			GoodRate:    rateOrNil(cur.good, cur.rated),
			SuccessRate: ratioOrNil(cur.success, cur.runs),
			AvgRounds:   round1(cur.rounds),
			BadCount:    int(cur.rated - cur.good),
		},
	}
	stats.Deltas.Consultations = deltaOrNil(float64(cur.consultations), float64(prev.consultations))
	stats.Deltas.Customers = deltaOrNil(float64(cur.customers), float64(prev.customers))

	curGood, prevGood := rateOrNil(cur.good, cur.rated), rateOrNil(prev.good, prev.rated)
	if curGood != nil && prevGood != nil {
		v := *curGood - *prevGood
		stats.Deltas.GoodRate = &v
	}
	curSucc, prevSucc := ratioOrNil(cur.success, cur.runs), ratioOrNil(prev.success, prev.runs)
	if curSucc != nil && prevSucc != nil {
		v := *curSucc - *prevSucc
		stats.Deltas.SuccessRate = &v
	}
	return stats, nil
}

// positiveOrNil returns nil for a zero measurement so the UI can render a dash
// instead of an authoritative-looking "0s".
func positiveOrNil(v float64) *float64 {
	if v <= 0 {
		return nil
	}
	r := round1(v)
	return &r
}

func round1(v float64) float64 {
	return float64(int64(v*10+0.5)) / 10
}

// Trend returns a per-day series for both chains merged by date.
func (s *AnalyticsService) Trend(ctx context.Context, tenantID string, from, to int64, appID string) (*entity.AnalyticsTrend, error) {
	if dao.DB == nil {
		return nil, errors.New("database not ready")
	}
	chatRows, err := s.dao.TrendChat(ctx, dao.DB, tenantID, from, to, appID)
	if err != nil {
		return nil, err
	}
	canvasRows, err := s.dao.TrendCanvas(ctx, dao.DB, tenantID, from, to, appID)
	if err != nil {
		return nil, err
	}

	type acc struct {
		sessions  int64
		customers int64
		good      int64
		rated     int64
	}
	byDay := map[string]*acc{}
	add := func(day string, sessions, customers, good, rated int64) {
		a, ok := byDay[day]
		if !ok {
			a = &acc{}
			byDay[day] = a
		}
		a.sessions += sessions
		a.customers += customers
		a.good += good
		a.rated += rated
	}
	for _, r := range chatRows {
		add(r.Day, r.Sessions, r.Customers, r.Good, r.Rated)
	}
	for _, r := range canvasRows {
		add(r.Day, r.Sessions, r.Customers, r.Good, r.Rated)
	}

	days := make([]string, 0, len(byDay))
	for d := range byDay {
		days = append(days, d)
	}
	sort.Strings(days)

	out := &entity.AnalyticsTrend{Points: make([]entity.AnalyticsTrendPoint, 0, len(days))}
	for _, d := range days {
		a := byDay[d]
		out.Points = append(out.Points, entity.AnalyticsTrendPoint{
			Date:          d,
			Consultations: int(a.sessions),
			Customers:     int(a.customers),
			GoodRate:      rateOrNil(a.good, a.rated),
		})
	}
	return out, nil
}

// Apps returns the per-app breakdown. Rows from both chains with the same app
// id are merged so one app never appears twice.
func (s *AnalyticsService) Apps(ctx context.Context, tenantID string, from, to int64) (*entity.AnalyticsAppStats, error) {
	if dao.DB == nil {
		return nil, errors.New("database not ready")
	}
	chatRows, err := s.dao.AppsChat(ctx, dao.DB, tenantID, from, to)
	if err != nil {
		return nil, err
	}
	canvasRows, err := s.dao.AppsCanvas(ctx, dao.DB, tenantID, from, to)
	if err != nil {
		return nil, err
	}
	// Ratings live in the message tables, so they need their own per-app pass;
	// the session-level queries above cannot produce them.
	chatRates, err := s.dao.AppRatesChat(ctx, dao.DB, tenantID, from, to)
	if err != nil {
		return nil, err
	}
	canvasRates, err := s.dao.AppRatesCanvas(ctx, dao.DB, tenantID, from, to)
	if err != nil {
		return nil, err
	}

	type acc struct {
		name      string
		chain     string
		sessions  int64
		customers int64
		msSum     float64
		msCount   int64
		good      int64
		rated     int64
	}
	byApp := map[string]*acc{}
	get := func(id, name, chain string) *acc {
		a, ok := byApp[id]
		if !ok {
			a = &acc{name: name, chain: chain}
			byApp[id] = a
		}
		if a.name == "" {
			a.name = name
		}
		return a
	}
	for _, r := range chatRows {
		a := get(r.AppID, r.AppName, entity.AnalyticsChainChat)
		a.sessions += r.Sessions
		a.customers += r.Customers
	}
	for _, r := range chatRates {
		a := get(r.AppID, "", entity.AnalyticsChainChat)
		a.good += r.Good
		a.rated += r.Rated
	}
	for _, r := range canvasRows {
		a := get(r.AppID, r.AppName, entity.AnalyticsChainCanvas)
		a.sessions += r.Sessions
		a.customers += r.Customers
		if r.AvgMS > 0 {
			a.msSum += r.AvgMS * float64(r.Sessions)
			a.msCount += r.Sessions
		}
		a.good += r.Good
		a.rated += r.Rated
	}
	for _, r := range canvasRates {
		a := get(r.AppID, "", entity.AnalyticsChainCanvas)
		a.good += r.Good
		a.rated += r.Rated
	}

	out := &entity.AnalyticsAppStats{Rows: make([]entity.AnalyticsAppRow, 0, len(byApp))}
	for id, a := range byApp {
		row := entity.AnalyticsAppRow{
			AppID:         id,
			AppName:       a.name,
			Chain:         a.chain,
			Consultations: int(a.sessions),
			Customers:     int(a.customers),
			GoodRate:      rateOrNil(a.good, a.rated),
		}
		if a.msCount > 0 {
			row.ResponseMS = round1(a.msSum / float64(a.msCount))
		}
		out.Rows = append(out.Rows, row)
	}
	sort.SliceStable(out.Rows, func(i, j int) bool {
		return out.Rows[i].Consultations > out.Rows[j].Consultations
	})
	return out, nil
}

// DefaultRange resolves a from/to pair from optional date strings.
//
// Both bounds are inclusive at day granularity so a dashboard default of
// "last 7 days" covers today and the six preceding days.
func DefaultRange(fromStr, toStr string) (int64, int64) {
	now := time.Now()
	end := time.Date(now.Year(), now.Month(), now.Day(), 23, 59, 59, 0, now.Location())
	start := end.AddDate(0, 0, -6)

	if t, err := time.ParseInLocation("2006-01-02", fromStr, now.Location()); err == nil {
		start = t
	}
	if t, err := time.ParseInLocation("2006-01-02", toStr, now.Location()); err == nil {
		end = t.Add(24*time.Hour - time.Millisecond)
	}
	if start.After(end) {
		start, end = end.AddDate(0, 0, -6), end
	}
	return start.UnixMilli(), end.UnixMilli()
}
