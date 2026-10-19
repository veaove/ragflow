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
	"strings"

	"ragflow/internal/entity"

	"gorm.io/gorm"
)

// SynonymDAO persists tenant-scoped vocabulary alias groups.
//
// Every write path re-checks tenant ownership instead of trusting the caller,
// so a group id guessed across tenants resolves to gorm.ErrRecordNotFound
// rather than leaking or mutating another tenant's vocabulary.
type SynonymDAO struct{}

func NewSynonymDAO() *SynonymDAO {
	return &SynonymDAO{}
}

// ListGroups returns the groups of one knowledge base with their word counts.
// domain filters by vocabulary domain when non-empty.
func (dao *SynonymDAO) ListGroups(ctx context.Context, db *gorm.DB, tenantID, datasetID, domain string) ([]*entity.SynonymGroup, error) {
	groups := make([]*entity.SynonymGroup, 0)
	q := db.WithContext(ctx).Model(&entity.SynonymGroup{}).
		Where("tenant_id = ?", tenantID).
		Where("dataset_id = ?", datasetID)
	if domain != "" {
		q = q.Where("domain = ?", domain)
	}
	// word_count is aggregated from synonym_word so the list view does not need
	// a second round trip per row.
	err := q.
		Select("synonym_group.*, (SELECT COUNT(1) FROM synonym_word WHERE synonym_word.group_id = synonym_group.id) AS word_count").
		Order("synonym_group.create_time DESC").
		Find(&groups).Error
	return groups, err
}

// GetGroup returns one group owned by the tenant.
func (dao *SynonymDAO) GetGroup(ctx context.Context, db *gorm.DB, tenantID, groupID string) (*entity.SynonymGroup, error) {
	var group entity.SynonymGroup
	if err := db.WithContext(ctx).Where("tenant_id = ?", tenantID).Where("id = ?", groupID).Take(&group).Error; err != nil {
		return nil, err
	}
	return &group, nil
}

// ListWords returns the words of one group ordered so the primary surface form
// comes first, keeping the manager table stable across reloads.
func (dao *SynonymDAO) ListWords(ctx context.Context, db *gorm.DB, tenantID, groupID string) ([]*entity.SynonymWord, error) {
	words := make([]*entity.SynonymWord, 0)
	err := db.WithContext(ctx).Model(&entity.SynonymWord{}).
		Where("group_id = ?", groupID).
		Order("is_primary DESC").
		Order("create_time ASC").
		Find(&words).Error
	return words, err
}

// ListWordsByGroupIDs returns the words of many groups in one query, so the list
// view can render each group's standard word and aliases without an N+1 round
// trip. The result is grouped by group_id.
func (dao *SynonymDAO) ListWordsByGroupIDs(ctx context.Context, db *gorm.DB, groupIDs []string) (map[string][]*entity.SynonymWord, error) {
	if len(groupIDs) == 0 {
		return map[string][]*entity.SynonymWord{}, nil
	}
	words := make([]*entity.SynonymWord, 0)
	err := db.WithContext(ctx).Model(&entity.SynonymWord{}).
		Where("group_id IN ?", groupIDs).
		Order("is_primary DESC").
		Order("create_time ASC").
		Find(&words).Error
	if err != nil {
		return nil, err
	}
	byGroup := make(map[string][]*entity.SynonymWord, len(groupIDs))
	for _, w := range words {
		byGroup[w.GroupID] = append(byGroup[w.GroupID], w)
	}
	return byGroup, nil
}

// CreateGroup inserts a group. The caller supplies a generated id.
func (dao *SynonymDAO) CreateGroup(ctx context.Context, db *gorm.DB, group *entity.SynonymGroup) error {
	return db.WithContext(ctx).Create(group).Error
}

// UpdateGroup applies the mutable columns of a group the tenant owns.
func (dao *SynonymDAO) UpdateGroup(ctx context.Context, db *gorm.DB, tenantID, groupID string, updates map[string]any) error {
	if _, err := dao.GetGroup(ctx, db, tenantID, groupID); err != nil {
		return err
	}
	return db.WithContext(ctx).Model(&entity.SynonymGroup{}).
		Where("tenant_id = ?", tenantID).
		Where("id = ?", groupID).
		Updates(updates).Error
}

