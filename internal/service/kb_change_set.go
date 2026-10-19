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
	"fmt"
	"strings"

	"ragflow/internal/common"
	"ragflow/internal/dao"
	"ragflow/internal/entity"

	"gorm.io/gorm"
)

// ErrChangeSetNotFound is returned when a change set is absent or owned by
// another tenant; the two cases are indistinguishable to callers.
var ErrChangeSetNotFound = errors.New("change set not found")

// ChangeSetService coordinates the staged-edit workflow: it owns change set
// lifecycle (open → tested → published / discarded), stages pending synonym and
// similar-question changes, and publishes them atomically.
type ChangeSetService struct {
	changeSetDAO  *dao.KbChangeSetDAO
	questionDAO   *dao.ChunkQuestionDAO
	synonymDAO    *dao.SynonymDAO
	chunkUpdater  ChunkQuestionSyncUpdater
}

// ChunkQuestionSyncUpdater writes a chunk's merged similar-question list back to
// the index (and recomputes question_tks). It is a seam so the publish path can
// be tested without a real engine.
type ChunkQuestionSyncUpdater interface {
	SyncChunkQuestions(ctx context.Context, userID, datasetID, documentID, chunkID string, questions []string) error
}

// NewChangeSetService builds the service with a nil chunk updater; the handler
// layer injects the concrete ChunkService-backed syncer to avoid an import
// cycle (chunk imports service).
func NewChangeSetService() *ChangeSetService {
	return &ChangeSetService{
		changeSetDAO: dao.NewKbChangeSetDAO(),
		questionDAO:  dao.NewChunkQuestionDAO(),
		synonymDAO:   dao.NewSynonymDAO(),
		chunkUpdater: nil,
	}
}

// SetChunkUpdater injects the index sync seam. The handler/server wiring calls
// this with a ChunkService-backed implementation before serving publish.
func (s *ChangeSetService) SetChunkUpdater(u ChunkQuestionSyncUpdater) {
	s.chunkUpdater = u
}

// CreateChangeSet opens a new change set for a knowledge base.
func (s *ChangeSetService) CreateChangeSet(ctx context.Context, userID, datasetID string) (*entity.KbChangeSet, error) {
	tenantID, err := resolveTenantID(ctx, userID, datasetID)
	if err != nil {
		return nil, err
	}
	cs := &entity.KbChangeSet{
		ID:        common.GenerateUUID(),
		KbID:      datasetID,
		TenantID:  tenantID,
		CreatedBy: userID,
		Status:    entity.ChangeSetStatusOpen,
	}
	if err := s.changeSetDAO.CreateChangeSet(ctx, dao.DB, cs); err != nil {
		return nil, err
	}
	return cs, nil
}

// GetOrCreateChangeSet returns the caller's open change set for the kb, opening
// one if none exists. Editing a staged item needs a stable change_set_id.
func (s *ChangeSetService) GetOrCreateChangeSet(ctx context.Context, userID, datasetID string) (*entity.KbChangeSet, error) {
	tenantID, err := resolveTenantID(ctx, userID, datasetID)
	if err != nil {
		return nil, err
	}
	sets, err := s.changeSetDAO.ListOpenChangeSets(ctx, dao.DB, tenantID, datasetID)
	if err != nil {
		return nil, err
	}
	for _, cs := range sets {
		if cs.CreatedBy == userID {
			return cs, nil
		}
	}
	return s.CreateChangeSet(ctx, userID, datasetID)
}

// ListChangeSets returns the caller's open change sets for a kb.
func (s *ChangeSetService) ListChangeSets(ctx context.Context, userID, datasetID string) ([]*entity.KbChangeSet, error) {
	tenantID, err := resolveTenantID(ctx, userID, datasetID)
	if err != nil {
		return nil, err
	}
	return s.changeSetDAO.ListOpenChangeSets(ctx, dao.DB, tenantID, datasetID)
}

// resolveTenantID resolves the tenant that owns the dataset, reusing the same
// ownership check as the synonym service.
func resolveTenantID(ctx context.Context, userID, datasetID string) (string, error) {
	syn := NewSynonymService()
	return syn.resolveTenant(ctx, userID, datasetID)
}

