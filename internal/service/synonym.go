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
	"ragflow/internal/service/nlp"

	"gorm.io/gorm"
)

// ErrSynonymGroupNotFound is returned when a group does not exist inside the
// caller's tenant. Ownership failures are deliberately indistinguishable from a
// missing row so a caller cannot probe for another tenant's group ids.
var ErrSynonymGroupNotFound = errors.New("synonym group not found")

// maxSynonymWordsPerGroup caps one group so a single import cannot blow up the
// keyword budget of every query that touches this vocabulary.
const maxSynonymWordsPerGroup = 200

// SynonymService manages tenant vocabulary alias groups and keeps the retrieval
// cache in step with the stored rows.
type SynonymService struct {
	synonymDAO *dao.SynonymDAO
}

func NewSynonymService() *SynonymService {
	return &SynonymService{synonymDAO: dao.NewSynonymDAO()}
}

// SynonymWordInput is one vocabulary entry in a create or update request.
type SynonymWordInput struct {
	Word      string `json:"word"`
	IsPrimary bool   `json:"is_primary"`
}

// CreateSynonymGroupRequest is the body of a group creation.
type CreateSynonymGroupRequest struct {
	Name      string             `json:"name" binding:"required"`
	Domain    string             `json:"domain"`
	Scope     string             `json:"scope"`
	GroupType string             `json:"group_type"`
	Remark    string             `json:"remark"`
	Words     []SynonymWordInput `json:"words"`
}

// UpdateSynonymGroupRequest is the body of a group update. Words is a pointer
// so an absent field leaves the stored words untouched while an explicit empty
// array clears them.
type UpdateSynonymGroupRequest struct {
	Name      *string             `json:"name"`
	Domain    *string             `json:"domain"`
	Scope     *string             `json:"scope"`
	GroupType *string             `json:"group_type"`
	Remark    *string             `json:"remark"`
	Words     *[]SynonymWordInput `json:"words"`
}

// ListSynonymGroups returns the vocabulary groups of one knowledge base.
func (s *SynonymService) ListSynonymGroups(ctx context.Context, userID, datasetID, domain string) ([]*entity.SynonymGroup, error) {
	tenantID, err := s.resolveTenant(ctx, userID, datasetID)
	if err != nil {
		return nil, err
	}
	groups, err := s.synonymDAO.ListGroups(ctx, dao.DB, tenantID, datasetID, domain)
	if err != nil {
		return nil, err
	}
	// Attach each group's words so the list view can render the standard word
	// and aliases without an N+1 round trip per row.
	if len(groups) > 0 {
		ids := make([]string, 0, len(groups))
		for _, g := range groups {
			ids = append(ids, g.ID)
		}
		byGroup, werr := s.synonymDAO.ListWordsByGroupIDs(ctx, dao.DB, ids)
		if werr != nil {
			return nil, werr
		}
		for _, g := range groups {
			g.Words = byGroup[g.ID]
			if g.Words == nil {
				g.Words = []*entity.SynonymWord{}
			}
		}
	}
	return groups, nil
}

// GetSynonymGroup returns one group with its words attached.
func (s *SynonymService) GetSynonymGroup(ctx context.Context, userID, groupID string) (*entity.SynonymGroup, error) {
	tenantID, err := requireOwnedTenantID(ctx, userID)
	if err != nil {
		return nil, err
	}
	group, err := s.synonymDAO.GetGroup(ctx, dao.DB, tenantID, groupID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrSynonymGroupNotFound
	}
	if err != nil {
		return nil, err
	}
	words, err := s.synonymDAO.ListWords(ctx, dao.DB, tenantID, group.ID)
	if err != nil {
		return nil, err
	}
	group.Words = words
	group.WordCount = len(words)
	return group, nil
}

// CreateSynonymGroup stores a new vocabulary group and its words.
func (s *SynonymService) CreateSynonymGroup(ctx context.Context, userID, datasetID string, req CreateSynonymGroupRequest) (*entity.SynonymGroup, error) {
	tenantID, err := s.resolveTenant(ctx, userID, datasetID)
	if err != nil {
		return nil, err
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, errors.New("synonym group name is required")
	}
	domain := normalizeSynonymDomain(req.Domain)
	words, err := normalizeSynonymWords(req.Words)
	if err != nil {
		return nil, err
	}

	group := &entity.SynonymGroup{
		ID:        common.GenerateUUID(),
		TenantID:  tenantID,
		DatasetID: datasetID,
		Name:      name,
		Domain:    domain,
		Scope:     normalizeSynonymScope(req.Scope),
		GroupType: normalizeSynonymGroupType(req.GroupType),
		Status:    entity.SynonymStatusLive,
		Remark:    strings.TrimSpace(req.Remark),
	}

	err = dao.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := s.synonymDAO.CreateGroup(ctx, tx, group); err != nil {
			return err
		}
		rows := buildSynonymWordRows(group.ID, words)
		return s.synonymDAO.CreateWords(ctx, tx, rows)
	})
	if err != nil {
		return nil, err
	}

	nlp.InvalidateSynonymCache(datasetID)

	group.Words = buildSynonymWordEntities(group.ID, words)
	group.WordCount = len(words)
	return group, nil
}

