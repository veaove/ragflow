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
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"ragflow/internal/entity"
)

// QcMatch is a single matched fragment produced by CompiledRules.Match.
type QcMatch struct {
	Rule        *entity.QcRule
	MatchedText string
}

// QcHitResult is a newly produced hit from a StreamMatcher inspection.
type QcHitResult struct {
	Rule        *entity.QcRule
	MatchedText string
	Scope       string
	// Blocked is true when the hit triggered a block-level action.
	Blocked bool
	// Replacement is the block-level replacement message (prompt_message).
	Replacement string
}

// compiledRule is one compiled QC rule. matchMode determines how keywords are
// evaluated; regex rules compile every keyword into one alternation.
type compiledRule struct {
	rule      *entity.QcRule
	matchMode string
	keywords  []string
	re        *regexp.Regexp
}

// CompiledRules is a precompiled rule set for one app. It is built once at the
// start of a session and reused for every delta.
type CompiledRules struct {
	rules           []compiledRule
	firstRunes      map[rune]bool
	maxKeywordRunes int
}

// regexOverlapRunes is the assumed maximum rune length of a regex match. It
// only sizes the cross-delta overlap window; contains / whole-word modes use
// their actual keyword lengths.
const regexOverlapRunes = 64

// CompileRules compiles a list of QC rules into a reusable CompiledRules.
// A rule with an invalid regex is rejected (the caller should have validated
// on save, but this guards against stale/invalid rows).
func CompileRules(rules []entity.QcRule) (*CompiledRules, error) {
	c := &CompiledRules{
		rules:           make([]compiledRule, 0, len(rules)),
		firstRunes:      make(map[rune]bool),
		maxKeywordRunes: 1,
	}
	for _, r := range rules {
		cr := compiledRule{rule: &r, matchMode: r.MatchMode}
		switch r.MatchMode {
		case entity.QcMatchRegex:
			patterns := make([]string, 0, len(r.Keywords))
			for _, kw := range r.Keywords {
				if kw == "" {
					continue
				}
				patterns = append(patterns, "(?:"+kw+")")
			}
			if len(patterns) == 0 {
				continue
			}
			re, err := regexp.Compile(strings.Join(patterns, "|"))
			if err != nil {
				return nil, err
			}
			cr.re = re
			if regexOverlapRunes > c.maxKeywordRunes {
				c.maxKeywordRunes = regexOverlapRunes
			}
		case entity.QcMatchWholeWord:
			cr.keywords = r.Keywords
			for _, kw := range r.Keywords {
				c.collectFirstRune(kw)
				if n := utf8.RuneCountInString(kw); n > c.maxKeywordRunes {
					c.maxKeywordRunes = n
				}
			}
		default: // contains
			cr.keywords = r.Keywords
			for _, kw := range r.Keywords {
				c.collectFirstRune(kw)
				if n := utf8.RuneCountInString(kw); n > c.maxKeywordRunes {
					c.maxKeywordRunes = n
				}
			}
		}
		c.rules = append(c.rules, cr)
	}
	return c, nil
}

func (c *CompiledRules) collectFirstRune(kw string) {
	if kw == "" {
		return
	}
	r, _ := utf8.DecodeRuneInString(kw)
	c.firstRunes[r] = true
}

// maybeHit is the cheap pre-check: false means no keyword can possibly start
// anywhere in text, so the full matcher can be skipped.
func (c *CompiledRules) maybeHit(text string) bool {
	for _, r := range text {
		if c.firstRunes[r] {
			return true
		}
	}
	return false
}

// ruleApplies reports whether a rule matches the given inspection scope.
func ruleApplies(rule *entity.QcRule, scope string) bool {
	if rule.Scope == entity.QcScopeBoth {
		return true
	}
	return rule.Scope == scope
}

// Match runs the compiled rules against text and returns every rule that
// matches (deduplicated at the rule level by the caller).
func (c *CompiledRules) Match(text string, scope string) []QcMatch {
	if text == "" || !c.maybeHit(text) {
		return nil
	}
	var out []QcMatch
	for _, cr := range c.rules {
		if !ruleApplies(cr.rule, scope) {
			continue
		}
		switch cr.matchMode {
		case entity.QcMatchRegex:
			if cr.re == nil {
				continue
			}
			if m := cr.re.FindString(text); m != "" {
				out = append(out, QcMatch{Rule: cr.rule, MatchedText: m})
			}
		case entity.QcMatchWholeWord:
			for _, kw := range cr.keywords {
				if m, ok := wholeWordMatch(text, kw); ok {
					out = append(out, QcMatch{Rule: cr.rule, MatchedText: m})
					break
				}
			}
		default: // contains
			for _, kw := range cr.keywords {
				if strings.Contains(text, kw) {
					out = append(out, QcMatch{Rule: cr.rule, MatchedText: kw})
					break
				}
			}
		}
	}
	return out
}

