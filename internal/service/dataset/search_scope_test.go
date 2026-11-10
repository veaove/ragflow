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

package dataset

import (
	"errors"
	"testing"

	"ragflow/internal/permission"
)

// 「部分知识库可用」的检索口径：绑定的库里只有一部分对调用者可用时，检索继续
// 使用可用的那部分，而不是整体判成权限不足——否则 AI 总结有内容、切片列表却是
// 0 条并弹「权限不足」。
func TestScopeSearchDatasetIDsKeepsVisibleSubsetInPartialMode(t *testing.T) {
	pushServiceDB(t, setupDatasetUpdateTestDB(t))
	insertDatasetUpdateKB(t, "kb-visible", "tenant-1", "Visible dataset")
	insertDatasetUpdateKB(t, "kb-hidden", "tenant-1", "Hidden dataset")
	insertDatasetUpdateTeamMember(t, "member-1", "tenant-1")
	shareDatasetWithMember(t, "kb-visible", "member-1")

	got, err := scopeSearchDatasetIDs(
		t.Context(),
		permission.Subject{UserID: "member-1"},
		[]string{"kb-visible", "kb-hidden", "kb-deleted"},
		true,
	)
	if err != nil {
		t.Fatalf("scopeSearchDatasetIDs(partial) error = %v, want nil", err)
	}
	if len(got) != 1 || got[0] != "kb-visible" {
		t.Fatalf("scopeSearchDatasetIDs(partial) = %v, want [kb-visible]", got)
	}
}

// allow_partial_kb=false 保持原契约：任一绑定不可用即拒绝整次检索。
func TestScopeSearchDatasetIDsRejectsAnyDeniedBindingInStrictMode(t *testing.T) {
	pushServiceDB(t, setupDatasetUpdateTestDB(t))
	insertDatasetUpdateKB(t, "kb-visible", "tenant-1", "Visible dataset")
	insertDatasetUpdateKB(t, "kb-hidden", "tenant-1", "Hidden dataset")
	insertDatasetUpdateTeamMember(t, "member-1", "tenant-1")
	shareDatasetWithMember(t, "kb-visible", "member-1")

	_, err := scopeSearchDatasetIDs(
		t.Context(),
		permission.Subject{UserID: "member-1"},
		[]string{"kb-visible", "kb-hidden"},
		false,
	)
	if !errors.Is(err, permission.ErrPermissionDenied) {
		t.Fatalf("scopeSearchDatasetIDs(strict) error = %v, want permission denial", err)
	}

	got, err := scopeSearchDatasetIDs(
		t.Context(),
		permission.Subject{UserID: "member-1"},
		[]string{"kb-visible"},
		false,
	)
	if err != nil || len(got) != 1 || got[0] != "kb-visible" {
		t.Fatalf("scopeSearchDatasetIDs(strict, all visible) = %v, %v; want [kb-visible], nil", got, err)
	}
}

// 一个库都不可用时没有可检索的语料，如实拒绝比返回空结果更好（空结果会被前端
// 当成「检索不到内容」而不是「无权限」）。
func TestScopeSearchDatasetIDsDeniesWhenNothingIsVisible(t *testing.T) {
	pushServiceDB(t, setupDatasetUpdateTestDB(t))
	insertDatasetUpdateKB(t, "kb-hidden", "tenant-1", "Hidden dataset")
	insertDatasetUpdateTeamMember(t, "member-1", "tenant-1")

	_, err := scopeSearchDatasetIDs(
		t.Context(),
		permission.Subject{UserID: "member-1"},
		[]string{"kb-hidden"},
		true,
	)
	if !errors.Is(err, permission.ErrPermissionDenied) {
		t.Fatalf("scopeSearchDatasetIDs(partial, nothing visible) error = %v, want permission denial", err)
	}
}
