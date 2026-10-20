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

	"gorm.io/gorm"
)

func setupAgentRunListTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := setupUserCanvasTestDB(t)
	if err := db.AutoMigrate(&entity.AgentRun{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}

// TestAgentRunDAO_ListWithFilter covers the run-log list: the canvas filter
// is optional (the log spans every app), keywords match either the run id
// or the owning app title, and the sort keys are a closed allowlist.
func TestAgentRunDAO_ListWithFilter(t *testing.T) {
	ctx := context.Background()
	db := setupAgentRunListTestDB(t)
	d := NewAgentRunDAO()

	if err := db.Create(&entity.User{ID: "u1", Nickname: "Owner", Email: "o@example.com"}).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	if err := db.Create(&entity.UserCanvas{
		ID: "app-a", UserID: "u1", Permission: "me",
		CanvasCategory: "workflow_canvas", Title: stringPtr("Refund Pipeline"),
	}).Error; err != nil {
		t.Fatalf("create canvas: %v", err)
	}

	runs := []entity.AgentRun{
		{ID: "run-1", CanvasID: "app-a", TenantID: "u1", TriggerType: "api", Status: "succeeded", DurationMS: 900, PromptTokens: 100, CompletionTokens: 20, CreateTime: 1000, UpdateTime: 1000},
		{ID: "run-2", CanvasID: "app-a", TenantID: "u1", TriggerType: "debug", Status: "failed", DurationMS: 100, PromptTokens: 10, CompletionTokens: 5, CreateTime: 2000, UpdateTime: 2000},
		{ID: "run-3", CanvasID: "app-b", TenantID: "u1", TriggerType: "api", Status: "succeeded", DurationMS: 500, PromptTokens: 50, CompletionTokens: 10, CreateTime: 3000, UpdateTime: 3000},
	}
	for i := range runs {
		if err := db.Create(&runs[i]).Error; err != nil {
			t.Fatalf("create run: %v", err)
		}
	}

	// No canvas filter: every run comes back (the run log spans apps).
	all, total, err := d.ListWithFilter(ctx, db, AgentRunListFilter{}, 20, 0)
	if err != nil {
		t.Fatalf("ListWithFilter (no filter): %v", err)
	}
	if total != 3 || len(all) != 3 {
		t.Fatalf("expected 3 runs without filters, got total=%d rows=%d", total, len(all))
	}

	// Canvas filter.
	onlyA, totalA, err := d.ListWithFilter(ctx, db, AgentRunListFilter{CanvasID: "app-a"}, 20, 0)
	if err != nil {
		t.Fatalf("ListWithFilter (canvas): %v", err)
	}
	if totalA != 2 || len(onlyA) != 2 {
		t.Fatalf("canvas filter expected 2 runs, got total=%d rows=%d", totalA, len(onlyA))
	}

	// Trigger type filter.
	apiRuns, totalAPI, err := d.ListWithFilter(ctx, db, AgentRunListFilter{TriggerType: "api"}, 20, 0)
	if err != nil {
		t.Fatalf("ListWithFilter (trigger): %v", err)
	}
	if totalAPI != 2 || len(apiRuns) != 2 {
		t.Fatalf("trigger filter expected 2 runs, got total=%d rows=%d", totalAPI, len(apiRuns))
	}

	// Status filter.
	failed, totalFailed, err := d.ListWithFilter(ctx, db, AgentRunListFilter{Status: "failed"}, 20, 0)
	if err != nil {
		t.Fatalf("ListWithFilter (status): %v", err)
	}
	if totalFailed != 1 || len(failed) != 1 || failed[0].ID != "run-2" {
		t.Fatalf("status filter expected only run-2, got %d rows", len(failed))
	}

	// Keywords match the run id.
	byID, totalID, err := d.ListWithFilter(ctx, db, AgentRunListFilter{Keywords: "run-3"}, 20, 0)
	if err != nil {
		t.Fatalf("ListWithFilter (keyword id): %v", err)
	}
	if totalID != 1 || len(byID) != 1 || byID[0].ID != "run-3" {
		t.Fatalf("keyword by run id expected only run-3, got %d rows", len(byID))
	}

	// Keywords match the app title.
	_, totalTitle, err := d.ListWithFilter(ctx, db, AgentRunListFilter{Keywords: "Refund"}, 20, 0)
	if err != nil {
		t.Fatalf("ListWithFilter (keyword title): %v", err)
	}
	if totalTitle != 2 {
		t.Fatalf("keyword by app title expected 2 runs, got %d", totalTitle)
	}

	// Sorting: most recent first is the default.
	if all[0].ID != "run-3" {
		t.Fatalf("default sort should put the newest run first, got %s", all[0].ID)
	}
	// Longest duration.
	slow, _, err := d.ListWithFilter(ctx, db, AgentRunListFilter{Sort: "duration_desc"}, 20, 0)
	if err != nil {
		t.Fatalf("ListWithFilter (duration_desc): %v", err)
	}
	if slow[0].ID != "run-1" {
		t.Fatalf("duration_desc expected run-1 first, got %s", slow[0].ID)
	}
	// Shortest duration.
	fast, _, err := d.ListWithFilter(ctx, db, AgentRunListFilter{Sort: "duration_asc"}, 20, 0)
	if err != nil {
		t.Fatalf("ListWithFilter (duration_asc): %v", err)
	}
	if fast[0].ID != "run-2" {
		t.Fatalf("duration_asc expected run-2 first, got %s", fast[0].ID)
	}
	// Most tokens.
	tokens, _, err := d.ListWithFilter(ctx, db, AgentRunListFilter{Sort: "tokens_desc"}, 20, 0)
	if err != nil {
		t.Fatalf("ListWithFilter (tokens_desc): %v", err)
	}
	if tokens[0].ID != "run-1" {
		t.Fatalf("tokens_desc expected run-1 first, got %s", tokens[0].ID)
	}

	// An unknown sort key falls back to the default instead of erroring or
	// injecting anything.
	fallback, _, err := d.ListWithFilter(ctx, db, AgentRunListFilter{Sort: "id; DROP TABLE agent_run"}, 20, 0)
	if err != nil {
		t.Fatalf("ListWithFilter (unknown sort): %v", err)
	}
	if len(fallback) != 3 {
		t.Fatalf("unknown sort should fall back to the default, got %d rows", len(fallback))
	}

	// Pagination: limit/offset slice the filtered set.
	page1, totalPaged, err := d.ListWithFilter(ctx, db, AgentRunListFilter{}, 2, 0)
	if err != nil {
		t.Fatalf("ListWithFilter (page 1): %v", err)
	}
	if totalPaged != 3 || len(page1) != 2 {
		t.Fatalf("page 1 expected total=3 rows=2, got total=%d rows=%d", totalPaged, len(page1))
	}
	page2, _, err := d.ListWithFilter(ctx, db, AgentRunListFilter{}, 2, 2)
	if err != nil {
		t.Fatalf("ListWithFilter (page 2): %v", err)
	}
	if len(page2) != 1 {
		t.Fatalf("page 2 expected 1 row, got %d", len(page2))
	}
}