// UpdateSynonymGroup applies a partial update to a group. When Words is present
// the stored word list is replaced wholesale inside one transaction, so a
// failed write cannot leave the group half-updated.
func (s *SynonymService) UpdateSynonymGroup(ctx context.Context, userID, groupID string, req UpdateSynonymGroupRequest) (*entity.SynonymGroup, error) {
	tenantID, err := requireOwnedTenantID(ctx, userID)
	if err != nil {
		return nil, err
	}

	group, err := s.synonymDAO.GetGroup(ctx, dao.DB, tenantID, groupID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrSynonymGroupNotFound
	}
	if err != nil {
		return nil, err
	}

	updates := make(map[string]any)
	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		if name == "" {
			return nil, errors.New("synonym group name is required")
		}
		updates["name"] = name
	}
	if req.Domain != nil {
		updates["domain"] = normalizeSynonymDomain(*req.Domain)
	}
	if req.Scope != nil {
		updates["scope"] = normalizeSynonymScope(*req.Scope)
	}
	if req.GroupType != nil {
		updates["group_type"] = normalizeSynonymGroupType(*req.GroupType)
	}
	if req.Remark != nil {
		updates["remark"] = strings.TrimSpace(*req.Remark)
	}

	var words []SynonymWordInput
	if req.Words != nil {
		words, err = normalizeSynonymWords(*req.Words)
		if err != nil {
			return nil, err
		}
	}

	err = dao.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if len(updates) > 0 {
			if err := s.synonymDAO.UpdateGroup(ctx, tx, tenantID, groupID, updates); err != nil {
				return err
			}
		}
		if req.Words != nil {
			if err := s.synonymDAO.DeleteWordsByGroup(ctx, tx, groupID); err != nil {
				return err
			}
			rows := buildSynonymWordRows(groupID, words)
			if err := s.synonymDAO.CreateWords(ctx, tx, rows); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	nlp.InvalidateSynonymCache(group.DatasetID)

	return s.GetSynonymGroup(ctx, userID, groupID)
}

// DeleteSynonymGroup removes a group and its words.
func (s *SynonymService) DeleteSynonymGroup(ctx context.Context, userID, groupID string) error {
	tenantID, err := requireOwnedTenantID(ctx, userID)
	if err != nil {
		return err
	}

	group, err := s.synonymDAO.GetGroup(ctx, dao.DB, tenantID, groupID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ErrSynonymGroupNotFound
	}
	if err != nil {
		return err
	}

	if err := s.synonymDAO.DeleteGroup(ctx, dao.DB, tenantID, groupID); err != nil {
		return err
	}

	nlp.InvalidateSynonymCache(group.DatasetID)
	return nil
}

// ImportSynonymGroups bulk-creates groups from a two-column upload
// (concept, alias). Every row becomes one group whose members are the concept
// plus its aliases, which is exactly the shape the retrieval dictionary needs.
func (s *SynonymService) ImportSynonymGroups(ctx context.Context, userID, datasetID, domain string, rows []SynonymImportRow) (int, error) {
	tenantID, err := s.resolveTenant(ctx, userID, datasetID)
	if err != nil {
		return 0, err
	}
	if len(rows) == 0 {
		return 0, nil
	}

	normalized := make([]entity.SynonymGroup, 0, len(rows))
	wordsByGroup := make(map[string][]SynonymWordInput, len(rows))
	order := make([]string, 0, len(rows))

	for _, row := range rows {
		concept := strings.TrimSpace(row.Concept)
		if concept == "" {
			continue
		}
		members := []SynonymWordInput{{Word: concept, IsPrimary: true}}
		for _, alias := range row.Aliases {
			alias = strings.TrimSpace(alias)
			if alias == "" || alias == concept {
				continue
			}
			members = append(members, SynonymWordInput{Word: alias})
		}
		if len(members) < 2 {
			// A concept with no alias expands to nothing, so importing it would
			// only create noise for the customer to clean up later.
			continue
		}

		group := entity.SynonymGroup{
			ID:        common.GenerateUUID(),
			TenantID:  tenantID,
			DatasetID: datasetID,
			Name:      concept,
			Domain:    normalizeSynonymDomain(domain),
			Remark:    strings.TrimSpace(row.Remark),
		}
		normalized = append(normalized, group)
		wordsByGroup[group.ID] = members
		order = append(order, group.ID)
	}

	if len(normalized) == 0 {
		return 0, nil
	}

	err = dao.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, group := range normalized {
			if err := s.synonymDAO.CreateGroup(ctx, tx, &group); err != nil {
				return err
			}
			if err := s.synonymDAO.CreateWords(ctx, tx, buildSynonymWordRows(group.ID, wordsByGroup[group.ID])); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return 0, err
	}

	nlp.InvalidateSynonymCache(datasetID)
	return len(normalized), nil
}