// StageSimilarQuestions writes a chunk's full similar-question list as pending
// rows under the given change set. The caller has already resolved the change
// set id. Only pending rows are written; live rows are untouched until publish.
func (s *ChangeSetService) StageSimilarQuestions(ctx context.Context, userID, datasetID, changeSetID, documentID, chunkID string, questions []string, origin string) error {
	if _, err := resolveTenantID(ctx, userID, datasetID); err != nil {
		return err
	}
	if origin == "" {
		origin = entity.ChunkQuestionOriginManual
	}
	// Soft-delete any previous pending rows for this chunk under this change set
	// so re-editing within one change set replaces rather than accumulates.
	if err := s.questionDAO.DeleteByChunkAndChangeSet(ctx, dao.DB, datasetID, chunkID, changeSetID); err != nil {
		return err
	}
	rows := make([]*entity.ChunkQuestion, 0, len(questions))
	for _, q := range questions {
		q = strings.TrimSpace(q)
		if q == "" {
			continue
		}
		rows = append(rows, &entity.ChunkQuestion{
			ID:          common.GenerateUUID(),
			ChunkID:     chunkID,
			KbID:        datasetID,
			DocumentID:  documentID,
			Content:     q,
			Origin:      origin,
			Status:      entity.ChunkQuestionStatusPending,
			ChangeSetID: changeSetID,
			CreatedBy:   userID,
		})
	}
	return s.questionDAO.CreateQuestions(ctx, dao.DB, rows)
}

// PublishChangeSet flips every pending item of a change set to live and syncs
// similar questions back to the chunk index, atomically.
//
// Conflict handling: the caller should pass the staged change set; this method
// validates ownership and performs the publish in one transaction where
// possible. Similar-question index sync runs after the DB commit; if any chunk
// sync fails, the DB rows are already live (they match the index's source of
// truth via question_kwd), and the error is reported for retry.
func (s *ChangeSetService) PublishChangeSet(ctx context.Context, userID, datasetID, changeSetID string) error {
	tenantID, err := resolveTenantID(ctx, userID, datasetID)
	if err != nil {
		return err
	}
	cs, err := s.changeSetDAO.GetChangeSet(ctx, dao.DB, tenantID, datasetID, changeSetID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrChangeSetNotFound
		}
		return err
	}
	if cs.Status == entity.ChangeSetStatusPublished {
		return errors.New("change set already published")
	}

	// 1. Promote pending chunk questions to live, grouped by chunk for index sync.
	pendingQuestions, err := s.questionDAO.ListByChangeSet(ctx, dao.DB, datasetID, changeSetID, entity.ChunkQuestionStatusPending)
	if err != nil {
		return err
	}
	type chunkGroup struct {
		documentID string
		questions  []string
	}
	groups := map[string]*chunkGroup{}

	err = dao.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, q := range pendingQuestions {
			if err := s.questionDAO.UpdateQuestionStatus(ctx, tx, datasetID, q.ID, entity.ChunkQuestionStatusLive); err != nil {
				return err
			}
			g, ok := groups[q.ChunkID]
			if !ok {
				g = &chunkGroup{documentID: q.DocumentID}
				groups[q.ChunkID] = g
			}
			g.questions = append(g.questions, q.Content)
		}
		// 2. Promote pending synonym groups/words to live.
		if err := s.synonymDAO.PromotePendingByChangeSet(ctx, tx, tenantID, datasetID, changeSetID); err != nil {
			return err
		}
		// 3. Mark the change set published.
		return s.changeSetDAO.UpdateChangeSetStatus(ctx, tx, tenantID, datasetID, changeSetID, entity.ChangeSetStatusPublished)
	})
	if err != nil {
		return err
	}

	// 4. Sync similar questions back to the chunk index (question_tks recompute).
	// The updater is injected by the handler wiring; without it the DB is already
	// live but the index is stale, so surface a clear error for retry.
	if len(groups) > 0 {
		if s.chunkUpdater == nil {
			return errors.New("chunk question syncer not configured; index sync skipped")
		}
		for chunkID, g := range groups {
			if err := s.chunkUpdater.SyncChunkQuestions(ctx, userID, datasetID, g.documentID, chunkID, g.questions); err != nil {
				return fmt.Errorf("failed to sync questions for chunk %s: %w", chunkID, err)
			}
		}
	}

	return nil
}

// DiscardChangeSet abandons all pending items of a change set. Live data is
// untouched; only pending rows are soft-deleted.
func (s *ChangeSetService) DiscardChangeSet(ctx context.Context, userID, datasetID, changeSetID string) error {
	tenantID, err := resolveTenantID(ctx, userID, datasetID)
	if err != nil {
		return err
	}
	if _, err := s.changeSetDAO.GetChangeSet(ctx, dao.DB, tenantID, datasetID, changeSetID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrChangeSetNotFound
		}
		return err
	}
	return dao.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := s.questionDAO.DiscardByChangeSet(ctx, tx, datasetID, changeSetID); err != nil {
			return err
		}
		if err := s.synonymDAO.DiscardPendingByChangeSet(ctx, tx, tenantID, datasetID, changeSetID); err != nil {
			return err
		}
		return s.changeSetDAO.UpdateChangeSetStatus(ctx, tx, tenantID, datasetID, changeSetID, entity.ChangeSetStatusDiscarded)
	})
}
