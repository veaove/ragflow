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

package document

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"ragflow/internal/common"
	"ragflow/internal/dao"
	"ragflow/internal/entity"
	"ragflow/internal/permission"
	permissionresponse "ragflow/internal/permission/response"
	"ragflow/internal/service"

	"gorm.io/gorm"
)

// DocumentFolderNode is one directory node of a knowledge base.
//
// DocCount 是目录直属文件数，FileCount / FolderCount 是整棵子树的总数：
// 列表行要显示"这个目录下有多少文件"，用户关心的是递归口径。
type DocumentFolderNode struct {
	ID          string `json:"id"`
	ParentID    string `json:"parent_id"`
	Name        string `json:"name"`
	DocCount    int64  `json:"doc_count"`
	FileCount   int64  `json:"file_count"`
	FolderCount int64  `json:"folder_count"`
	CreatedBy   string `json:"created_by"`
	CreateTime  *int64 `json:"create_time,omitempty"`
	UpdateTime  *int64 `json:"update_time,omitempty"`
}

// DocumentFolderListResponse is the folder listing of one knowledge base.
type DocumentFolderListResponse struct {
	Folders []*DocumentFolderNode `json:"folders"`
	Unfiled int64                 `json:"unfiled"`
	Total   int64                 `json:"total"`
}

// DocumentFolderParseSummary describes what a folder parse would do.
type DocumentFolderParseSummary struct {
	FolderID    string `json:"folder_id"`
	Total       int64  `json:"total"`
	Pending     int64  `json:"pending"`
	Parsed      int64  `json:"parsed"`
	SubFolders  int64  `json:"sub_folders"`
	InProgress  int64  `json:"in_progress"`
	Path        string `json:"path"`
	FolderCount int64  `json:"folder_count"`
}

const documentFolderNameMaxRunes = 255

// ListDocumentFolders returns every folder of a knowledge base with its counts.
//
// 返回扁平列表 + parent_id，由前端组树：目录数量在千级以内，
// 服务端拼树只会让前端"展开某一层"和"搜索整个库"都多绕一步。
func (s *DocumentService) ListDocumentFolders(ctx context.Context, userID, datasetID string) (*DocumentFolderListResponse, common.ErrorCode, error) {
	if datasetID == "" {
		return nil, common.CodeArgumentError, errors.New("dataset_id is required")
	}
	if err := service.CheckDatasetAccess(ctx, permission.Subject{UserID: userID}, datasetID, permission.OperationRead); err != nil {
		code, permissionErr := permissionresponse.Normalize(err)
		return nil, code, permissionErr
	}

	folders, err := s.documentFolderDAO.ListByDataset(ctx, dao.DB, datasetID)
	if err != nil {
		return nil, common.CodeServerError, fmt.Errorf("failed to list document folders: %w", err)
	}
	directCounts, unfiled, err := s.documentFolderDAO.CountDocumentsByFolder(ctx, dao.DB, datasetID)
	if err != nil {
		return nil, common.CodeServerError, fmt.Errorf("failed to count documents: %w", err)
	}

	children := make(map[string][]*entity.DocumentFolder, len(folders))
	for _, folder := range folders {
		children[folder.ParentID] = append(children[folder.ParentID], folder)
	}

	nodes := make([]*DocumentFolderNode, 0, len(folders))
	var total int64 = unfiled
	for _, folder := range folders {
		// subtreeCounts 只统计子孙；FileCount 的口径是「整棵子树」，
		// 所以要把目录自己的直属文件加回来，否则"解析文件夹"会少报数量。
		subtreeFiles, folderCount := subtreeCounts(children, directCounts, folder.ID)
		docCount := directCounts[folder.ID]
		total += docCount
		nodes = append(nodes, &DocumentFolderNode{
			ID:          folder.ID,
			ParentID:    folder.ParentID,
			Name:        folder.Name,
			DocCount:    docCount,
			FileCount:   docCount + subtreeFiles,
			FolderCount: folderCount,
			CreatedBy:   folder.CreatedBy,
			CreateTime:  folder.CreateTime,
			UpdateTime:  folder.UpdateTime,
		})
	}

	return &DocumentFolderListResponse{Folders: nodes, Unfiled: unfiled, Total: total}, common.CodeSuccess, nil
}

