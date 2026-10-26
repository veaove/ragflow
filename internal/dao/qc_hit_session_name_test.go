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

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"ragflow/internal/entity"
)

// The hit log only stores session_id, and the two runtimes keep their sessions
// in different tables (chat -> conversation, canvas -> api_4_conversation), so
// the display name has to be resolved from both. These tests pin the read-time
// behaviour: a name lookup must never be able to turn a hit into an error, and
// an unresolvable session must stay empty rather than borrow another name.

func setupQcHitSessionNameDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to open sqlite: %v", err)
	}
	// Created by hand instead of AutoMigrate: fillSessionNames only reads
	// (id, name) and the entities carry columns that are irrelevant here.
	for _, stmt := range []string{
		`CREATE TABLE conversation (id TEXT PRIMARY KEY, name TEXT)`,
		`CREATE TABLE api_4_conversation (id TEXT PRIMARY KEY, name TEXT)`,
	} {
		if err := db.Exec(stmt).Error; err != nil {
			t.Fatalf("failed to create table: %v", err)
		}
	}
	return db
}

func TestQcHitFillSessionNamesResolvesBothRuntimes(t *testing.T) {
	db := setupQcHitSessionNameDB(t)
	rows := []struct {
		table string
		id    string
		name  any
	}{
		{"conversation", "chat-session", "基金产品咨询"},
		{"api_4_conversation", "canvas-session", "退款流程排查"},
		// Never renamed: COALESCE(name, '') must yield "" and not a literal
		// "NULL" string.
		{"conversation", "unnamed-session", nil},
	}
	for _, r := range rows {
		if err := db.Exec(
			"INSERT INTO "+r.table+" (id, name) VALUES (?, ?)", r.id, r.name,
		).Error; err != nil {
			t.Fatalf("failed to insert %s: %v", r.table, err)
		}
	}

	hits := []entity.QcHit{
		{SessionID: "chat-session"},
		{SessionID: "canvas-session"},
		{SessionID: "unnamed-session"},
		// Deleted, or a session id from a runtime that no longer exists.
		{SessionID: "gone-session"},
		{SessionID: ""},
	}
	NewQcHitDAO().fillSessionNames(context.Background(), db, hits)

	want := []string{"基金产品咨询", "退款流程排查", "", "", ""}
	for i, w := range want {
		if hits[i].SessionName != w {
			t.Errorf("hits[%d].SessionName = %q, want %q", i, hits[i].SessionName, w)
		}
	}
}

func TestQcHitFillSessionNamesToleratesMissingTable(t *testing.T) {
	db := setupQcHitSessionNameDB(t)
	// A deployment whose canvas runtime never wrote a session must still list
	// chat hits; the lookup error is swallowed on purpose.
	if err := db.Exec(`DROP TABLE api_4_conversation`).Error; err != nil {
		t.Fatalf("failed to drop table: %v", err)
	}
	if err := db.Exec(
		`INSERT INTO conversation (id, name) VALUES (?, ?)`, "chat-session", "基金产品咨询",
	).Error; err != nil {
		t.Fatalf("failed to insert conversation: %v", err)
	}

	hits := []entity.QcHit{{SessionID: "chat-session"}}
	NewQcHitDAO().fillSessionNames(context.Background(), db, hits)

	if hits[0].SessionName != "基金产品咨询" {
		t.Errorf("SessionName = %q, want %q", hits[0].SessionName, "基金产品咨询")
	}
}
