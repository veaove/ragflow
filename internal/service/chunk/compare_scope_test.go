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
	"testing"

	"ragflow/internal/service"
)

func TestFilterChangeSetDiff(t *testing.T) {
	diff := &service.ChangeSetDiff{
		ChangeSetID: "cs-1",
		SimilarQuestions: []service.SimilarQuestionDiff{
			{ChunkID: "c1"},
			{ChunkID: "c2"},
			{ChunkID: "c3"},
		},
		Synonyms: []service.SynonymGroupDiff{
			{GroupID: "g1"},
			{GroupID: "g2"},
		},
	}

	t.Run("selects only listed ids", func(t *testing.T) {
		got := filterChangeSetDiff(diff, &service.ChangeSetItemFilter{
			ChunkIDs: []string{"c1", "c3"},
			GroupIDs: []string{"g2"},
		})
		if len(got.SimilarQuestions) != 2 || len(got.Synonyms) != 1 {
			t.Fatalf("expected 2 similar questions + 1 synonym, got %d + %d",
				len(got.SimilarQuestions), len(got.Synonyms))
		}
		if got.SimilarQuestions[0].ChunkID != "c1" || got.SimilarQuestions[1].ChunkID != "c3" {
			t.Fatalf("similar question order/ids wrong: %+v", got.SimilarQuestions)
		}
		if got.Synonyms[0].GroupID != "g2" {
			t.Fatalf("synonym id wrong: %+v", got.Synonyms)
		}
		if got.ChangeSetID != "cs-1" {
			t.Fatalf("change_set_id not carried over: %q", got.ChangeSetID)
		}
	})

	t.Run("empty chunk list drops all similar questions", func(t *testing.T) {
		got := filterChangeSetDiff(diff, &service.ChangeSetItemFilter{
			ChunkIDs: []string{},
			GroupIDs: []string{"g1"},
		})
		if len(got.SimilarQuestions) != 0 {
			t.Fatalf("expected 0 similar questions, got %d", len(got.SimilarQuestions))
		}
		if len(got.Synonyms) != 1 {
			t.Fatalf("expected 1 synonym, got %d", len(got.Synonyms))
		}
	})

	t.Run("empty group list drops all synonyms", func(t *testing.T) {
		got := filterChangeSetDiff(diff, &service.ChangeSetItemFilter{
			ChunkIDs: []string{"c2"},
			GroupIDs: []string{},
		})
		if len(got.SimilarQuestions) != 1 || len(got.Synonyms) != 0 {
			t.Fatalf("expected 1 similar question + 0 synonyms, got %d + %d",
				len(got.SimilarQuestions), len(got.Synonyms))
		}
	})
}
