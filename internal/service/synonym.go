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
	"ragflow/internal/permission"
	"ragflow/internal/service/nlp"

	"gorm.io/gorm"
)

// ErrSynonymGroupNotFound is returned when a group does not exist inside the
// caller's tenant. Ownership failures are deliberately indistinguishable from a
// missing row so a caller cannot probe for another tenant's group ids.
var ErrSynonymGroupNotFound = errors.New("synonym group not found")

// ErrDatasetNotFound is returned when the knowledge base behind a vocabulary
// request does not exist or is not visible to the caller.
//
// 这跟 ErrSynonymGroupNotFound 是两件事：前者是「知识库这层」不通，后者是
// 「词组这层」不通。早期把前者也映射成 ErrSynonymGroupNotFound，页面上就显示
// 「词组不存在」——而实际上词组可能一个都没少，是知识库没解析到。用户在词表页
// 看到「暂无词组」加一句「synonym group not found」，既看不懂也查不下去。
var ErrDatasetNotFound = errors.New("dataset not found")

// ErrSynonymGroupNeedsChangeSet is returned when a caller edits a version that
// is no longer live without supplying a change set.
//
// Such a row cannot be written in place: a direct write makes its words live
// while the group itself stays disabled, so the edit silently never reaches
// retrieval. Staging is the only path that works for these rows, and the
// vocabulary page always opens a change set before saving — this error means
// that step failed and the caller should simply retry.
var ErrSynonymGroupNeedsChangeSet = errors.New("saving this vocabulary group requires a change set; refresh the page and retry")

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
	Name        string             `json:"name" binding:"required"`
	Domain      string             `json:"domain"`
	Scope       string             `json:"scope"`
	GroupType   string             `json:"group_type"`
	Remark      string             `json:"remark"`
	Words       []SynonymWordInput `json:"words"`
	ChangeSetID string             `json:"change_set_id"`
}

// UpdateSynonymGroupRequest is the body of a group update. Words is a pointer
// so an absent field leaves the stored words untouched while an explicit empty
// array clears them.
type UpdateSynonymGroupRequest struct {
	Name        *string             `json:"name"`
	Domain      *string             `json:"domain"`
	Scope       *string             `json:"scope"`
	GroupType   *string             `json:"group_type"`
	Remark      *string             `json:"remark"`
	Words       *[]SynonymWordInput `json:"words"`
	ChangeSetID string              `json:"change_set_id"`
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
	// Drop the leftovers of discarded staged copies before attaching words: they
	// are rows a previous discard flagged disabled instead of deleting, and the
	// manager renders that as 已被新版本替换 even though nothing was replaced.
	groups = dropDiscardedLeftovers(groups)
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
			// WordCount is `gorm:"-"`, so the DAO's COUNT subquery never lands in
			// it and the list always rendered 词条数 0. The words are already
			// loaded here, so derive the count instead of adding a projection the
			// entity deliberately cannot scan.
			g.WordCount = len(g.Words)
		}
	}
	return groups, nil
}

