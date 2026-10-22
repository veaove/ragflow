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

package dao

import (
	"context"
	"ragflow/internal/entity"

	"gorm.io/gorm"
)

// AnalyticsDAO reads consultation records across both execution chains.
//
// The chat pipeline stores sessions in conversation/conversation_message while
// the agent canvas runtime stores them in api_4_conversation/
// api_4_conversation_message. Neither table carries tenant_id, so every query
// has to join its owner table to scope by tenant.
//
// The two chains do NOT share an owner table: chat sessions point at `dialog`,
// canvas sessions point at `user_canvas` (agent canvases have no dialog row).
// Joining dialog for canvas sessions returns zero rows, which is how the canvas
// half of every report silently disappeared. Time filtering uses create_time (Unix ms,
// always populated by the BaseModel hook) rather than create_date, which is
// NULL on rows written before that column existed.
type AnalyticsDAO struct{}

// NewAnalyticsDAO builds the analytics DAO.
func NewAnalyticsDAO() *AnalyticsDAO {
	return &AnalyticsDAO{}
}

// chatListRow mirrors one conversation row with its message aggregates.
type chatListRow struct {
	SessionID     string  `gorm:"column:session_id"`
	CustomerID    string  `gorm:"column:customer_id"`
	AppID         string  `gorm:"column:app_id"`
	AppName       string  `gorm:"column:app_name"`
	StartTime     int64   `gorm:"column:start_time"`
	Rounds        int     `gorm:"column:rounds"`
	FirstQuestion string  `gorm:"column:first_question"`
	DurationMS    int     `gorm:"column:duration_ms"`
	ThumbUp       *bool   `gorm:"column:thumb_up"`
	Feedback      *string `gorm:"column:feedback"`
}

// canvasListRow mirrors one api_4_conversation row.
type canvasListRow struct {
	SessionID     string  `gorm:"column:session_id"`
	CustomerID    string  `gorm:"column:customer_id"`
	AppID         string  `gorm:"column:app_id"`
	AppName       string  `gorm:"column:app_name"`
	StartTime     int64   `gorm:"column:start_time"`
	Rounds        int     `gorm:"column:rounds"`
	DurationMS    int     `gorm:"column:duration_ms"`
	FirstQuestion string  `gorm:"column:first_question"`
	ThumbUp       *bool   `gorm:"column:thumb_up"`
	Feedback      *string `gorm:"column:feedback"`
}

func ratingOf(thumbUp *bool) string {
	switch {
	case thumbUp == nil:
		return entity.AnalyticsRatingNone
	case *thumbUp:
		return entity.AnalyticsRatingGood
	default:
		return entity.AnalyticsRatingBad
	}
}

