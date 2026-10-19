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
	"encoding/json"
	"fmt"
	"time"

	"ragflow/internal/common"
	"ragflow/internal/entity"

	"gorm.io/gorm"
)

// ConversationVariableDAO persists Chatflow conversation-scoped variables.
type ConversationVariableDAO struct{}

func NewConversationVariableDAO() *ConversationVariableDAO {
	return &ConversationVariableDAO{}
}

// LoadByConversation returns all variables of a conversation keyed by name.
func (dao *ConversationVariableDAO) LoadByConversation(ctx context.Context, db *gorm.DB, conversationID string) (map[string]*entity.ConversationVariable, error) {
	rows := make([]*entity.ConversationVariable, 0)
	if err := db.WithContext(ctx).Model(&entity.ConversationVariable{}).
		Where("conversation_id = ?", conversationID).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make(map[string]*entity.ConversationVariable, len(rows))
	for _, r := range rows {
		out[r.Name] = r
	}
	return out, nil
}

// UpsertMany writes (insert or update) conversation variables. Each value is
// stored as JSON-encoded text so any value_type round-trips.
func (dao *ConversationVariableDAO) UpsertMany(ctx context.Context, db *gorm.DB, conversationID, canvasID string, values map[string]any) error {
	if len(values) == 0 {
		return nil
	}
	now := time.Now().UnixMilli()
	for name, v := range values {
		encoded := encodeVarValue(v)
		row := &entity.ConversationVariable{
			ID:             common.GenerateUUID(),
			ConversationID: conversationID,
			CanvasID:       canvasID,
			Name:           name,
			Value:          encoded,
			ValueType:      inferValueType(v),
			UpdateTime:     now,
		}
		// Insert-or-update on the unique key (conversation_id, name).
		if err := db.WithContext(ctx).
			Where(entity.ConversationVariable{ConversationID: conversationID, Name: name}).
			Assign(map[string]any{"value": encoded, "value_type": row.ValueType, "update_time": now}).
			FirstOrCreate(row).Error; err != nil {
			return err
		}
	}
	return nil
}

// encodeVarValue serializes an arbitrary value to its JSON text form so it
// round-trips regardless of value_type.
func encodeVarValue(v any) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	b, err := json.Marshal(v)
	if err != nil {
		return fmt.Sprintf("%v", v)
	}
	return string(b)
}

// inferValueType maps a Go value to the variable's declared type.
func inferValueType(v any) string {
	switch v.(type) {
	case nil:
		return "string"
	case bool:
		return "boolean"
	case json.Number, float64, float32, int, int64, int32:
		return "number"
	case []any, map[string]any:
		return "object"
	default:
		return "string"
	}
}
