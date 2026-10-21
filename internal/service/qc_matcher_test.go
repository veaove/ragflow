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
	"testing"

	"ragflow/internal/entity"
)

func rule(id, mode, scope string, keywords []string) entity.QcRule {
	return entity.QcRule{
		ID:            id,
		Name:          "r-" + id,
		MatchMode:     mode,
		Scope:         scope,
		Severity:      entity.QcSeverityWarn,
		Action:        entity.QcActionLogAndAlert,
		PromptMessage: "replacement",
		Keywords:      entity.QcKeywords(keywords),
	}
}

func TestCompileRulesContainsAndScope(t *testing.T) {
	c, err := CompileRules([]entity.QcRule{
		rule("1", entity.QcMatchContains, entity.QcScopeAIAnswer, []string{"保本", "稳赚"}),
		rule("2", entity.QcMatchContains, entity.QcScopeUserInput, []string{"投诉"}),
	})
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	if got := c.Match("本产品保本保息", entity.QcScopeAIAnswer); len(got) != 1 || got[0].Rule.ID != "1" {
		t.Fatalf("ai_answer contains match: %+v", got)
	}
	// A user-input-scoped keyword must not fire on the AI answer scope.
	if got := c.Match("我想投诉你们", entity.QcScopeAIAnswer); len(got) != 0 {
		t.Fatalf("scope should exclude user-input rule: %+v", got)
	}
	if got := c.Match("我想投诉你们", entity.QcScopeUserInput); len(got) != 1 || got[0].Rule.ID != "2" {
		t.Fatalf("user_input contains match: %+v", got)
	}
}

func TestWholeWordCJKBoundaries(t *testing.T) {
	// 「保本」should match 「保本。」but not 「保本息」.
	if _, ok := wholeWordMatch("保本保息", "保本"); ok {
		t.Fatal("whole word should not match 「保本」 inside 「保本保息」")
	}
	if _, ok := wholeWordMatch("保本。", "保本"); !ok {
		t.Fatal("whole word should match 「保本」 before a non-word rune")
	}
	// The rune immediately before the match is a CJK letter, so it is NOT a
	// whole word.
	if _, ok := wholeWordMatch("这是保本", "保本"); ok {
		t.Fatal("whole word should not match 「保本」 preceded by 「是」")
	}
	// Preceded by punctuation → whole word.
	if _, ok := wholeWordMatch("，保本", "保本"); !ok {
		t.Fatal("whole word should match 「保本」 preceded by punctuation")
	}
	// ASCII word-boundary: "foo" matches "foo bar" but not "foobar".
	if _, ok := wholeWordMatch("foobar", "foo"); ok {
		t.Fatal("whole word should not match foo inside foobar")
	}
	if _, ok := wholeWordMatch("foo bar", "foo"); !ok {
		t.Fatal("whole word should match foo before space")
	}
	if _, ok := wholeWordMatch("bar foo", "foo"); !ok {
		t.Fatal("whole word should match foo after space")
	}
}

func TestRegexMatch(t *testing.T) {
	c, err := CompileRules([]entity.QcRule{
		rule("1", entity.QcMatchRegex, entity.QcScopeBoth, []string{`\b1[3-9]\d{9}\b`}),
	})
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	if got := c.Match("联系电话 13800138000", entity.QcScopeAIAnswer); len(got) != 1 {
		t.Fatalf("regex phone match: %+v", got)
	}
	if got := c.Match("没有号码", entity.QcScopeAIAnswer); len(got) != 0 {
		t.Fatalf("regex should not match: %+v", got)
	}
}

func TestCompileRulesRejectsBadRegex(t *testing.T) {
	if _, err := CompileRules([]entity.QcRule{
		rule("1", entity.QcMatchRegex, entity.QcScopeBoth, []string{`[`}),
	}); err == nil {
		t.Fatal("expected error for invalid regex")
	}
}

func TestStreamMatcherCrossDeltaOverlap(t *testing.T) {
	c, err := CompileRules([]entity.QcRule{
		rule("1", entity.QcMatchContains, entity.QcScopeAIAnswer, []string{"绝对收益"}),
	})
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	m := NewStreamMatcher(c)
	// Split the keyword across two deltas at every position; the overlap window
	// must reassemble it.
	if hits := m.Inspect("我们保证绝对收", entity.QcScopeAIAnswer); len(hits) != 0 {
		t.Fatalf("partial should not hit: %+v", hits)
	}
	if hits := m.Inspect("益稳赚", entity.QcScopeAIAnswer); len(hits) != 1 || hits[0].Rule.ID != "1" {
		t.Fatalf("cross-delta overlap miss: %+v", hits)
	}
	// Second hit is deduplicated (once per rule per session).
	if hits := m.Inspect("绝对收益", entity.QcScopeAIAnswer); len(hits) != 0 {
		t.Fatalf("dedup failed: %+v", hits)
	}
}

