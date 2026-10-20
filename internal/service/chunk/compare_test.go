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

package chunk

import (
	"math"
	"testing"

	"ragflow/internal/service"
)

func hit(id string, rank int, score float64) service.CompareHit {
	return service.CompareHit{ChunkID: id, Rank: rank, Similarity: score}
}

// TestComputeCompareDiff_IntersectionAverage guards the fix from self-review
// P1-1: the average delta must be computed over the intersection, never over
// two differently-sized result sets. Here the candidate has one extra hit whose
// score is deliberately extreme, so an "all rows" average would be dragged off.
func TestComputeCompareDiff_IntersectionAverage(t *testing.T) {
	baseline := []service.CompareHit{
		hit("a", 1, 0.50),
		hit("b", 2, 0.40),
	}
	candidate := []service.CompareHit{
		hit("a", 1, 0.60), // +0.10
		hit("b", 2, 0.42), // +0.02
		hit("z", 3, 9.99), // the outlier that must NOT influence the average
	}

	diff := computeCompareDiff(baseline, candidate, 2, 3)

	if diff.Summary.CommonCount != 2 {
		t.Fatalf("common count = %d, want 2", diff.Summary.CommonCount)
	}
	wantAvg := (0.10 + 0.02) / 2
	if math.Abs(diff.Summary.AvgDeltaOnCommon-wantAvg) > 1e-9 {
		t.Fatalf("avg delta = %v, want %v (intersection-only)", diff.Summary.AvgDeltaOnCommon, wantAvg)
	}
	if diff.Summary.AddedCount != 1 {
		t.Fatalf("added = %d, want 1", diff.Summary.AddedCount)
	}
	if len(diff.Added) != 1 || diff.Added[0].ChunkID != "z" {
		t.Fatalf("added items = %+v, want [z]", diff.Added)
	}
}

// TestComputeCompareDiff_DisplacedVsReordered guards self-review P1-2: when one
// new row enters at the top, every row below shifts down without its own score
// changing. That is displacement, not N regressions.
func TestComputeCompareDiff_DisplacedVsReordered(t *testing.T) {
	baseline := []service.CompareHit{
		hit("a", 1, 0.90),
		hit("b", 2, 0.80),
		hit("c", 3, 0.70),
	}
	candidate := []service.CompareHit{
		hit("n", 1, 0.95), // new entry pushes everyone down
		hit("a", 2, 0.90), // same score, rank 1 -> 2
		hit("b", 3, 0.80), // same score, rank 2 -> 3
		hit("c", 4, 0.70), // same score, rank 3 -> 4
	}

	diff := computeCompareDiff(baseline, candidate, 3, 4)

	if diff.Summary.DisplacedCount != 3 {
		t.Fatalf("displaced = %d, want 3 (all shifts are structural)", diff.Summary.DisplacedCount)
	}
	if diff.Summary.ReorderedCount != 0 {
		t.Fatalf("reordered = %d, want 0 (no score moved)", diff.Summary.ReorderedCount)
	}
}

// TestComputeCompareDiff_RealReorder covers the opposite case: the score itself
// moved and the rank moved, which is a genuine reorder.
func TestComputeCompareDiff_RealReorder(t *testing.T) {
	baseline := []service.CompareHit{
		hit("a", 1, 0.90),
		hit("b", 2, 0.80),
	}
	candidate := []service.CompareHit{
		hit("b", 1, 0.95), // +0.15, rank 2 -> 1
		hit("a", 2, 0.90), // unchanged, rank 1 -> 2
	}

	diff := computeCompareDiff(baseline, candidate, 2, 2)

	if diff.Summary.ReorderedCount != 1 {
		t.Fatalf("reordered = %d, want 1", diff.Summary.ReorderedCount)
	}
	if len(diff.ReorderedCommon) != 1 || diff.ReorderedCommon[0].ChunkID != "b" {
		t.Fatalf("reordered items = %+v, want [b]", diff.ReorderedCommon)
	}
	if diff.Summary.DisplacedCount != 1 {
		t.Fatalf("displaced = %d, want 1 (a shifted without its score moving)", diff.Summary.DisplacedCount)
	}
	if diff.Summary.ScoreChangedCount != 1 {
		t.Fatalf("score changed = %d, want 1", diff.Summary.ScoreChangedCount)
	}
}

// TestComputeCompareDiff_RemovedReason covers the honest-reason rule: the reason
// is inferred from whether the candidate had to truncate.
func TestComputeCompareDiff_RemovedReason(t *testing.T) {
	baseline := []service.CompareHit{
		hit("a", 1, 0.50),
		hit("b", 2, 0.40),
	}
	candidate := []service.CompareHit{
		hit("a", 1, 0.50),
	}

	// candidateTotal greater than returned rows: more results exist beyond the
	// window, so "b" most likely lost the ranking contest.
	truncated := computeCompareDiff(baseline, candidate, 2, 10)
	if len(truncated.Removed) != 1 {
		t.Fatalf("removed items = %d, want 1", len(truncated.Removed))
	}
	if truncated.Removed[0].Reason != "pushed_out_of_topk" {
		t.Fatalf("reason = %q, want pushed_out_of_topk", truncated.Removed[0].Reason)
	}

	// candidateTotal equals returned rows: nothing else was retrieved.
	exhausted := computeCompareDiff(baseline, candidate, 2, 1)
	if exhausted.Removed[0].Reason != "not_recalled" {
		t.Fatalf("reason = %q, want not_recalled", exhausted.Removed[0].Reason)
	}
}

