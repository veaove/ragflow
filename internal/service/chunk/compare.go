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
	"context"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"ragflow/internal/common"
	"ragflow/internal/entity"
	"ragflow/internal/service"
	"ragflow/internal/service/nlp"

	"go.uber.org/zap"
)

// scoreEpsilon is the threshold below which two similarity scores are treated
// as identical. Rerankers return f32-derived floats, so exact equality is not
// meaningful; 1e-4 matches the product spec's diff definition.
const scoreEpsilon = 1e-4

// wordSepThreshold mirrors the tokenizer parameters used everywhere else when
// splitting a synonym or similar question into terms (see reranker.go:117).
const wordSepThreshold = 0.6

// retrievalCompare runs the change-set comparison: the same query is retrieved
// twice — once against the live configuration, once against the configuration
// the change set would produce — and the two result sets are diffed.
//
// The candidate side is produced by injection, not by rebuilding an index:
//
//   - Synonyms expand into the query string (engine-independent, exact);
//   - Similar questions append tokens to the affected chunk's token list,
//     which is where they enter scoring on the rerank path (exact there,
//     impossible on the no-rerank path because fusion happens inside the
//     engine).
//
// Both runs use identical TopK / threshold / weight / filters, so the only
// difference between them is the pending change set.
func (s *ChunkService) RetrievalCompare(
	ctx context.Context,
	userID, datasetID, changeSetID string,
	req *service.RetrievalCompareRequest,
) (*service.RetrievalCompareResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("request is required")
	}
	if strings.TrimSpace(req.Question) == "" {
		return nil, fmt.Errorf("question is required")
	}

	diff, err := service.NewChangeSetService().GetChangeSetDiff(ctx, userID, datasetID, changeSetID)
	if err != nil {
		return nil, err
	}

	language, err := s.datasetLanguage(ctx, datasetID)
	if err != nil {
		return nil, err
	}

	shadowSimilar := true
	if req.ShadowSimilarQuestions != nil {
		shadowSimilar = *req.ShadowSimilarQuestions
	}

	override, extraTokens, capInfo := buildInjections(diff, req.Question, language, shadowSimilar)

	// Observability: when a comparison shows "no effect", this line answers the
	// first question every time — was anything actually injected? Logged at
	// info because the comparison is a user-initiated, low-frequency action.
	overrideTokens := make([]string, 0, len(override))
	for tk := range override {
		overrideTokens = append(overrideTokens, tk)
	}
	common.Info("retrieval compare injections built",
		zap.String("dataset_id", datasetID),
		zap.String("change_set_id", changeSetID),
		zap.String("question", req.Question),
		zap.Int("synonym_override_tokens", len(override)),
		zap.Strings("synonym_override_keys", overrideTokens),
		zap.Int("extra_token_chunks", len(extraTokens)),
		zap.Int("affected_chunks", capInfo.affectedChunks),
		zap.Int("skipped_similar", capInfo.skipped),
		zap.Bool("shadow_similar", shadowSimilar))

	// Baseline: the configuration as it is live right now.
	baselineReq := req.RetrievalTestRequest
	baselineReq.Datasets = common.StringSlice{datasetID}
	baselineReq.SynonymOverride = nil
	baselineReq.ExtraChunkTokens = nil

	baselineStart := time.Now()
	baselineResp, err := s.RetrievalTest(ctx, &baselineReq, userID)
	baselineTook := time.Since(baselineStart).Milliseconds()
	if err != nil {
		// Deliberately no fallback: showing "baseline only" would look like a
		// comparison while hiding the fact that the candidate side never ran.
		return nil, fmt.Errorf("baseline retrieval failed: %w", err)
	}

	// Candidate: live configuration plus the pending change set.
	candidateReq := req.RetrievalTestRequest
	candidateReq.Datasets = common.StringSlice{datasetID}
	candidateReq.SynonymOverride = override
	candidateReq.ExtraChunkTokens = extraTokens

	candidateStart := time.Now()
	candidateResp, err := s.RetrievalTest(ctx, &candidateReq, userID)
	candidateTook := time.Since(candidateStart).Milliseconds()
	if err != nil {
		return nil, fmt.Errorf("candidate retrieval failed: %w", err)
	}

	baselineHits := toCompareHits(baselineResp.Chunks)
	candidateHits := toCompareHits(candidateResp.Chunks)

	capability := service.CompareCapability{
		SynonymSimulated:    true,
		SimilarQSimulated:   baselineResp.UsedRerank,
		AffectedChunkCount:  capInfo.affectedChunks,
		SkippedSimilarCount: capInfo.skipped,
		UnsolvedReasons:     []string{},
	}
	if !capability.SimilarQSimulated {
		capability.UnsolvedReasons = append(capability.UnsolvedReasons, "no_rerank_model")
	}
	if !shadowSimilar && capInfo.affectedChunks > 0 {
		capability.UnsolvedReasons = append(capability.UnsolvedReasons, "similar_questions_not_requested")
	}

	return &service.RetrievalCompareResponse{
		Baseline: service.CompareSide{
			Hits:   baselineHits,
			TookMs: baselineTook,
			Total:  baselineResp.Total,
		},
		Candidate: service.CompareSide{
			Hits:   candidateHits,
			TookMs: candidateTook,
			Total:  candidateResp.Total,
		},
		Diff:       computeCompareDiff(baselineHits, candidateHits, baselineResp.Total, candidateResp.Total),
		Capability: capability,
	}, nil
}

