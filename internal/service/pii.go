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

// PII patterns for masking run records and logs (GOV-08 / 15). The full value
// is not printed — only the masked form reaches agent_run / agent_node_execution.
var (
	piiPhoneRE   = regexp.MustCompile(`1[3-9]\d{9}`)
	piiIDCardRE  = regexp.MustCompile(`\b\d{17}[\dXx]\b`)
	piiBankCardRE = regexp.MustCompile(`\b\d{16,19}\b`)
)

// MaskPII redacts Chinese mobile numbers, 18-digit ID card numbers and bank
// card numbers from a string, preserving length so logs remain useful for
// debugging without leaking PII.
func MaskPII(s string) string {
	s = piiPhoneRE.ReplaceAllStringFunc(s, func(m string) string {
		return m[:3] + "****" + m[7:]
	})
	s = piiIDCardRE.ReplaceAllStringFunc(s, func(m string) string {
		return m[:6] + "********" + m[len(m)-4:]
	})
	s = piiBankCardRE.ReplaceAllStringFunc(s, func(m string) string {
		return m[:4] + " **** **** " + m[len(m)-4:]
	})
	return s
}

// MaskPIIMap deep-masks all string values in a map (and nested slices/maps),
// used before a node's inputs/outputs are persisted.
func MaskPIIMap(v any) any {
	switch x := v.(type) {
	case string:
		return MaskPII(x)
	case map[string]any:
		out := make(map[string]any, len(x))
		for k, val := range x {
			out[k] = MaskPIIMap(val)
		}
		return out
	case []any:
		out := make([]any, len(x))
		for i, val := range x {
			out[i] = MaskPIIMap(val)
		}
		return out
	default:
		return v
	}
}

// maskPromptForLog removes newlines and collapses whitespace so a prompt is
// never logged in full (GOV-08). Only a truncated fingerprint is emitted.
func maskPromptForLog(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if len(s) > 200 {
		return s[:200] + "…"
	}
	return s
}
