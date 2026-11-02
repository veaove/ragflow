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

package dao

import (
	"context"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"ragflow/internal/common"
	"ragflow/internal/entity"
)

// ChatSessionDAO chat session data access object
type ChatSessionDAO struct{}

type ListAgentSessionsParams struct {
	AgentID    string
	Page       int
	PageSize   int
	OrderBy    string
	Desc       bool
	SessionID  string
	UserID     string
	TenantID   string
	IncludeDSL bool
	NoHistory  bool
	Keywords   string
	FromDate   *time.Time
	ToDate     *time.Time
	ExpUserID  string
	// OwnerUserID 是授权边界，不是客户端筛选条件。
	//
	// UserID / ExpUserID 来自请求参数，只在传了值时生效（不传等于不限制）；
	// OwnerUserID 由服务层在判完「能否读整个画布」之后填入，非空时强制要求
	// 会话属于该用户。缺了它，「不传任何过滤条件」的请求会拿到该画布下
	// 所有人的会话。
	OwnerUserID string
}

// NewChatSessionDAO create chat session DAO
func NewChatSessionDAO() *ChatSessionDAO {
	return &ChatSessionDAO{}
}

// GetByID gets chat session by ID
func (dao *ChatSessionDAO) GetByID(ctx context.Context, db *gorm.DB, id string) (*entity.ChatSession, error) {
	var conv entity.ChatSession
	err := db.WithContext(ctx).Session(&gorm.Session{QueryFields: true}).Take(&conv, "id = ?", id).Error
	if err != nil {
		return nil, err
	}
	if err = hydrateChatSessions(ctx, db, []*entity.ChatSession{&conv}); err != nil {
		return nil, err
	}
	return &conv, nil
}

// GetBySessionIDAndChatID gets a chat session by session ID and chat ID.
func (dao *ChatSessionDAO) GetBySessionIDAndChatID(ctx context.Context, db *gorm.DB, sessionID, chatID string) (*entity.ChatSession, error) {
	var conv entity.ChatSession
	err := db.WithContext(ctx).Session(&gorm.Session{QueryFields: true}).Where("id = ? AND dialog_id = ?", sessionID, chatID).First(&conv).Error
	if err != nil {
		return nil, err
	}
	if err = hydrateChatSessions(ctx, db, []*entity.ChatSession{&conv}); err != nil {
		return nil, err
	}
	return &conv, nil
}

// Create creates a new chat session
func (dao *ChatSessionDAO) Create(ctx context.Context, db *gorm.DB, conv *entity.ChatSession) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(conv).Error; err != nil {
			return err
		}
		if err := createHistory(ctx, tx, conversationMessageTable, "message", conv.ID, conv.Message); err != nil {
			return err
		}
		return createHistory(ctx, tx, conversationReferenceTable, "reference", conv.ID, conv.Reference)
	})
}

// UpdateByID updates a chat session by ID
func (dao *ChatSessionDAO) UpdateByID(ctx context.Context, db *gorm.DB, id string, updates map[string]interface{}) error {
	if updates == nil {
		updates = make(map[string]interface{})
	}

	historyUpdate, targeted := updates["history_update"].(ConversationHistoryUpdate)
	delete(updates, "history_update")
	for key := range updates {
		switch key {
		case "message", "Message", "messages", "Messages", "reference", "Reference":
			return errors.New("does not support")
		}
	}

	now := time.Now().Local()
	updates["update_time"] = now.UnixMilli()
	updates["update_date"] = now.Truncate(time.Second)

	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Session(&gorm.Session{SkipHooks: true}).Model(&entity.ChatSession{}).Where("id = ?", id).Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			var count int64
			if err := tx.Model(&entity.ChatSession{}).Where("id = ?", id).Count(&count).Error; err != nil {
				return err
			}
			if count == 0 {
				return gorm.ErrRecordNotFound
			}
		}
		if targeted {
			return updateConversationHistory(ctx, tx, conversationMessageTable, conversationReferenceTable, id, historyUpdate)
		}
		return nil
	})
}

