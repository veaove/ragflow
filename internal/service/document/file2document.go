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
	"path/filepath"
	"strings"

	"go.uber.org/zap"
	"gorm.io/gorm"

	"ragflow/internal/common"
	"ragflow/internal/dao"
	"ragflow/internal/entity"
	"ragflow/internal/permission"
	permissionresponse "ragflow/internal/permission/response"
	"ragflow/internal/service"
	"ragflow/internal/utility"
)

// Sentinel errors returned by File2DocumentService. Handlers map these to
// Python-compatible response codes/messages. Returning sentinels (instead of
// wrapped DAO/runtime errors) prevents internal DB details from leaking through
// the API response path.
var (
	// ErrLinkFileNotFound mirrors Python "File not found!".
	ErrLinkFileNotFound = errors.New("File not found!")
	// ErrLinkDatasetNotFound mirrors Python "Can't find this dataset!".
	ErrLinkDatasetNotFound = errors.New("Can't find this dataset!")
	// ErrLinkInternal is a generic, safe-to-expose internal failure.
	ErrLinkInternal = errors.New("Internal server error.")
)

// File2DocumentService handles linking files to datasets.
type File2DocumentService struct {
	fileDAO          *dao.FileDAO
	file2DocumentDAO *dao.File2DocumentDAO
	kbDAO            *dao.KnowledgebaseDAO
	userTenantDAO    *dao.UserTenantDAO
	documentSvc      *DocumentService
	documentDAO      *dao.DocumentDAO
	// folderDAO is used to mirror the source folder tree into the target
	// dataset when a folder is linked, so the link keeps its structure.
	folderDAO *dao.DocumentFolderDAO
}

// NewFile2DocumentService creates a File2DocumentService.
func NewFile2DocumentService() *File2DocumentService {
	return &File2DocumentService{
		fileDAO:          dao.NewFileDAO(),
		file2DocumentDAO: dao.NewFile2DocumentDAO(),
		kbDAO:            dao.NewKnowledgebaseDAO(),
		userTenantDAO:    dao.NewUserTenantDAO(),
		documentSvc:      NewDocumentService(),
		documentDAO:      dao.NewDocumentDAO(),
		folderDAO:        dao.NewDocumentFolderDAO(),
	}
}

// LinkToDatasetsRequest is the body for POST /files/link-to-datasets.
type LinkToDatasetsRequest struct {
	FileIDs []string `json:"file_ids"`
	KbIDs   []string `json:"kb_ids"`
}

