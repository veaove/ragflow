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

// TestUserCanvasDAO_ListByIDs_ReleaseFilter covers the publication-state
// filter used by the Agent / Studio list filter bars (product doc 3.4:
// "状态" is a column the table shows, so it must be filterable).
func TestUserCanvasDAO_ListByIDs_ReleaseFilter(t *testing.T) {
	ctx := context.Background()
	db := setupUserCanvasTestDB(t)
	d := NewUserCanvasDAO()

	if err := db.Create(&entity.User{ID: "u1", Nickname: "Owner", Email: "o@example.com"}).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	canvases := []entity.UserCanvas{
		{ID: "pub", UserID: "u1", Permission: "me", CanvasCategory: "workflow_canvas", Title: stringPtr("Published"), Release: true},
		{ID: "draft", UserID: "u1", Permission: "me", CanvasCategory: "workflow_canvas", Title: stringPtr("Draft"), Release: false},
	}
	for i := range canvases {
		if err := db.Create(&canvases[i]).Error; err != nil {
			t.Fatalf("create canvas: %v", err)
		}
	}

	ids := []string{"pub", "draft"}
	terms := []OrderTerm{{Column: "create_time"}}

	// nil = no filter on this dimension: both rows come back.
	all, _, err := d.ListByIDs(ctx, db, ids, nil, 1, 10, terms, "", nil, "", nil, nil)
	if err != nil {
		t.Fatalf("ListByIDs (no filter): %v", err)
	}
	if len(all) != 2 {
		t.Fatalf("expected 2 rows without a release filter, got %d", len(all))
	}

	published := true
	onlyPublished, _, err := d.ListByIDs(ctx, db, ids, nil, 1, 10, terms, "", nil, "", nil, &published)
	if err != nil {
		t.Fatalf("ListByIDs (published): %v", err)
	}
	if len(onlyPublished) != 1 || onlyPublished[0].ID != "pub" {
		t.Fatalf("published filter returned %d rows (want 1: pub), got %d", len(onlyPublished), len(onlyPublished))
	}

	draft := false
	onlyDraft, _, err := d.ListByIDs(ctx, db, ids, nil, 1, 10, terms, "", nil, "", nil, &draft)
	if err != nil {
		t.Fatalf("ListByIDs (draft): %v", err)
	}
	if len(onlyDraft) != 1 || onlyDraft[0].ID != "draft" {
		t.Fatalf("draft filter should return only the draft canvas, got %d rows", len(onlyDraft))
	}
}