// subtreeCounts walks the in-memory folder tree once per root, summing the
// direct document counts of every descendant. Folders are few, so the O(n^2)
// worst case of per-root walks is cheaper than memoizing a tree walk.
func subtreeCounts(children map[string][]*entity.DocumentFolder, direct map[string]int64, rootID string) (files int64, folders int64) {
	for _, child := range children[rootID] {
		folders++
		files += direct[child.ID]
		childFiles, childFolders := subtreeCounts(children, direct, child.ID)
		files += childFiles
		folders += childFolders
	}
	return files, folders
}

// descendantFolderIDs returns rootID together with every folder below it.
func descendantFolderIDs(folders []*entity.DocumentFolder, rootID string) []string {
	children := make(map[string][]string, len(folders))
	for _, folder := range folders {
		children[folder.ParentID] = append(children[folder.ParentID], folder.ID)
	}
	result := make([]string, 0, 8)
	stack := []string{rootID}
	for len(stack) > 0 {
		current := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		result = append(result, current)
		stack = append(stack, children[current]...)
	}
	return result
}

// CreateDocumentFolder creates a directory under parentID ("" means the root).
func (s *DocumentService) CreateDocumentFolder(ctx context.Context, userID, datasetID, parentID, name string) (*DocumentFolderNode, common.ErrorCode, error) {
	if err := service.CheckDatasetAccess(ctx, permission.Subject{UserID: userID}, datasetID, permission.OperationUpdate); err != nil {
		code, permissionErr := permissionresponse.Normalize(err)
		return nil, code, permissionErr
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, common.CodeArgumentError, errors.New("folder name is required")
	}
	if utf8.RuneCountInString(name) > documentFolderNameMaxRunes {
		return nil, common.CodeArgumentError, fmt.Errorf("folder name must be at most %d characters", documentFolderNameMaxRunes)
	}
	parentID = strings.TrimSpace(parentID)
	if parentID != "" {
		if _, err := s.documentFolderDAO.GetByIDInDataset(ctx, dao.DB, datasetID, parentID); err != nil {
			if dao.IsNotFoundErr(err) {
				return nil, common.CodeDataError, errors.New("parent folder not found")
			}
			return nil, common.CodeServerError, fmt.Errorf("failed to load parent folder: %w", err)
		}
	}

	folder := &entity.DocumentFolder{
		ID:        common.GenerateUUID(),
		DatasetID: datasetID,
		ParentID:  parentID,
		Name:      name,
		CreatedBy: userID,
	}
	if err := s.documentFolderDAO.Create(ctx, dao.DB, folder); err != nil {
		if isDuplicateFolderError(err) {
			return nil, common.CodeDataError, errors.New("a folder with the same name already exists here")
		}
		return nil, common.CodeServerError, fmt.Errorf("failed to create folder: %w", err)
	}

	return &DocumentFolderNode{
		ID:         folder.ID,
		ParentID:   folder.ParentID,
		Name:       folder.Name,
		CreatedBy:  folder.CreatedBy,
		CreateTime: folder.CreateTime,
		UpdateTime: folder.UpdateTime,
	}, common.CodeSuccess, nil
}