// DeleteByID deletes a chat session by ID (hard delete)
func (dao *ChatSessionDAO) DeleteByID(ctx context.Context, db *gorm.DB, id string) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var parent entity.ChatSession
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id").Where("id = ?", id).Take(&parent).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err := deleteHistory(ctx, tx, []string{conversationMessageTable, conversationReferenceTable}, []string{id}); err != nil {
			return err
		}
		return tx.Where("id = ?", id).Delete(&entity.ChatSession{}).Error
	})
}

// ListByResourceIDs lists only sessions authorized by the permission layer.
func (dao *ChatSessionDAO) ListByResourceIDs(ctx context.Context, db *gorm.DB, chatID string, sessionIDs []string, sessionID, name string, terms []OrderTerm, page, pageSize int, includeHistory ...bool) ([]*entity.ChatSession, error) {
	if len(sessionIDs) == 0 {
		return []*entity.ChatSession{}, nil
	}
	var chatSessions []*entity.ChatSession
	query := db.WithContext(ctx).Session(&gorm.Session{QueryFields: true}).Where("dialog_id = ? AND id IN ?", chatID, sessionIDs)
	if sessionID != "" {
		query = query.Where("id = ?", sessionID)
	}
	if name != "" {
		query = query.Where("name = ?", name)
	}
	query = query.Order(chatSessionOrderClause(terms))
	if pageSize > 0 {
		if page < 1 {
			page = 1
		}
		query = query.Offset((page - 1) * pageSize).Limit(pageSize)
	}
	err := query.Find(&chatSessions).Error
	if err != nil {
		return nil, err
	}
	if len(includeHistory) == 0 || includeHistory[0] {
		if err = hydrateChatSessions(ctx, db, chatSessions); err != nil {
			return nil, err
		}
	}
	return chatSessions, nil
}

// GetDialogByID gets dialog by ID
func (dao *ChatSessionDAO) GetDialogByID(ctx context.Context, db *gorm.DB, chatID string) (*entity.Chat, error) {
	var dialog entity.Chat
	err := db.WithContext(ctx).Where("id = ? AND status = ?", chatID, common.StatusDialogValid).First(&dialog).Error
	if err != nil {
		return nil, err
	}
	return &dialog, nil
}

// DeleteByDialogIDs deletes chat sessions by dialog IDs (hard delete)
func (dao *ChatSessionDAO) DeleteByDialogIDs(ctx context.Context, db *gorm.DB, dialogIDs []string) (int64, error) {
	if len(dialogIDs) == 0 {
		return 0, nil
	}
	var rowsAffected int64
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var ids []string
		if err := tx.Model(&entity.ChatSession{}).Clauses(clause.Locking{Strength: "UPDATE"}).Where("dialog_id IN ?", dialogIDs).Order("id").Pluck("id", &ids).Error; err != nil {
			return err
		}
		if err := deleteHistory(ctx, tx, []string{conversationMessageTable, conversationReferenceTable}, ids); err != nil {
			return err
		}
		result := tx.Unscoped().Where("dialog_id IN ?", dialogIDs).Delete(&entity.ChatSession{})
		rowsAffected = result.RowsAffected
		return result.Error
	})
	return rowsAffected, err
}

// agentSessionOwnedBy 拼出「这条会话属于某人」的条件。
//
// 两列都要认：写入侧（CreateAgentSession 与聊天链路）把登录用户 id 同时写进
// user_id 和 exp_user_id，但 exp_user_id 是后加的列，早期行可能为 NULL，
// 只认其中一列会让那些行对主人自己都不可见。
func (dao *ChatSessionDAO) agentSessionOwnedBy(query *gorm.DB, userID string) *gorm.DB {
	if userID == "" {
		return query
	}
	return query.Where("(user_id = ? OR exp_user_id = ?)", userID, userID)
}

