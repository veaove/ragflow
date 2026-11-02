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

// 链接文件夹时，路径靠 appendPath 逐层拼出来。如果它复用了同一个底层数组，
// 兄弟分支会互相覆盖 —— 表现为「A 文件夹里的文件全跑到 B 文件夹下」，
// 而且只在有多层、多分支时才复现，很难查。
func TestAppendPathDoesNotShareBackingArray(t *testing.T) {
	base := []string{"投教材料"}

	docs := appendPath(base, "文档")
	images := appendPath(base, "图片")

	if docs[1] != "文档" {
		t.Fatalf("docs path = %v, want second segment 文档", docs)
	}
	if images[1] != "图片" {
		t.Fatalf("images path = %v, want second segment 图片 (sibling must not overwrite)", images)
	}
	// base 本身不能被改动
	if len(base) != 1 || base[0] != "投教材料" {
		t.Fatalf("base path mutated: %v", base)
	}

	// 再深一层，确认不会反向影响已生成的兄弟
	deeper := appendPath(docs, "子目录")
	if len(docs) != 2 || docs[1] != "文档" {
		t.Fatalf("parent path mutated by child append: %v", docs)
	}
	if len(deeper) != 3 || deeper[2] != "子目录" {
		t.Fatalf("deeper path = %v, want 3 segments", deeper)
	}
}

// 去重按 (文件, 目标路径) 而不是只按文件：
// 同一个文件被两个文件夹各自包含时，两处都该链进去；
// 而同一个文件同一个路径被重复选中（勾了文件夹又勾了里面的文件）只该链一次。
func TestLinkedKeySeparatesPaths(t *testing.T) {
	root := linkedFile{FileID: "f1"}
	a := linkedFile{FileID: "f1", FolderPath: []string{"A"}}
	b := linkedFile{FileID: "f1", FolderPath: []string{"B"}}
	ab := linkedFile{FileID: "f1", FolderPath: []string{"A", "B"}}
	// 名字里带分隔符也要能和不同的分层方式区分开
	tricky := linkedFile{FileID: "f1", FolderPath: []string{"A\x00B"}}

	if linkedKey(root) == linkedKey(a) {
		t.Fatal("root and A must not share a key")
	}
	if linkedKey(a) == linkedKey(b) {
		t.Fatal("A and B must not share a key")
	}
	if linkedKey(ab) == linkedKey(tricky) {
		t.Fatal("multi-segment path must not collide with a name containing the separator")
	}
	// 相同路径要稳定命中同一个键，去重才有意义
	if linkedKey(a) != linkedKey(linkedFile{FileID: "f1", FolderPath: []string{"A"}}) {
		t.Fatal("same (file, path) must produce the same key")
	}
}

// 重复链接同一个文件夹时，文件本来就在知识库里，不能只建出空目录：
// 已存在的文档必须按本次链接的目录结构归位，否则用户看到的是
// 「一个空的顶层文件夹」，而文档还留在原来那一层。
func TestConvertFilesRepositionsAlreadyLinkedDocuments(t *testing.T) {
	db := setupServiceTestDB(t)
	pushServiceDB(t, db)
	if err := db.AutoMigrate(
		&entity.DocumentFolder{},
		&entity.File{},
		&entity.File2Document{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	insertTestKB(t, "kb-1", "tenant-1", 0, 0, 0)
	insertTestDoc(t, "doc-1", "kb-1", 0, 0)

	fileID := "file-1"
	location := "华夏基金/2026/投教.pdf"
	if err := db.Create(&entity.File{
		ID:        fileID,
		Name:      "投教.pdf",
		Type:      "pdf",
		Location:  &location,
		CreatedBy: "user-1",
		TenantID:  "tenant-1",
	}).Error; err != nil {
		t.Fatalf("create file: %v", err)
	}
	docID := "doc-1"
	if err := db.Create(&entity.File2Document{
		ID:         "f2d-1",
		FileID:     &fileID,
		DocumentID: &docID,
	}).Error; err != nil {
		t.Fatalf("create mapping: %v", err)
	}

	ctx := t.Context()
	svc := NewFile2DocumentService()
	if err := svc.convertFiles(
		ctx,
		[]linkedFile{{FileID: fileID, FolderPath: []string{"华夏基金", "2026"}}},
		nil,
		[]string{"kb-1"},
		"user-1",
		"add",
	); err != nil {
		t.Fatalf("convertFiles: %v", err)
	}

	doc, err := dao.NewDocumentDAO().GetByID(ctx, dao.DB, "doc-1")
	if err != nil || doc == nil {
		t.Fatalf("reload document: %v", err)
	}
	folderDAO := dao.NewDocumentFolderDAO()
	parent, err := folderDAO.GetSiblingByName(ctx, dao.DB, "kb-1", "", "华夏基金")
	if err != nil || parent == nil {
		t.Fatalf("顶层目录 华夏基金 没有建出来: %v", err)
	}
	child, err := folderDAO.GetSiblingByName(ctx, dao.DB, "kb-1", parent.ID, "2026")
	if err != nil || child == nil {
		t.Fatalf("子目录 2026 没有建出来: %v", err)
	}
	if doc.FolderID == nil || *doc.FolderID != child.ID {
		t.Fatalf("document folder_id = %v, want %s", doc.FolderID, child.ID)
	}
}