func TestStreamMatcherBlockAndNoBlock(t *testing.T) {
	blockRule := rule("b", entity.QcMatchContains, entity.QcScopeAIAnswer, []string{"保本"})
	blockRule.Action = entity.QcActionBlockAndAlert
	blockRule.Severity = entity.QcSeverityBlock
	c, err := CompileRules([]entity.QcRule{blockRule})
	if err != nil {
		t.Fatalf("compile: %v", err)
	}

	// Default: block allowed.
	m := NewStreamMatcher(c)
	hits := m.Inspect("产品保本", entity.QcScopeAIAnswer)
	if len(hits) != 1 || !hits[0].Blocked {
		t.Fatalf("expected block hit: %+v", hits)
	}
	if !m.Blocked || m.Replacement != "replacement" {
		t.Fatalf("expected blocked state with replacement, got blocked=%v repl=%q", m.Blocked, m.Replacement)
	}
	if hits = m.Inspect("继续输出", entity.QcScopeAIAnswer); len(hits) != 0 {
		t.Fatalf("blocked matcher should produce no further hits: %+v", hits)
	}

	// NoBlock (workflow / debug): hit still reports Blocked=true, but the
	// matcher never enters the blocked state.
	m2 := NewStreamMatcher(c)
	m2.NoBlock = true
	hits = m2.Inspect("产品保本", entity.QcScopeAIAnswer)
	if len(hits) != 1 || !hits[0].Blocked {
		t.Fatalf("expected would-be block hit: %+v", hits)
	}
	if m2.Blocked {
		t.Fatal("NoBlock matcher must not enter blocked state")
	}
	if hits = m2.Inspect("继续输出", entity.QcScopeAIAnswer); len(hits) != 0 {
		t.Fatalf("second inspection should dedup: %+v", hits)
	}
}

func TestSanitizeSensitive(t *testing.T) {
	got := SanitizeSensitive("手机13800138000，身份证11010519491231002X，卡号6222021234567890")
	if got == "手机13800138000，身份证11010519491231002X，卡号6222021234567890" {
		t.Fatal("sensitive data not masked")
	}
	// Digits must be masked; already-masked runs are left alone (idempotent).
	if SanitizeSensitive(got) != got {
		t.Fatalf("sanitize should be idempotent: %q -> %q", got, SanitizeSensitive(got))
	}
	for _, digit := range []string{"13800138000", "11010519491231002X", "6222021234567890"} {
		if _, ok := findSubstring(got, digit); ok {
			t.Fatalf("raw sensitive value %q still present in %q", digit, got)
		}
	}
}

func findSubstring(haystack, needle string) (int, bool) {
	idx := -1
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return i, true
		}
	}
	return idx, false
}

func TestTruncateRunes(t *testing.T) {
	if got := TruncateRunes("你好世界", 3); got != "你好世…" {
		t.Fatalf("truncate: %q", got)
	}
	if got := TruncateRunes("短", 5); got != "短" {
		t.Fatalf("no truncation: %q", got)
	}
}

func TestExtractWorkflowAnswerText(t *testing.T) {
	// End node output is inspected.
	if got := extractWorkflowAnswerText(`{"component_name":"End","outputs":{"answer":"保本保息"}}`); got != "保本保息" {
		t.Fatalf("end output: %q", got)
	}
	// A non-End node is ignored.
	if got := extractWorkflowAnswerText(`{"component_name":"LLM","outputs":{"answer":"保本保息"}}`); got != "" {
		t.Fatalf("non-end node should be ignored: %q", got)
	}
	// component_type fallback.
	if got := extractWorkflowAnswerText(`{"component_type":"End","outputs":{"answer":"保本"}}`); got != "保本" {
		t.Fatalf("component_type fallback: %q", got)
	}
	// Nested string outputs are flattened.
	if got := flattenWorkflowOutputs(map[string]any{"a": "甲", "b": []any{"乙", "丙"}, "c": 1}); got != "甲 乙 丙 1" {
		t.Fatalf("flatten: %q", got)
	}
}