// GetSynonymGroup returns one group with its words attached.
func (s *SynonymService) GetSynonymGroup(ctx context.Context, userID, groupID string) (*entity.SynonymGroup, error) {
	group, tenantID, err := s.resolveGroup(ctx, userID, groupID)
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
	// Staged mode: when the caller supplies a change set, the group is written
	// pending and does not affect retrieval until published.
	if req.ChangeSetID != "" {
		group.Status = entity.SynonymStatusPending
		group.ChangeSetID = req.ChangeSetID
	}

	err = dao.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := s.synonymDAO.CreateGroup(ctx, tx, group); err != nil {
			return err
		}
		rows := buildSynonymWordRows(group.ID, words, group.Status)
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
	group, tenantID, err := s.resolveGroup(ctx, userID, groupID)
	if err != nil {
		return nil, err
	}

	// Editing an existing group never touches the row that is online now: the
	// edit is written as a pending copy carrying source_group_id, and publish
	// swaps the copy in. Online retrieval is unaffected until then.
	//
	// A disabled group is a version an earlier publish superseded, and it stays
	// editable — the manager lists it, so the user has to be able to fix it. Its
	// edit is staged against the live head of the version chain rather than
	// against the archived row itself: a copy whose source is already disabled
	// would go live next to the current version instead of replacing it.
	if req.ChangeSetID != "" && group.Status != entity.SynonymStatusPending {
		target := group
		if group.Status == entity.SynonymStatusDisabled {
			head, herr := s.synonymDAO.LiveHeadOfChain(ctx, dao.DB, tenantID, group.DatasetID, group.ID)
			if herr != nil {
				return nil, herr
			}
			if head != nil {
				target = head
			}
		}
		return s.stageUpdateSynonymGroup(ctx, tenantID, target, req)
	}
	// Reaching here with a disabled row means no change set was supplied. Writing
	// it directly would flip only its words live while the group stays disabled,
	// so the edit would never reach retrieval — refuse loudly instead.
	if group.Status == entity.SynonymStatusDisabled {
		return nil, ErrSynonymGroupNeedsChangeSet
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
			rows := buildSynonymWordRows(groupID, words, entity.SynonymStatusLive)
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
	group, tenantID, err := s.resolveGroup(ctx, userID, groupID)
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
			if err := s.synonymDAO.CreateWords(ctx, tx, buildSynonymWordRows(group.ID, wordsByGroup[group.ID], entity.SynonymStatusLive)); err != nil {
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

// resolveTenant returns the tenant that owns the knowledge base and asserts the
// caller may manage its vocabulary. Every row this service writes carries that
// tenant, which is also the tenant retrieval loads the dictionary with.
//
// The tenant must come from the knowledge base itself. Taking it from the
// caller (the previous implementation used "the first tenant the user owns")
// broke every collaborator who is a normal member of the base's tenant while
// owning a tenant of their own: the base was looked up under that other tenant,
// missed, and the miss was reported as "synonym group not found" — which the
// vocabulary page renders as an empty list beside an English error nobody can
// act on. Writing rows under the caller's tenant was wrong for the same reason:
// retrieval asks with the base's tenant, so those words would never expand.
func (s *SynonymService) resolveTenant(ctx context.Context, userID, datasetID string) (string, error) {
	datasetID = strings.TrimSpace(datasetID)
	if datasetID == "" {
		return "", errors.New("dataset_id is required")
	}
	kb, err := dao.NewKnowledgebaseDAO().GetByID(ctx, dao.DB, datasetID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", ErrDatasetNotFound
		}
		return "", err
	}
	// A base without a tenant cannot be authorized at all; report it as missing
	// rather than letting the permission layer fail the request with a 500.
	if strings.TrimSpace(kb.TenantID) == "" {
		return "", ErrDatasetNotFound
	}
	subject := permission.Subject{UserID: userID}
	checker := permission.NewDatabaseChecker(dao.DB)
	// Membership of the base's tenant comes first. It used to be the only real
	// defence: the grant lookup matched subject_kind='team' for every caller
	// without checking that the caller belongs to the tenant it grants to, so
	// anyone who merely knew the base id could rewrite its vocabulary. The
	// engine now binds a team grant to tenant membership, but this surface is a
	// writer, so it stays at "the base's tenant" — never wider than what the
	// read path allows.
	//
	// A personal tenant is keyed by its owner's user id and needs no membership
	// row; the same convention the model factory and the scope query follow.
	if userID != kb.TenantID {
		if err := checker.CheckTenant(ctx, subject, kb.TenantID, permission.TenantMember); err != nil {
			if datasetAccessDenied(err) {
				return "", ErrDatasetNotFound
			}
			return "", err
		}
	}
	// Update rather than Read: this service exposes the vocabulary manager, which
	// writes. The dataset policy grants Update to the same principals that may
	// read it, so this does not narrow who can open the page — it keeps a
	// read-only share from rewriting the words behind retrieval.
	if err := checker.CheckResource(ctx, subject, permission.ResourceRef{Kind: permission.ResourceKindDataset, ID: kb.ID}, permission.OperationUpdate); err != nil {
		if datasetAccessDenied(err) {
			return "", ErrDatasetNotFound
		}
		return "", err
	}
	return kb.TenantID, nil
}

// resolveGroup loads a group by id and authorizes the caller against the
// knowledge base that owns it, returning both the row and that base's tenant.
//
// Group-level endpoints only carry a group id, so the access check has to be
// driven by the row itself. A group whose stored tenant disagrees with its
// base's tenant is not addressable under the base's scope and is reported as
// missing, so a stale row can never be rewritten across tenants.
func (s *SynonymService) resolveGroup(ctx context.Context, userID, groupID string) (*entity.SynonymGroup, string, error) {
	groupID = strings.TrimSpace(groupID)
	if groupID == "" {
		return nil, "", ErrSynonymGroupNotFound
	}
	group, err := s.synonymDAO.GetGroupByID(ctx, dao.DB, groupID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, "", ErrSynonymGroupNotFound
		}
		return nil, "", err
	}
	tenantID, err := s.resolveTenant(ctx, userID, group.DatasetID)
	if err != nil {
		return nil, "", err
	}
	if group.TenantID != tenantID {
		return nil, "", ErrSynonymGroupNotFound
	}
	return group, tenantID, nil
}

// datasetAccessDenied reports whether err is a permission decision meaning "this
// caller may not touch that knowledge base". They are folded into
// ErrDatasetNotFound so a caller cannot tell a missing base from one it is not
// allowed to see — the same rule ErrSynonymGroupNotFound follows.
func datasetAccessDenied(err error) bool {
	return errors.Is(err, permission.ErrPermissionDenied) ||
		errors.Is(err, permission.ErrMembershipNotFound) ||
		errors.Is(err, permission.ErrResourceNotFound)
}

// dropDiscardedLeftovers hides the rows a discard used to leave behind.
//
// Discarding a staged copy of a live group used to mark the copy disabled, the
// same state a published replacement leaves on the version it superseded — so
// the manager showed 已被新版本替换 for a group nothing had replaced, and hid its
// edit entry because the row looked like history. Discard now deletes the copy,
// but older rows are still in the database, and they cannot be told apart from
// real history by status alone.
//
// They can be told apart by the chain: publishing disables the source row, so a
// genuinely superseded version always points at a source that is already
// disabled. A disabled row whose source is still live is a discarded copy.
//
// The live set comes from the same listing rather than from a second query: the
// manager loads the whole base (it never narrows by domain), so every live group
// is in hand already.
func dropDiscardedLeftovers(groups []*entity.SynonymGroup) []*entity.SynonymGroup {
	if len(groups) == 0 {
		return groups
	}
	live := make(map[string]struct{}, len(groups))
	for _, g := range groups {
		if g.Status == entity.SynonymStatusLive {
			live[g.ID] = struct{}{}
		}
	}
	kept := make([]*entity.SynonymGroup, 0, len(groups))
	for _, g := range groups {
		if g.Status == entity.SynonymStatusDisabled && g.SourceGroupID != "" {
			if _, stillLive := live[g.SourceGroupID]; stillLive {
				continue
			}
		}
		kept = append(kept, g)
	}
	return kept
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

func buildSynonymWordRows(groupID string, words []SynonymWordInput, status string) []*entity.SynonymWord {
	if len(words) == 0 {
		return nil
	}
	if status == "" {
		status = entity.SynonymStatusLive
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
			Status: status,
			Weight: 1.00,
		})
	}
	return rows
}

