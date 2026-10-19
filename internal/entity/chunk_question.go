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

package entity

// ChunkQuestion lifecycle status. live = in effect; pending = staged, not yet
// live; disabled = soft-deleted / inactive.
const (
	ChunkQuestionStatusLive     = "live"
	ChunkQuestionStatusPending  = "pending"
	ChunkQuestionStatusDisabled = "disabled"
)

// ChunkQuestion origin values trace how a similar question was produced.
const (
	ChunkQuestionOriginManual   = "manual"
	ChunkQuestionOriginLLM      = "llm"
	ChunkQuestionOriginImported = "imported"
)

// ChunkQuestion is one similar question attached to an FAQ chunk. It is the
// stateful, independently-versionable form of the legacy chunk.question_kwd
// array: a change-set workflow can diff, stage and publish individual questions
// without rewriting the whole chunk.
type ChunkQuestion struct {
	ID     string `gorm:"column:id;primaryKey;size:32" json:"id"`
	ChunkID string `gorm:"column:chunk_id;size:32;not null;index" json:"chunk_id"`
	KbID   string `gorm:"column:kb_id;size:32;not null;index" json:"kb_id"`
	// DocumentID is the chunk's parent document, needed to sync questions back
	// to the index at publish time.
	DocumentID string `gorm:"column:document_id;size:32;not null;index" json:"document_id"`
	// Content is the similar-question text (a user's alternative phrasing).
	Content string `gorm:"column:content;size:200;not null" json:"content"`
	// Origin records how this question was produced: manual / llm / imported.
	Origin string `gorm:"column:origin;size:16;not null;default:manual" json:"origin"`
	// Status is the lifecycle state: live / pending / disabled.
	Status string `gorm:"column:status;size:16;not null;default:live;index" json:"status"`
	// ChangeSetID links a pending question to the change set that staged it.
	ChangeSetID string `gorm:"column:change_set_id;size:64;index" json:"change_set_id,omitempty"`
	// CreatedBy records who authored the question, for audit.
	CreatedBy string `gorm:"column:created_by;size:64" json:"created_by,omitempty"`
	BaseModel `json:"-"`
}

// TableName specify table name
func (ChunkQuestion) TableName() string {
	return "chunk_question"
}
