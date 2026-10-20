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

// QC rule selection is expressed only by qc_rule_binding rows, so the app
// settings checkbox list, the database and the compiled rule set can never
// disagree. These tests pin that contract: it used to be "a rule whose home app
// is this one applies implicitly", which showed the rule as already selected in
// the UI while nothing about that selection was stored, and made it impossible
// to tell which rules a session was really enforcing.

func setupQcRuleTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{TranslateError: true})
	if err != nil {
		t.Fatalf("failed to open sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&entity.QcRule{},
		&entity.QcRuleBinding{},
		// The one-time migration is guarded by a system_settings marker.
		&entity.SystemSettings{},
	); err != nil {
		t.Fatalf("failed to migrate: %v", err)
	}
	return db
}

func newTestQcRule(id, tenantID, appType, appID, name string, enabled bool) *entity.QcRule {
	return &entity.QcRule{
		ID:            id,
		TenantID:      tenantID,
		AppType:       appType,
		AppID:         appID,
		Name:          name,
		Keywords:      entity.QcKeywords{"你好"},
		MatchMode:     entity.QcMatchContains,
		Scope:         entity.QcScopeAIAnswer,
		Severity:      entity.QcSeverityWarn,
		Action:        entity.QcActionLogAndAlert,
		PromptMessage: "violation",
		Enabled:       enabled,
	}
}

func mustCreateQcRule(t *testing.T, db *gorm.DB, rule *entity.QcRule) {
	t.Helper()
	if err := db.Create(rule).Error; err != nil {
		t.Fatalf("failed to insert rule %s: %v", rule.ID, err)
	}
}

func qcRuleIDs(rules []entity.QcRule) map[string]bool {
	out := make(map[string]bool, len(rules))
	for _, r := range rules {
		out[r.ID] = true
	}
	return out
}

func countQcBindings(t *testing.T, db *gorm.DB) int64 {
	t.Helper()
	var n int64
	if err := db.Model(&entity.QcRuleBinding{}).Count(&n).Error; err != nil {
		t.Fatalf("failed to count bindings: %v", err)
	}
	return n
}

// A rule created in an app does NOT run there until it is selected. This is the
// bug the panel used to hide: the row was rendered as checked while no
// selection had ever been stored.
func TestQcRuleCreatedRuleDoesNotRunUntilSelected(t *testing.T) {
	db := setupQcRuleTestDB(t)
	ctx := context.Background()
	dao := NewQcRuleDAO()

	mustCreateQcRule(t, db, newTestQcRule("rule-a", "tenant-1", entity.QcAppTypeChat, "chat-1", "A", true))

	rules, err := dao.ListEnabledByApp(ctx, db, entity.QcAppTypeChat, "chat-1")
	if err != nil {
		t.Fatalf("ListEnabledByApp: %v", err)
	}
	if len(rules) != 0 {
		t.Fatalf("unselected rule must not run, got %d rule(s)", len(rules))
	}

	selection, err := dao.ListSelectable(ctx, db, "tenant-1", entity.QcAppTypeChat, "chat-1")
	if err != nil {
		t.Fatalf("ListSelectable: %v", err)
	}
	if len(selection) != 1 || selection[0].Selected {
		t.Fatalf("expected the rule to be listed as not selected, got %+v", selection)
	}
	if !selection[0].Home {
		t.Fatalf("home flag must still label where the rule was created")
	}

	// Ticking the checkbox is what makes it run.
	if err := dao.ReplaceBindings(ctx, db, "tenant-1", entity.QcAppTypeChat, "chat-1", []string{"rule-a"}); err != nil {
		t.Fatalf("ReplaceBindings: %v", err)
	}
	rules, err = dao.ListEnabledByApp(ctx, db, entity.QcAppTypeChat, "chat-1")
	if err != nil {
		t.Fatalf("ListEnabledByApp after select: %v", err)
	}
	if !qcRuleIDs(rules)["rule-a"] {
		t.Fatalf("selected rule must run, got %+v", qcRuleIDs(rules))
	}

	// Unticking it must be honoured — a home rule is not pinned on.
	if err := dao.ReplaceBindings(ctx, db, "tenant-1", entity.QcAppTypeChat, "chat-1", nil); err != nil {
		t.Fatalf("ReplaceBindings clear: %v", err)
	}
	rules, err = dao.ListEnabledByApp(ctx, db, entity.QcAppTypeChat, "chat-1")
	if err != nil {
		t.Fatalf("ListEnabledByApp after clear: %v", err)
	}
	if len(rules) != 0 {
		t.Fatalf("unselected home rule must stop running, got %d rule(s)", len(rules))
	}
}