func buildSynonymWordEntities(groupID string, words []SynonymWordInput) []*entity.SynonymWord {
	rows := buildSynonymWordRows(groupID, words, entity.SynonymStatusLive)
	if rows == nil {
		return []*entity.SynonymWord{}
	}
	return rows
}

// stageUpdateSynonymGroup writes a pending copy of a live group for a staged
// edit. The live group is left as-is; the pending copy carries source_group_id
// so PublishChangeSet can swap it in (disable the source, promote the copy).
func (s *SynonymService) stageUpdateSynonymGroup(ctx context.Context, tenantID string, live *entity.SynonymGroup, req UpdateSynonymGroupRequest) (*entity.SynonymGroup, error) {
	name := live.Name
	if req.Name != nil {
		name = strings.TrimSpace(*req.Name)
		if name == "" {
			return nil, errors.New("synonym group name is required")
		}
	}
	domain := live.Domain
	if req.Domain != nil {
		domain = normalizeSynonymDomain(*req.Domain)
	}
	scope := live.Scope
	if req.Scope != nil {
		scope = normalizeSynonymScope(*req.Scope)
	}
	groupType := live.GroupType
	if req.GroupType != nil {
		groupType = normalizeSynonymGroupType(*req.GroupType)
	}
	remark := live.Remark
	if req.Remark != nil {
		remark = strings.TrimSpace(*req.Remark)
	}

	words := []SynonymWordInput{}
	if req.Words != nil {
		var err error
		words, err = normalizeSynonymWords(*req.Words)
		if err != nil {
			return nil, err
		}
	} else {
		// Preserve the live words when the caller did not change them.
		liveWords, err := s.synonymDAO.ListWords(ctx, dao.DB, tenantID, live.ID)
		if err != nil {
			return nil, err
		}
		for _, w := range liveWords {
			words = append(words, SynonymWordInput{Word: w.Word, IsPrimary: w.IsPrimary})
		}
	}

	// Re-stage into the copy this change set already holds for the live group,
	// so saving twice updates one staged item instead of stacking a second copy
	// that would also go live on publish.
	existing, err := s.synonymDAO.FindPendingCopy(ctx, dao.DB, tenantID, live.DatasetID, req.ChangeSetID, live.ID)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		err = dao.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if err := s.synonymDAO.UpdateGroup(ctx, tx, tenantID, existing.ID, map[string]any{
				"name":       name,
				"domain":     domain,
				"scope":      scope,
				"group_type": groupType,
				"remark":     remark,
			}); err != nil {
				return err
			}
			if err := s.synonymDAO.DeleteWordsByGroup(ctx, tx, existing.ID); err != nil {
				return err
			}
			return s.synonymDAO.CreateWords(ctx, tx, buildSynonymWordRows(existing.ID, words, entity.SynonymStatusPending))
		})
		if err != nil {
			return nil, err
		}
		existing.Name = name
		existing.Domain = domain
		existing.Scope = scope
		existing.GroupType = groupType
		existing.Remark = remark
		existing.Words = buildSynonymWordEntities(existing.ID, words)
		existing.WordCount = len(words)
		return existing, nil
	}

	pending := &entity.SynonymGroup{
		ID:            common.GenerateUUID(),
		TenantID:      tenantID,
		DatasetID:     live.DatasetID,
		Name:          name,
		Domain:        domain,
		Scope:         scope,
		GroupType:     groupType,
		Status:        entity.SynonymStatusPending,
		ChangeSetID:   req.ChangeSetID,
		SourceGroupID: live.ID,
		Remark:        remark,
	}

	err = dao.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := s.synonymDAO.CreateGroup(ctx, tx, pending); err != nil {
			return err
		}
		return s.synonymDAO.CreateWords(ctx, tx, buildSynonymWordRows(pending.ID, words, entity.SynonymStatusPending))
	})
	if err != nil {
		return nil, err
	}

	pending.Words = buildSynonymWordEntities(pending.ID, words)
	pending.WordCount = len(words)
	return pending, nil
}
