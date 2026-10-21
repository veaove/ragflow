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
	"reflect"
	"testing"
)

func TestChunkQuestionList(t *testing.T) {
	cases := []struct {
		name string
		in   interface{}
		want []interface{}
	}{
		{"nil", nil, []interface{}{}},
		{"empty string", "", []interface{}{}},
		{"newline joined", "工资理财去哪买\n在哪买基金", []interface{}{"工资理财去哪买", "在哪买基金"}},
		{"blank lines dropped", "a\n\n  \nb", []interface{}{"a", "b"}},
		{"already a list", []interface{}{"a", "b"}, []interface{}{"a", "b"}},
		{"go native list", []string{"a", "b"}, []interface{}{"a", "b"}},
		{"unexpected type", 42, []interface{}{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := chunkQuestionList(tc.in); !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("chunkQuestionList(%#v) = %#v, want %#v", tc.in, got, tc.want)
			}
		})
	}
}

// TestFormatChunkForListQuestionKwdIsAlwaysAList pins the bug behind
// "n.map is not a function" on the similar-question page.
//
// Infinity's chunk reader publishes the same column twice: the raw
// newline-joined `questions` string and the split `question_kwd` list. Both
// live in one Go map, so the projection iterated them in a random order and the
// raw string sometimes won — the endpoint then returned a string where the
// client contract promises an array. The map is iterated repeatedly here
// because a single pass can land on the lucky order.
func TestFormatChunkForListQuestionKwdIsAlwaysAList(t *testing.T) {
	for i := 0; i < 200; i++ {
		chunk := map[string]interface{}{
			"id":                  "chunk-1",
			"content_with_weight": "问题：怎么买\t回答：官网",
			"questions":           "怎么买基金\n基金在哪买",
			"question_kwd":        []interface{}{"怎么买基金", "基金在哪买"},
		}
		got := formatChunkForList(chunk)
		list, ok := got["question_kwd"].([]interface{})
		if !ok {
			t.Fatalf("iteration %d: question_kwd = %#v (%T), want a list", i, got["question_kwd"], got["question_kwd"])
		}
		if len(list) != 2 {
			t.Fatalf("iteration %d: question_kwd = %#v, want 2 entries", i, list)
		}
	}
}

// TestFormatChunkForListQuestionKwdFromRawString covers the backends that only
// hand back the raw column: it must still be split into a list.
func TestFormatChunkForListQuestionKwdFromRawString(t *testing.T) {
	got := formatChunkForList(map[string]interface{}{
		"id":            "chunk-2",
		"questions":     "a\nb",
		"docnm":         "faq.md",
		"available_int": 0,
	})
	list, ok := got["question_kwd"].([]interface{})
	if !ok {
		t.Fatalf("question_kwd = %#v (%T), want a list", got["question_kwd"], got["question_kwd"])
	}
	if !reflect.DeepEqual(list, []interface{}{"a", "b"}) {
		t.Fatalf("question_kwd = %#v, want [a b]", list)
	}
	if got["available"] != false {
		t.Fatalf("available = %#v, want false for available_int=0", got["available"])
	}
	if got["docnm_kwd"] != "faq.md" {
		t.Fatalf("docnm_kwd = %#v, want faq.md", got["docnm_kwd"])
	}
}