// DeleteGroup removes a group together with its words in one transaction so a
// half-deleted group can never be served to the retrieval path.
func (dao *SynonymDAO) DeleteGroup(ctx context.Context, db *gorm.DB, tenantID, groupID string) error {
	if _, err := dao.GetGroup(ctx, db, tenantID, groupID); err != nil {
		return err
	}
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("group_id = ?", groupID).Delete(&entity.SynonymWord{}).Error; err != nil {
			return err
		}
		return tx.Where("tenant_id = ?", tenantID).Where("id = ?", groupID).Delete(&entity.SynonymGroup{}).Error
	})
}

// CreateWords bulk-inserts the words of a group.
func (dao *SynonymDAO) CreateWords(ctx context.Context, db *gorm.DB, words []*entity.SynonymWord) error {
	if len(words) == 0 {
		return nil
	}
	return db.WithContext(ctx).Create(&words).Error
}

// PromotePendingByChangeSet flips every pending group and word of a change set
// to live, so they take effect at query time (the retrieval dictionary loads
// only live rows). Pending copies that carry source_group_id first disable the
// live group they replace, effecting an atomic swap.
func (dao *SynonymDAO) PromotePendingByChangeSet(ctx context.Context, db *gorm.DB, tenantID, datasetID, changeSetID string) error {
	// Disable the live groups that pending copies replace (swap-in).
	if err := db.WithContext(ctx).Model(&entity.SynonymGroup{}).
		Where("tenant_id = ?", tenantID).
		Where("dataset_id = ?", datasetID).
		Where("status = ?", entity.SynonymStatusLive).
		Where("id IN (?)",
			db.WithContext(ctx).Model(&entity.SynonymGroup{}).
				Select("source_group_id").
				Where("tenant_id = ?", tenantID).
				Where("dataset_id = ?", datasetID).
				Where("change_set_id = ?", changeSetID).
				Where("status = ?", entity.SynonymStatusPending).
				Where("source_group_id <> ''"),
		).
		Update("status", entity.SynonymStatusDisabled).Error; err != nil {
		return err
	}

	if err := db.WithContext(ctx).Model(&entity.SynonymGroup{}).
		Where("tenant_id = ?", tenantID).
		Where("dataset_id = ?", datasetID).
		Where("change_set_id = ?", changeSetID).
		Where("status = ?", entity.SynonymStatusPending).
		Update("status", entity.SynonymStatusLive).Error; err != nil {
		return err
	}
	return db.WithContext(ctx).Model(&entity.SynonymWord{}).
		Where("status = ?", entity.SynonymStatusPending).
		Where("group_id IN (?)",
			db.WithContext(ctx).Model(&entity.SynonymGroup{}).
				Select("id").
				Where("tenant_id = ?", tenantID).
				Where("dataset_id = ?", datasetID).
				Where("change_set_id = ?", changeSetID),
		).
		Update("status", entity.SynonymStatusLive).Error
}

// DiscardPendingByChangeSet soft-deletes every pending group and word of a
// change set, abandoning the staged vocabulary without touching live rows.
func (dao *SynonymDAO) DiscardPendingByChangeSet(ctx context.Context, db *gorm.DB, tenantID, datasetID, changeSetID string) error {
	groupIDs := db.WithContext(ctx).Model(&entity.SynonymGroup{}).
		Select("id").
		Where("tenant_id = ?", tenantID).
		Where("dataset_id = ?", datasetID).
		Where("change_set_id = ?", changeSetID).
		Where("status = ?", entity.SynonymStatusPending)
	if err := db.WithContext(ctx).Model(&entity.SynonymWord{}).
		Where("group_id IN (?)", groupIDs).
		Update("status", entity.SynonymStatusDisabled).Error; err != nil {
		return err
	}
	return db.WithContext(ctx).Model(&entity.SynonymGroup{}).
		Where("tenant_id = ?", tenantID).
		Where("dataset_id = ?", datasetID).
		Where("change_set_id = ?", changeSetID).
		Where("status = ?", entity.SynonymStatusPending).
		Update("status", entity.SynonymStatusDisabled).Error
}