// datasetLanguage resolves the dataset language, which drives tokenisation.
func (s *ChunkService) datasetLanguage(ctx context.Context, datasetID string) (string, error) {
	kb, err := s.getKnowledgebaseByID(ctx, datasetID)
	if err != nil {
		return "", fmt.Errorf("failed to load dataset %s: %w", datasetID, err)
	}
	if kb == nil {
		return "", fmt.Errorf("dataset %s not found", datasetID)
	}
	// Reuse the same helper the retrieval path uses, so tokenisation here and
	// there can never disagree.
	return entity.KnowledgebasesLanguage([]*entity.Knowledgebase{kb}), nil
}

type capabilityInfo struct {
	affectedChunks int
	skipped        int
}

// buildInjections turns the change-set diff into the two injection maps.
//
// Synonym handling: a diff group's After list is the word set the group will
// have once published. For every query token that belongs to such a group, the
// override is "the group's words, minus the token itself" — i.e. exactly the
// synonym list the live lookup would return after publishing. Groups that do
// not touch any query token produce no override, keeping the map sparse.
//
// Similar-question handling: only added questions are considered (the change
// set model cannot express deletions). A question that shares no term with the
// test query cannot move any score — TokenSimilarity only sees the
// intersection — so it is skipped and counted, which is itself useful feedback.
func buildInjections(
	diff *service.ChangeSetDiff,
	question, language string,
	shadowSimilar bool,
) (map[string][]string, map[string][]string, capabilityInfo) {
	info := capabilityInfo{}
	qb := nlp.GetQueryBuilder()

	_, qTokens := qb.Question(question, "qa", wordSepThreshold, language)

	override := map[string][]string{}
	for _, group := range diff.Synonyms {
		if len(group.After) == 0 {
			continue
		}
		for _, tk := range qTokens {
			if !groupMatchesToken(group.After, tk, qb, language) {
				continue
			}
			words := make([]string, 0, len(group.After))
			for _, w := range group.After {
				if w != tk {
					words = append(words, w)
				}
			}
			if len(words) > 0 {
				override[tk] = words
			}
		}
	}

	extra := map[string][]string{}
	if !shadowSimilar {
		// Still report how many chunks the change set touches, so the UI can
		// explain that similar questions exist but were not simulated.
		for _, sq := range diff.SimilarQuestions {
			if len(sq.After) > len(sq.Before) {
				info.affectedChunks++
			}
		}
		return override, extra, info
	}

	for _, sq := range diff.SimilarQuestions {
		added := difference(sq.After, sq.Before)
		if len(added) == 0 {
			continue
		}
		info.affectedChunks++

		var tokens []string
		for _, q := range added {
			_, qPrimeTokens := qb.Question(q, "qa", wordSepThreshold, language)
			if !overlapsQuestion(question, q, qTokens, qPrimeTokens) {
				info.skipped++
				continue
			}
			tokens = append(tokens, qPrimeTokens...)
		}
		if len(tokens) > 0 {
			extra[sq.ChunkID] = append(extra[sq.ChunkID], tokens...)
		}
	}

	return override, extra, info
}

// groupMatchesToken reports whether tk is one of the group's words, either
// verbatim or as a term produced by tokenising a multi-word entry.
func groupMatchesToken(words []string, tk string, qb *nlp.QueryBuilder, language string) bool {
	for _, w := range words {
		if w == tk {
			return true
		}
		_, wt := qb.Question(w, "qa", wordSepThreshold, language)
		for _, x := range wt {
			if x == tk {
				return true
			}
		}
	}
	return false
}