func strOf(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// CountChatSessions counts chat-chain sessions in the window.
func (d *AnalyticsDAO) CountChatSessions(ctx context.Context, db *gorm.DB, tenantID string, from, to int64, appID string) (int64, error) {
	var total int64
	q := db.WithContext(ctx).Table("conversation AS c").
		Joins("JOIN dialog AS d ON d.id = c.dialog_id AND d.tenant_id = ?", tenantID).
		Where("c.create_time >= ? AND c.create_time <= ?", from, to)
	if appID != "" {
		q = q.Where("c.dialog_id = ?", appID)
	}
	err := q.Count(&total).Error
	return total, err
}

// CountCanvasSessions counts canvas-chain sessions in the window.
func (d *AnalyticsDAO) CountCanvasSessions(ctx context.Context, db *gorm.DB, tenantID string, from, to int64, appID string) (int64, error) {
	var total int64
	q := db.WithContext(ctx).Table("api_4_conversation AS a").
		Joins("JOIN user_canvas AS u ON u.id = a.dialog_id AND u.user_id = ?", tenantID).
		Where("a.create_time >= ? AND a.create_time <= ?", from, to)
	if appID != "" {
		q = q.Where("a.dialog_id = ?", appID)
	}
	err := q.Count(&total).Error
	return total, err
}

// ListChatSessions returns one page of chat-chain sessions.
func (d *AnalyticsDAO) ListChatSessions(ctx context.Context, db *gorm.DB, tenantID string, from, to int64, appID, keyword, rating string, offset, limit int) ([]entity.ConsultationLogItem, error) {
	var rows []chatListRow
	q := db.WithContext(ctx).Table("conversation AS c").
		Select(`
			c.id AS session_id,
			COALESCE(c.user_id, '') AS customer_id,
			COALESCE(c.dialog_id, '') AS app_id,
			COALESCE(d.name, '') AS app_name,
			c.create_time AS start_time,
			(SELECT COUNT(*) FROM conversation_message m WHERE m.conversation_id = c.id) AS rounds,
			COALESCE((SELECT m.content FROM conversation_message m
				WHERE m.conversation_id = c.id AND m.role = 'user'
				ORDER BY m.position ASC LIMIT 1), '') AS first_question,
			COALESCE((SELECT m.duration_ms FROM conversation_message m
				WHERE m.conversation_id = c.id AND m.role = 'assistant' AND m.duration_ms > 0
				ORDER BY m.position DESC LIMIT 1), 0) AS duration_ms,
			(SELECT m.thumb_up FROM conversation_message m
				WHERE m.conversation_id = c.id AND m.role = 'assistant'
				ORDER BY m.position DESC LIMIT 1) AS thumb_up,
			(SELECT m.feedback FROM conversation_message m
				WHERE m.conversation_id = c.id AND m.role = 'assistant'
					AND m.feedback IS NOT NULL AND m.feedback <> ''
				ORDER BY m.position DESC LIMIT 1) AS feedback`).
		Joins("JOIN dialog AS d ON d.id = c.dialog_id AND d.tenant_id = ?", tenantID).
		Where("c.create_time >= ? AND c.create_time <= ?", from, to)
	if appID != "" {
		q = q.Where("c.dialog_id = ?", appID)
	}
	if keyword != "" {
		like := "%" + keyword + "%"
		q = q.Where(`EXISTS (
			SELECT 1 FROM conversation_message km
			WHERE km.conversation_id = c.id AND km.content LIKE ?)`, like)
	}
	switch rating {
	case entity.AnalyticsRatingGood:
		q = q.Where(`(SELECT m.thumb_up FROM conversation_message m
			WHERE m.conversation_id = c.id AND m.role = 'assistant'
			ORDER BY m.position DESC LIMIT 1) = 1`)
	case entity.AnalyticsRatingBad:
		q = q.Where(`(SELECT m.thumb_up FROM conversation_message m
			WHERE m.conversation_id = c.id AND m.role = 'assistant'
			ORDER BY m.position DESC LIMIT 1) = 0`)
	case entity.AnalyticsRatingNone:
		q = q.Where(`(SELECT m.thumb_up FROM conversation_message m
			WHERE m.conversation_id = c.id AND m.role = 'assistant'
			ORDER BY m.position DESC LIMIT 1) IS NULL`)
	}
	err := q.Order("c.create_time DESC").Limit(limit).Offset(offset).Scan(&rows).Error
	if err != nil {
		return nil, err
	}

	items := make([]entity.ConsultationLogItem, 0, len(rows))
	for _, r := range rows {
		items = append(items, entity.ConsultationLogItem{
			Chain:         entity.AnalyticsChainChat,
			SessionID:     r.SessionID,
			CustomerID:    r.CustomerID,
			AppID:         r.AppID,
			AppName:       r.AppName,
			StartTime:     r.StartTime,
			Rounds:        r.Rounds,
			Rating:        ratingOf(r.ThumbUp),
			Feedback:      strOf(r.Feedback),
			DurationMS:    r.DurationMS,
			FirstQuestion: r.FirstQuestion,
		})
	}
	return items, nil
}

// ListCanvasSessions returns one page of canvas-chain sessions.
func (d *AnalyticsDAO) ListCanvasSessions(ctx context.Context, db *gorm.DB, tenantID string, from, to int64, appID, keyword, rating string, offset, limit int) ([]entity.ConsultationLogItem, error) {
	var rows []canvasListRow
	q := db.WithContext(ctx).Table("api_4_conversation AS a").
		Select(`
			a.id AS session_id,
			COALESCE(a.user_id, '') AS customer_id,
			COALESCE(a.dialog_id, '') AS app_id,
			COALESCE(u.title, '') AS app_name,
			a.create_time AS start_time,
			COALESCE(a.round, 0) AS rounds,
			COALESCE(a.duration, 0) AS duration_ms,
			COALESCE((SELECT m.content FROM api_4_conversation_message m
				WHERE m.conversation_id = a.id AND m.role = 'user'
				ORDER BY m.position ASC LIMIT 1), '') AS first_question,
			(SELECT m.thumb_up FROM api_4_conversation_message m
				WHERE m.conversation_id = a.id AND m.role = 'assistant'
				ORDER BY m.position DESC LIMIT 1) AS thumb_up,
			(SELECT m.feedback FROM api_4_conversation_message m
				WHERE m.conversation_id = a.id AND m.role = 'assistant'
					AND m.feedback IS NOT NULL AND m.feedback <> ''
				ORDER BY m.position DESC LIMIT 1) AS feedback`).
		Joins("JOIN user_canvas AS u ON u.id = a.dialog_id AND u.user_id = ?", tenantID).
		Where("a.create_time >= ? AND a.create_time <= ?", from, to)
	if appID != "" {
		q = q.Where("a.dialog_id = ?", appID)
	}
	if keyword != "" {
		like := "%" + keyword + "%"
		q = q.Where(`EXISTS (
			SELECT 1 FROM api_4_conversation_message km
			WHERE km.conversation_id = a.id AND km.content LIKE ?)`, like)
	}
	switch rating {
	case entity.AnalyticsRatingGood:
		q = q.Where(`(SELECT m.thumb_up FROM api_4_conversation_message m
			WHERE m.conversation_id = a.id AND m.role = 'assistant'
			ORDER BY m.position DESC LIMIT 1) = 1`)
	case entity.AnalyticsRatingBad:
		q = q.Where(`(SELECT m.thumb_up FROM api_4_conversation_message m
			WHERE m.conversation_id = a.id AND m.role = 'assistant'
			ORDER BY m.position DESC LIMIT 1) = 0`)
	case entity.AnalyticsRatingNone:
		q = q.Where(`(SELECT m.thumb_up FROM api_4_conversation_message m
			WHERE m.conversation_id = a.id AND m.role = 'assistant'
			ORDER BY m.position DESC LIMIT 1) IS NULL`)
	}
	err := q.Order("a.create_time DESC").Limit(limit).Offset(offset).Scan(&rows).Error
	if err != nil {
		return nil, err
	}

	items := make([]entity.ConsultationLogItem, 0, len(rows))
	for _, r := range rows {
		items = append(items, entity.ConsultationLogItem{
			Chain:         entity.AnalyticsChainCanvas,
			SessionID:     r.SessionID,
			CustomerID:    r.CustomerID,
			AppID:         r.AppID,
			AppName:       r.AppName,
			StartTime:     r.StartTime,
			Rounds:        r.Rounds,
			Rating:        ratingOf(r.ThumbUp),
			Feedback:      strOf(r.Feedback),
			DurationMS:    r.DurationMS,
			FirstQuestion: r.FirstQuestion,
		})
	}
	return items, nil
}

// GetChatDetail returns the transcript of one chat-chain session.
func (d *AnalyticsDAO) GetChatDetail(ctx context.Context, db *gorm.DB, tenantID, sessionID string) (*entity.ConsultationDetail, error) {
	var head chatListRow
	err := db.WithContext(ctx).Table("conversation AS c").
		Select(`
			c.id AS session_id,
			COALESCE(c.user_id, '') AS customer_id,
			COALESCE(c.dialog_id, '') AS app_id,
			COALESCE(d.name, '') AS app_name,
			c.create_time AS start_time,
			(SELECT COUNT(*) FROM conversation_message m WHERE m.conversation_id = c.id) AS rounds`).
		Joins("JOIN dialog AS d ON d.id = c.dialog_id AND d.tenant_id = ?", tenantID).
		Where("c.id = ?", sessionID).
		Take(&head).Error
	if err != nil {
		return nil, err
	}

	var msgs []entity.ConversationMessage
	if err := db.WithContext(ctx).
		Where("conversation_id = ?", sessionID).
		Order("position ASC").
		Find(&msgs).Error; err != nil {
		return nil, err
	}

	detail := &entity.ConsultationDetail{
		Chain:      entity.AnalyticsChainChat,
		SessionID:  head.SessionID,
		CustomerID: head.CustomerID,
		AppID:      head.AppID,
		AppName:    head.AppName,
		StartTime:  head.StartTime,
		Rounds:     head.Rounds,
	}
	for _, m := range msgs {
		turn := entity.ConsultationTurn{
			Position: m.Position,
			Role:     strOf(m.Role),
			Content:  strOf(m.Content),
			ThumbUp:  m.ThumbUp,
			Feedback: strOf(m.Feedback),
		}
		if m.DurationMS > 0 {
			turn.DurationMS = m.DurationMS
			detail.DurationMS += m.DurationMS
		}
		if m.CreatedAt != nil {
			turn.CreatedAt = *m.CreatedAt
		}
		detail.Turns = append(detail.Turns, turn)
	}
	return detail, nil
}

// GetCanvasDetail returns the transcript of one canvas-chain session.
func (d *AnalyticsDAO) GetCanvasDetail(ctx context.Context, db *gorm.DB, tenantID, sessionID string) (*entity.ConsultationDetail, error) {
	var head canvasListRow
	err := db.WithContext(ctx).Table("api_4_conversation AS a").
		Select(`
			a.id AS session_id,
			COALESCE(a.user_id, '') AS customer_id,
			COALESCE(a.dialog_id, '') AS app_id,
			COALESCE(u.title, '') AS app_name,
			a.create_time AS start_time,
			COALESCE(a.round, 0) AS rounds,
			COALESCE(a.duration, 0) AS duration_ms`).
		Joins("JOIN user_canvas AS u ON u.id = a.dialog_id AND u.user_id = ?", tenantID).
		Where("a.id = ?", sessionID).
		Take(&head).Error
	if err != nil {
		return nil, err
	}

	var msgs []entity.API4ConversationMessage
	if err := db.WithContext(ctx).
		Where("conversation_id = ?", sessionID).
		Order("position ASC").
		Find(&msgs).Error; err != nil {
		return nil, err
	}

	detail := &entity.ConsultationDetail{
		Chain:      entity.AnalyticsChainCanvas,
		SessionID:  head.SessionID,
		CustomerID: head.CustomerID,
		AppID:      head.AppID,
		AppName:    head.AppName,
		StartTime:  head.StartTime,
		Rounds:     head.Rounds,
		DurationMS: head.DurationMS,
	}
	for _, m := range msgs {
		turn := entity.ConsultationTurn{
			Position: m.Position,
			Role:     strOf(m.Role),
			Content:  strOf(m.Content),
			ThumbUp:  m.ThumbUp,
			Feedback: strOf(m.Feedback),
		}
		if m.CreatedAt != nil {
			turn.CreatedAt = *m.CreatedAt
		}
		detail.Turns = append(detail.Turns, turn)
	}
	return detail, nil
}

// AnalyticsTotals is the raw aggregate for one chain over a window.
type AnalyticsTotals struct {
	Sessions  int64   `gorm:"column:sessions"`
	Customers int64   `gorm:"column:customers"`
	AvgMS     float64 `gorm:"column:avg_ms"`
	Good      int64   `gorm:"column:good"`
	Rated     int64   `gorm:"column:rated"`
	Success   int64   `gorm:"column:success"`
	Rounds    float64 `gorm:"column:rounds"`
	Tokens    int64   `gorm:"column:tokens"`
}

// TotalsChat aggregates the chat chain over the window.
//
// Rate uses message-level thumb_up only: the conversation table has no
// session-level rating, and the canvas chain's session-level thumb_up (int) is
// a different scale, so mixing them would make the two chains incomparable.
func (d *AnalyticsDAO) TotalsChat(ctx context.Context, db *gorm.DB, tenantID string, from, to int64, appID string) (*AnalyticsTotals, error) {
	var out AnalyticsTotals
	q := db.WithContext(ctx).Table("conversation AS c").
		Select(`
			COUNT(DISTINCT c.id) AS sessions,
			COUNT(DISTINCT c.user_id) AS customers,
			0 AS avg_ms,
			0 AS good,
			0 AS rated,
			0 AS success,
			0 AS rounds,
			0 AS tokens`).
		Joins("JOIN dialog AS d ON d.id = c.dialog_id AND d.tenant_id = ?", tenantID).
		Where("c.create_time >= ? AND c.create_time <= ?", from, to)
	if appID != "" {
		q = q.Where("c.dialog_id = ?", appID)
	}
	if err := q.Scan(&out).Error; err != nil {
		return nil, err
	}

	// Message-level aggregates need a second pass because they live in another
	// table and are not derivable from the session row.
	type msgAgg struct {
		AvgMS  float64 `gorm:"column:avg_ms"`
		Good   int64   `gorm:"column:good"`
		Rated  int64   `gorm:"column:rated"`
		Rounds float64 `gorm:"column:rounds"`
	}
	var agg msgAgg
	aggQ := db.WithContext(ctx).Table("conversation_message AS m").
		Select(`
			COALESCE(AVG(CASE WHEN m.role = 'assistant' AND m.duration_ms > 0 THEN m.duration_ms END), 0) AS avg_ms,
			COALESCE(SUM(CASE WHEN m.role = 'assistant' AND m.thumb_up = 1 THEN 1 ELSE 0 END), 0) AS good,
			COALESCE(SUM(CASE WHEN m.role = 'assistant' AND m.thumb_up IS NOT NULL THEN 1 ELSE 0 END), 0) AS rated,
			COALESCE(COUNT(*) / NULLIF(COUNT(DISTINCT m.conversation_id), 0), 0) AS rounds`).
		Joins("JOIN conversation AS c ON c.id = m.conversation_id").
		Joins("JOIN dialog AS d ON d.id = c.dialog_id AND d.tenant_id = ?", tenantID).
		Where("c.create_time >= ? AND c.create_time <= ?", from, to)
	if appID != "" {
		aggQ = aggQ.Where("c.dialog_id = ?", appID)
	}
	if err := aggQ.Scan(&agg).Error; err != nil {
		return nil, err
	}

	out.AvgMS = agg.AvgMS
	out.Good = agg.Good
	out.Rated = agg.Rated
	out.Rounds = agg.Rounds
	return &out, nil
}

// TotalsCanvas aggregates the canvas chain over the window.
func (d *AnalyticsDAO) TotalsCanvas(ctx context.Context, db *gorm.DB, tenantID string, from, to int64, appID string) (*AnalyticsTotals, error) {
	var out AnalyticsTotals
	// api_4_conversation.duration / tokens are declared on the entity but never
	// written by the runtime (they are 0 on every row), so latency comes from
	// agent_run.duration_ms, which the canvas runtime does populate.
	q := db.WithContext(ctx).Table("api_4_conversation AS a").
		Select(`
			COUNT(DISTINCT a.id) AS sessions,
			COUNT(DISTINCT a.user_id) AS customers,
			0 AS avg_ms,
			0 AS good,
			0 AS rated,
			0 AS success,
			COALESCE(AVG(a.round), 0) AS rounds,
			0 AS tokens`).
		Joins("JOIN user_canvas AS u ON u.id = a.dialog_id AND u.user_id = ?", tenantID).
		Where("a.create_time >= ? AND a.create_time <= ?", from, to)
	if appID != "" {
		q = q.Where("a.dialog_id = ?", appID)
	}
	if err := q.Scan(&out).Error; err != nil {
		return nil, err
	}

	// Latency is measured per run, not per session: one session may trigger
	// several runs, and averaging them keeps slow retries visible.
	var avgMS float64
	latQ := db.WithContext(ctx).Table("agent_run").
		Select("COALESCE(AVG(duration_ms), 0)").
		Where("tenant_id = ? AND create_time >= ? AND create_time <= ? AND duration_ms > 0",
			tenantID, from, to)
	if appID != "" {
		latQ = latQ.Where("canvas_id = ?", appID)
	}
	if err := latQ.Scan(&avgMS).Error; err != nil {
		return nil, err
	}
	out.AvgMS = avgMS

	type msgAgg struct {
		Good  int64 `gorm:"column:good"`
		Rated int64 `gorm:"column:rated"`
	}
	var agg msgAgg
	aggQ := db.WithContext(ctx).Table("api_4_conversation_message AS m").
		Select(`
			COALESCE(SUM(CASE WHEN m.role = 'assistant' AND m.thumb_up = 1 THEN 1 ELSE 0 END), 0) AS good,
			COALESCE(SUM(CASE WHEN m.role = 'assistant' AND m.thumb_up IS NOT NULL THEN 1 ELSE 0 END), 0) AS rated`).
		Joins("JOIN api_4_conversation AS a ON a.id = m.conversation_id").
		Joins("JOIN user_canvas AS u ON u.id = a.dialog_id AND u.user_id = ?", tenantID).
		Where("a.create_time >= ? AND a.create_time <= ?", from, to)
	if appID != "" {
		aggQ = aggQ.Where("a.dialog_id = ?", appID)
	}
	if err := aggQ.Scan(&agg).Error; err != nil {
		return nil, err
	}
	out.Good, out.Rated = agg.Good, agg.Rated
	return &out, nil
}

// CountSuccessRuns counts succeeded agent runs, used for the success-rate tile.
// The chat chain has no run-status equivalent, so this metric is canvas-only.
func (d *AnalyticsDAO) CountSuccessRuns(ctx context.Context, db *gorm.DB, tenantID string, from, to int64, appID string) (success, total int64, err error) {
	type row struct {
		Success int64 `gorm:"column:success"`
		Total   int64 `gorm:"column:total"`
	}
	var r row
	q := db.WithContext(ctx).Table("agent_run").
		Select(`
			COALESCE(SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END), 0) AS success,
			COUNT(*) AS total`).
		Where("tenant_id = ? AND create_time >= ? AND create_time <= ?", tenantID, from, to)
	if appID != "" {
		q = q.Where("canvas_id = ?", appID)
	}
	if err = q.Scan(&r).Error; err != nil {
		return 0, 0, err
	}
	return r.Success, r.Total, nil
}

// TrendRow is one day of the merged trend series.
type TrendRow struct {
	Day       string `gorm:"column:day"`
	Sessions  int64  `gorm:"column:sessions"`
	Customers int64  `gorm:"column:customers"`
	Good      int64  `gorm:"column:good"`
	Rated     int64  `gorm:"column:rated"`
}

// TrendChat returns the daily trend for the chat chain.
func (d *AnalyticsDAO) TrendChat(ctx context.Context, db *gorm.DB, tenantID string, from, to int64, appID string) ([]TrendRow, error) {
	var rows []TrendRow
	q := db.WithContext(ctx).Table("conversation AS c").
		Select(`
			DATE_FORMAT(c.create_date, '%Y-%m-%d') AS day,
			COUNT(DISTINCT c.id) AS sessions,
			COUNT(DISTINCT c.user_id) AS customers,
			0 AS good,
			0 AS rated`).
		Joins("JOIN dialog AS d ON d.id = c.dialog_id AND d.tenant_id = ?", tenantID).
		Where("c.create_time >= ? AND c.create_time <= ?", from, to)
	if appID != "" {
		q = q.Where("c.dialog_id = ?", appID)
	}
	if err := q.Group("DATE_FORMAT(c.create_date, '%Y-%m-%d')").Order("day ASC").Scan(&rows).Error; err != nil {
		return nil, err
	}

	// Fold in the daily rating counts from the message table.
	type rateRow struct {
		Day   string `gorm:"column:day"`
		Good  int64  `gorm:"column:good"`
		Rated int64  `gorm:"column:rated"`
	}
	var rates []rateRow
	rateQ := db.WithContext(ctx).Table("conversation_message AS m").
		Select(`
			DATE_FORMAT(c.create_date, '%Y-%m-%d') AS day,
			COALESCE(SUM(CASE WHEN m.role = 'assistant' AND m.thumb_up = 1 THEN 1 ELSE 0 END), 0) AS good,
			COALESCE(SUM(CASE WHEN m.role = 'assistant' AND m.thumb_up IS NOT NULL THEN 1 ELSE 0 END), 0) AS rated`).
		Joins("JOIN conversation AS c ON c.id = m.conversation_id").
		Joins("JOIN dialog AS d ON d.id = c.dialog_id AND d.tenant_id = ?", tenantID).
		Where("c.create_time >= ? AND c.create_time <= ?", from, to)
	if appID != "" {
		rateQ = rateQ.Where("c.dialog_id = ?", appID)
	}
	if err := rateQ.Group("DATE_FORMAT(c.create_date, '%Y-%m-%d')").Scan(&rates).Error; err != nil {
		return nil, err
	}
	byDay := make(map[string]rateRow, len(rates))
	for _, r := range rates {
		byDay[r.Day] = r
	}
	for i := range rows {
		if r, ok := byDay[rows[i].Day]; ok {
			rows[i].Good, rows[i].Rated = r.Good, r.Rated
		}
	}
	return rows, nil
}

// TrendCanvas returns the daily trend for the canvas chain.
func (d *AnalyticsDAO) TrendCanvas(ctx context.Context, db *gorm.DB, tenantID string, from, to int64, appID string) ([]TrendRow, error) {
	var rows []TrendRow
	q := db.WithContext(ctx).Table("api_4_conversation AS a").
		Select(`
			DATE_FORMAT(a.create_date, '%Y-%m-%d') AS day,
			COUNT(DISTINCT a.id) AS sessions,
			COUNT(DISTINCT a.user_id) AS customers,
			0 AS good,
			0 AS rated`).
		Joins("JOIN user_canvas AS u ON u.id = a.dialog_id AND u.user_id = ?", tenantID).
		Where("a.create_time >= ? AND a.create_time <= ?", from, to)
	if appID != "" {
		q = q.Where("a.dialog_id = ?", appID)
	}
	if err := q.Group("DATE_FORMAT(a.create_date, '%Y-%m-%d')").Order("day ASC").Scan(&rows).Error; err != nil {
		return nil, err
	}

	type rateRow struct {
		Day   string `gorm:"column:day"`
		Good  int64  `gorm:"column:good"`
		Rated int64  `gorm:"column:rated"`
	}
	var rates []rateRow
	rateQ := db.WithContext(ctx).Table("api_4_conversation_message AS m").
		Select(`
			DATE_FORMAT(a.create_date, '%Y-%m-%d') AS day,
			COALESCE(SUM(CASE WHEN m.role = 'assistant' AND m.thumb_up = 1 THEN 1 ELSE 0 END), 0) AS good,
			COALESCE(SUM(CASE WHEN m.role = 'assistant' AND m.thumb_up IS NOT NULL THEN 1 ELSE 0 END), 0) AS rated`).
		Joins("JOIN api_4_conversation AS a ON a.id = m.conversation_id").
		Joins("JOIN user_canvas AS u ON u.id = a.dialog_id AND u.user_id = ?", tenantID).
		Where("a.create_time >= ? AND a.create_time <= ?", from, to)
	if appID != "" {
		rateQ = rateQ.Where("a.dialog_id = ?", appID)
	}
	if err := rateQ.Group("DATE_FORMAT(a.create_date, '%Y-%m-%d')").Scan(&rates).Error; err != nil {
		return nil, err
	}
	byDay := make(map[string]rateRow, len(rates))
	for _, r := range rates {
		byDay[r.Day] = r
	}
	for i := range rows {
		if r, ok := byDay[rows[i].Day]; ok {
			rows[i].Good, rows[i].Rated = r.Good, r.Rated
		}
	}
	return rows, nil
}

// AppRow is one per-app aggregate row before it is mapped to the entity type.
type AppRow struct {
	AppID     string  `gorm:"column:app_id"`
	AppName   string  `gorm:"column:app_name"`
	Sessions  int64   `gorm:"column:sessions"`
	Customers int64   `gorm:"column:customers"`
	AvgMS     float64 `gorm:"column:avg_ms"`
	Good      int64   `gorm:"column:good"`
	Rated     int64   `gorm:"column:rated"`
}

// AppsChat groups the chat chain by app.
func (d *AnalyticsDAO) AppsChat(ctx context.Context, db *gorm.DB, tenantID string, from, to int64) ([]AppRow, error) {
	var rows []AppRow
	err := db.WithContext(ctx).Table("conversation AS c").
		Select(`
			COALESCE(c.dialog_id, '') AS app_id,
			COALESCE(d.name, '') AS app_name,
			COUNT(DISTINCT c.id) AS sessions,
			COUNT(DISTINCT c.user_id) AS customers,
			0 AS avg_ms,
			0 AS good,
			0 AS rated`).
		Joins("JOIN dialog AS d ON d.id = c.dialog_id AND d.tenant_id = ?", tenantID).
		Where("c.create_time >= ? AND c.create_time <= ?", from, to).
		Group("c.dialog_id, d.name").
		Order("sessions DESC").
		Scan(&rows).Error
	return rows, err
}

// AppsCanvas groups the canvas chain by app.
func (d *AnalyticsDAO) AppsCanvas(ctx context.Context, db *gorm.DB, tenantID string, from, to int64) ([]AppRow, error) {
	var rows []AppRow
	// Latency comes from a run-level subquery for the same reason as TotalsCanvas.
	err := db.WithContext(ctx).Table("api_4_conversation AS a").
		Select(`
			COALESCE(a.dialog_id, '') AS app_id,
			COALESCE(u.title, '') AS app_name,
			COUNT(DISTINCT a.id) AS sessions,
			COUNT(DISTINCT a.user_id) AS customers,
			COALESCE(MAX(lat.avg_ms), 0) AS avg_ms,
			0 AS good,
			0 AS rated`).
		Joins("JOIN user_canvas AS u ON u.id = a.dialog_id AND u.user_id = ?", tenantID).
		Joins(`LEFT JOIN (
			SELECT canvas_id, AVG(duration_ms) AS avg_ms
			FROM agent_run
			WHERE duration_ms > 0 AND create_time >= ? AND create_time <= ?
			GROUP BY canvas_id
		) AS lat ON lat.canvas_id = a.dialog_id`, from, to).
		Where("a.create_time >= ? AND a.create_time <= ?", from, to).
		Group("a.dialog_id, u.title").
		Order("sessions DESC").
		Scan(&rows).Error
	return rows, err
}

// CountDistinctCustomers counts unique customers across BOTH chains.
//
// Counting each chain separately and adding the results would double-count a
// customer who consulted through a chat at one time and a chatflow at another,
// so the two user_id sets are merged before DISTINCT is applied. UNION (not
// UNION ALL) does the dedupe.
func (d *AnalyticsDAO) CountDistinctCustomers(ctx context.Context, db *gorm.DB, tenantID string, from, to int64, appID string) (int64, error) {
	chatQ := `
		SELECT c.user_id AS uid
		FROM conversation AS c
		JOIN dialog AS d ON d.id = c.dialog_id AND d.tenant_id = ?
		WHERE c.create_time >= ? AND c.create_time <= ? AND COALESCE(c.user_id, '') <> ''`
	// Canvas apps live in user_canvas, not dialog: agent canvases have no dialog
	// row at all, so the old JOIN dialog silently dropped every canvas session.
	canvasQ := `
		SELECT a.user_id AS uid
		FROM api_4_conversation AS a
		JOIN user_canvas AS u ON u.id = a.dialog_id AND u.user_id = ?
		WHERE a.create_time >= ? AND a.create_time <= ? AND COALESCE(a.user_id, '') <> ''`
	args := []any{tenantID, from, to, tenantID, from, to}
	if appID != "" {
		chatQ += " AND c.dialog_id = ?"
		canvasQ += " AND a.dialog_id = ?"
		args = append(args, appID, appID)
	}

	var total int64
	sql := "SELECT COUNT(*) FROM (" + chatQ + " UNION " + canvasQ + ") AS u"
	if err := db.WithContext(ctx).Raw(sql, args...).Scan(&total).Error; err != nil {
		return 0, err
	}
	return total, nil
}

// AppRate holds per-app rating counts for one chain.
type AppRate struct {
	AppID string `gorm:"column:app_id"`
	Good  int64  `gorm:"column:good"`
	Rated int64  `gorm:"column:rated"`
}

// AppRatesChat returns per-app message-level rating counts for the chat chain.
//
// Ratings live in conversation_message, not in conversation, so this cannot be
// folded into AppsChat's GROUP BY without a correlated subquery per row.
func (d *AnalyticsDAO) AppRatesChat(ctx context.Context, db *gorm.DB, tenantID string, from, to int64) ([]AppRate, error) {
	var rows []AppRate
	err := db.WithContext(ctx).Table("conversation_message AS m").
		Select(`
			COALESCE(c.dialog_id, '') AS app_id,
			COALESCE(SUM(CASE WHEN m.role = 'assistant' AND m.thumb_up = 1 THEN 1 ELSE 0 END), 0) AS good,
			COALESCE(SUM(CASE WHEN m.role = 'assistant' AND m.thumb_up IS NOT NULL THEN 1 ELSE 0 END), 0) AS rated`).
		Joins("JOIN conversation AS c ON c.id = m.conversation_id").
		Joins("JOIN dialog AS d ON d.id = c.dialog_id AND d.tenant_id = ?", tenantID).
		Where("c.create_time >= ? AND c.create_time <= ?", from, to).
		Group("c.dialog_id").
		Scan(&rows).Error
	return rows, err
}

// AppRatesCanvas returns per-app message-level rating counts for the canvas chain.
func (d *AnalyticsDAO) AppRatesCanvas(ctx context.Context, db *gorm.DB, tenantID string, from, to int64) ([]AppRate, error) {
	var rows []AppRate
	err := db.WithContext(ctx).Table("api_4_conversation_message AS m").
		Select(`
			COALESCE(a.dialog_id, '') AS app_id,
			COALESCE(SUM(CASE WHEN m.role = 'assistant' AND m.thumb_up = 1 THEN 1 ELSE 0 END), 0) AS good,
			COALESCE(SUM(CASE WHEN m.role = 'assistant' AND m.thumb_up IS NOT NULL THEN 1 ELSE 0 END), 0) AS rated`).
		Joins("JOIN api_4_conversation AS a ON a.id = m.conversation_id").
		Joins("JOIN user_canvas AS u ON u.id = a.dialog_id AND u.user_id = ?", tenantID).
		Where("a.create_time >= ? AND a.create_time <= ?", from, to).
		Group("a.dialog_id").
		Scan(&rows).Error
	return rows, err
}
