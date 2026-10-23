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