// wholeWordMatch reports whether kw appears in text surrounded by non-word
// boundaries. Unlike regexp's ASCII-only \b, this treats CJK letters as word
// characters via unicode.IsLetter, so 「保本息」 does not match 「保本」 while
// 「保本。」 does.
func wholeWordMatch(text, kw string) (string, bool) {
	if kw == "" {
		return "", false
	}
	idx := strings.Index(text, kw)
	for idx >= 0 {
		beforeOK := idx == 0 || !isWordRuneAt(text, idx, true)
		afterOK := idx+len(kw) >= len(text) || !isWordRuneAt(text, idx+len(kw), false)
		if beforeOK && afterOK {
			return kw, true
		}
		next := strings.Index(text[idx+len(kw):], kw)
		if next < 0 {
			break
		}
		idx = idx + len(kw) + next
	}
	return "", false
}

// isWordRuneAt reports whether the rune immediately before (before=true) or at
// (before=false) byteIdx is a word character (letter / digit / underscore).
// byteIdx must lie on a rune boundary when before=false; the before=true case
// decodes backwards so it stays correct even when the preceding rune is a
// multi-byte CJK character.
func isWordRuneAt(s string, byteIdx int, before bool) bool {
	if before {
		if byteIdx <= 0 || byteIdx > len(s) {
			return false
		}
		r, _ := utf8.DecodeLastRuneInString(s[:byteIdx])
		return isWordRune(r)
	}
	if byteIdx < 0 || byteIdx >= len(s) {
		return false
	}
	r, _ := utf8.DecodeRuneInString(s[byteIdx:])
	return isWordRune(r)
}

// isWordRune reports whether r is a word character.
func isWordRune(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_'
}

// StreamMatcher accumulates a stream of deltas and reports newly matched hits
// once per rule per session. It is single-goroutine (one per session) and not
// safe for concurrent use.
type StreamMatcher struct {
	compiled *CompiledRules
	runes    []rune
	scanned  int
	fired    map[string]bool

	// Block state: once a block rule fires, the session switches to the
	// replacement message and stops producing new hits.
	Blocked     bool
	BlockedRule *entity.QcRule
	Replacement string

	// NoBlock disables the block state transition (used for debug runs, which
	// only record, never intercept). Hits still report Blocked=true so the
	// caller can record the would-be action without altering the stream.
	NoBlock bool
}

// NewStreamMatcher builds a session matcher from a compiled rule set.
func NewStreamMatcher(compiled *CompiledRules) *StreamMatcher {
	return &StreamMatcher{
		compiled: compiled,
		fired:    make(map[string]bool),
	}
}

// Inspect appends delta to the accumulated text and returns the newly produced
// hits for the given scope. Once blocked, it returns nil forever.
func (m *StreamMatcher) Inspect(delta, scope string) []QcHitResult {
	if m.compiled == nil {
		return nil
	}
	if delta != "" {
		m.runes = append(m.runes, []rune(delta)...)
	}
	if m.Blocked {
		return nil
	}

	// Scan the un-scanned tail, minus a cross-delta overlap window so a keyword
	// split across two deltas is still matched whole.
	start := m.scanned - (m.compiled.maxKeywordRunes - 1)
	if start < 0 {
		start = 0
	}
	seg := string(m.runes[start:])
	m.scanned = len(m.runes)

	matches := m.compiled.Match(seg, scope)
	if len(matches) == 0 {
		return nil
	}

	hits := make([]QcHitResult, 0, len(matches))
	for _, match := range matches {
		if m.fired[match.Rule.ID] {
			continue
		}
		m.fired[match.Rule.ID] = true
		h := QcHitResult{
			Rule:        match.Rule,
			MatchedText: match.MatchedText,
			Scope:       scope,
		}
		if match.Rule.Action == entity.QcActionBlockAndAlert ||
			match.Rule.Severity == entity.QcSeverityBlock {
			h.Blocked = true
			h.Replacement = match.Rule.PromptMessage
			if !m.NoBlock {
				m.Blocked = true
				m.BlockedRule = match.Rule
				m.Replacement = match.Rule.PromptMessage
			}
		}
		hits = append(hits, h)
	}
	return hits
}

// FullText returns the accumulated answer text, used to extract context.
func (m *StreamMatcher) FullText() string {
	return string(m.runes)
}
