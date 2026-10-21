// Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package dao

import (
	"context"

	"gorm.io/gorm"

	"ragflow/internal/entity"
)

// LatestUserMessage returns the most recent user question of one conversation.
// Used by the hover bubble, which needs the paired answer as well.
type LatestUserMessage struct {
	ConversationID string `gorm:"column:conversation_id"`
	Position       int64  `gorm:"column:position"`
	Content        string `gorm:"column:content"`
}

// LatestSessionPreview is one conversation's most recent user question.
// The list only needs this (truncated), so the answer is deliberately not
// loaded here — see FetchSessionConversation for the hover payload.
type LatestSessionPreview struct {
	ConversationID string
	Question       string
	Position       int64
}

// FetchSessionPreviews returns the latest user question for each conversation.
//
// One query for the whole page: a per-row lookup would be the classic N+1 that
// makes the memory table feel slow (the list can hold 20-50 rows).
func FetchSessionPreviews(
	ctx context.Context,
	db *gorm.DB,
	conversationIDs []string,
) (map[string]*LatestSessionPreview, error) {
	out := make(map[string]*LatestSessionPreview, len(conversationIDs))
	if len(conversationIDs) == 0 || db == nil {
		return out, nil
	}

	var rows []LatestUserMessage
	err := db.WithContext(ctx).
		Model(&entity.ConversationMessage{}).
		Select("conversation_id, position, content").
		Where("conversation_id IN ?", conversationIDs).
		Where("role = ?", "user").
		Where(
			"(conversation_id, position) IN (?)",
			db.Model(&entity.ConversationMessage{}).
				Select("conversation_id, MAX(position)").
				Where("conversation_id IN ?", conversationIDs).
				Where("role = ?", "user").
				Group("conversation_id"),
		).
		Find(&rows).Error
	if err != nil {
		return nil, err
	}

	for _, row := range rows {
		out[row.ConversationID] = &LatestSessionPreview{
			ConversationID: row.ConversationID,
			Question:       row.Content,
			Position:       row.Position,
		}
	}
	return out, nil
}

// FetchSessionConversation returns the latest user question and the assistant
// answer at the following position. Called on hover only (lazy loading), so a
// slightly heavier two-step lookup is acceptable here.
func FetchSessionConversation(
	ctx context.Context,
	db *gorm.DB,
	conversationID string,
) (question string, answer string, err error) {
	if db == nil || conversationID == "" {
		return "", "", nil
	}

	var latest []LatestUserMessage
	err = db.WithContext(ctx).
		Model(&entity.ConversationMessage{}).
		Select("conversation_id, position, content").
		Where("conversation_id = ?", conversationID).
		Where("role = ?", "user").
		Order("position DESC").
		Limit(1).
		Find(&latest).Error
	if err != nil {
		return "", "", err
	}
	if len(latest) == 0 {
		return "", "", nil
	}

	question = latest[0].Content
	position := latest[0].Position

	// The reply sits at the next position in practice; fall back to "the next
	// assistant message after the question" so a gap (retry/regenerate) still
	// surfaces something instead of an empty bubble.
	var replies []LatestUserMessage
	err = db.WithContext(ctx).
		Model(&entity.ConversationMessage{}).
		Select("conversation_id, position, content").
		Where("conversation_id = ?", conversationID).
		Where("role = ?", "assistant").
		Where("position > ?", position).
		Order("position ASC").
		Limit(1).
		Find(&replies).Error
	if err != nil {
		return question, "", err
	}
	if len(replies) > 0 {
		answer = replies[0].Content
	}
	return question, answer, nil
}

// SearchSessionIDsByContent returns conversation ids whose messages contain
// the keyword, so list search can hit conversation text and not just memory
// content (requirement: 顶部搜索支持检索会话预览里的对话文本).
func SearchSessionIDsByContent(
	ctx context.Context,
	db *gorm.DB,
	keyword string,
	limit int,
) ([]string, error) {
	if db == nil || keyword == "" {
		return nil, nil
	}
	if limit <= 0 {
		limit = 500
	}
	var ids []string
	err := db.WithContext(ctx).
		Model(&entity.ConversationMessage{}).
		Distinct("conversation_id").
		Where("content LIKE ?", "%"+keyword+"%").
		Limit(limit).
		Pluck("conversation_id", &ids).Error
	if err != nil {
		return nil, err
	}
	return ids, nil
}