// UpdateDocumentFolder renames and/or moves a folder.
//
// 移动前必须拦住两种情况：把 A 移到 A 自己里、把 A 移到 A 的子孙里。
// 前端拦住只是体验，直接调接口一样能造出环，所以校验放在这里。
func (s *DocumentService) UpdateDocumentFolder(ctx context.Context, userID, datasetID, folderID string, name, parentID *string) (*DocumentFolderNode, common.ErrorCode, error) {
	if err := service.CheckDatasetAccess(ctx, permission.Subject{UserID: userID}, datasetID, permission.OperationUpdate); err != nil {
		code, permissionErr := permissionresponse.Normalize(err)
		return nil, code, permissionErr
	}
	folder, err := s.documentFolderDAO.GetByIDInDataset(ctx, dao.DB, datasetID, folderID)
	if err != nil {
		if dao.IsNotFoundErr(err) {
			return nil, common.CodeDataError, errors.New("folder not found")
		}
		return nil, common.CodeServerError, fmt.Errorf("failed to load folder: %w", err)
	}

	updates := map[string]interface{}{}
	if name != nil {
		trimmed := strings.TrimSpace(*name)
		if trimmed == "" {
			return nil, common.CodeArgumentError, errors.New("folder name is required")
		}
		if utf8.RuneCountInString(trimmed) > documentFolderNameMaxRunes {
			return nil, common.CodeArgumentError, fmt.Errorf("folder name must be at most %d characters", documentFolderNameMaxRunes)
		}
		if trimmed != folder.Name {
			updates["name"] = trimmed
		}
	}
	if parentID != nil {
		target := strings.TrimSpace(*parentID)
		if target != folder.ParentID {
			allFolders, err := s.documentFolderDAO.ListByDataset(ctx, dao.DB, datasetID)
			if err != nil {
				return nil, common.CodeServerError, fmt.Errorf("failed to list folders: %w", err)
			}
			subtree := descendantFolderIDs(allFolders, folder.ID)
			for _, id := range subtree {
				if id == target {
					return nil, common.CodeDataError, errors.New("cannot move a folder into itself or its subfolder")
				}
			}
			if target != "" {
				if _, err := s.documentFolderDAO.GetByIDInDataset(ctx, dao.DB, datasetID, target); err != nil {
					if dao.IsNotFoundErr(err) {
						return nil, common.CodeDataError, errors.New("target folder not found")
					}
					return nil, common.CodeServerError, fmt.Errorf("failed to load target folder: %w", err)
				}
			}
			updates["parent_id"] = target
		}
	}

	if len(updates) > 0 {
		if err := s.documentFolderDAO.Update(ctx, dao.DB, folder.ID, updates); err != nil {
			if isDuplicateFolderError(err) {
				return nil, common.CodeDataError, errors.New("a folder with the same name already exists here")
			}
			return nil, common.CodeServerError, fmt.Errorf("failed to update folder: %w", err)
		}
	}

	updated, err := s.documentFolderDAO.GetByID(ctx, dao.DB, folder.ID)
	if err != nil {
		return nil, common.CodeServerError, fmt.Errorf("failed to reload folder: %w", err)
	}
	return &DocumentFolderNode{
		ID:         updated.ID,
		ParentID:   updated.ParentID,
		Name:       updated.Name,
		CreatedBy:  updated.CreatedBy,
		CreateTime: updated.CreateTime,
		UpdateTime: updated.UpdateTime,
	}, common.CodeSuccess, nil
}

// DeleteDocumentFolder removes a folder tree.
//
// recursive 为 false 时，只要子树里还有文件夹或文件就拒绝 —— 这是防止
// "点一下删掉一整棵树"的唯一一道闸门。recursive 为 true 时连同子树里的
// 文件一起删，走 DeleteDocuments 以便切片、索引、任务一起清掉。
func (s *DocumentService) DeleteDocumentFolder(ctx context.Context, userID, datasetID, folderID string, recursive bool) (map[string]interface{}, common.ErrorCode, error) {
	if err := service.CheckDatasetAccess(ctx, permission.Subject{UserID: userID}, datasetID, permission.OperationDeleteContent); err != nil {
		code, permissionErr := permissionresponse.Normalize(err)
		return nil, code, permissionErr
	}
	folder, err := s.documentFolderDAO.GetByIDInDataset(ctx, dao.DB, datasetID, folderID)
	if err != nil {
		if dao.IsNotFoundErr(err) {
			return nil, common.CodeDataError, errors.New("folder not found")
		}
		return nil, common.CodeServerError, fmt.Errorf("failed to load folder: %w", err)
	}

	allFolders, err := s.documentFolderDAO.ListByDataset(ctx, dao.DB, datasetID)
	if err != nil {
		return nil, common.CodeServerError, fmt.Errorf("failed to list folders: %w", err)
	}
	subtree := descendantFolderIDs(allFolders, folder.ID)
	docIDs, err := s.documentFolderDAO.ListDocumentIDsUnderFolders(ctx, dao.DB, datasetID, subtree)
	if err != nil {
		return nil, common.CodeServerError, fmt.Errorf("failed to list documents: %w", err)
	}

	if !recursive && (len(subtree) > 1 || len(docIDs) > 0) {
		return nil, common.CodeDataError, fmt.Errorf(
			"folder %q still has %d subfolder(s) and %d document(s); pass recursive=true to delete them",
			folder.Name, len(subtree)-1, len(docIDs))
	}

	deleted := 0
	if len(docIDs) > 0 {
		deleted, err = s.DeleteDocuments(ctx, docIDs, false, datasetID, userID)
		if err != nil {
			return nil, common.CodeServerError, fmt.Errorf("failed to delete documents in folder: %w", err)
		}
	}
	if err := s.documentFolderDAO.DeleteByIDs(ctx, dao.DB, datasetID, subtree); err != nil {
		return nil, common.CodeServerError, fmt.Errorf("failed to delete folders: %w", err)
	}

	return map[string]interface{}{
		"deleted_folders":   len(subtree),
		"deleted_documents": deleted,
	}, common.CodeSuccess, nil
}