// overlapsQuestion decides whether an added similar question shares enough
// with the test question to be worth injecting.
//
// Token intersection alone is too strict: tokenisers segment inconsistently, so
// "华夏的申购费率说明" and "华夏基金 申购费率是多少" can end up with disjoint
// term lists even though a human sees the overlap immediately. Skipping such a
// question would silently hide a real effect, which is far worse than injecting
// a token that changes nothing — so we fall back to a character-bigram check.
func overlapsQuestion(question, similar string, qTokens, sTokens []string) bool {
	if hasTokenOverlap(qTokens, sTokens) {
		return true
	}
	return shareBigram(question, similar)
}

// shareBigram reports whether two strings share a two-rune substring. For CJK
// text this is a reliable "these talk about the same thing" signal; for Latin
// text the token path above normally answers first.
func shareBigram(a, b string) bool {
	ra, rb := []rune(a), []rune(b)
	if len(ra) < 2 || len(rb) < 2 {
		return false
	}
	grams := make(map[string]struct{}, len(ra))
	for i := 0; i+1 < len(ra); i++ {
		grams[string(ra[i:i+2])] = struct{}{}
	}
	for i := 0; i+1 < len(rb); i++ {
		if _, ok := grams[string(rb[i:i+2])]; ok {
			return true
		}
	}
	return false
}

// hasTokenOverlap reports whether the two token sets share at least one term.
func hasTokenOverlap(a, b []string) bool {
	if len(a) == 0 || len(b) == 0 {
		return false
	}
	set := make(map[string]struct{}, len(a))
	for _, t := range a {
		set[t] = struct{}{}
	}
	for _, t := range b {
		if _, ok := set[t]; ok {
			return true
		}
	}
	return false
}

// difference returns the elements of after that are not in before.
func difference(after, before []string) []string {
	set := make(map[string]struct{}, len(before))
	for _, b := range before {
		set[b] = struct{}{}
	}
	out := make([]string, 0, len(after))
	for _, a := range after {
		if _, ok := set[a]; !ok {
			out = append(out, a)
		}
	}
	return out
}

// toCompareHits converts the retrieval payload into comparison hits.
func toCompareHits(chunks []map[string]interface{}) []service.CompareHit {
	hits := make([]service.CompareHit, 0, len(chunks))
	for i, c := range chunks {
		chunkID := stringField(c, "id")
		if chunkID == "" {
			chunkID = stringField(c, "chunk_id")
		}
		hits = append(hits, service.CompareHit{
			ChunkID:    chunkID,
			DocKeyword: stringField(c, "docnm_kwd"),
			Content:    stringField(c, "content_with_weight"),
			Similarity: floatField(c, "similarity"),
			Rank:       i + 1,
		})
	}
	return hits
}

