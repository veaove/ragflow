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
	"testing"

	"ragflow/internal/dao"
	"ragflow/internal/entity"
)

// 目录子树的统计与遍历是纯函数，先把它们钉住：
// 列表行显示的"N 个文件"和"解析文件夹"的处理范围都依赖这两个口径。
func TestSubtreeCountsAndDescendants(t *testing.T) {
	folders := []*entity.DocumentFolder{
		{ID: "a", ParentID: "", Name: "a"},
		{ID: "b", ParentID: "a", Name: "b"},
		{ID: "c", ParentID: "b", Name: "c"},
		{ID: "d", ParentID: "", Name: "d"},
	}

	children := make(map[string][]*entity.DocumentFolder, len(folders))
	for _, folder := range folders {
		children[folder.ParentID] = append(children[folder.ParentID], folder)
	}
	direct := map[string]int64{"a": 1, "b": 2, "c": 3, "d": 4}

	files, subFolders := subtreeCounts(children, direct, "a")
	// a 的子树 = b(2 个) + c(3 个)；a 自己直接挂的 1 个不计入"子树"口径。
	if files != 5 || subFolders != 2 {
		t.Fatalf("subtreeCounts(a) = (%d files, %d folders), want (5, 2)", files, subFolders)
	}

	subtree := descendantFolderIDs(folders, "a")
	want := map[string]bool{"a": true, "b": true, "c": true}
	if len(subtree) != len(want) {
		t.Fatalf("descendantFolderIDs(a) = %v, want 3 ids", subtree)
	}
	for _, id := range subtree {
		if !want[id] {
			t.Fatalf("descendantFolderIDs(a) contains unexpected id %q", id)
		}
	}

	if got := folderPath(folders, "c"); got != "a › b › c" {
		t.Fatalf("folderPath(c) = %q, want %q", got, "a › b › c")
	}
}

// 移动防环必须落在服务层：越过前端直接调接口一样能造出环。
func TestUpdateDocumentFolderRejectsMoveIntoOwnSubtree(t *testing.T) {
	db := setupServiceTestDB(t)
	pushServiceDB(t, db)
	if err := db.AutoMigrate(&entity.DocumentFolder{}); err != nil {
		t.Fatalf("migrate document_folder: %v", err)
	}
	insertTestKB(t, "kb-1", "tenant-1", 0, 0, 0)

	svc := testDocumentService(t)
	svc.documentFolderDAO = dao.NewDocumentFolderDAO()
	ctx := t.Context()

	parent, code, err := svc.CreateDocumentFolder(ctx, "user-1", "kb-1", "", "父目录")
	if err != nil || code != 0 {
		t.Fatalf("create parent folder: code=%v err=%v", code, err)
	}
	child, code, err := svc.CreateDocumentFolder(ctx, "user-1", "kb-1", parent.ID, "子目录")
	if err != nil || code != 0 {
		t.Fatalf("create child folder: code=%v err=%v", code, err)
	}

	// 把父目录移到自己的子孙里：必须被拒。
	if _, _, err = svc.UpdateDocumentFolder(ctx, "user-1", "kb-1", parent.ID, nil, &child.ID); err == nil {
		t.Fatal("moving a folder into its own subtree must fail")
	}
	// 移到自己里同样必须被拒。
	if _, _, err = svc.UpdateDocumentFolder(ctx, "user-1", "kb-1", parent.ID, nil, &parent.ID); err == nil {
		t.Fatal("moving a folder into itself must fail")
	}

	// 同层重名要拒绝（唯一索引 + 应用层语义）。
	if _, code, err = svc.CreateDocumentFolder(ctx, "user-1", "kb-1", parent.ID, "子目录"); err == nil || code == 0 {
		t.Fatal("creating a sibling folder with the same name must fail")
	}
}

