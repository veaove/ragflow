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

// File2DocumentDAO file to document mapping data access object
type File2DocumentDAO struct{}

// NewFile2DocumentDAO create file2document DAO
func NewFile2DocumentDAO() *File2DocumentDAO {
	return &File2DocumentDAO{}
}

// GetKBInfoByFileID gets knowledge base info by file ID
func (dao *File2DocumentDAO) GetKBInfoByFileID(ctx context.Context, db *gorm.DB, fileID string) ([]map[string]interface{}, error) {
	var results []map[string]interface{}

	rows, err := db.WithContext(ctx).Model(&entity.File{}).
		Select("knowledgebase.id, knowledgebase.name, file2document.document_id").
		Joins("JOIN file2document ON file2document.file_id = ?", fileID).
		Joins("JOIN document ON document.id = file2document.document_id").
		Joins("JOIN knowledgebase ON knowledgebase.id = document.kb_id").
		Where("file.id = ?", fileID).
		Rows()
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var kbID, kbName, docID string
		if err = rows.Scan(&kbID, &kbName, &docID); err != nil {
			continue
		}
		results = append(results, map[string]interface{}{
			"kb_id":       kbID,
			"kb_name":     kbName,
			"document_id": docID,
		})
	}

	return results, nil
}

// GetKBInfoByParentIDs returns the distinct knowledge bases linked to the
// documents directly under each parent folder, keyed by parent folder ID.
// Folders carry no document of their own, so this is how a folder row reports
// which knowledge base its contents belong to.
func (dao *File2DocumentDAO) GetKBInfoByParentIDs(ctx context.Context, db *gorm.DB, parentIDs []string) (map[string][]map[string]interface{}, error) {
	result := make(map[string][]map[string]interface{}, len(parentIDs))
	if len(parentIDs) == 0 {
		return result, nil
	}

	rows, err := db.WithContext(ctx).Model(&entity.File{}).
		Select("file.parent_id, knowledgebase.id, knowledgebase.name").
		Joins("JOIN file2document ON file2document.file_id = file.id").
		Joins("JOIN document ON document.id = file2document.document_id").
		Joins("JOIN knowledgebase ON knowledgebase.id = document.kb_id").
		Where("file.parent_id IN ?", parentIDs).
		Group("file.parent_id, knowledgebase.id, knowledgebase.name").
		Order("file.parent_id, knowledgebase.name").
		Rows()
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var parentID, kbID, kbName string
		if err = rows.Scan(&parentID, &kbID, &kbName); err != nil {
			return nil, err
		}
		result[parentID] = append(result[parentID], map[string]interface{}{
			"kb_id":   kbID,
			"kb_name": kbName,
		})
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

// GetByFileID gets file2document mappings by file ID
func (dao *File2DocumentDAO) GetByFileID(ctx context.Context, db *gorm.DB, fileID string) ([]*entity.File2Document, error) {
	var mappings []*entity.File2Document
	err := db.WithContext(ctx).Where("file_id = ?", fileID).Find(&mappings).Error
	return mappings, err
}

// DeleteByFileID deletes file2document mappings by file ID
func (dao *File2DocumentDAO) DeleteByFileID(ctx context.Context, db *gorm.DB, fileID string) error {
	return db.WithContext(ctx).Unscoped().Where("file_id = ?", fileID).Delete(&entity.File2Document{}).Error
}

// GetByDocumentID gets file2document mappings by document ID
func (dao *File2DocumentDAO) GetByDocumentID(ctx context.Context, db *gorm.DB, docID string) ([]*entity.File2Document, error) {
	var mappings []*entity.File2Document
	err := db.WithContext(ctx).Where("document_id = ?", docID).Find(&mappings).Error
	return mappings, err
}

// DeleteByDocumentID deletes file2document mappings by document ID
func (dao *File2DocumentDAO) DeleteByDocumentID(ctx context.Context, db *gorm.DB, docID string) error {
	return db.WithContext(ctx).Unscoped().Where("document_id = ?", docID).Delete(&entity.File2Document{}).Error
}

// Create inserts a new file2document mapping record.
func (dao *File2DocumentDAO) Create(ctx context.Context, db *gorm.DB, mapping *entity.File2Document) error {
	return db.WithContext(ctx).Create(mapping).Error
}
