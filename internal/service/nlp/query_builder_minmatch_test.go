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

// TestRebaseMinMatchForSynonyms pins the arithmetic behind the score-collapse
// fix: an expanded query must ask for the same share of the user's own clauses,
// so the fraction has to shrink by exactly the expansion ratio.
func TestRebaseMinMatchForSynonyms(t *testing.T) {
	cases := []struct {
		name      string
		minMatch  float64
		literal   int
		synonym   int
		want      float64
		wantEqual bool
	}{
		{
			// No aliases configured: production behaviour must be untouched.
			name: "no expansion passes through", minMatch: 0.3, literal: 3, synonym: 0,
			want: 0.3, wantEqual: true,
		},
		{
			// One term of the user's own, six alias clauses: the gate must drop
			// far enough that a chunk on the literal term still clears it.
			name: "one literal six aliases", minMatch: 0.3, literal: 1, synonym: 6,
			want: 0.3 / 7, wantEqual: true,
		},
		{
			// Long question, small group: the gate keeps most of its bite.
			name: "ten literal five aliases", minMatch: 0.3, literal: 10, synonym: 5,
			want: 0.2, wantEqual: true,
		},
		{
			// A disabled gate stays disabled, even with aliases.
			name: "zero gate stays zero", minMatch: 0, literal: 1, synonym: 6,
			want: 0, wantEqual: true,
		},
		{
			// Degenerate input: nothing was counted, so nothing to re-base.
			name: "empty counts pass through", minMatch: 0.3, literal: 0, synonym: 0,
			want: 0.3, wantEqual: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := rebaseMinMatchForSynonyms(tc.minMatch, tc.literal, tc.synonym)
			if tc.wantEqual {
				if diff := got - tc.want; diff > 1e-9 || diff < -1e-9 {
					t.Fatalf("rebaseMinMatchForSynonyms(%v, %d, %d) = %v, want %v",
						tc.minMatch, tc.literal, tc.synonym, got, tc.want)
				}
			}
			if got > tc.minMatch {
				t.Fatalf("rebaseMinMatchForSynonyms(%v, %d, %d) = %v raised the gate above the original %v — expansion must never make a query stricter",
					tc.minMatch, tc.literal, tc.synonym, got, tc.minMatch)
			}
		})
	}
}

// TestRebaseMinMatchForSynonymsNeverRaises is the invariant that the user
// actually reported: adding a synonym may never make an already-matching chunk
// score lower. Since the gate is the only lever expansion pulls down, "never
// above the original fraction" is the property to lock.
func TestRebaseMinMatchForSynonymsNeverRaises(t *testing.T) {
	for literal := 0; literal <= 12; literal++ {
		for synonym := 0; synonym <= 40; synonym++ {
			got := rebaseMinMatchForSynonyms(0.3, literal, synonym)
			if got > 0.3 {
				t.Fatalf("literal=%d synonym=%d produced %v > 0.3", literal, synonym, got)
			}
			if got < 0 {
				t.Fatalf("literal=%d synonym=%d produced negative gate %v", literal, synonym, got)
			}
			if synonym == 0 && got != 0.3 {
				t.Fatalf("literal=%d synonym=0 changed the gate to %v", literal, got)
			}
		}
	}
}

// TestQuestionScopedWithOverride_RebasesMinimumShouldMatch is the end-to-end
// regression test: it walks the real Chinese branch, so a future refactor that
// stops counting expansion clauses fails here rather than in production as a
// silently zeroed keyword channel.
func TestQuestionScopedWithOverride_RebasesMinimumShouldMatch(t *testing.T) {
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

	override := map[string][]string{
		"我的费率": {"申购费", "申购费率", "手续费", "认购费", "买入费率"},
	}

	baseline, _ := qb.QuestionScopedWithOverride(
		context.Background(), "", "", "我的费率", "", 0.3, "Chinese", nil)
	expanded, _ := qb.QuestionScopedWithOverride(
		context.Background(), "", "", "我的费率", "", 0.3, "Chinese", override)

	if baseline == nil || expanded == nil {
		t.Fatalf("expected both queries to build, got baseline=%v expanded=%v", baseline, expanded)
	}

	baseGate, _ := baseline.ExtraOptions["minimum_should_match"].(float64)
	expGate, _ := expanded.ExtraOptions["minimum_should_match"].(float64)
	t.Logf("minimum_should_match: baseline=%v expanded=%v query=%q", baseGate, expGate, expanded.MatchingText)

	if baseGate != 0.3 {
		t.Fatalf("baseline minimum_should_match = %v, want 0.3", baseGate)
	}
	if expGate >= baseGate {
		t.Fatalf("expanded minimum_should_match = %v, want strictly below baseline %v — a five-alias group must lower the gate, otherwise the keyword leg is filtered out and the score collapses",
			expGate, baseGate)
	}
}
