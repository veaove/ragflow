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
	"sort"
	"strings"

	"ragflow/internal/entity"
)

// QcTestHit is one matched keyword with its rune offsets in the test text.
type QcTestHit struct {
	Keyword string `json:"keyword"`
	Start   int    `json:"start"` // rune offset
	End     int    `json:"end"`   // rune offset (exclusive)
}

// QcTestRange is one highlighted region as rune offsets. Unlike QcTestHit it is
// per OCCURRENCE, so the drawer can highlight every repetition of a keyword
// instead of only the first one.
type QcTestRange struct {
	Start int `json:"start"`
	End   int `json:"end"`
}

// QcTestResult is the rule-test preview returned by /qc/rules/test.
type QcTestResult struct {
	// HitCount counts matched OCCURRENCES (「命中 N 处」), not distinct keywords.
	HitCount    int           `json:"hit_count"`
	Hits        []QcTestHit   `json:"hits"`
	Ranges      []QcTestRange `json:"ranges"`
	Highlighted string        `json:"highlighted"`
}

type qcSpan struct {
	start int // rune offset
	end   int
}

// QcTestMatch tests keywords against text without persisting anything. It is
// the server twin of the front-end drawer preview, sharing the same semantics.
func QcTestMatch(keywords []string, matchMode, text string) (*QcTestResult, error) {
	// One synthetic rule per keyword. CompiledRules.Match reports at most one
	// match per rule, so packing every keyword into a single rule made the
	// preview report at most one hit no matter how many keywords matched —
	// 「保本」「稳赚」both present still returned hit_count=1.
	rules := make([]entity.QcRule, 0, len(keywords))
	seenKw := make(map[string]bool, len(keywords))
	for _, kw := range keywords {
		kw = strings.TrimSpace(kw)
		if kw == "" || seenKw[kw] {
			continue
		}
		seenKw[kw] = true
		rules = append(rules, entity.QcRule{
			ID:        "test-" + kw,
			Keywords:  []string{kw},
			MatchMode: matchMode,
			Scope:     entity.QcScopeBoth,
		})
	}
	if len(rules) == 0 {
		return &QcTestResult{Hits: []QcTestHit{}, Ranges: []QcTestRange{}, Highlighted: text}, nil
	}

	compiled, err := CompileRules(rules)
	if err != nil {
		return nil, err
	}

	matches := compiled.Match(text, entity.QcScopeBoth)
	spans := make([]qcSpan, 0, len(matches))
	hits := make([]QcTestHit, 0, len(matches))
	for _, m := range matches {
		if m.MatchedText == "" {
			continue
		}
		found := findRuneSpans(text, m.MatchedText)
		if len(found) == 0 {
			continue
		}
		spans = append(spans, found...)
		// Best effort: report the first occurrence as the keyword's offsets.
		hits = append(hits, QcTestHit{
			Keyword: m.MatchedText,
			Start:   found[0].start,
			End:     found[0].end,
		})
	}

	merged := mergeSpans(spans)
	ranges := make([]QcTestRange, 0, len(merged))
	for _, s := range merged {
		ranges = append(ranges, QcTestRange{Start: s.start, End: s.end})
	}

	return &QcTestResult{
		HitCount:    len(merged),
		Hits:        hits,
		Ranges:      ranges,
		Highlighted: buildHighlight(text, merged),
	}, nil
}

// findRuneSpans returns all non-overlapping occurrences of needle in haystack
// as rune offsets.
func findRuneSpans(haystack, needle string) []qcSpan {
	if needle == "" {
		return nil
	}
	var spans []qcSpan
	offset := 0
	for {
		idx := strings.Index(haystack[offset:], needle)
		if idx < 0 {
			break
		}
		abs := offset + idx
		startRune := runeCount(haystack[:abs])
		endRune := startRune + runeCount(needle)
		spans = append(spans, qcSpan{start: startRune, end: endRune})
		offset = abs + len(needle)
	}
	return spans
}

func runeCount(s string) int {
	return len([]rune(s))
}

func mergeSpans(spans []qcSpan) []qcSpan {
	if len(spans) == 0 {
		return nil
	}
	sort.Slice(spans, func(i, j int) bool {
		if spans[i].start != spans[j].start {
			return spans[i].start < spans[j].start
		}
		return spans[i].end < spans[j].end
	})
	merged := []qcSpan{spans[0]}
	for _, s := range spans[1:] {
		last := &merged[len(merged)-1]
		// Strict overlap only: back-to-back occurrences of the same keyword
		// ("保本保本") are two hits, and merging them would undercount.
		if s.start < last.end {
			if s.end > last.end {
				last.end = s.end
			}
		} else {
			merged = append(merged, s)
		}
	}
	return merged
}

func buildHighlight(text string, spans []qcSpan) string {
	if len(spans) == 0 {
		return text
	}
	runes := []rune(text)
	var b strings.Builder
	prev := 0
	for _, s := range spans {
		if s.start > len(runes) {
			s.start = len(runes)
		}
		if s.end > len(runes) {
			s.end = len(runes)
		}
		if s.start < prev {
			s.start = prev
		}
		if s.start > s.end {
			s.end = s.start
		}
		b.WriteString(string(runes[prev:s.start]))
		b.WriteString("<mark>")
		b.WriteString(string(runes[s.start:s.end]))
		b.WriteString("</mark>")
		prev = s.end
	}
	b.WriteString(string(runes[prev:]))
	return b.String()
}