// LinkToDatasets validates inputs, expands folders, checks permissions, and
// schedules convertFiles in a goroutine — mirroring Python convert().
//
// On validation failure it returns a sentinel error (see ErrLink* above) so the
// handler can map it to a Python-compatible response without leaking internals.
func (s *File2DocumentService) LinkToDatasets(ctx context.Context, userID string, req *LinkToDatasetsRequest, mode string) error {
	// ── 1. Validate files exist ───────────────────────────────────────────────
	files, err := s.fileDAO.GetByIDs(ctx, dao.DB, req.FileIDs)
	if err != nil {
		common.Warn("LinkToDatasets: GetByIDs failed", zap.Error(err))
		return ErrLinkInternal
	}
	filesSet := make(map[string]*entity.File, len(files))
	for _, f := range files {
		filesSet[f.ID] = f
	}
	for _, id := range req.FileIDs {
		if filesSet[id] == nil {
			return ErrLinkFileNotFound
		}
	}

	// ── 2. Validate KBs exist ────────────────────────────────────────────────
	kbMap := make(map[string]*entity.Knowledgebase, len(req.KbIDs))
	for _, kbID := range req.KbIDs {
		kb, err := s.kbDAO.GetByID(ctx, dao.DB, kbID)
		if err != nil || kb == nil {
			return ErrLinkDatasetNotFound
		}
		kbMap[kbID] = kb
	}

	// ── 3. Expand folders into (file, destination folder path) pairs ──────────
	checker := permission.NewDatabaseChecker(dao.DB)
	checkFileRead := func(file *entity.File) error {
		kind := permission.ResourceKindFile
		if file.Type == "folder" {
			kind = permission.ResourceKindFolder
		}
		return checker.CheckResource(ctx, permission.Subject{UserID: userID}, permission.ResourceRef{
			Kind: kind,
			ID:   file.ID,
		}, permission.OperationRead)
	}

	// The same leaf file can be reached more than once (a folder and one of its
	// files both selected, or two folders sharing a sub-folder), so dedupe on
	// the (file, destination path) pair: each destination gets the file once.
	expanded := make([]linkedFile, 0, len(req.FileIDs))
	seen := make(map[string]struct{}, len(req.FileIDs))
	addExpanded := func(item linkedFile) {
		key := linkedKey(item)
		if _, dup := seen[key]; dup {
			return
		}
		seen[key] = struct{}{}
		expanded = append(expanded, item)
	}
	// Top-level folders selected by the user. Tracked separately from expanded
	// so that an empty folder is still created in the dataset (otherwise the
	// user links a folder, sees "success", and finds nothing there).
	var rootFolderPaths [][]string

	for _, id := range req.FileIDs {
		file := filesSet[id]
		if file.Type != "folder" {
			addExpanded(linkedFile{FileID: id})
			continue
		}
		if err := checkFileRead(file); err != nil {
			_, permissionErr := permissionresponse.Normalize(err)
			return permissionErr
		}
		// The folder's own name is the first path segment, so a linked folder
		// shows up as a folder in the dataset instead of a flat dump.
		path := []string{file.Name}
		rootFolderPaths = append(rootFolderPaths, path)

		inner, err := s.collectFilesWithPath(ctx, id, path, checkFileRead)
		if err != nil {
			if permissionresponse.IsPermissionError(err) {
				_, permissionErr := permissionresponse.Normalize(err)
				return permissionErr
			}
			common.Warn("LinkToDatasets: folder expansion failed", zap.String("fileID", id), zap.Error(err))
			return ErrLinkInternal
		}
		for _, item := range inner {
			addExpanded(item)
		}
	}

	// ── 4. Validate expanded file permissions ─────────────────────────────────
	// Sub-folders were already checked during the walk; only leaves are left.
	for _, item := range expanded {
		file, err := s.fileDAO.GetByID(ctx, dao.DB, item.FileID)
		if err != nil || file == nil {
			return ErrLinkFileNotFound
		}
		if err := checkFileRead(file); err != nil {
			_, permissionErr := permissionresponse.Normalize(err)
			return permissionErr
		}
	}

	// ── 5. Validate KB permissions ────────────────────────────────────────────
	for _, kb := range kbMap {
		if err := service.CheckDatasetAccess(ctx, permission.Subject{UserID: userID}, kb.ID, permission.OperationUpdate); err != nil {
			_, permissionErr := permissionresponse.Normalize(err)
			return permissionErr
		}
	}

	// ── 6. Run conversion in background (fire-and-forget) ────────────────────
	kbIDs := req.KbIDs
	go func() {
		newCtx := context.Background()
		// Use a local err: the outer err is shared with the request goroutine,
		// so assigning to it here races with the handler returning.
		if err := s.convertFiles(newCtx, expanded, rootFolderPaths, kbIDs, userID, mode); err != nil {
			common.Warn("file2document.convertFiles failed",
				zap.Int("files", len(expanded)),
				zap.Strings("kb_ids", kbIDs),
				zap.Error(err))
		}
	}()

	return nil
}