// One rule can serve several apps; selecting it in app B must not leak into
// app A, and must not require duplicating the rule.
func TestQcRuleBindingSharedAcrossApps(t *testing.T) {
	db := setupQcRuleTestDB(t)
	ctx := context.Background()
	dao := NewQcRuleDAO()

	mustCreateQcRule(t, db, newTestQcRule("rule-a", "tenant-1", entity.QcAppTypeChat, "chat-1", "A", true))

	if err := dao.ReplaceBindings(ctx, db, "tenant-1", entity.QcAppTypeChat, "chat-2", []string{"rule-a"}); err != nil {
		t.Fatalf("ReplaceBindings: %v", err)
	}

	chat2, err := dao.ListEnabledByApp(ctx, db, entity.QcAppTypeChat, "chat-2")
	if err != nil {
		t.Fatalf("ListEnabledByApp chat-2: %v", err)
	}
	if !qcRuleIDs(chat2)["rule-a"] {
		t.Fatalf("chat-2 should enforce the shared rule, got %+v", qcRuleIDs(chat2))
	}

	chat1, err := dao.ListEnabledByApp(ctx, db, entity.QcAppTypeChat, "chat-1")
	if err != nil {
		t.Fatalf("ListEnabledByApp chat-1: %v", err)
	}
	if len(chat1) != 0 {
		t.Fatalf("selecting a rule in chat-2 must not enable it in chat-1, got %d rule(s)", len(chat1))
	}

	selection, err := dao.ListSelectable(ctx, db, "tenant-1", entity.QcAppTypeChat, "chat-2")
	if err != nil {
		t.Fatalf("ListSelectable: %v", err)
	}
	if len(selection) != 1 || !selection[0].Selected || selection[0].Home {
		t.Fatalf("chat-2 must show the rule selected but not home, got %+v", selection)
	}
}

// The startup backfill is what keeps pre-existing rules enforced after the
// switch to explicit selection. It has to be idempotent: it runs on every boot.
func TestEnsureHomeBindingsBackfillsAndIsIdempotent(t *testing.T) {
	db := setupQcRuleTestDB(t)
	ctx := context.Background()
	dao := NewQcRuleDAO()

	mustCreateQcRule(t, db, newTestQcRule("rule-a", "tenant-1", entity.QcAppTypeChat, "chat-1", "A", true))
	mustCreateQcRule(t, db, newTestQcRule("rule-b", "tenant-1", entity.QcAppTypeCanvas, "canvas-1", "B", true))

	for i := 0; i < 2; i++ {
		if err := dao.EnsureHomeBindings(ctx, db); err != nil {
			t.Fatalf("EnsureHomeBindings run %d: %v", i+1, err)
		}
	}
	if got := countQcBindings(t, db); got != 2 {
		t.Fatalf("expected one binding per rule after two runs, got %d", got)
	}

	chat, err := dao.ListEnabledByApp(ctx, db, entity.QcAppTypeChat, "chat-1")
	if err != nil {
		t.Fatalf("ListEnabledByApp chat: %v", err)
	}
	if !qcRuleIDs(chat)["rule-a"] {
		t.Fatalf("backfilled chat rule must run, got %+v", qcRuleIDs(chat))
	}

	canvas, err := dao.ListEnabledByApp(ctx, db, entity.QcAppTypeCanvas, "canvas-1")
	if err != nil {
		t.Fatalf("ListEnabledByApp canvas: %v", err)
	}
	if !qcRuleIDs(canvas)["rule-b"] {
		t.Fatalf("backfilled canvas rule must run, got %+v", qcRuleIDs(canvas))
	}
}

