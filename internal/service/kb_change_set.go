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

// ChangeSetItemFilter narrows a publish / discard / compare operation to the
// items the user selected in the change center list.
//
// Convention: a nil filter means every pending item of the change set — the
// original whole-set behaviour. A non-nil filter is an explicit selection
// scope: only the listed ids take part, and an empty (but non-nil) list means
// "no item of that kind is selected". JSON preserves the distinction
// (absent/null → nil, [] → empty slice), so a request that selects only
// similar questions can never accidentally publish the vocabulary groups.
type ChangeSetItemFilter struct {
	ChunkIDs []string `json:"chunk_ids"`
	GroupIDs []string `json:"group_ids"`
}

// ChangeSetService coordinates the staged-edit workflow: it owns change set
// lifecycle (open → tested → published / discarded), stages pending synonym and
// similar-question changes, and publishes them atomically.
type ChangeSetService struct {
	changeSetDAO *dao.KbChangeSetDAO
	questionDAO  *dao.ChunkQuestionDAO
	synonymDAO   *dao.SynonymDAO
	chunkUpdater ChunkQuestionSyncUpdater
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
// knowledge-base-level access check as the synonym service.
//
// The change centre stages edits to one base's vocabulary and similar
// questions, so it is scoped by that base's tenant rather than by a tenant the
// caller happens to own — resolving it from the caller rejected every member of
// the base's tenant who does not own it.
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

// PublishChangeSet flips the pending items of a change set to live and syncs
// similar questions back to the chunk index, atomically.
//
// The scope narrows the publish to the selected items: a nil scope publishes
// everything pending (the original behaviour), a non-nil scope publishes only
// the listed chunks / groups and leaves the rest staged. The change set only
// leaves the active list once nothing is pending, so a partial publish keeps
// it open and its remaining items visible in the change center.
//
// Conflict handling: the caller should pass the staged change set; this method
// validates ownership and performs the publish in one transaction where
// possible. Similar-question index sync runs after the DB commit; if any chunk
// sync fails, the DB rows are already live (they match the index's source of
// truth via question_kwd), and the error is reported for retry.
func (s *ChangeSetService) PublishChangeSet(ctx context.Context, userID, datasetID, changeSetID string, scope *ChangeSetItemFilter) error {
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

	// nil scope → both nil → the DAO paths promote every pending item, exactly
	// the pre-scope behaviour. A non-nil scope is passed through as-is so an
	// empty list inside it means "none selected" rather than "everything".
	var chunkIDs, groupIDs []string
	if scope != nil {
		chunkIDs, groupIDs = scope.ChunkIDs, scope.GroupIDs
	}
	selectedChunks := toIDSet(chunkIDs)

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
			// A scoped publish only promotes the selected chunks; the rest
			// stay pending under the same change set.
			if scope != nil {
				if _, ok := selectedChunks[q.ChunkID]; !ok {
					continue
				}
			}
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
		if err := s.synonymDAO.PromotePendingByGroupIDs(ctx, tx, tenantID, datasetID, changeSetID, groupIDs); err != nil {
			return err
		}
		// 3. Mark the change set published only once nothing is pending: a
		// partial publish keeps the set open with the remaining items staged.
		return s.finalizeChangeSetStatus(ctx, tx, tenantID, datasetID, changeSetID, entity.ChangeSetStatusPublished)
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

// DiscardChangeSet abandons pending items of a change set. Live data is
// untouched; only pending rows are soft-deleted. The scope narrows the discard
// to the selected items: a nil scope discards everything pending, a non-nil
// scope discards only the listed chunks / groups and leaves the rest staged.
// The set is only marked discarded once nothing is pending, so a partial
// discard keeps it open with the remaining items visible.
func (s *ChangeSetService) DiscardChangeSet(ctx context.Context, userID, datasetID, changeSetID string, scope *ChangeSetItemFilter) error {
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
	var chunkIDs, groupIDs []string
	if scope != nil {
		chunkIDs, groupIDs = scope.ChunkIDs, scope.GroupIDs
	}
	return dao.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := s.questionDAO.DiscardQuestionsByChunkIDs(ctx, tx, datasetID, changeSetID, chunkIDs); err != nil {
			return err
		}
		if err := s.synonymDAO.DiscardPendingByGroupIDs(ctx, tx, tenantID, datasetID, changeSetID, groupIDs); err != nil {
			return err
		}
		return s.finalizeChangeSetStatus(ctx, tx, tenantID, datasetID, changeSetID, entity.ChangeSetStatusDiscarded)
	})
}

// finalizeChangeSetStatus flips a change set to the terminal status only when
// nothing is pending any more. A partial publish or discard leaves staged
// items behind, and the set must stay in the active list (ListChangeSets
// returns open/tested sets) so the remaining items keep showing in the change
// center.
func (s *ChangeSetService) finalizeChangeSetStatus(ctx context.Context, tx *gorm.DB, tenantID, datasetID, changeSetID, terminalStatus string) error {
	remainingQuestions, err := s.questionDAO.CountPendingByChangeSet(ctx, tx, datasetID, changeSetID)
	if err != nil {
		return err
	}
	remainingGroups, err := s.synonymDAO.CountPendingGroupsByChangeSet(ctx, tx, tenantID, datasetID, changeSetID)
	if err != nil {
		return err
	}
	if remainingQuestions+remainingGroups > 0 {
		return nil
	}
	return s.changeSetDAO.UpdateChangeSetStatus(ctx, tx, tenantID, datasetID, changeSetID, terminalStatus)
}