// MoveDocumentsToFolder moves documents into a folder; folderID "" clears it.
func (s *DocumentService) MoveDocumentsToFolder(ctx context.Context, userID, datasetID string, documentIDs []string, folderID string) (int64, common.ErrorCode, error) {
	if err := service.CheckDatasetAccess(ctx, permission.Subject{UserID: userID}, datasetID, permission.OperationUpdate); err != nil {
		code, permissionErr := permissionresponse.Normalize(err)
		return 0, code, permissionErr
	}
	if len(documentIDs) == 0 {
		return 0, common.CodeArgumentError, errors.New("doc_ids must be a non-empty list")
	}
	folderID = strings.TrimSpace(folderID)
	if folderID != "" {
		if _, err := s.documentFolderDAO.GetByIDInDataset(ctx, dao.DB, datasetID, folderID); err != nil {
			if dao.IsNotFoundErr(err) {
				return 0, common.CodeDataError, errors.New("folder not found")
			}
			return 0, common.CodeServerError, fmt.Errorf("failed to load folder: %w", err)
		}
	}
	affected, err := s.documentFolderDAO.MoveDocuments(ctx, dao.DB, datasetID, documentIDs, folderID)
	if err != nil {
		return 0, common.CodeServerError, fmt.Errorf("failed to move documents: %w", err)
	}
	return affected, common.CodeSuccess, nil
}

// GetDocumentFolderParseSummary reports what parsing a folder would process.
func (s *DocumentService) GetDocumentFolderParseSummary(ctx context.Context, userID, datasetID, folderID string) (*DocumentFolderParseSummary, common.ErrorCode, error) {
	if err := service.CheckDatasetAccess(ctx, permission.Subject{UserID: userID}, datasetID, permission.OperationRead); err != nil {
		code, permissionErr := permissionresponse.Normalize(err)
		return nil, code, permissionErr
	}
	folder, allFolders, err := s.loadFolderAndSiblings(ctx, datasetID, folderID)
	if err != nil {
		return nil, common.CodeDataError, err
	}
	subtree := descendantFolderIDs(allFolders, folder.ID)
	docs, err := s.documentFolderDAO.ListDocumentsUnderFolders(ctx, dao.DB, datasetID, subtree)
	if err != nil {
		return nil, common.CodeServerError, fmt.Errorf("failed to list documents: %w", err)
	}

	docIDs := make([]string, 0, len(docs))
	parsed := int64(0)
	inProgress := int64(0)
	if len(docs) > 0 {
		for _, doc := range docs {
			docIDs = append(docIDs, doc.ID)
		}
		tasks, err := s.ingestionTaskDAO.GetLatestByDocumentIDs(ctx, dao.DB, docIDs)
		if err != nil {
			return nil, common.CodeServerError, fmt.Errorf("failed to load ingestion tasks: %w", err)
		}
		for _, docID := range docIDs {
			task := tasks[docID]
			switch {
			case task == nil:
			case task.Status == common.COMPLETED:
				parsed++
			case common.IsActiveTaskStatus(task.Status):
				inProgress++
			}
		}
	}

	total := int64(len(docIDs))
	return &DocumentFolderParseSummary{
		FolderID:    folder.ID,
		Total:       total,
		Pending:     total - parsed - inProgress,
		Parsed:      parsed,
		InProgress:  inProgress,
		SubFolders:  int64(len(subtree) - 1),
		FolderCount: int64(len(subtree)),
		Path:        folderPath(allFolders, folder.ID),
	}, common.CodeSuccess, nil
}