// ListAgentSessionNames 返回会话下拉框用的 id/name 列表。
//
// expUserID 是客户端的筛选条件；ownerUserID 是服务端定下的归属边界，
// 非空时只有该用户的会话会出现在结果里。
func (dao *ChatSessionDAO) ListAgentSessionNames(ctx context.Context, db *gorm.DB, agentID, expUserID, ownerUserID string) ([]map[string]interface{}, error) {
	var rows []map[string]interface{}
	query := db.WithContext(ctx).Model(&entity.API4Conversation{}).
		Select("id", "name").
		Where("dialog_id = ?", agentID)
	if expUserID != "" {
		query = query.Where("exp_user_id = ?", expUserID)
	}
	query = dao.agentSessionOwnedBy(query, ownerUserID)
	err := query.Order("create_date DESC").Find(&rows).Error
	return rows, err
}

func normalizeAgentSessionOrderBy(orderBy string) string {
	switch orderBy {
	case "id":
		return "id"
	case "name":
		return "name"
	case "create_time":
		return "create_time"
	case "create_date":
		return "create_date"
	case "update_time":
		return "update_time"
	case "update_date":
		return "update_date"
	case "tokens":
		return "tokens"
	case "duration":
		return "duration"
	case "round":
		return "round"
	case "thumb_up":
		return "thumb_up"
	default:
		return "update_time"
	}
}

func (dao *ChatSessionDAO) ListAgentSessions(ctx context.Context, db *gorm.DB, params ListAgentSessionsParams) (int64, []*entity.API4Conversation, error) {
	query := db.WithContext(ctx).Session(&gorm.Session{QueryFields: true}).Model(&entity.API4Conversation{}).Where("dialog_id = ?", params.AgentID)
	if !params.IncludeDSL {
		query = query.Omit("dsl")
	}

	if params.SessionID != "" {
		query = query.Where("id = ?", params.SessionID)
	}

	if params.UserID != "" {
		query = query.Where("user_id = ?", params.UserID)
	}

	// 归属边界必须无条件生效：客户端不传 user_id / exp_user_id 时，上面两个
	// 分支都不加限制，只靠这一条兜住「读到别人会话」。
	query = dao.agentSessionOwnedBy(query, params.OwnerUserID)

	if params.Keywords != "" {
		keywords := strings.ToLower(params.Keywords)
		keywordPattern := "%" + keywords + "%"
		messageMatch := "EXISTS (SELECT 1 FROM " + apiConversationMessageTable + " AS cm WHERE cm.conversation_id = api_4_conversation.id AND LOWER(cm.content) LIKE ?)"
		query = query.Where("(LOWER(id) LIKE ? OR LOWER(name) LIKE ? OR "+messageMatch+")", keywordPattern, keywordPattern, keywordPattern)
	}

	dateColumn := "create_date"
	if strings.HasPrefix(params.OrderBy, "update_") {
		dateColumn = "update_date"
	}

	if params.FromDate != nil {
		query = query.Where(dateColumn+" >= ?", *params.FromDate)
	}

	if params.ToDate != nil {
		query = query.Where(dateColumn+" <= ?", *params.ToDate)
	}

	if params.ExpUserID != "" {
		query = query.Where("exp_user_id = ?", params.ExpUserID)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return 0, nil, err
	}

	orderBy := normalizeAgentSessionOrderBy(params.OrderBy)
	if params.Desc {
		orderBy += " DESC"
	} else {
		orderBy += " ASC"
	}

	page := params.Page
	if page <= 0 {
		page = 1
	}

	pageSize := params.PageSize
	if pageSize <= 0 {
		pageSize = 30
	}

	var sessions []*entity.API4Conversation
	err := query.
		Order(orderBy).
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&sessions).Error
	if err != nil {
		return 0, nil, err
	}
	if !params.NoHistory {
		if err = hydrateAPIConversations(ctx, db, sessions); err != nil {
			return 0, nil, err
		}
	}

	return total, sessions, nil
}
