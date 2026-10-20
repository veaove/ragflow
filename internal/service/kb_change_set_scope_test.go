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

package service

import (
	"encoding/json"
	"testing"
)

// TestChangeSetItemFilterJSONContract locks the nil-vs-empty distinction the
// whole selection feature depends on: an absent/null scope must unmarshal to
// nil slices ("everything"), while an explicit empty list must stay a non-nil
// empty slice ("none of that kind selected"). If this contract ever breaks,
// a request that selects only similar questions would silently publish the
// vocabulary groups too.
func TestChangeSetItemFilterJSONContract(t *testing.T) {
	t.Run("absent fields are nil", func(t *testing.T) {
		var f ChangeSetItemFilter
		if err := json.Unmarshal([]byte(`{}`), &f); err != nil {
			t.Fatal(err)
		}
		if f.ChunkIDs != nil {
			t.Fatalf("absent chunk_ids should be nil, got %#v", f.ChunkIDs)
		}
		if f.GroupIDs != nil {
			t.Fatalf("absent group_ids should be nil, got %#v", f.GroupIDs)
		}
	})

	t.Run("explicit empty list is non-nil", func(t *testing.T) {
		var f ChangeSetItemFilter
		if err := json.Unmarshal([]byte(`{"chunk_ids":[],"group_ids":["g1"]}`), &f); err != nil {
			t.Fatal(err)
		}
		if f.ChunkIDs == nil {
			t.Fatal("explicit [] chunk_ids must stay non-nil to mean 'none selected'")
		}
		if len(f.ChunkIDs) != 0 {
			t.Fatalf("expected empty chunk_ids, got %#v", f.ChunkIDs)
		}
		if len(f.GroupIDs) != 1 || f.GroupIDs[0] != "g1" {
			t.Fatalf("group_ids wrong: %#v", f.GroupIDs)
		}
	})
}

func TestToIDSet(t *testing.T) {
	got := toIDSet([]string{"a", "b"})
	if len(got) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(got))
	}
	if _, ok := got["a"]; !ok {
		t.Fatal("missing key a")
	}
	if _, ok := got["b"]; !ok {
		t.Fatal("missing key b")
	}
	// A nil list yields an empty (but usable) set; the publish loop only
	// consults it when scope is non-nil, where an empty set means "nothing".
	if len(toIDSet(nil)) != 0 {
		t.Fatal("nil list should produce an empty set")
	}
}
