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

package kgview

import "testing"

func TestEntityKeyFoldsLegalSuffixes(t *testing.T) {
	same := []string{
		"华夏基金管理有限公司",
		"华夏基金",
		"华夏基金 ",
		"华夏基金(集团)",
	}
	base := EntityKey(same[0])
	for _, name := range same[1:] {
		if got := EntityKey(name); got != base {
			t.Errorf("EntityKey(%q) = %q, want %q (same entity)", name, got, base)
		}
	}

	// A name that only consists of a suffix must not collapse to nothing.
	if got := EntityKey("公司"); got != "公司" {
		t.Errorf("EntityKey(公司) = %q, want 公司", got)
	}
	// Different entities must stay apart.
	if EntityKey("华夏基金") == EntityKey("华夏银行") {
		t.Error("distinct entities collapsed into one key")
	}
}

func TestNormalizeNameFoldsWidthCaseAndPunctuation(t *testing.T) {
	if got := NormalizeName("Ｍｏｄｅｌ  Y（2026）"); got != "modely2026" {
		t.Errorf("NormalizeName = %q, want modely2026", got)
	}
	if NormalizeName("华夏基金") != NormalizeName("华夏基金，") {
		t.Error("trailing punctuation changed the key")
	}
}

func TestConfidenceIsMonotoneAndBounded(t *testing.T) {
	previous := 0.0
	for support := 0; support <= 10; support++ {
		got := Confidence(support)
		if got < 0.5 || got > 0.99 {
			t.Fatalf("Confidence(%d) = %v, want within [0.5, 0.99]", support, got)
		}
		if support > 0 && got < previous {
			t.Fatalf("Confidence is not monotone at support=%d: %v < %v", support, got, previous)
		}
		previous = got
	}
	if Confidence(1) >= 0.9 {
		t.Errorf("a single snippet should not look certain: %v", Confidence(1))
	}
}

func TestClampConfidence(t *testing.T) {
	if _, ok := ClampConfidence(0); ok {
		t.Error("zero confidence must be treated as absent")
	}
	if _, ok := ClampConfidence(1.4); ok {
		t.Error("out-of-range confidence must be rejected")
	}
	if got, ok := ClampConfidence(0.8765); !ok || got != 0.877 {
		t.Errorf("ClampConfidence(0.8765) = (%v, %v), want (0.877, true)", got, ok)
	}
}

func TestStableIDIsStable(t *testing.T) {
	first := StableID("n", "华夏基金")
	second := StableID("n", "华夏基金")
	if first != second {
		t.Fatalf("StableID is not deterministic: %q vs %q", first, second)
	}
	if first == StableID("n", "华夏银行") {
		t.Fatal("distinct keys produced the same id")
	}
}

func TestSnippet(t *testing.T) {
	if got := Snippet("  多行\n文本  ", 10); got != "多行 文本" {
		t.Errorf("Snippet collapsed whitespace wrong: %q", got)
	}
	if got := Snippet("一二三四五六", 3); got != "一二三…" {
		t.Errorf("Snippet truncation = %q", got)
	}
}