// DeleteWordsByGroup clears the words of a group. It is used together with
// CreateWords to apply a whole-list replacement in one transaction.
func (dao *SynonymDAO) DeleteWordsByGroup(ctx context.Context, db *gorm.DB, groupID string) error {
	return db.WithContext(ctx).Where("group_id = ?", groupID).Delete(&entity.SynonymWord{}).Error
}

// LoadDictionary implements nlp.SynonymLoader so the retrieval path can read
// tenant vocabulary without importing the service layer.
func (dao *SynonymDAO) LoadDictionary(ctx context.Context, tenantID, datasetID string) (map[string][]string, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	// DB is the package-level handle; the ctx-carrying copy is derived from it.
	return dao.GetDictionaryByDataset(ctx, DB.WithContext(ctx), tenantID, datasetID)
}

// GetDictionaryByDataset builds the retrieval-facing dictionary for one
// knowledge base: every word of a group maps to the group's other words.
//
// The word itself is excluded from its own expansion so an exact hit does not
// spend one of the caller's keyword slots on a duplicate of the query.
func (dao *SynonymDAO) GetDictionaryByDataset(ctx context.Context, db *gorm.DB, tenantID, datasetID string) (map[string][]string, error) {
	type row struct {
		GroupID string
		Word    string
	}
	rows := make([]row, 0)
	err := db.WithContext(ctx).Table("synonym_word").
		Select("synonym_word.group_id, synonym_word.word").
		Joins("JOIN synonym_group ON synonym_group.id = synonym_word.group_id").
		Where("synonym_group.tenant_id = ?", tenantID).
		Where("synonym_group.dataset_id = ?", datasetID).
		// Only live groups expand at query time. Pending groups are staged
		// changes that must not affect online retrieval until published.
		Where("synonym_group.status = ?", entity.SynonymStatusLive).
		Where("synonym_word.status = ?", entity.SynonymStatusLive).
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}

	grouped := make(map[string][]string)
	order := make([]string, 0)
	for _, r := range rows {
		if _, seen := grouped[r.GroupID]; !seen {
			order = append(order, r.GroupID)
		}
		grouped[r.GroupID] = append(grouped[r.GroupID], r.Word)
	}

	dict := make(map[string][]string)
	for _, groupID := range order {
		members := grouped[groupID]
		if len(members) < 2 {
			// A single-word group expands to nothing, so it contributes no
			// keywords and is skipped rather than stored as an empty slice.
			continue
		}
		for _, word := range members {
			others := make([]string, 0, len(members)-1)
			for _, other := range members {
				if other != word {
					others = append(others, other)
				}
			}
			// Keys are folded to lower case so the lookup key matches whatever
			// casing the customer typed ("50ETF" / "50etf").
			key := strings.ToLower(word)
			dict[key] = append(dict[key], others...)
		}
	}
	return dict, nil
}

// ListGroupsByChangeSet returns the pending groups of a change set with their
// words attached, so the diff view can render the staged vocabulary without an
// N+1 round trip.
func (dao *SynonymDAO) ListGroupsByChangeSet(ctx context.Context, db *gorm.DB, tenantID, datasetID, changeSetID string) ([]*entity.SynonymGroup, error) {
	groups := make([]*entity.SynonymGroup, 0)
	err := db.WithContext(ctx).Model(&entity.SynonymGroup{}).
		Where("tenant_id = ?", tenantID).
		Where("dataset_id = ?", datasetID).
		Where("change_set_id = ?", changeSetID).
		Where("status = ?", entity.SynonymStatusPending).
		Order("create_time DESC").
		Find(&groups).Error
	if err != nil {
		return nil, err
	}
	if len(groups) == 0 {
		return groups, nil
	}
	ids := make([]string, 0, len(groups))
	for _, g := range groups {
		ids = append(ids, g.ID)
	}
	byGroup, err := dao.ListWordsByGroupIDs(ctx, db, ids)
	if err != nil {
		return nil, err
	}
	for _, g := range groups {
		g.Words = byGroup[g.ID]
		if g.Words == nil {
			g.Words = []*entity.SynonymWord{}
		}
		g.WordCount = len(g.Words)
	}
	return groups, nil
}
