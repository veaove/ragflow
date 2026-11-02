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
	"time"

	"ragflow/internal/entity"

	"gorm.io/gorm"
)

// DocumentFolderDAO is the data access object for knowledge-base folders.
//
// 树的父子关系存在 parent_id 上，递归一律在服务层用一次全量读取完成：
// 单个知识库的目录数量在千级以内，一次 SELECT 比 CTE 更省事，
// 也不依赖 MySQL 8（本项目线上是 5.7 口径，CTE 不可用）。
type DocumentFolderDAO struct{}

// NewDocumentFolderDAO creates a DocumentFolderDAO.
func NewDocumentFolderDAO() *DocumentFolderDAO {
	return &DocumentFolderDAO{}
}

// Create inserts a folder row.
func (dao *DocumentFolderDAO) Create(ctx context.Context, db *gorm.DB, folder *entity.DocumentFolder) error {
	return db.WithContext(ctx).Create(folder).Error
}

// GetByID loads a folder by primary key.
func (dao *DocumentFolderDAO) GetByID(ctx context.Context, db *gorm.DB, id string) (*entity.DocumentFolder, error) {
	var folder entity.DocumentFolder
	if err := db.WithContext(ctx).Where("id = ?", id).Take(&folder).Error; err != nil {
		return nil, err
	}
	return &folder, nil
}

// GetByIDInDataset loads a folder only when it belongs to the given dataset.
// 带上 dataset_id 是为了让跨知识库的 id 直接表现为"不存在"，而不是被误操作。
func (dao *DocumentFolderDAO) GetByIDInDataset(ctx context.Context, db *gorm.DB, datasetID, id string) (*entity.DocumentFolder, error) {
	var folder entity.DocumentFolder
	if err := db.WithContext(ctx).Where("id = ? AND dataset_id = ?", id, datasetID).Take(&folder).Error; err != nil {
		return nil, err
	}
	return &folder, nil
}

// ListByDataset returns every folder of one knowledge base ordered by name.
func (dao *DocumentFolderDAO) ListByDataset(ctx context.Context, db *gorm.DB, datasetID string) ([]*entity.DocumentFolder, error) {
	folders := make([]*entity.DocumentFolder, 0)
	err := db.WithContext(ctx).
		Where("dataset_id = ?", datasetID).
		Order("name ASC").
		Find(&folders).Error
	return folders, err
}

// GetSiblingByName finds a folder with the same name under the same parent.
// parentID "" means the root level.
func (dao *DocumentFolderDAO) GetSiblingByName(ctx context.Context, db *gorm.DB, datasetID, parentID, name string) (*entity.DocumentFolder, error) {
	var folder entity.DocumentFolder
	err := db.WithContext(ctx).
		Where("dataset_id = ? AND parent_id = ? AND name = ?", datasetID, parentID, name).
		Take(&folder).Error
	if err != nil {
		return nil, err
	}
	return &folder, nil
}

// Update applies a partial update to one folder.
func (dao *DocumentFolderDAO) Update(ctx context.Context, db *gorm.DB, id string, updates map[string]interface{}) error {
	if _, ok := updates["update_time"]; !ok {
		updates["update_time"] = time.Now().UnixMilli()
	}
	if _, ok := updates["update_date"]; !ok {
		updates["update_date"] = time.Now().Truncate(time.Second)
	}
	return db.WithContext(ctx).
		Model(&entity.DocumentFolder{}).
		Where("id = ?", id).
		Updates(updates).Error
}

// DeleteByIDs removes folder rows of one knowledge base.
func (dao *DocumentFolderDAO) DeleteByIDs(ctx context.Context, db *gorm.DB, datasetID string, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	return db.WithContext(ctx).
		Where("dataset_id = ? AND id IN ?", datasetID, ids).
		Delete(&entity.DocumentFolder{}).Error
}

// CountDocumentsByFolder returns the direct document count per folder id, plus
// the number of documents that belong to no folder.
func (dao *DocumentFolderDAO) CountDocumentsByFolder(ctx context.Context, db *gorm.DB, datasetID string) (map[string]int64, int64, error) {
	type countRow struct {
		FolderID string
		Count    int64
	}
	var rows []countRow
	err := db.WithContext(ctx).
		Model(&entity.Document{}).
		Select("IFNULL(folder_id, '') AS folder_id, COUNT(*) AS count").
		Where("kb_id = ?", datasetID).
		Group("IFNULL(folder_id, '')").
		Scan(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	perFolder := make(map[string]int64, len(rows))
	var unfiled int64
	for _, row := range rows {
		if row.FolderID == "" {
			unfiled = row.Count
			continue
		}
		perFolder[row.FolderID] = row.Count
	}
	return perFolder, unfiled, nil
}

// ListDocumentIDsUnderFolders returns the document ids that belong to any of the
// given folders (direct membership only; callers pass the whole subtree).
func (dao *DocumentFolderDAO) ListDocumentIDsUnderFolders(ctx context.Context, db *gorm.DB, datasetID string, folderIDs []string) ([]string, error) {
	ids := make([]string, 0)
	if len(folderIDs) == 0 {
		return ids, nil
	}
	err := db.WithContext(ctx).
		Model(&entity.Document{}).
		Where("kb_id = ? AND folder_id IN ?", datasetID, folderIDs).
		Pluck("id", &ids).Error
	return ids, err
}

// ListDocumentsUnderFolders returns the documents that belong to any of the
// given folders (direct membership only; callers pass the whole subtree).
func (dao *DocumentFolderDAO) ListDocumentsUnderFolders(ctx context.Context, db *gorm.DB, datasetID string, folderIDs []string) ([]*entity.Document, error) {
	docs := make([]*entity.Document, 0)
	if len(folderIDs) == 0 {
		return docs, nil
	}
	err := db.WithContext(ctx).
		Where("kb_id = ? AND folder_id IN ?", datasetID, folderIDs).
		Find(&docs).Error
	return docs, err
}

// MoveDocuments assigns the given documents to one folder ("" moves them out of
// any folder). kb_id is part of the predicate so cross-dataset ids are ignored.
func (dao *DocumentFolderDAO) MoveDocuments(ctx context.Context, db *gorm.DB, datasetID string, documentIDs []string, folderID string) (int64, error) {
	if len(documentIDs) == 0 {
		return 0, nil
	}
	var value interface{}
	if folderID == "" {
		value = gorm.Expr("NULL")
	} else {
		value = folderID
	}
	res := db.WithContext(ctx).
		Model(&entity.Document{}).
		Where("id IN ? AND kb_id = ?", documentIDs, datasetID).
		Update("folder_id", value)
	if res.Error != nil {
		return 0, res.Error
	}
	return res.RowsAffected, nil
}
