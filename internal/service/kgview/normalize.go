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

import (
	"crypto/sha1"
	"encoding/hex"
	"math"
	"strings"

	"golang.org/x/text/unicode/norm"
)

// legalFormSuffixes are stripped from the entity key only (never from the
// displayed name) so 「华夏基金」/「华夏基金管理有限公司」 count as one node
// instead of two half-connected islands. Longest first: "管理有限公司" must be
// tried before "有限公司".
var legalFormSuffixes = []string{
	"股份有限责任公司",
	"股份有限公司",
	"有限责任公司",
	"集团有限公司",
	"管理有限公司",
	"有限公司",
	"集团",
	"公司",
}

// NormalizeName folds the surface forms a name can take: full-width → half-width
// (NFKC), case, whitespace and punctuation. Used for alias lookup and matching,
// never for display.
func NormalizeName(raw string) string {
	key := strings.ToLower(norm.NFKC.String(raw))
	var b strings.Builder
	b.Grow(len(key))
	for _, r := range key {
		switch r {
		case ' ', '\t', '\n', '\r', '\u3000', '_', '-', '—', '/', '\\',
			'(', ')', '（', '）', '[', ']', '【', '】', '《', '》', '〈', '〉',
			'、', '，', ',', '。', '.', ':', '：', ';', '；', '"', '\'', '“', '”', '‘', '’',
			'·', '•', '!', '！', '?', '？':
			continue
		}
		b.WriteRune(r)
	}
	return strings.TrimSpace(b.String())
}

// EntityKey returns the merge key for an entity name. Two names that differ
// only by a corporate suffix collapse into one key.
func EntityKey(raw string) string {
	key := NormalizeName(raw)
	changed := true
	for changed && key != "" {
		changed = false
		for _, suffix := range legalFormSuffixes {
			suffixKey := NormalizeName(suffix)
			if suffixKey == "" || !strings.HasSuffix(key, suffixKey) {
				continue
			}
			trimmed := strings.TrimSuffix(key, suffixKey)
			// Never reduce a name to nothing: "公司" alone is a real (if vague)
			// entity and stripping it would merge it with every empty name.
			if trimmed == "" {
				continue
			}
			key = trimmed
			changed = true
			break
		}
	}
	if key == "" {
		return NormalizeName(raw)
	}
	return key
}

// StableID derives the API id for a node/edge from its identity so the same
// entity keeps the same id across reloads (selection, filters and deep links
// then survive a refetch). Collisions are bounded by the 12-hex prefix.
func StableID(prefix string, parts ...string) string {
	hash := sha1.New()
	for _, part := range parts {
		hash.Write([]byte(part))
		hash.Write([]byte{0})
	}
	return prefix + ":" + hex.EncodeToString(hash.Sum(nil))[:12]
}

// Confidence turns corroboration into the 0..1 score the UI shows next to a
// triple. Extraction stores no confidence, so it is derived from how many
// distinct source chunks back the relation: one snippet is the weakest case
// (0.70), five independent segments land near 0.94. The number is monotone and
// bounded, which is what matters — users must be able to tell a guess from a
// well-corroborated edge, and the support counts are returned alongside it.
func Confidence(support int) float64 {
	if support <= 0 {
		return 0.5
	}
	score := 0.5 + 0.5*(1-math.Exp(-float64(support)/2))
	if score > 0.99 {
		score = 0.99
	}
	return math.Round(score*1000) / 1000
}

// ClampConfidence keeps an explicitly extracted confidence usable.
func ClampConfidence(value float64) (float64, bool) {
	if value <= 0 || value > 1 || math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, false
	}
	return math.Round(value*1000) / 1000, true
}

// Snippet trims evidence text to the length the detail panel can render.
func Snippet(raw string, limit int) string {
	text := strings.Join(strings.Fields(raw), " ")
	if limit <= 0 || len([]rune(text)) <= limit {
		return text
	}
	runes := []rune(text)
	return strings.TrimSpace(string(runes[:limit])) + "…"
}
