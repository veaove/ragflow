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
	"reflect"
	"testing"
	"time"

	"ragflow/internal/tokenizer"
)

// TestWithEntryAliases covers the merge itself, without a tokenizer: the
// verbatim key survives, the segmented key resolves to the same group, and the
// loader's map is left untouched (it is shared with the cache).
func TestWithEntryAliases(t *testing.T) {
	loaderDict := map[string][]string{
		"基金是怎么买": {"买基金", "申购", "购买基金"},
		"申购费":    {"手续费", "认购费"},
	}
	// Segmentation is the caller's job; this test exercises the merge.
	got := withEntryAliases(loaderDict, func(entry string) []string {
		switch entry {
		case "基金是怎么买":
			return []string{"基金买"}
		case "申购费":
			return []string{"申购费率"}
		default:
			return nil
		}
	})

	if len(loaderDict) != 2 {
		t.Fatalf("loader dictionary was mutated: %v", loaderDict)
	}
	if _, ok := got["基金是怎么买"]; !ok {
		t.Fatalf("verbatim key disappeared: %v", got)
	}
	if !reflect.DeepEqual(got["基金买"], []string{"买基金", "申购", "购买基金"}) {
		t.Fatalf("基金买 = %v, want the 基金是怎么买 group", got["基金买"])
	}
	if !reflect.DeepEqual(got["申购费率"], []string{"手续费", "认购费"}) {
		t.Fatalf("申购费率 = %v, want the 申购费 group", got["申购费率"])
	}
}

// TestWithEntryAliasesDedupesMembers locks the slot accounting: reaching the
// same group through both spellings must not spend two of the caller's synonym
// slots on the same word.
func TestWithEntryAliasesDedupesMembers(t *testing.T) {
	loaderDict := map[string][]string{
		"基金是怎么买": {"买基金", "申购"},
		"基金买":    {"买基金", "申购", "申购"},
	}
	got := withEntryAliases(loaderDict, func(entry string) []string {
		if entry == "基金是怎么买" {
			return []string{"基金买"}
		}
		return nil
	})
	if !reflect.DeepEqual(got["基金买"], []string{"买基金", "申购"}) {
		t.Fatalf("基金买 = %v, want deduplicated [买基金 申购]", got["基金买"])
	}
}

// TestWithEntryAliasesNilKeepsDictionary makes sure ordinary callers (no alias
// hook) and empty vocabularies are untouched.
func TestWithEntryAliasesNilKeepsDictionary(t *testing.T) {
	dict := map[string][]string{"a": {"b"}}
	if got := withEntryAliases(dict, nil); !reflect.DeepEqual(got, dict) {
		t.Fatalf("nil aliasKeys changed the dictionary: %v", got)
	}
	if got := withEntryAliases(nil, func(string) []string { return []string{"x"} }); got != nil {
		t.Fatalf("empty dictionary produced %v, want nil", got)
	}
}

// TestQuestionScopedWithOverride_EntryAliasClosesTheGap is the end-to-end
// regression test for the customer report "加了相似词，感觉没生效".
//
// The entry is stored the way the customer typed it ("基金是怎么买"); the
// question is asked the way a customer asks it ("基金怎么买"). Before the fix
// the dictionary was consulted for the segment "基金买", missed, and the whole
// group stayed invisible to retrieval. The change-set preview tokenised the
// entry itself, so it showed an effect that production could never reproduce.
func TestQuestionScopedWithOverride_EntryAliasClosesTheGap(t *testing.T) {
	if err := tokenizer.Init(&tokenizer.PoolConfig{
		MinSize: 1, MaxSize: 1,
		IdleTimeout:    5 * time.Second,
		AcquireTimeout: 5 * time.Second,
	}); err != nil {
		t.Skipf("tokenizer unavailable in this environment: %v", err)
	}
	defer tokenizer.Close()

	loader := &stubLoader{dict: map[string][]string{
		"基金是怎么买": {"买基金", "申购", "购买基金"},
	}}
	qb := NewQueryBuilder()
	qb.synonym = NewSynonymWithLoader(nil, "", "", loader)

	_, keywords := qb.QuestionScopedWithOverride(
		context.Background(), "t1", "kb1", "基金怎么买", "", 0.3, "Chinese", nil)

	want := []string{"买基金", "申购", "购买基金"}
	for _, w := range want {
		found := false
		for _, k := range keywords {
			if k == w {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("keyword %q missing from %v — the entry stored as 「基金是怎么买」 is invisible to the segment the query path looks up", w, keywords)
		}
	}
	if loader.calls != 1 {
		t.Fatalf("dictionary loaded %d times, want 1 (the cache should serve the rest)", loader.calls)
	}

	// A second question must be answered from the cache, aliases included.
	_, again := qb.QuestionScopedWithOverride(
		context.Background(), "t1", "kb1", "基金怎么买", "", 0.3, "Chinese", nil)
	if len(again) != len(keywords) {
		t.Fatalf("cached lookup returned %v, want %v", again, keywords)
	}
}

// TestVocabularyAliasKeysSkipsFragments pins the guard that keeps the alias
// index from grafting whole groups onto single characters.
func TestVocabularyAliasKeysSkipsFragments(t *testing.T) {
	if err := tokenizer.Init(&tokenizer.PoolConfig{
		MinSize: 1, MaxSize: 1,
		IdleTimeout:    5 * time.Second,
		AcquireTimeout: 5 * time.Second,
	}); err != nil {
		t.Skipf("tokenizer unavailable in this environment: %v", err)
	}
	defer tokenizer.Close()

	qb := NewQueryBuilder()

	// Same spelling after normalisation -> no extra key.
	if got := qb.vocabularyAliasKeys("买基金"); len(got) != 0 {
		t.Fatalf("vocabularyAliasKeys(买基金) = %v, want none", got)
	}
	// Different spelling -> exactly the segment the query path would use.
	got := qb.vocabularyAliasKeys("基金是怎么买")
	if !reflect.DeepEqual(got, []string{"基金买"}) {
		t.Fatalf("vocabularyAliasKeys(基金是怎么买) = %v, want [基金买]", got)
	}
	// Every key is long enough to be specific.
	for _, key := range got {
		if len([]rune(key)) < 2 {
			t.Fatalf("alias key %q is a single rune", key)
		}
	}
}