func stringField(m map[string]interface{}, key string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func floatField(m map[string]interface{}, key string) float64 {
	switch v := m[key].(type) {
	case float64:
		return v
	case float32:
		return float64(v)
	case int:
		return float64(v)
	case int64:
		return float64(v)
	case nil:
		return 0
	default:
		return 0
	}
}

// computeCompareDiff diffs the two sides by chunk id.
//
// The intersection is what makes the numbers comparable: averaging scores over
// different-sized result sets (5 vs 6 hits) would compare two different
// populations, so AvgDeltaOnCommon is intersection-only.
//
// A rank change is classified by whether the chunk's own score moved:
//   - score unchanged, rank changed → structural displacement (something else
//     entered or left above it), counted in DisplacedCount;
//   - score changed, rank changed → a genuine reorder, counted in
//     ReorderedCount.
//
// This keeps "one insertion pushed five rows down" from being reported as five
// real regressions.
func computeCompareDiff(baseline, candidate []service.CompareHit, baselineTotal, candidateTotal int64) service.CompareDiff {
	b := make(map[string]service.CompareHit, len(baseline))
	for _, h := range baseline {
		b[h.ChunkID] = h
	}
	c := make(map[string]service.CompareHit, len(candidate))
	for _, h := range candidate {
		c[h.ChunkID] = h
	}

	diff := service.CompareDiff{
		Added:           []service.CompareDiffItem{},
		Removed:         []service.CompareDiffItem{},
		ReorderedCommon: []service.CompareDiffItem{},
		ScoreChanged:    []service.CompareDiffItem{},
	}

	// Added: present in candidate, absent from baseline — ordered by new rank.
	for _, h := range candidate {
		if _, ok := b[h.ChunkID]; ok {
			continue
		}
		diff.Added = append(diff.Added, service.CompareDiffItem{
			ChunkID:    h.ChunkID,
			DocKeyword: h.DocKeyword,
			Content:    h.Content,
			Similarity: h.Similarity,
			Rank:       h.Rank,
			AfterRank:  h.Rank,
			AfterScore: h.Similarity,
		})
	}

	// Removed: present in baseline, absent from candidate — ordered by old rank.
	//
	// The reason is inferred from whether the candidate had to truncate: if it
	// still holds more results than it returned, the chunk most likely lost a
	// ranking contest rather than vanishing from the index. This is the honest
	// limit of what a TopK comparison can tell us — we never see the score of
	// a chunk outside the returned window.
	for _, h := range baseline {
		if _, ok := c[h.ChunkID]; ok {
			continue
		}
		reason := "not_recalled"
		if candidateTotal > int64(len(candidate)) {
			reason = "pushed_out_of_topk"
		}
		diff.Removed = append(diff.Removed, service.CompareDiffItem{
			ChunkID:     h.ChunkID,
			DocKeyword:  h.DocKeyword,
			Content:     h.Content,
			Similarity:  h.Similarity,
			Rank:        h.Rank,
			BeforeRank:  h.Rank,
			BeforeScore: h.Similarity,
			Reason:      reason,
		})
	}

	// Intersection: reorders, score changes, and the comparable average delta.
	var deltaSum float64
	common := 0
	displaced := 0
	for _, before := range baseline {
		after, ok := c[before.ChunkID]
		if !ok {
			continue
		}
		common++
		delta := after.Similarity - before.Similarity
		deltaSum += delta

		scoreMoved := math.Abs(delta) > scoreEpsilon
		rankMoved := before.Rank != after.Rank

		if scoreMoved {
			diff.ScoreChanged = append(diff.ScoreChanged, service.CompareDiffItem{
				ChunkID:     before.ChunkID,
				DocKeyword:  after.DocKeyword,
				Content:     after.Content,
				Similarity:  after.Similarity,
				BeforeRank:  before.Rank,
				AfterRank:   after.Rank,
				BeforeScore: before.Similarity,
				AfterScore:  after.Similarity,
				Delta:       delta,
			})
		}

		switch {
		case rankMoved && scoreMoved:
			diff.ReorderedCommon = append(diff.ReorderedCommon, service.CompareDiffItem{
				ChunkID:     before.ChunkID,
				DocKeyword:  after.DocKeyword,
				Content:     after.Content,
				Similarity:  after.Similarity,
				BeforeRank:  before.Rank,
				AfterRank:   after.Rank,
				BeforeScore: before.Similarity,
				AfterScore:  after.Similarity,
				Delta:       delta,
			})
		case rankMoved && !scoreMoved:
			displaced++
		}
	}

	var avgDelta float64
	if common > 0 {
		avgDelta = deltaSum / float64(common)
	}

	diff.Summary = service.CompareDiffSummary{
		BaselineCount:     len(baseline),
		CandidateCount:    len(candidate),
		AddedCount:        len(diff.Added),
		RemovedCount:      len(diff.Removed),
		ReorderedCount:    len(diff.ReorderedCommon),
		DisplacedCount:    displaced,
		ScoreChangedCount: len(diff.ScoreChanged),
		AvgDeltaOnCommon:  avgDelta,
		CommonCount:       common,
	}

	// Stable output order: by rank so the UI can render straight through.
	sort.SliceStable(diff.Added, func(i, j int) bool { return diff.Added[i].Rank < diff.Added[j].Rank })
	sort.SliceStable(diff.Removed, func(i, j int) bool { return diff.Removed[i].Rank < diff.Removed[j].Rank })
	sort.SliceStable(diff.ReorderedCommon, func(i, j int) bool {
		return diff.ReorderedCommon[i].AfterRank < diff.ReorderedCommon[j].AfterRank
	})
	sort.SliceStable(diff.ScoreChanged, func(i, j int) bool {
		return diff.ScoreChanged[i].AfterRank < diff.ScoreChanged[j].AfterRank
	})

	return diff
}