// TestQcTestMatchCountsEveryKeyword pins the /qc/rules/test preview: it packs
// every keyword of the drawer into one request, so it must report one hit per
// matching keyword. It used to build a SINGLE synthetic rule, and Match stops
// at the first matching keyword per rule — 「保本」+「稳赚」both present still
// came back as hit_count=1.
func TestQcTestMatchCountsEveryKeyword(t *testing.T) {
	res, err := QcTestMatch([]string{"保本", "稳赚"}, "contains", "这个产品保本高收益，稳赚不赔。")
	if err != nil {
		t.Fatalf("QcTestMatch: %v", err)
	}
	if res.HitCount != 2 {
		t.Fatalf("hit_count = %d, want 2", res.HitCount)
	}
	if len(res.Ranges) != 2 {
		t.Fatalf("ranges = %d, want 2", len(res.Ranges))
	}
	keywords := map[string]bool{}
	for _, h := range res.Hits {
		keywords[h.Keyword] = true
	}
	if !keywords["保本"] || !keywords["稳赚"] {
		t.Fatalf("hits = %+v, want both keywords", res.Hits)
	}
}

// TestQcTestMatchCountsRepeatedOccurrences pins that hit_count counts
// occurrences, so 「保本保本」 is two hits rather than one merged range.
func TestQcTestMatchCountsRepeatedOccurrences(t *testing.T) {
	res, err := QcTestMatch([]string{"保本"}, "contains", "保本保本")
	if err != nil {
		t.Fatalf("QcTestMatch: %v", err)
	}
	if res.HitCount != 2 {
		t.Fatalf("hit_count = %d, want 2", res.HitCount)
	}
	// Both halves must still be highlighted separately.
	if res.Highlighted != "<mark>保本</mark><mark>保本</mark>" {
		t.Fatalf("highlighted = %q", res.Highlighted)
	}
}

// TestQcTestMatchRegex pins the regex preview, which is what exposed the
// first-rune fast-path defect (a regex-only rule set never matched).
func TestQcTestMatchRegex(t *testing.T) {
	res, err := QcTestMatch([]string{"保本.{0,4}收益"}, "regex", "这个产品保本高收益。")
	if err != nil {
		t.Fatalf("QcTestMatch: %v", err)
	}
	if res.HitCount != 1 {
		t.Fatalf("hit_count = %d, want 1 (highlighted=%q)", res.HitCount, res.Highlighted)
	}
}

// TestQuestionKeywordNeedsBothScope pins down the failure where a rule showed
// up as 「生效」 in the app settings yet never fired. The keyword was the
// question a user asks (「基金怎么买」) while the scope sat at its old default
// `ai_answer`, and an AI answer never repeats the question back to itself, so
// the rule was unreachable even though the binding, the enabled flag and the
// session load were all correct. `both` is the scope that matches either side.
func TestQuestionKeywordNeedsBothScope(t *testing.T) {
	const (
		question = "基金怎么买？"
		answer   = "您可通过以下渠道购买华夏基金产品：华夏基金官网、官方APP、银行及证券公司等代销机构。"
		keyword  = "基金怎么买"
	)

	aiOnly, err := CompileRules([]entity.QcRule{
		rule("q", entity.QcMatchContains, entity.QcScopeAIAnswer, []string{keyword}),
	})
	if err != nil {
		t.Fatalf("compile ai_answer: %v", err)
	}
	// The answer does not contain the question, so an ai_answer-only rule finds
	// nothing here — this is the report's symptom, not a matching bug.
	if got := aiOnly.Match(answer, entity.QcScopeAIAnswer); len(got) != 0 {
		t.Fatalf("ai_answer must not match the answer: %+v", got)
	}
	// And an ai_answer rule must never inspect what the user typed.
	if got := aiOnly.Match(question, entity.QcScopeUserInput); len(got) != 0 {
		t.Fatalf("ai_answer rule must not inspect user input: %+v", got)
	}

	both, err := CompileRules([]entity.QcRule{
		rule("q", entity.QcMatchContains, entity.QcScopeBoth, []string{keyword}),
	})
	if err != nil {
		t.Fatalf("compile both: %v", err)
	}
	if got := both.Match(question, entity.QcScopeUserInput); len(got) != 1 {
		t.Fatalf("both scope must match the user's question: %+v", got)
	}
}