// SynonymImportRow is one line of a bulk vocabulary upload.
type SynonymImportRow struct {
	Concept string   `json:"concept"`
	Aliases []string `json:"aliases"`
	Remark  string   `json:"remark"`
}

// resolveTenant resolves the tenant and asserts the knowledge base belongs to
// it, so a dataset id from another tenant cannot be used to create vocabulary.
func (s *SynonymService) resolveTenant(ctx context.Context, userID, datasetID string) (string, error) {
	datasetID = strings.TrimSpace(datasetID)
	if datasetID == "" {
		return "", errors.New("dataset_id is required")
	}
	tenantID, err := requireOwnedTenantID(ctx, userID)
	if err != nil {
		return "", err
	}
	// The tenant filter is pushed into the query so another tenant's dataset id
	// simply does not resolve.
	if _, err := dao.NewKnowledgebaseDAO().GetByIDAndTenantID(ctx, dao.DB, datasetID, tenantID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", ErrSynonymGroupNotFound
		}
		return "", err
	}
	return tenantID, nil
}

// normalizeSynonymDomain validates the vocabulary domain, defaulting to the
// shared fund domain when the caller leaves it empty.
func normalizeSynonymDomain(domain string) string {
	switch strings.ToLower(strings.TrimSpace(domain)) {
	case entity.SynonymDomainHx, "huaxia", "华夏":
		return entity.SynonymDomainHx
	default:
		return entity.SynonymDomainFund
	}
}

// normalizeSynonymScope validates the effect range, defaulting to kb (single
// knowledge base). Only kb and tenant are accepted.
func normalizeSynonymScope(scope string) string {
	switch strings.ToLower(strings.TrimSpace(scope)) {
	case entity.SynonymScopeTenant:
		return entity.SynonymScopeTenant
	default:
		return entity.SynonymScopeKB
	}
}

// normalizeSynonymGroupType validates the group type, defaulting to synonym
// (semantic expansion). Only synonym and proper are accepted.
func normalizeSynonymGroupType(groupType string) string {
	switch strings.ToLower(strings.TrimSpace(groupType)) {
	case entity.SynonymGroupTypeProper:
		return entity.SynonymGroupTypeProper
	default:
		return entity.SynonymGroupTypeSynonym
	}
}

// normalizeSynonymWords trims, drops blanks and duplicates, and enforces the
// per-group cap. At most one entry is treated as primary so the manager table
// has a stable canonical form.
func normalizeSynonymWords(words []SynonymWordInput) ([]SynonymWordInput, error) {
	out := make([]SynonymWordInput, 0, len(words))
	seen := make(map[string]struct{}, len(words))
	primarySeen := false

	for _, w := range words {
		word := strings.TrimSpace(w.Word)
		if word == "" {
			continue
		}
		key := strings.ToLower(word)
		if _, dup := seen[key]; dup {
			continue
		}
		seen[key] = struct{}{}

		isPrimary := w.IsPrimary && !primarySeen
		if isPrimary {
			primarySeen = true
		}
		out = append(out, SynonymWordInput{Word: word, IsPrimary: isPrimary})

		if len(out) >= maxSynonymWordsPerGroup {
			break
		}
	}

	if len(out) > maxSynonymWordsPerGroup {
		return nil, fmt.Errorf("too many words in one group: limit is %d", maxSynonymWordsPerGroup)
	}
	return out, nil
}

func buildSynonymWordRows(groupID string, words []SynonymWordInput) []*entity.SynonymWord {
	if len(words) == 0 {
		return nil
	}
	rows := make([]*entity.SynonymWord, 0, len(words))
	for _, w := range words {
		rows = append(rows, &entity.SynonymWord{
			ID:        common.GenerateUUID(),
			GroupID:   groupID,
			Word:      w.Word,
			IsPrimary: w.IsPrimary,
			// Explicitly set lifecycle fields: GORM writes the Go zero value ""
			// instead of the column DEFAULT when the field is empty, so relying on
			// the DB default would store '' and the retrieval path's
			// `WHERE status='live'` filter would drop every newly created word.
			Status: entity.SynonymStatusLive,
			Weight: 1.00,
		})
	}
	return rows
}

func buildSynonymWordEntities(groupID string, words []SynonymWordInput) []*entity.SynonymWord {
	rows := buildSynonymWordRows(groupID, words)
	if rows == nil {
		return []*entity.SynonymWord{}
	}
	return rows
}
