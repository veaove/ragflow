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

// QcTestResult is the rule-test preview returned by /qc/rules/test.
type QcTestResult struct {
	HitCount    int         `json:"hit_count"`
	Hits        []QcTestHit `json:"hits"`
	Highlighted string      `json:"highlighted"`
}

type qcSpan struct {
	start int // rune offset
	end   int
}

// QcTestMatch tests keywords against text without persisting anything. It is
// the server twin of the front-end drawer preview, sharing the same semantics.
func QcTestMatch(keywords []string, matchMode, text string) (*QcTestResult, error) {
	rule := entity.QcRule{
		ID:        "test",
		Keywords:  keywords,
		MatchMode: matchMode,
		Scope:     entity.QcScopeBoth,
	}
	compiled, err := CompileRules([]entity.QcRule{rule})
	if err != nil {
		return nil, err
	}

	matches := compiled.Match(text, entity.QcScopeBoth)
	// Rebuild spans from the matched fragments so we can highlight precisely.
	spans := make([]qcSpan, 0, len(matches))
	seen := make(map[string]bool)
	hits := make([]QcTestHit, 0, len(matches))
	for _, m := range matches {
		if m.MatchedText == "" || seen[m.MatchedText] {
			continue
		}
		seen[m.MatchedText] = true
		for _, span := range findRuneSpans(text, m.MatchedText) {
			spans = append(spans, span)
		}
		hits = append(hits, QcTestHit{
			Keyword: m.MatchedText,
			Start:   0,
			End:     0,
		})
	}

	// Deduplicate/merge overlapping spans and build the highlight.
	merged := mergeSpans(spans)
	highlighted := buildHighlight(text, merged)

	// Fill real offsets into hits (best effort: first occurrence each).
	runes := []rune(text)
	_ = runes
	for i := range hits {
		if s := findRuneSpans(text, hits[i].Keyword); len(s) > 0 {
			hits[i].Start = s[0].start
			hits[i].End = s[0].end
		}
	}

	return &QcTestResult{
		HitCount:    len(hits),
		Hits:        hits,
		Highlighted: highlighted,
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
		if s.start <= last.end {
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
