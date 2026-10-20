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

// RetrievalCompareRequest drives the change-set retrieval comparison
// (同义词测试对比 2.0). It embeds the ordinary retrieval-test request so the
// two sides of the comparison run with exactly the same TopK / threshold /
// weight / doc filters — the comparison is only meaningful if every knob
// except the pending change set is held constant.
type RetrievalCompareRequest struct {
	RetrievalTestRequest
	// ShadowSimilarQuestions controls whether pending similar questions are
	// simulated. Defaults to true. Setting it false yields a synonyms-only
	// comparison, which is the exact path (synonym expansion only ever
	// touches the query string).
	ShadowSimilarQuestions *bool `json:"shadow_similar_questions,omitempty"`
}

// CompareHit is one retrieved chunk, as shown in either comparison column.
type CompareHit struct {
	ChunkID    string  `json:"chunk_id"`
	DocKeyword string  `json:"doc_keyword,omitempty"`
	Content    string  `json:"content,omitempty"`
	Similarity float64 `json:"similarity"`
	// Rank is 1-based so the UI can render "#1" directly.
	Rank int `json:"rank"`
}

// CompareSide is one column of the comparison.
type CompareSide struct {
	Hits   []CompareHit `json:"hits"`
	TookMs int64        `json:"took_ms"`
	Total  int64        `json:"total"`
}

// CompareDiffItem describes one chunk's participation in the diff. Which
// fields are populated depends on which diff bucket the item belongs to.
type CompareDiffItem struct {
	ChunkID     string  `json:"chunk_id"`
	DocKeyword  string  `json:"doc_keyword,omitempty"`
	Content     string  `json:"content,omitempty"`
	Similarity  float64 `json:"similarity,omitempty"`
	Rank        int     `json:"rank,omitempty"`
	BeforeRank  int     `json:"before_rank,omitempty"`
	AfterRank   int     `json:"after_rank,omitempty"`
	BeforeScore float64 `json:"before_score,omitempty"`
	AfterScore  float64 `json:"after_score,omitempty"`
	Delta       float64 `json:"delta,omitempty"`
	// Reason is set for removed items only:
	//   pushed_out_of_topk — the candidate still has more results than it
	//                        returned, so this chunk most likely lost the
	//                        ranking contest rather than disappeared;
	//   not_recalled       — the candidate retrieved no further results, so
	//                        this chunk was genuinely not recalled.
	Reason string `json:"reason,omitempty"`
}

// CompareDiffSummary aggregates the diff. Note that AvgDeltaOnCommon is
// computed **on the intersection only**: averaging over different-sized
// result sets (5 hits vs 6 hits) compares two incomparable populations.
type CompareDiffSummary struct {
	BaselineCount     int     `json:"baseline_count"`
	CandidateCount    int     `json:"candidate_count"`
	AddedCount        int     `json:"added_count"`
	RemovedCount      int     `json:"removed_count"`
	ReorderedCount    int     `json:"reordered_count"`
	DisplacedCount    int     `json:"displaced_count"`
	ScoreChangedCount int     `json:"score_changed_count"`
	AvgDeltaOnCommon  float64 `json:"avg_delta_on_common"`
	CommonCount       int     `json:"common_count"`
}

// CompareDiff is the structural difference between the two sides.
type CompareDiff struct {
	Added           []CompareDiffItem  `json:"added"`
	Removed         []CompareDiffItem  `json:"removed"`
	ReorderedCommon []CompareDiffItem  `json:"reordered_common"`
	ScoreChanged    []CompareDiffItem  `json:"score_changed"`
	Summary         CompareDiffSummary `json:"summary"`
}

// CompareCapability states, honestly, what this run could and could not
// simulate. The front end renders it verbatim — the comparison is an
// approximation on one axis and must say so.
type CompareCapability struct {
	// SynonymSimulated is always true: synonyms are expanded into the query
	// string, which is engine-independent.
	SynonymSimulated bool `json:"synonym_simulated"`
	// SimilarQSimulated is true only on the rerank path, where a similar
	// question enters scoring through the chunk token list we can inject into.
	SimilarQSimulated bool `json:"similar_q_simulated"`
	// UnsolvedReasons lists machine-readable reasons, e.g. "no_rerank_model".
	UnsolvedReasons []string `json:"unsolved_reasons"`
	// AffectedChunkCount is how many chunks the change set adds questions to.
	AffectedChunkCount int `json:"affected_chunk_count"`
	// SkippedSimilarCount counts added similar questions that share no term
	// with the test question. Injecting those cannot change any score, so they
	// are skipped — and the count is itself useful feedback ("this question
	// you added does nothing for this query").
	SkippedSimilarCount int `json:"skipped_similar_count"`
}

// RetrievalCompareResponse is the POST .../retrieval-compare body.
type RetrievalCompareResponse struct {
	Baseline   CompareSide       `json:"baseline"`
	Candidate  CompareSide       `json:"candidate"`
	Diff       CompareDiff       `json:"diff"`
	Capability CompareCapability `json:"capability"`
}