// convertFiles mirrors Python _convert_files: keep existing links, remove links
// outside the requested KBs in replace mode, then add any missing links.
//
// items carry the destination folder path so a linked folder is mirrored into
// the dataset; emptyFolders lists the paths selected by the user that contain
// no linkable file, so the folder itself still appears after linking.
func (s *File2DocumentService) convertFiles(
	ctx context.Context,
	items []linkedFile,
	emptyFolders [][]string,
	kbIDs []string,
	userID, mode string,
) error {
	replaceExisting := mode != "add"
	kbIDs = dedupeStrings(kbIDs)
	requestedKBIDs := make(map[string]struct{}, len(kbIDs))
	for _, kbID := range kbIDs {
		requestedKBIDs[kbID] = struct{}{}
	}

	// Create the folder tree up front, per target dataset, so an empty linked
	// folder still shows up. ensureFolderPath is idempotent, so repeating the
	// paths that do have files costs one indexed lookup each.
	for _, kbID := range kbIDs {
		for _, path := range emptyFolders {
			if _, err := s.ensureFolderPath(ctx, kbID, path, userID); err != nil {
				common.Warn("convertFiles: ensureFolderPath failed",
					zap.String("kbID", kbID), zap.Strings("path", path), zap.Error(err))
			}
		}
	}

	for _, item := range items {
		fileID := item.FileID
		mappings, err := s.file2DocumentDAO.GetByFileID(ctx, dao.DB, fileID)
		if err != nil {
			common.Warn("convertFiles: GetByFileID failed", zap.String("fileID", fileID), zap.Error(err))
		}

		existingKBIDs := make(map[string]struct{})
		for _, m := range mappings {
			if m.DocumentID == nil {
				continue
			}
			doc, getErr := s.documentDAO.GetByID(ctx, dao.DB, *m.DocumentID)
			if getErr != nil || doc == nil {
				continue
			}
			existingKBIDs[doc.KbID] = struct{}{}
			if replaceExisting {
				if _, exists := requestedKBIDs[doc.KbID]; exists {
					continue
				}
				if err = s.documentSvc.RemoveDocumentKeepFile(ctx, doc.ID); err != nil {
					common.Warn("convertFiles: RemoveDocumentKeepFile failed", zap.String("docID", doc.ID), zap.Error(err))
					continue
				}
				if err = s.file2DocumentDAO.DeleteByDocumentID(ctx, dao.DB, doc.ID); err != nil {
					common.Warn("convertFiles: DeleteByDocumentID failed", zap.String("docID", doc.ID), zap.Error(err))
				}
			}
		}

		// Reload the source file.
		file, err := s.fileDAO.GetByID(ctx, dao.DB, fileID)
		if err != nil || file == nil {
			continue
		}

		// Create a document + mapping in each target KB.
		for _, kbID := range kbIDs {
			if _, exists := existingKBIDs[kbID]; exists {
				continue
			}
			kb, err := s.kbDAO.GetByID(ctx, dao.DB, kbID)
			if err != nil || kb == nil {
				continue
			}

			// Materialise the destination folder before naming the document:
			// the target folder decides where it lands, and a path that cannot
			// be created should skip this file rather than drop it at the root.
			folderID, err := s.ensureFolderPath(ctx, kbID, item.FolderPath, userID)
			if err != nil {
				common.Warn("convertFiles: ensureFolderPath failed",
					zap.String("kbID", kbID), zap.String("fileID", fileID),
					zap.Strings("path", item.FolderPath), zap.Error(err))
				continue
			}

			// Mirror Python duplicate_name: generate a non-colliding document
			// name within the dataset so that linking does not silently create
			// duplicate-name documents in the same KB.
			docName, err := s.documentSvc.UniqueDocumentName(ctx, kbID, file.Name)
			if err != nil {
				common.Warn("convertFiles: UniqueDocumentName failed",
					zap.String("kbID", kbID), zap.String("fileID", fileID), zap.Error(err))
				continue
			}

			selection, parserConfig := resolveDocumentParser(ctx, kb, docName, utility.FileType(file.Type), cloneParserConfigForDocument(kb.ParserConfig))
			parserID, pipelineID := parserSelectionColumns(selection)
			suffix := strings.TrimPrefix(filepath.Ext(docName), ".")
			doc := &entity.Document{
				ID:           common.GenerateUUID(),
				KbID:         kb.ID,
				FolderID:     folderID,
				ParserID:     parserID,
				PipelineID:   pipelineID,
				ParserConfig: parserConfig,
				CreatedBy:    userID,
				Type:         file.Type,
				Name:         &docName,
				Suffix:       suffix,
				Size:         file.Size,
			}
			if file.Location != nil {
				doc.Location = file.Location
			}

			// InsertDocument creates the row and increments KB doc_num in one
			// transaction, so a failed insert never leaves a stale counter.
			if err = s.documentSvc.InsertDocument(doc); err != nil {
				common.Warn("convertFiles: InsertDocument failed",
					zap.String("kbID", kbID), zap.String("fileID", fileID), zap.Error(err))
				continue
			}

			mapping := &entity.File2Document{
				ID:         common.GenerateUUID(),
				FileID:     &fileID,
				DocumentID: &doc.ID,
			}
			if err = s.file2DocumentDAO.Create(ctx, dao.DB, mapping); err != nil {
				common.Warn("convertFiles: Create file2document mapping failed",
					zap.String("fileID", fileID), zap.String("docID", doc.ID), zap.Error(err))
			}
		}
	}
	return nil
}

