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

package service

import (
	"context"
	"errors"
	"time"

	"ragflow/internal/dao"
)

// ErrTenantNotFound indicates the current user has no tenant relation.
var ErrTenantNotFound = errors.New("Tenant not found!")

// StatPoint matches the frontend [date, value] tuple shape.
type StatPoint [2]interface{}

type StatsService struct {
	userTenantDAO *dao.UserTenantDAO
}

// NewStatsService create stats service
func NewStatsService() *StatsService {
	return &StatsService{
		userTenantDAO: dao.NewUserTenantDAO(),
	}
}

// StatsResponse matches Python GET /api/v1/system/stats response data.
type StatsResponse struct {
	PV      []StatPoint `json:"pv"`
	UV      []StatPoint `json:"uv"`
	Speed   []StatPoint `json:"speed"`
	Tokens  []StatPoint `json:"tokens"`
	Round   []StatPoint `json:"round"`
	ThumbUp []StatPoint `json:"thumb_up"`
}

// GetStats returns daily API conversation statistics for the first tenant of a user.
func (s *StatsService) GetStats(ctx context.Context, userID, fromDate, toDate string, source *string) (*StatsResponse, error) {
	tenants, err := s.userTenantDAO.GetByUserID(ctx, dao.DB, userID)
	if err != nil || len(tenants) == 0 {
		return nil, ErrTenantNotFound
	}

	rows, err := dao.NewAPI4ConversationDAO().Stats(ctx, dao.DB, tenants[0].TenantID, fromDate, toDate, source)
	if err != nil {
		return nil, err
	}

	response := &StatsResponse{
		PV:      make([]StatPoint, 0, len(rows)),
		UV:      make([]StatPoint, 0, len(rows)),
		Speed:   make([]StatPoint, 0, len(rows)),
		Tokens:  make([]StatPoint, 0, len(rows)),
		Round:   make([]StatPoint, 0, len(rows)),
		ThumbUp: make([]StatPoint, 0, len(rows)),
	}

	for _, row := range rows {
		response.PV = append(response.PV, StatPoint{row.Dt, row.PV})
		response.UV = append(response.UV, StatPoint{row.Dt, row.UV})
		response.Speed = append(response.Speed, StatPoint{row.Dt, row.Tokens / (row.Duration + 0.1)})
		response.Tokens = append(response.Tokens, StatPoint{row.Dt, row.Tokens / 1000.0})
		response.Round = append(response.Round, StatPoint{row.Dt, row.Round})
		response.ThumbUp = append(response.ThumbUp, StatPoint{row.Dt, row.ThumbUp})
	}

	return response, nil
}

// FeedbackStats 是网页端对话的点赞/点踩计数。
//
// 数据来自 conversation_message（网页聊天），不是 api_4_conversation（API 调用）。
// 口径：
//   Up   = thumb_up = 1
//   Down = thumb_up = 0 且 feedback 非空（前端「差评」要求填写反馈文案）
type FeedbackStats struct {
	Up   int64 `json:"up"`
	Down int64 `json:"down"`
}

// GetFeedbackStats counts thumb-up / thumb-down on assistant messages for a tenant.
func (s *StatsService) GetFeedbackStats(ctx context.Context, userID string) (*FeedbackStats, error) {
	tenants, err := s.userTenantDAO.GetByUserID(ctx, dao.DB, userID)
	if err != nil || len(tenants) == 0 {
		return nil, ErrTenantNotFound
	}
	tenantID := tenants[0].TenantID

	// conversation / conversation_message 都没有 tenant_id，必须经由
	// conversation -> dialog 关联到租户（见项目既有约定）。
	var row struct {
		Up   int64
		Down int64
	}
	err = dao.DB.WithContext(ctx).Raw(`
		SELECT
			COALESCE(SUM(CASE WHEN m.thumb_up = 1 THEN 1 ELSE 0 END), 0) AS up,
			COALESCE(SUM(CASE WHEN m.thumb_up = 0
				AND m.feedback IS NOT NULL AND m.feedback <> '' THEN 1 ELSE 0 END), 0) AS down
		FROM conversation_message m
		JOIN conversation c ON c.id = m.conversation_id
		JOIN dialog d ON d.id = c.dialog_id
		WHERE d.tenant_id = ? AND m.role = 'assistant'
	`, tenantID).Scan(&row).Error
	if err != nil {
		return nil, err
	}
	return &FeedbackStats{Up: row.Up, Down: row.Down}, nil
}

