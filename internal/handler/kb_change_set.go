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

package handler

import (
	"context"
	"errors"

	"github.com/gin-gonic/gin"

	"ragflow/internal/common"
	"ragflow/internal/entity"
	"ragflow/internal/service"
	"ragflow/internal/service/chunk"
)

// chunkQuestionSyncer adapts ChunkService.UpdateChunk to the ChangeSetService's
// index-sync seam. It lives in handler (not service) to avoid an import cycle.
type chunkQuestionSyncer struct {
	chunkService *chunk.ChunkService
}

func (s *chunkQuestionSyncer) SyncChunkQuestions(ctx context.Context, userID, datasetID, documentID, chunkID string, questions []string) error {
	return s.chunkService.UpdateChunk(ctx, &service.UpdateChunkRequest{
		DatasetID:  datasetID,
		DocumentID: documentID,
		ChunkID:    chunkID,
		Questions:  questions,
	}, userID)
}

// ChangeSetServiceAPI is the service contract used by the handler, kept narrow
// so the routes can be exercised without a database.
type ChangeSetServiceAPI interface {
	CreateChangeSet(ctx context.Context, userID, datasetID string) (*entity.KbChangeSet, error)
	ListChangeSets(ctx context.Context, userID, datasetID string) ([]*entity.KbChangeSet, error)
	GetOrCreateChangeSet(ctx context.Context, userID, datasetID string) (*entity.KbChangeSet, error)
	StageSimilarQuestions(ctx context.Context, userID, datasetID, changeSetID, documentID, chunkID string, questions []string, origin string) error
	PublishChangeSet(ctx context.Context, userID, datasetID, changeSetID string) error
	DiscardChangeSet(ctx context.Context, userID, datasetID, changeSetID string) error
}

// ChangeSetHandler serves the staged-edit (change set) endpoints.
type ChangeSetHandler struct {
	service *service.ChangeSetService
}

func NewChangeSetHandler() *ChangeSetHandler {
	svc := service.NewChangeSetService()
	svc.SetChunkUpdater(&chunkQuestionSyncer{chunkService: chunk.NewChunkService()})
	return &ChangeSetHandler{service: svc}
}

// CreateChangeSet handles POST /datasets/:dataset_id/change-sets.
func (h *ChangeSetHandler) CreateChangeSet(c *gin.Context) {
	user, code, message := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, message)
		return
	}
	cs, err := h.service.CreateChangeSet(c.Request.Context(), user.ID, c.Param("dataset_id"))
	if err != nil {
		respondChangeSetError(c, err)
		return
	}
	common.SuccessWithData(c, cs, "success")
}

// ListChangeSets handles GET /datasets/:dataset_id/change-sets.
func (h *ChangeSetHandler) ListChangeSets(c *gin.Context) {
	user, code, message := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, message)
		return
	}
	sets, err := h.service.ListChangeSets(c.Request.Context(), user.ID, c.Param("dataset_id"))
	if err != nil {
		respondChangeSetError(c, err)
		return
	}
	common.SuccessWithData(c, sets, "success")
}

// StageSimilarQuestionsRequest is the body for staging a chunk's similar
// questions into a change set.
type StageSimilarQuestionsRequest struct {
	ChangeSetID string   `json:"change_set_id"`
	DocumentID  string   `json:"document_id" binding:"required"`
	ChunkID     string   `json:"chunk_id" binding:"required"`
	Questions   []string `json:"questions"`
	Origin      string   `json:"origin"`
}

// StageSimilarQuestions handles POST /datasets/:dataset_id/change-sets/similar-questions.
func (h *ChangeSetHandler) StageSimilarQuestions(c *gin.Context) {
	user, code, message := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, message)
		return
	}
	var req StageSimilarQuestionsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ResponseWithCodeData(c, common.CodeDataError, nil, "Invalid request: "+err.Error())
		return
	}
	if req.ChangeSetID == "" {
		cs, err := h.service.GetOrCreateChangeSet(c.Request.Context(), user.ID, c.Param("dataset_id"))
		if err != nil {
			respondChangeSetError(c, err)
			return
		}
		req.ChangeSetID = cs.ID
	}
	if err := h.service.StageSimilarQuestions(c.Request.Context(), user.ID, c.Param("dataset_id"), req.ChangeSetID, req.DocumentID, req.ChunkID, req.Questions, req.Origin); err != nil {
		respondChangeSetError(c, err)
		return
	}
	common.SuccessWithData(c, gin.H{"change_set_id": req.ChangeSetID}, "success")
}

// PublishChangeSetRequest is the body for publishing a change set.
type PublishChangeSetRequest struct {
	ChangeSetID string `json:"change_set_id" binding:"required"`
}

// PublishChangeSet handles POST /datasets/:dataset_id/change-sets/publish.
func (h *ChangeSetHandler) PublishChangeSet(c *gin.Context) {
	user, code, message := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, message)
		return
	}
	var req PublishChangeSetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ResponseWithCodeData(c, common.CodeDataError, nil, "Invalid request: "+err.Error())
		return
	}
	if err := h.service.PublishChangeSet(c.Request.Context(), user.ID, c.Param("dataset_id"), req.ChangeSetID); err != nil {
		respondChangeSetError(c, err)
		return
	}
	common.SuccessWithData(c, nil, "success")
}

// DiscardChangeSetRequest is the body for discarding a change set.
type DiscardChangeSetRequest struct {
	ChangeSetID string `json:"change_set_id" binding:"required"`
}

// DiscardChangeSet handles POST /datasets/:dataset_id/change-sets/discard.
func (h *ChangeSetHandler) DiscardChangeSet(c *gin.Context) {
	user, code, message := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, message)
		return
	}
	var req DiscardChangeSetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ResponseWithCodeData(c, common.CodeDataError, nil, "Invalid request: "+err.Error())
		return
	}
	if err := h.service.DiscardChangeSet(c.Request.Context(), user.ID, c.Param("dataset_id"), req.ChangeSetID); err != nil {
		respondChangeSetError(c, err)
		return
	}
	common.SuccessWithData(c, nil, "success")
}

// respondChangeSetError maps service errors onto shared response codes. A
// missing change set and a cross-tenant one are reported identically.
func respondChangeSetError(c *gin.Context, err error) {
	if errors.Is(err, service.ErrChangeSetNotFound) {
		common.ResponseWithCodeData(c, common.CodeDataError, nil, "change set not found")
		return
	}
	if respondPermissionErrorIf(c, err, true) {
		return
	}
	common.ResponseWithCodeData(c, common.CodeServerError, nil, err.Error())
}