// 非空目录不传 recursive 时必须拒绝，避免"点一下删掉一整棵树"。
func TestDeleteDocumentFolderRequiresRecursiveWhenNotEmpty(t *testing.T) {
	db := setupServiceTestDB(t)
	pushServiceDB(t, db)
	if err := db.AutoMigrate(&entity.DocumentFolder{}); err != nil {
		t.Fatalf("migrate document_folder: %v", err)
	}
	insertTestKB(t, "kb-1", "tenant-1", 0, 0, 0)
	insertTestDoc(t, "doc-1", "kb-1", 0, 0)

	svc := testDocumentService(t)
	svc.documentFolderDAO = dao.NewDocumentFolderDAO()
	ctx := t.Context()

	folder, code, err := svc.CreateDocumentFolder(ctx, "user-1", "kb-1", "", "有文件的目录")
	if err != nil || code != 0 {
		t.Fatalf("create folder: code=%v err=%v", code, err)
	}
	if _, code, err = svc.MoveDocumentsToFolder(ctx, "user-1", "kb-1", []string{"doc-1"}, folder.ID); err != nil || code != 0 {
		t.Fatalf("move document: code=%v err=%v", code, err)
	}

	if _, _, err = svc.DeleteDocumentFolder(ctx, "user-1", "kb-1", folder.ID, false); err == nil {
		t.Fatal("deleting a non-empty folder without recursive must fail")
	}

	// 目录仍在：拒绝的路径不能留下半删状态。
	remaining, err := svc.documentFolderDAO.GetByID(ctx, dao.DB, folder.ID)
	if err != nil || remaining == nil {
		t.Fatalf("folder should still exist after a rejected delete: %v", err)
	}
}

// 列表的递归文件数是"解析文件夹"到底处理多少个文件的口径。
func TestListDocumentFoldersCountsRecursiveFiles(t *testing.T) {
	db := setupServiceTestDB(t)
	pushServiceDB(t, db)
	if err := db.AutoMigrate(&entity.DocumentFolder{}); err != nil {
		t.Fatalf("migrate document_folder: %v", err)
	}
	insertTestKB(t, "kb-1", "tenant-1", 0, 0, 0)
	insertTestDoc(t, "doc-1", "kb-1", 0, 0)
	insertTestDoc(t, "doc-2", "kb-1", 0, 0)
	insertTestDoc(t, "doc-3", "kb-1", 0, 0)

	svc := testDocumentService(t)
	svc.documentFolderDAO = dao.NewDocumentFolderDAO()
	ctx := t.Context()

	parent, _, err := svc.CreateDocumentFolder(ctx, "user-1", "kb-1", "", "父")
	if err != nil {
		t.Fatalf("create parent: %v", err)
	}
	child, _, err := svc.CreateDocumentFolder(ctx, "user-1", "kb-1", parent.ID, "子")
	if err != nil {
		t.Fatalf("create child: %v", err)
	}
	if _, code, err := svc.MoveDocumentsToFolder(ctx, "user-1", "kb-1", []string{"doc-1"}, parent.ID); err != nil || code != 0 {
		t.Fatalf("move doc-1: code=%v err=%v", code, err)
	}
	if _, code, err := svc.MoveDocumentsToFolder(ctx, "user-1", "kb-1", []string{"doc-2", "doc-3"}, child.ID); err != nil || code != 0 {
		t.Fatalf("move doc-2/3: code=%v err=%v", code, err)
	}

	list, code, err := svc.ListDocumentFolders(ctx, "user-1", "kb-1")
	if err != nil || code != 0 {
		t.Fatalf("list folders: code=%v err=%v", code, err)
	}
	if list.Total != 3 {
		t.Fatalf("total documents = %d, want 3", list.Total)
	}
	byID := make(map[string]*DocumentFolderNode, len(list.Folders))
	for _, node := range list.Folders {
		byID[node.ID] = node
	}
	if node := byID[parent.ID]; node == nil || node.DocCount != 1 || node.FileCount != 3 {
		t.Fatalf("parent counts = %+v, want DocCount=1 FileCount=3", node)
	}
	if node := byID[child.ID]; node == nil || node.DocCount != 2 || node.FileCount != 2 {
		t.Fatalf("child counts = %+v, want DocCount=2 FileCount=2", node)
	}
}