// ParseDocumentFolder starts parsing for every document in a folder subtree.
//
// includeParsed 为 false 时跳过已解析的文件（重解析会覆盖切片，误触成本高）；
// 为 true 时先清掉旧结果再重跑，对应原型里"全部重新解析"的按钮。
func (s *DocumentService) ParseDocumentFolder(ctx context.Context, userID, datasetID, folderID string, includeParsed bool) (map[string]interface{}, common.ErrorCode, error) {
	if err := service.CheckDatasetAccess(ctx, permission.Subject{UserID: userID}, datasetID, permission.OperationRun); err != nil {
		code, permissionErr := permissionresponse.Normalize(err)
		return nil, code, permissionErr
	}
	folder, allFolders, err := s.loadFolderAndSiblings(ctx, datasetID, folderID)
	if err != nil {
		return nil, common.CodeDataError, err
	}
	subtree := descendantFolderIDs(allFolders, folder.ID)
	docs, err := s.documentFolderDAO.ListDocumentsUnderFolders(ctx, dao.DB, datasetID, subtree)
	if err != nil {
		return nil, common.CodeServerError, fmt.Errorf("failed to list documents: %w", err)
	}
	docIDs := make([]string, 0, len(docs))
	for _, doc := range docs {
		docIDs = append(docIDs, doc.ID)
	}
	if len(docIDs) == 0 {
		return map[string]interface{}{
			"started": 0, "skipped": 0, "total": 0,
		}, common.CodeSuccess, nil
	}

	// 交给 Ingest 处理，跳过/重跑语义与 /documents/ingest 完全一致，
	// 不在文件夹这一层另造一套状态判断。
	code, err := s.Ingest(ctx, userID, &IngestDocumentRequest{
		DocIDs:  docIDs,
		Run:     string(entity.TaskStatusRunning),
		Delete:  includeParsed,
		ApplyKB: true,
	})
	if err != nil {
		return nil, code, err
	}

	return map[string]interface{}{
		"total":   len(docIDs),
		"started": len(docIDs),
	}, common.CodeSuccess, nil
}

func (s *DocumentService) loadFolderAndSiblings(ctx context.Context, datasetID, folderID string) (*entity.DocumentFolder, []*entity.DocumentFolder, error) {
	folder, err := s.documentFolderDAO.GetByIDInDataset(ctx, dao.DB, datasetID, folderID)
	if err != nil {
		if dao.IsNotFoundErr(err) {
			return nil, nil, errors.New("folder not found")
		}
		return nil, nil, fmt.Errorf("failed to load folder: %w", err)
	}
	allFolders, err := s.documentFolderDAO.ListByDataset(ctx, dao.DB, datasetID)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to list folders: %w", err)
	}
	return folder, allFolders, nil
}

// folderPath renders "A › B › C" for a folder node.
func folderPath(folders []*entity.DocumentFolder, folderID string) string {
	byID := make(map[string]*entity.DocumentFolder, len(folders))
	for _, folder := range folders {
		byID[folder.ID] = folder
	}
	parts := make([]string, 0, 4)
	current := byID[folderID]
	for current != nil {
		// 名字为空时跳过，否则路径里会多出一段空白（"a ›  › c"）。
		if name := strings.TrimSpace(current.Name); name != "" {
			parts = append(parts, name)
		}
		current = byID[current.ParentID]
	}
	for i, j := 0, len(parts)-1; i < j; i, j = i+1, j-1 {
		parts[i], parts[j] = parts[j], parts[i]
	}
	return strings.Join(parts, " › ")
}

// isDuplicateFolderError reports a unique-constraint violation on
// (dataset_id, parent_id, name).
func isDuplicateFolderError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return true
	}
	message := err.Error()
	return strings.Contains(message, "Duplicate entry") || strings.Contains(message, "UNIQUE constraint failed")
}