// A disabled rule stays selected but must not be enforced: selection and
// enablement are separate switches.
func TestDisabledBoundRuleDoesNotRun(t *testing.T) {
	db := setupQcRuleTestDB(t)
	ctx := context.Background()
	dao := NewQcRuleDAO()

	mustCreateQcRule(t, db, newTestQcRule("rule-a", "tenant-1", entity.QcAppTypeChat, "chat-1", "A", false))
	if err := dao.EnsureHomeBindings(ctx, db); err != nil {
		t.Fatalf("EnsureHomeBindings: %v", err)
	}

	rules, err := dao.ListEnabledByApp(ctx, db, entity.QcAppTypeChat, "chat-1")
	if err != nil {
		t.Fatalf("ListEnabledByApp: %v", err)
	}
	if len(rules) != 0 {
		t.Fatalf("disabled rule must not run, got %d rule(s)", len(rules))
	}

	selection, err := dao.ListSelectable(ctx, db, "tenant-1", entity.QcAppTypeChat, "chat-1")
	if err != nil {
		t.Fatalf("ListSelectable: %v", err)
	}
	if len(selection) != 1 || !selection[0].Selected || selection[0].Enabled {
		t.Fatalf("disabled rule must stay selected-but-disabled, got %+v", selection)
	}
}

// The one-time migration must not undo a deliberate choice: a rule the user
// unticked has no binding, which looks exactly like "never migrated", so the
// marker — not the missing row — decides whether to backfill again.
func TestEnsureExplicitSelectionRunsOnce(t *testing.T) {
	db := setupQcRuleTestDB(t)
	ctx := context.Background()
	dao := NewQcRuleDAO()

	mustCreateQcRule(t, db, newTestQcRule("rule-a", "tenant-1", entity.QcAppTypeChat, "chat-1", "A", true))

	if err := dao.EnsureExplicitSelection(ctx, db); err != nil {
		t.Fatalf("EnsureExplicitSelection: %v", err)
	}
	if got := countQcBindings(t, db); got != 1 {
		t.Fatalf("expected the home binding to be backfilled, got %d", got)
	}

	// The user unties the rule from this app.
	if err := dao.ReplaceBindings(ctx, db, "tenant-1", entity.QcAppTypeChat, "chat-1", nil); err != nil {
		t.Fatalf("ReplaceBindings clear: %v", err)
	}
	if got := countQcBindings(t, db); got != 0 {
		t.Fatalf("expected the binding to be removed, got %d", got)
	}

	// Next process start runs the migration again; it must be a no-op.
	if err := dao.EnsureExplicitSelection(ctx, db); err != nil {
		t.Fatalf("EnsureExplicitSelection re-run: %v", err)
	}
	if got := countQcBindings(t, db); got != 0 {
		t.Fatalf("migration must not re-select a rule the user turned off, got %d binding(s)", got)
	}
}

// A stale selection that carries another tenant's rule id must not attach it.
func TestReplaceBindingsIgnoresForeignRules(t *testing.T) {
	db := setupQcRuleTestDB(t)
	ctx := context.Background()
	dao := NewQcRuleDAO()

	mustCreateQcRule(t, db, newTestQcRule("rule-other", "tenant-2", entity.QcAppTypeChat, "chat-9", "Other", true))

	if err := dao.ReplaceBindings(ctx, db, "tenant-1", entity.QcAppTypeChat, "chat-1", []string{"rule-other"}); err != nil {
		t.Fatalf("ReplaceBindings: %v", err)
	}
	if got := countQcBindings(t, db); got != 0 {
		t.Fatalf("foreign rule must not be bound, got %d binding(s)", got)
	}
}

// Creating a rule in the QC menu has to leave it in effect for the app it was
// created in, otherwise it looks configured but inspects nothing.
func TestCreateWithHomeBindingMakesRuleRun(t *testing.T) {
	db := setupQcRuleTestDB(t)
	ctx := context.Background()
	dao := NewQcRuleDAO()

	rule := newTestQcRule("rule-a", "tenant-1", entity.QcAppTypeChat, "chat-1", "A", true)
	if err := dao.CreateWithHomeBinding(ctx, db, rule); err != nil {
		t.Fatalf("CreateWithHomeBinding: %v", err)
	}
	if got := countQcBindings(t, db); got != 1 {
		t.Fatalf("expected the home binding to be created, got %d", got)
	}

	rules, err := dao.ListEnabledByApp(ctx, db, entity.QcAppTypeChat, "chat-1")
	if err != nil {
		t.Fatalf("ListEnabledByApp: %v", err)
	}
	if !qcRuleIDs(rules)["rule-a"] {
		t.Fatalf("rule created for this app must run there, got %+v", qcRuleIDs(rules))
	}
}
