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
	"testing"

	"ragflow/internal/entity"
)

// TestQcRuleListScopesToVisibleApps 覆盖 E2E D3：规则的归属应用看不见时，规则
// 本身也不该出现在列表里。租户管理层传 nil（全量），普通成员传可见应用 id。
func TestQcRuleListScopesToVisibleApps(t *testing.T) {
	db := setupQcRuleTestDB(t)
	ctx := context.Background()

	rules := []*entity.QcRule{
		newTestQcRule("r-chat-visible", "t1", entity.QcAppTypeChat, "chat-1", "可见应用", true),
		newTestQcRule("r-chat-hidden", "t1", entity.QcAppTypeChat, "chat-2", "别人应用", true),
		newTestQcRule("r-canvas-visible", "t1", entity.QcAppTypeCanvas, "cv-1", "可见画布", true),
		newTestQcRule("r-other-tenant", "t2", entity.QcAppTypeChat, "chat-1", "别的租户", true),
	}
	for _, rule := range rules {
		if err := db.Create(rule).Error; err != nil {
			t.Fatalf("create rule %q: %v", rule.ID, err)
		}
	}

	// nil：不按可见性收窄，只按租户。
	all, total, err := NewQcRuleDAO().List(ctx, db, QcRuleListFilter{TenantID: "t1"}, 0, 20)
	if err != nil {
		t.Fatalf("List(all): %v", err)
	}
	if total != 3 || len(all) != 3 {
		t.Fatalf("unscoped total=%d len=%d, want 3/3", total, len(all))
	}

	scoped, scopedTotal, err := NewQcRuleDAO().List(ctx, db, QcRuleListFilter{
		TenantID: "t1",
		AppIDsByType: map[string][]string{
			entity.QcAppTypeChat:   {"chat-1"},
			entity.QcAppTypeCanvas: {"cv-1"},
		},
	}, 0, 20)
	if err != nil {
		t.Fatalf("List(scoped): %v", err)
	}
	if scopedTotal != 2 || len(scoped) != 2 {
		t.Fatalf("scoped total=%d len=%d, want 2/2", scopedTotal, len(scoped))
	}
	got := map[string]bool{}
	for _, rule := range scoped {
		got[rule.ID] = true
	}
	if !got["r-chat-visible"] || !got["r-canvas-visible"] {
		t.Fatalf("scoped rules = %v, want the two visible ones", got)
	}

	// 空 map 是「一个应用都看不到」而不是「不限制」：必须一条都不返回。
	none, noneTotal, err := NewQcRuleDAO().List(ctx, db, QcRuleListFilter{
		TenantID:     "t1",
		AppIDsByType: map[string][]string{},
	}, 0, 20)
	if err != nil {
		t.Fatalf("List(none): %v", err)
	}
	if noneTotal != 0 || len(none) != 0 {
		t.Fatalf("empty visible-app set must return nothing, got total=%d len=%d", noneTotal, len(none))
	}
}
