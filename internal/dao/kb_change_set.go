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

// KbChangeSetDAO persists change sets and test records for the staged-edit
// workflow. Writes always re-check kb/tenant ownership so a guessed id cannot
// mutate another tenant's staged changes.
type KbChangeSetDAO struct{}

func NewKbChangeSetDAO() *KbChangeSetDAO {
	return &KbChangeSetDAO{}
}

// CreateChangeSet inserts a new change set. The caller supplies the id.
func (dao *KbChangeSetDAO) CreateChangeSet(ctx context.Context, db *gorm.DB, cs *entity.KbChangeSet) error {
	return db.WithContext(ctx).Create(cs).Error
}

// GetChangeSet returns one change set owned by the kb/tenant.
func (dao *KbChangeSetDAO) GetChangeSet(ctx context.Context, db *gorm.DB, tenantID, kbID, changeSetID string) (*entity.KbChangeSet, error) {
	var cs entity.KbChangeSet
	if err := db.WithContext(ctx).
		Where("tenant_id = ?", tenantID).
		Where("kb_id = ?", kbID).
		Where("id = ?", changeSetID).
		Take(&cs).Error; err != nil {
		return nil, err
	}
	return &cs, nil
}

// ListOpenChangeSets returns the open (not yet published/discarded) change sets
// of a knowledge base, newest first.
func (dao *KbChangeSetDAO) ListOpenChangeSets(ctx context.Context, db *gorm.DB, tenantID, kbID string) ([]*entity.KbChangeSet, error) {
	sets := make([]*entity.KbChangeSet, 0)
	err := db.WithContext(ctx).Model(&entity.KbChangeSet{}).
		Where("tenant_id = ?", tenantID).
		Where("kb_id = ?", kbID).
		Where("status IN ?", []string{entity.ChangeSetStatusOpen, entity.ChangeSetStatusTested}).
		Order("create_time DESC").
		Find(&sets).Error
	return sets, err
}

// UpdateChangeSetStatus flips a change set's lifecycle state.
func (dao *KbChangeSetDAO) UpdateChangeSetStatus(ctx context.Context, db *gorm.DB, tenantID, kbID, changeSetID, status string) error {
	return db.WithContext(ctx).Model(&entity.KbChangeSet{}).
		Where("tenant_id = ?", tenantID).
		Where("kb_id = ?", kbID).
		Where("id = ?", changeSetID).
		Update("status", status).Error
}

// CreateTestRecord inserts a test-comparison record.
func (dao *KbChangeSetDAO) CreateTestRecord(ctx context.Context, db *gorm.DB, rec *entity.KbTestRecord) error {
	return db.WithContext(ctx).Create(rec).Error
}

// ListTestRecords returns the test records of a change set, oldest first.
func (dao *KbChangeSetDAO) ListTestRecords(ctx context.Context, db *gorm.DB, changeSetID string) ([]*entity.KbTestRecord, error) {
	recs := make([]*entity.KbTestRecord, 0)
	err := db.WithContext(ctx).Model(&entity.KbTestRecord{}).
		Where("change_set_id = ?", changeSetID).
		Order("create_time ASC").
		Find(&recs).Error
	return recs, err
}
