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

	"ragflow/internal/entity"

	"gorm.io/gorm"
)

// ChunkQuestionDAO persists similar questions attached to FAQ chunks. It is the
// stateful store behind the similar-question management page; the legacy
// chunk.question_kwd array remains the retrieval-facing projection but edits
// now flow through this table so they can be diffed, staged and audited.
type ChunkQuestionDAO struct{}

func NewChunkQuestionDAO() *ChunkQuestionDAO {
	return &ChunkQuestionDAO{}
}

// ListByChunk returns the similar questions of one chunk in a stable order.
func (dao *ChunkQuestionDAO) ListByChunk(ctx context.Context, db *gorm.DB, kbID, chunkID string) ([]*entity.ChunkQuestion, error) {
	questions := make([]*entity.ChunkQuestion, 0)
	err := db.WithContext(ctx).Model(&entity.ChunkQuestion{}).
		Where("kb_id = ?", kbID).
		Where("chunk_id = ?", chunkID).
		Where("status = ?", entity.ChunkQuestionStatusLive).
		Order("create_time ASC").
		Find(&questions).Error
	return questions, err
}

// ListByKB returns the similar questions of a whole knowledge base, optionally
// filtered by status. The live view is what the similar-question page lists.
func (dao *ChunkQuestionDAO) ListByKB(ctx context.Context, db *gorm.DB, kbID string, status string) ([]*entity.ChunkQuestion, error) {
	questions := make([]*entity.ChunkQuestion, 0)
	q := db.WithContext(ctx).Model(&entity.ChunkQuestion{}).
		Where("kb_id = ?", kbID)
	if status != "" {
		q = q.Where("status = ?", status)
	}
	err := q.Order("create_time ASC").Find(&questions).Error
	return questions, err
}

// CreateQuestions bulk-inserts similar questions. The caller supplies generated
// ids, origin and creator.
func (dao *ChunkQuestionDAO) CreateQuestions(ctx context.Context, db *gorm.DB, questions []*entity.ChunkQuestion) error {
	if len(questions) == 0 {
		return nil
	}
	return db.WithContext(ctx).Create(&questions).Error
}

// UpdateQuestionStatus flips one question's lifecycle state (e.g. pending →
// live on publish). It is scoped to the kb so a guessed id cannot mutate another
// tenant's question.
func (dao *ChunkQuestionDAO) UpdateQuestionStatus(ctx context.Context, db *gorm.DB, kbID, questionID, status string) error {
	return db.WithContext(ctx).Model(&entity.ChunkQuestion{}).
		Where("kb_id = ?", kbID).
		Where("id = ?", questionID).
		Update("status", status).Error
}

// DeleteByChunk soft-deletes every question of a chunk (status → disabled)
// rather than physically removing rows, preserving audit history.
func (dao *ChunkQuestionDAO) DeleteByChunk(ctx context.Context, db *gorm.DB, kbID, chunkID string) error {
	return db.WithContext(ctx).Model(&entity.ChunkQuestion{}).
		Where("kb_id = ?", kbID).
		Where("chunk_id = ?", chunkID).
		Update("status", entity.ChunkQuestionStatusDisabled).Error
}

// DeleteByChunkAndChangeSet soft-deletes the pending questions of a chunk under
// a change set. Re-editing within one change set replaces the staged set.
func (dao *ChunkQuestionDAO) DeleteByChunkAndChangeSet(ctx context.Context, db *gorm.DB, kbID, chunkID, changeSetID string) error {
	return db.WithContext(ctx).Model(&entity.ChunkQuestion{}).
		Where("kb_id = ?", kbID).
		Where("chunk_id = ?", chunkID).
		Where("change_set_id = ?", changeSetID).
		Where("status = ?", entity.ChunkQuestionStatusPending).
		Update("status", entity.ChunkQuestionStatusDisabled).Error
}

// ListByChangeSet returns the questions of a change set, optionally filtered by
// status.
func (dao *ChunkQuestionDAO) ListByChangeSet(ctx context.Context, db *gorm.DB, kbID, changeSetID, status string) ([]*entity.ChunkQuestion, error) {
	questions := make([]*entity.ChunkQuestion, 0)
	q := db.WithContext(ctx).Model(&entity.ChunkQuestion{}).
		Where("kb_id = ?", kbID).
		Where("change_set_id = ?", changeSetID)
	if status != "" {
		q = q.Where("status = ?", status)
	}
	err := q.Order("create_time ASC").Find(&questions).Error
	return questions, err
}

// DiscardByChangeSet soft-deletes every pending question of a change set.
func (dao *ChunkQuestionDAO) DiscardByChangeSet(ctx context.Context, db *gorm.DB, kbID, changeSetID string) error {
	return db.WithContext(ctx).Model(&entity.ChunkQuestion{}).
		Where("kb_id = ?", kbID).
		Where("change_set_id = ?", changeSetID).
		Where("status = ?", entity.ChunkQuestionStatusPending).
		Update("status", entity.ChunkQuestionStatusDisabled).Error
}