// UserActivityStats 是总览页「用户活跃度」卡片的数据。
//
// 口径：
//
//	TotalUsers  = 租户下 status='1' 的成员数（含 owner，团队页只列非 owner，这里要算全）
//	ActiveUsers = 窗口期内「登录过」或「在本租户发起过会话」的成员数
//
// 为什么活跃要两个信号：last_login_time 只在登录时刷新，长期挂着会话、
// 靠 token 续期的用户不会被记到登录时间里；而网页对话又会真实产生
// conversation 记录。两者取并集，才不至于把天天在用的人算成不活跃。
// 并集用 UNION 去重，避免同一个人被算两次。
type UserActivityStats struct {
	TotalUsers  int64 `json:"total_users"`
	ActiveUsers int64 `json:"active_users"`
	Days        int   `json:"days"`
}

// defaultUserActivityDays 是「活跃」的默认回看天数，与总览页其他卡片一致。
const defaultUserActivityDays = 7

// GetUserActivity 统计当前租户的总用户数与活跃用户数。
func (s *StatsService) GetUserActivity(ctx context.Context, userID string, days int) (*UserActivityStats, error) {
	tenants, err := s.userTenantDAO.GetByUserID(ctx, dao.DB, userID)
	if err != nil || len(tenants) == 0 {
		return nil, ErrTenantNotFound
	}
	tenantID := tenants[0].TenantID
	if days <= 0 || days > 365 {
		days = defaultUserActivityDays
	}

	// 活跃窗口：自然日回退，避免「7 天」被理解成 168 小时导致边界抖动。
	cutoff := time.Now().AddDate(0, 0, -days)

	var total int64
	err = dao.DB.WithContext(ctx).Raw(`
		SELECT COUNT(*)
		FROM user_tenant ut
		JOIN user u ON u.id = ut.user_id
		WHERE ut.tenant_id = ? AND ut.status = '1'
	`, tenantID).Scan(&total).Error
	if err != nil {
		return nil, err
	}

	// conversation.create_time 是毫秒时间戳，不能直接和 cutoff 比较。
	// 第二个分支再 join 一次 user_tenant，保证活跃用户一定是本租户成员，
	// 不满足「活跃 <= 总数」的人在卡片上会变成 8/5 这种坏数据。
	var active int64
	err = dao.DB.WithContext(ctx).Raw(`
		SELECT COUNT(*) FROM (
			SELECT ut.user_id
			FROM user_tenant ut
			JOIN user u ON u.id = ut.user_id
			WHERE ut.tenant_id = ? AND ut.status = '1' AND u.last_login_time >= ?
			UNION
			SELECT DISTINCT c.user_id
			FROM conversation c
			JOIN dialog d ON d.id = c.dialog_id
			JOIN user_tenant ut2
			  ON ut2.user_id = c.user_id AND ut2.tenant_id = d.tenant_id AND ut2.status = '1'
			WHERE d.tenant_id = ?
			  AND c.create_time >= ?
			  AND c.user_id IS NOT NULL AND c.user_id <> ''
		) active_users
	`, tenantID, cutoff, tenantID, cutoff.UnixMilli()).Scan(&active).Error
	if err != nil {
		return nil, err
	}

	return &UserActivityStats{TotalUsers: total, ActiveUsers: active, Days: days}, nil
}

// HotQuestions 返回知识搜索首页的「热门问题」。
//
// 数据源是真实聊天记录里的用户提问（conversation_message.role='user'），
// 按出现次数排序。过滤掉寒暄与过短的句子，否则「你好」会常年霸榜。
func (s *StatsService) HotQuestions(ctx context.Context, userID string, limit int) ([]string, error) {
	tenants, err := s.userTenantDAO.GetByUserID(ctx, dao.DB, userID)
	if err != nil || len(tenants) == 0 {
		return nil, ErrTenantNotFound
	}
	tenantID := tenants[0].TenantID
	if limit <= 0 || limit > 20 {
		limit = 4
	}

	type row struct {
		Q string
		C int64
	}
	var rows []row
	err = dao.DB.WithContext(ctx).Raw(`
		SELECT TRIM(m.content) AS q, COUNT(*) AS c
		FROM conversation_message m
		JOIN conversation c ON c.id = m.conversation_id
		JOIN dialog d ON d.id = c.dialog_id
		WHERE d.tenant_id = ?
		  AND m.role = 'user'
		  AND CHAR_LENGTH(TRIM(m.content)) BETWEEN 5 AND 40
		  AND TRIM(m.content) NOT IN ('你好', '您好', 'hi', 'hello', '在吗', '谢谢', '测试')
		GROUP BY TRIM(m.content)
		ORDER BY c DESC, MAX(m.created_at) DESC
		LIMIT ?
	`, tenantID, limit).Scan(&rows).Error
	if err != nil {
		return nil, err
	}

	questions := make([]string, 0, len(rows))
	for _, r := range rows {
		if r.Q != "" {
			questions = append(questions, r.Q)
		}
	}
	return questions, nil
}