// toIDSet builds a lookup set from an id list. A nil list yields an empty set,
// which the caller only consults for scoped (non-nil) operations.
func toIDSet(ids []string) map[string]struct{} {
	set := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		set[id] = struct{}{}
	}
	return set
}

// ChangeSetDiff is the structured "before vs after" view of a change set,
// consumed by both the change center and the test-comparison dialog.
type ChangeSetDiff struct {
	ChangeSetID      string                `json:"change_set_id"`
	SimilarQuestions []SimilarQuestionDiff `json:"similar_questions"`
	Synonyms         []SynonymGroupDiff    `json:"synonyms"`
}

// SimilarQuestionDiff shows one chunk's similar questions before (live) and
// after (live + pending merge) the change set is published.
type SimilarQuestionDiff struct {
	ChunkID    string   `json:"chunk_id"`
	DocumentID string   `json:"document_id"`
	Question   string   `json:"question"`
	Before     []string `json:"before"`
	After      []string `json:"after"`
}

// SynonymGroupDiff shows one synonym/proper group's words before and after.
type SynonymGroupDiff struct {
	GroupID       string   `json:"group_id"`
	Name          string   `json:"name"`
	GroupType     string   `json:"group_type"`
	Scope         string   `json:"scope"`
	SourceGroupID string   `json:"source_group_id,omitempty"`
	Before        []string `json:"before"`
	After         []string `json:"after"`
}

// GetChangeSetDiff assembles the before/after diff of a change set's pending
// items. For similar questions, "before" is the chunk's live list and "after"
// is the live list merged with pending additions. For vocabulary, "before" is
// the source live group's words (empty for a new group) and "after" is the
// pending group's words.
func (s *ChangeSetService) GetChangeSetDiff(ctx context.Context, userID, datasetID, changeSetID string) (*ChangeSetDiff, error) {
	tenantID, err := resolveTenantID(ctx, userID, datasetID)
	if err != nil {
		return nil, err
	}
	if _, err := s.changeSetDAO.GetChangeSet(ctx, dao.DB, tenantID, datasetID, changeSetID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrChangeSetNotFound
		}
		return nil, err
	}

	diff := &ChangeSetDiff{ChangeSetID: changeSetID}

	// Similar questions: group pending by chunk, merge with live.
	pending, err := s.questionDAO.ListByChangeSet(ctx, dao.DB, datasetID, changeSetID, entity.ChunkQuestionStatusPending)
	if err != nil {
		return nil, err
	}
	type sqKey struct{ chunkID, documentID string }
	pendingByChunk := map[sqKey][]string{}
	for _, q := range pending {
		k := sqKey{q.ChunkID, q.DocumentID}
		pendingByChunk[k] = append(pendingByChunk[k], q.Content)
	}
	diff.SimilarQuestions = make([]SimilarQuestionDiff, 0, len(pendingByChunk))
	for k, add := range pendingByChunk {
		live, _ := s.questionDAO.ListByChunk(ctx, dao.DB, datasetID, k.chunkID)
		before := make([]string, 0, len(live))
		seen := map[string]bool{}
		for _, lq := range live {
			before = append(before, lq.Content)
			seen[lq.Content] = true
		}
		after := append([]string{}, before...)
		for _, a := range add {
			if !seen[a] {
				after = append(after, a)
				seen[a] = true
			}
		}
		diff.SimilarQuestions = append(diff.SimilarQuestions, SimilarQuestionDiff{
			ChunkID:    k.chunkID,
			DocumentID: k.documentID,
			Before:     before,
			After:      after,
		})
	}

	// Vocabulary: pending groups, with before = source live group's words.
	groups, err := s.synonymDAO.ListGroupsByChangeSet(ctx, dao.DB, tenantID, datasetID, changeSetID)
	if err != nil {
		return nil, err
	}
	diff.Synonyms = make([]SynonymGroupDiff, 0, len(groups))
	for _, g := range groups {
		after := make([]string, 0, len(g.Words))
		for _, w := range g.Words {
			after = append(after, w.Word)
		}
		before := []string{}
		if g.SourceGroupID != "" {
			srcWords, _ := s.synonymDAO.ListWords(ctx, dao.DB, tenantID, g.SourceGroupID)
			for _, w := range srcWords {
				before = append(before, w.Word)
			}
		}
		diff.Synonyms = append(diff.Synonyms, SynonymGroupDiff{
			GroupID:       g.ID,
			Name:          g.Name,
			GroupType:     g.GroupType,
			Scope:         g.Scope,
			SourceGroupID: g.SourceGroupID,
			Before:        before,
			After:         after,
		})
	}

	return diff, nil
}