// getAllInnermostFileIDs recursively collects all non-folder file IDs under a folder.
// Mirrors Python FileService.get_all_innermost_file_ids.
// linkedFile is one source file to link, plus the folder path it should land in
// inside the target dataset. An empty FolderPath means the dataset root.
type linkedFile struct {
	FileID     string
	FolderPath []string
}

// collectFilesWithPath walks a source folder recursively and records each leaf
// file together with the folder names leading to it.
//
// prefix is the path of the folder being walked; the top-level call passes the
// linked folder's own name so that linking a folder reproduces that folder in
// the dataset instead of dumping its files at the root.
//
// checkFolder is applied to every sub-folder met during the walk: the caller
// only validated the folder the user selected, so without this a user holding
// read access to a parent folder could pull in sub-folders they cannot read.
func (s *File2DocumentService) collectFilesWithPath(
	ctx context.Context,
	folderID string,
	prefix []string,
	checkFolder func(*entity.File) error,
) ([]linkedFile, error) {
	children, err := s.fileDAO.ListByParentID(ctx, dao.DB, folderID)
	if err != nil {
		return nil, err
	}
	var out []linkedFile
	for _, child := range children {
		if child.Type == "folder" {
			if checkFolder != nil {
				if err := checkFolder(child); err != nil {
					return nil, err
				}
			}
			sub, err := s.collectFilesWithPath(ctx, child.ID, appendPath(prefix, child.Name), checkFolder)
			if err != nil {
				return nil, err
			}
			out = append(out, sub...)
			continue
		}
		// "virtual" files are the zero-byte placeholders that
		// UploadEmptyDocument creates for an empty dataset document; they are
		// already linked to the dataset they were created in. Expanding a
		// folder that happens to contain one would link that placeholder into
		// another dataset as a second, contentless document that cannot be
		// parsed and reads as a stray entry.
		if child.Type == "virtual" {
			continue
		}
		out = append(out, linkedFile{FileID: child.ID, FolderPath: prefix})
	}
	return out, nil
}

// appendPath returns a copy of prefix with name appended, so sibling branches
// never share (and mutate) the same backing array.
func appendPath(prefix []string, name string) []string {
	out := make([]string, len(prefix)+1)
	copy(out, prefix)
	out[len(prefix)] = name
	return out
}

// linkedKey identifies one (file, destination folder) pair for deduplication.
// The path is joined with NUL so that names containing the separator cannot
// collide with a different split of the same string.
func linkedKey(item linkedFile) string {
	return item.FileID + "|" + strings.Join(item.FolderPath, "\x00")
}

// ensureFolderPath resolves a folder path inside a dataset, creating the missing
// segments as it goes, and returns the innermost folder id (nil for the root).
//
// Folders are matched by (dataset_id, parent_id, name) — the same tuple as the
// uni_document_folder_sibling unique index — so linking the same folder twice
// reuses the existing tree instead of building a parallel one.
func (s *File2DocumentService) ensureFolderPath(
	ctx context.Context,
	datasetID string,
	path []string,
	userID string,
) (*string, error) {
	if len(path) == 0 {
		return nil, nil
	}
	// document_folder.parent_id is NOT NULL DEFAULT '', so the dataset root is
	// the empty string (not NULL as document.folder_id uses).
	parentID := ""
	for _, name := range path {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		existing, err := s.folderDAO.GetSiblingByName(ctx, dao.DB, datasetID, parentID, name)
		if err == nil && existing != nil {
			parentID = existing.ID
			continue
		}
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}

		folder := &entity.DocumentFolder{
			ID:        common.GenerateUUID(),
			DatasetID: datasetID,
			ParentID:  parentID,
			Name:      name,
			CreatedBy: userID,
		}
		if err := s.folderDAO.Create(ctx, dao.DB, folder); err != nil {
			// A concurrent link may have created the same sibling between the
			// lookup and this insert; re-read so the unique index degrades into
			// reuse instead of a failed link.
			again, readErr := s.folderDAO.GetSiblingByName(ctx, dao.DB, datasetID, parentID, name)
			if readErr == nil && again != nil {
				parentID = again.ID
				continue
			}
			return nil, err
		}
		parentID = folder.ID
	}
	if parentID == "" {
		return nil, nil
	}
	return &parentID, nil
}

// dedupeStrings returns the input slice with duplicates removed, preserving the
// first-seen order.
func dedupeStrings(in []string) []string {
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, v := range in {
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	return out
}
