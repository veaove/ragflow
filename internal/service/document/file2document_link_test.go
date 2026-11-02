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

import "testing"

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
