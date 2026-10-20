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
)

// Sensitive-data masking patterns. Order matters: id cards are masked before
// bank cards so an 18-digit id number is not swallowed by the bank-card
// pattern first.
var (
	idCardPattern   = regexp.MustCompile(`\d{17}[\dXx]|\d{15}`)
	phonePattern    = regexp.MustCompile(`1[3-9]\d{9}`)
	bankCardPattern = regexp.MustCompile(`\d{13,19}`)
)

// SanitizeSensitive masks phone numbers, id card numbers and bank card numbers
// in text. It is idempotent: already-masked `*` runs are left untouched because
// they are no longer digit runs.
func SanitizeSensitive(text string) string {
	if text == "" {
		return text
	}
	text = idCardPattern.ReplaceAllStringFunc(text, func(s string) string {
		return maskMiddle(s, 4, 4)
	})
	text = phonePattern.ReplaceAllStringFunc(text, func(s string) string {
		return maskMiddle(s, 3, 4)
	})
	text = bankCardPattern.ReplaceAllStringFunc(text, func(s string) string {
		return maskMiddle(s, 4, 4)
	})
	return text
}

// maskMiddle keeps keepHead leading runes and keepTail trailing runes, masking
// everything in between with '*'. Values shorter than the kept window are fully
// masked.
func maskMiddle(s string, keepHead, keepTail int) string {
	r := []rune(s)
	if len(r) <= keepHead+keepTail {
		return strings.Repeat("*", len(r))
	}
	return string(r[:keepHead]) + strings.Repeat("*", len(r)-keepHead-keepTail) + string(r[len(r)-keepTail:])
}

// TruncateRunes cuts s to at most maxRunes runes, appending "…" when truncated.
func TruncateRunes(s string, maxRunes int) string {
	if maxRunes <= 0 {
		return ""
	}
	r := []rune(s)
	if len(r) <= maxRunes {
		return s
	}
	return string(r[:maxRunes]) + "…"
}
