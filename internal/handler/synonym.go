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
)

// SynonymServiceAPI is the service contract used by the handler, kept narrow so
// the routes can be exercised without a database.
type SynonymServiceAPI interface {
	ListSynonymGroups(ctx context.Context, userID, datasetID, domain string) ([]*entity.SynonymGroup, error)
	GetSynonymGroup(ctx context.Context, userID, groupID string) (*entity.SynonymGroup, error)
	CreateSynonymGroup(ctx context.Context, userID, datasetID string, req service.CreateSynonymGroupRequest) (*entity.SynonymGroup, error)
	UpdateSynonymGroup(ctx context.Context, userID, groupID string, req service.UpdateSynonymGroupRequest) (*entity.SynonymGroup, error)
	DeleteSynonymGroup(ctx context.Context, userID, groupID string) error
	ImportSynonymGroups(ctx context.Context, userID, datasetID, domain string, rows []service.SynonymImportRow) (int, error)
}

// SynonymHandler serves the vocabulary alias management endpoints.
type SynonymHandler struct {
	synonymService SynonymServiceAPI
}

func NewSynonymHandler(synonymService SynonymServiceAPI) *SynonymHandler {
	return &SynonymHandler{synonymService: synonymService}
}

// NewSynonym keeps the constructor shape used by the router wiring.
func NewSynonym() *SynonymHandler {
	return NewSynonymHandler(service.NewSynonymService())
}

// ListSynonymGroups handles GET /datasets/:dataset_id/synonym-groups.
func (h *SynonymHandler) ListSynonymGroups(c *gin.Context) {
	user, code, message := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, message)
		return
	}

	groups, err := h.synonymService.ListSynonymGroups(
		c.Request.Context(),
		user.ID,
		c.Param("dataset_id"),
		c.Query("domain"),
	)
	if err != nil {
		respondSynonymError(c, err)
		return
	}
	common.SuccessWithData(c, groups, "success")
}

// GetSynonymGroup handles GET /synonym-groups/:group_id.
func (h *SynonymHandler) GetSynonymGroup(c *gin.Context) {
	user, code, message := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, message)
		return
	}

	group, err := h.synonymService.GetSynonymGroup(c.Request.Context(), user.ID, c.Param("group_id"))
	if err != nil {
		respondSynonymError(c, err)
		return
	}
	common.SuccessWithData(c, group, "success")
}

// CreateSynonymGroup handles POST /datasets/:dataset_id/synonym-groups.
func (h *SynonymHandler) CreateSynonymGroup(c *gin.Context) {
	user, code, message := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, message)
		return
	}

	var req service.CreateSynonymGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ResponseWithCodeData(c, common.CodeDataError, nil, "Invalid request: "+err.Error())
		return
	}

	group, err := h.synonymService.CreateSynonymGroup(c.Request.Context(), user.ID, c.Param("dataset_id"), req)
	if err != nil {
		respondSynonymError(c, err)
		return
	}
	common.SuccessWithData(c, group, "success")
}

// UpdateSynonymGroup handles PUT /synonym-groups/:group_id.
func (h *SynonymHandler) UpdateSynonymGroup(c *gin.Context) {
	user, code, message := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, message)
		return
	}

	var req service.UpdateSynonymGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ResponseWithCodeData(c, common.CodeDataError, nil, "Invalid request: "+err.Error())
		return
	}

	group, err := h.synonymService.UpdateSynonymGroup(c.Request.Context(), user.ID, c.Param("group_id"), req)
	if err != nil {
		respondSynonymError(c, err)
		return
	}
	common.SuccessWithData(c, group, "success")
}

// DeleteSynonymGroup handles DELETE /synonym-groups/:group_id.
func (h *SynonymHandler) DeleteSynonymGroup(c *gin.Context) {
	user, code, message := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, message)
		return
	}

	if err := h.synonymService.DeleteSynonymGroup(c.Request.Context(), user.ID, c.Param("group_id")); err != nil {
		respondSynonymError(c, err)
		return
	}
	common.SuccessWithData(c, nil, "success")
}

// ImportSynonymGroupsRequest is the body of a bulk vocabulary upload.
type ImportSynonymGroupsRequest struct {
	Domain string                     `json:"domain"`
	Rows   []service.SynonymImportRow `json:"rows"`
}

// ImportSynonymGroups handles POST /datasets/:dataset_id/synonym-groups/import.
func (h *SynonymHandler) ImportSynonymGroups(c *gin.Context) {
	user, code, message := GetUser(c)
	if code != common.CodeSuccess {
		common.ErrorWithCode(c, code, message)
		return
	}

	var req ImportSynonymGroupsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ResponseWithCodeData(c, common.CodeDataError, nil, "Invalid request: "+err.Error())
		return
	}

	created, err := h.synonymService.ImportSynonymGroups(
		c.Request.Context(),
		user.ID,
		c.Param("dataset_id"),
		req.Domain,
		req.Rows,
	)
	if err != nil {
		respondSynonymError(c, err)
		return
	}
	common.SuccessWithData(c, gin.H{"created": created}, "success")
}

// respondSynonymError maps service errors onto the shared response codes.
// A missing group and a cross-tenant group are reported identically so the
// endpoint cannot be used to enumerate another tenant's vocabulary.
func respondSynonymError(c *gin.Context, err error) {
	if errors.Is(err, service.ErrSynonymGroupNotFound) {
		common.ResponseWithCodeData(c, common.CodeDataError, nil, "synonym group not found")
		return
	}
	if respondPermissionErrorIf(c, err, true) {
		return
	}
	common.ResponseWithCodeData(c, common.CodeServerError, nil, err.Error())
}
