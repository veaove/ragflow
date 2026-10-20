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

package nlp

import (
	"context"
	"testing"
	"time"

	"ragflow/internal/tokenizer"
)

// newTestQueryBuilder builds a QueryBuilder with an empty synonym dictionary.
// It deliberately avoids touching the tokenizer or wordnet, so the test runs
// anywhere — the behaviour under test is dictionary resolution, not segmentation.
func newTestQueryBuilder() *QueryBuilder {
	return &QueryBuilder{
		synonym: NewSynonymWithLoader(nil, "", "", nil),
	}
}

// TestLookupSynonyms_HonoursOverride covers the bug that made the whole
// change-set comparison silently useless on Chinese datasets: the override was
// applied at exactly one of the three dictionary call sites, so the Chinese
// branch kept reading the live dictionary and the injected synonyms never
// reached the query.
func TestLookupSynonyms_HonoursOverride(t *testing.T) {
	qb := newTestQueryBuilder()
	ctx := context.Background()

	override := map[string][]string{
		"我的费率": {"申购费", "申购费率", "手续费"},
	}

	got := qb.lookupSynonyms(ctx, "", "", "我的费率", override)
	want := []string{"申购费", "申购费率", "手续费"}
	if len(got) != len(want) {
		t.Fatalf("lookupSynonyms returned %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("lookupSynonyms returned %v, want %v", got, want)
		}
	}
}

// TestLookupSynonyms_FallsBackToLive verifies the override is a sparse overlay:
// tokens it does not mention still consult the live dictionary. With an empty
// dictionary that means "no synonyms", which is what we assert.
func TestLookupSynonyms_FallsBackToLive(t *testing.T) {
	qb := newTestQueryBuilder()
	ctx := context.Background()

	override := map[string][]string{"我的费率": {"申购费"}}

	got := qb.lookupSynonyms(ctx, "", "", "无关词", override)
	if len(got) != 0 {
		t.Fatalf("lookupSynonyms for an uncovered token returned %v, want empty", got)
	}
}

// TestLookupSynonyms_NilOverrideIsHarmless locks the ordinary path: production
// retrieval passes nil, and it must behave exactly as before the injection
// point existed.
func TestLookupSynonyms_NilOverrideIsHarmless(t *testing.T) {
	qb := newTestQueryBuilder()
	got := qb.lookupSynonyms(context.Background(), "", "", "任何词", nil)
	if len(got) != 0 {
		t.Fatalf("lookupSynonyms with nil override returned %v, want empty", got)
	}
}

// TestQuestionScopedWithOverride_ChineseBranch is the decisive regression test
// for the bug described above: it runs the real Chinese code path and asserts
// the injected synonym actually reaches the emitted keywords.
//
// A synthetic token (ZZZINJECTEDSYN) is used so the assertion cannot be
// satisfied by anything the live dictionary happens to contain.
func TestQuestionScopedWithOverride_ChineseBranch(t *testing.T) {
	if err := tokenizer.Init(&tokenizer.PoolConfig{
		MinSize: 1, MaxSize: 1,
		IdleTimeout:    5 * time.Second,
		AcquireTimeout: 5 * time.Second,
	}); err != nil {
		t.Skipf("tokenizer unavailable in this environment: %v", err)
	}
	defer tokenizer.Close()

	qb := NewQueryBuilder()
	// NewQueryBuilder leaves the dictionary nil; an empty one is enough — the
	// override is what we are testing.
	qb.synonym = NewSynonymWithLoader(nil, "", "", nil)

	const injected = "ZZZINJECTEDSYN"
	override := map[string][]string{"我的费率": {injected}}

	_, keywords := qb.QuestionScopedWithOverride(
		context.Background(), "", "", "我的费率", "", 0.3, "Chinese", override)

	found := false
	for _, k := range keywords {
		if k == injected {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("injected synonym %q missing from keywords %v — the Chinese branch is not honouring the override", injected, keywords)
	}
}

// TestQuestionScopedWithOverride_ChineseBranchUnchangedWithoutOverride makes
// sure ordinary retrieval (nil override) is untouched by the injection point.
func TestQuestionScopedWithOverride_ChineseBranchUnchangedWithoutOverride(t *testing.T) {
	if err := tokenizer.Init(&tokenizer.PoolConfig{
		MinSize: 1, MaxSize: 1,
		IdleTimeout:    5 * time.Second,
		AcquireTimeout: 5 * time.Second,
	}); err != nil {
		t.Skipf("tokenizer unavailable in this environment: %v", err)
	}
	defer tokenizer.Close()

	qb := NewQueryBuilder()
	qb.synonym = NewSynonymWithLoader(nil, "", "", nil)

	_, keywords := qb.QuestionScopedWithOverride(
		context.Background(), "", "", "我的费率", "", 0.3, "Chinese", nil)

	for _, k := range keywords {
		if k == "ZZZINJECTEDSYN" {
			t.Fatalf("nil override leaked an injected term: %v", keywords)
		}
	}
}