// TestComputeCompareDiff_NoEffect covers the done_no_effect state: identical
// sides must produce an all-zero summary and empty buckets (never nil, so the
// UI can render without null checks).
func TestComputeCompareDiff_NoEffect(t *testing.T) {
	baseline := []service.CompareHit{
		hit("a", 1, 0.50),
		hit("b", 2, 0.40),
	}
	candidate := []service.CompareHit{
		hit("a", 1, 0.50),
		hit("b", 2, 0.40),
	}

	diff := computeCompareDiff(baseline, candidate, 2, 2)

	s := diff.Summary
	if s.AddedCount != 0 || s.RemovedCount != 0 || s.ReorderedCount != 0 ||
		s.DisplacedCount != 0 || s.ScoreChangedCount != 0 {
		t.Fatalf("expected an all-zero summary, got %+v", s)
	}
	if s.AvgDeltaOnCommon != 0 {
		t.Fatalf("avg delta = %v, want 0", s.AvgDeltaOnCommon)
	}
	if diff.Added == nil || diff.Removed == nil ||
		diff.ReorderedCommon == nil || diff.ScoreChanged == nil {
		t.Fatalf("buckets must be empty slices, not nil")
	}
}

// TestComputeCompareDiff_EmptySides makes sure an empty result set does not
// divide by zero.
func TestComputeCompareDiff_EmptySides(t *testing.T) {
	diff := computeCompareDiff(nil, nil, 0, 0)
	if diff.Summary.AvgDeltaOnCommon != 0 || diff.Summary.CommonCount != 0 {
		t.Fatalf("empty diff should be zero-valued, got %+v", diff.Summary)
	}
}

// TestComputeCompareDiff_ScoreEpsilon verifies that a sub-epsilon score wobble
// is not reported as a change.
func TestComputeCompareDiff_ScoreEpsilon(t *testing.T) {
	baseline := []service.CompareHit{hit("a", 1, 0.50000)}
	candidate := []service.CompareHit{hit("a", 1, 0.50005)}

	diff := computeCompareDiff(baseline, candidate, 1, 1)
	if diff.Summary.ScoreChangedCount != 0 {
		t.Fatalf("score changed = %d, want 0 (within epsilon)", diff.Summary.ScoreChangedCount)
	}
}

// TestShareBigram guards the overlap fallback: tokenisers segment
// inconsistently, so two obviously-related Chinese sentences can end up with
// disjoint term lists. Falling back to a character bigram must still recognise
// them as related — otherwise a real effect gets silently skipped.
func TestShareBigram(t *testing.T) {
	cases := []struct {
		name    string
		a, b    string
		wantHit bool
	}{
		{
			name:    "related Chinese phrasing",
			a:       "华夏基金 申购费率是多少",
			b:       "华夏的申购费率说明",
			wantHit: true,
		},
		{
			name:    "unrelated Chinese",
			a:       "华夏基金 申购费率是多少",
			b:       "火星探测器的燃料配方",
			wantHit: false,
		},
		{
			name:    "too short to compare",
			a:       "a",
			b:       "b",
			wantHit: false,
		},
		{
			name:    "shared latin bigram",
			a:       "etf fee",
			b:       "etf charges",
			wantHit: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := shareBigram(tc.a, tc.b); got != tc.wantHit {
				t.Fatalf("shareBigram(%q, %q) = %v, want %v", tc.a, tc.b, got, tc.wantHit)
			}
		})
	}
}

// TestOverlapsQuestion_TokenOrBigram documents the two-tier rule: either a
// token hit or a character bigram hit counts as overlap.
func TestOverlapsQuestion_TokenOrBigram(t *testing.T) {
	// Disjoint token lists, but the strings obviously relate.
	if !overlapsQuestion("华夏基金 申购费率是多少", "华夏的申购费率说明",
		[]string{"totally", "different"}, []string{"tokens", "here"}) {
		t.Fatal("expected a bigram hit to count as overlap")
	}
	// Neither tokens nor bigrams overlap.
	if overlapsQuestion("华夏基金", "火星探测器",
		[]string{"x"}, []string{"y"}) {
		t.Fatal("expected no overlap for unrelated content")
	}
	// Token hit alone is enough even without shared characters.
	if !overlapsQuestion("alpha", "beta", []string{"shared"}, []string{"shared"}) {
		t.Fatal("expected a token hit to count as overlap")
	}
}
