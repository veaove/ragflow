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
	"strings"
	"testing"

	"ragflow/internal/entity"
)

// flattenedDSL mirrors what dsl.NormalizeForCanvas emits: component name and
// params sit at the top level of each component, with no `obj` wrapper.
func flattenedDSL(components map[string]any) map[string]any {
	return map[string]any{
		"schema_version": 1,
		"components":     components,
	}
}

// nestedDSL mirrors a hand-written DSL: name/params live under `obj`.
func nestedDSL(components map[string]any) map[string]any {
	out := make(map[string]any, len(components))
	for id, c := range components {
		cm := c.(map[string]any)
		out[id] = map[string]any{
			"obj": map[string]any{
				"component_name": cm["name"],
				"params":         cm["params"],
			},
		}
	}
	return flattenedDSL(out)
}

func endComponent() map[string]any {
	return map[string]any{
		"name": "End",
		"params": map[string]any{
			"outputs": map[string]any{
				"broadcast_text": map[string]any{"type": "string", "value": "{llm@answer}"},
			},
		},
	}
}

func beginComponent() map[string]any {
	return map[string]any{
		"name":   "Begin",
		"params": map[string]any{"inputs": []any{}},
	}
}

func answerComponent() map[string]any {
	return map[string]any{
		"name":   "Answer",
		"params": map[string]any{"content": "{llm@answer}"},
	}
}

func TestValidatePublish_WorkflowShapes(t *testing.T) {
	workflow := &entity.UserCanvas{CanvasCategory: entity.CanvasCategoryWorkflow}

	cases := []struct {
		name    string
		dsl     map[string]any
		wantErr bool
	}{
		{
			name:    "flattened Begin+End passes",
			dsl:     flattenedDSL(map[string]any{"begin": beginComponent(), "end": endComponent()}),
			wantErr: false,
		},
		{
			name:    "nested Begin+End passes",
			dsl:     nestedDSL(map[string]any{"begin": beginComponent(), "end": endComponent()}),
			wantErr: false,
		},
		{
			name:    "missing End rejected",
			dsl:     flattenedDSL(map[string]any{"begin": beginComponent()}),
			wantErr: true,
		},
		{
			name: "End without outputs rejected",
			dsl: flattenedDSL(map[string]any{"end": map[string]any{
				"name":   "End",
				"params": map[string]any{},
			}}),
			wantErr: true,
		},
		{
			name: "two Ends rejected",
			dsl: flattenedDSL(map[string]any{
				"end1": endComponent(), "end2": endComponent(),
			}),
			wantErr: true,
		},
		{
			name: "Answer in workflow rejected",
			dsl: flattenedDSL(map[string]any{
				"end": endComponent(), "answer": answerComponent(),
			}),
			wantErr: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validatePublish(workflow, tc.dsl)
			if tc.wantErr && err == nil {
				t.Fatalf("expected validation error, got nil")
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("expected pass, got %v", err)
			}
		})
	}
}

func TestValidatePublish_ChatflowShapes(t *testing.T) {
	chatflow := &entity.UserCanvas{CanvasCategory: entity.CanvasCategoryChatflow}

	if err := validatePublish(chatflow, flattenedDSL(map[string]any{
		"begin": beginComponent(), "answer": answerComponent(),
	})); err != nil {
		t.Fatalf("chatflow with Answer should pass: %v", err)
	}

	err := validatePublish(chatflow, flattenedDSL(map[string]any{"begin": beginComponent()}))
	if err == nil {
		t.Fatal("chatflow without Answer should be rejected")
	}
	if !strings.Contains(err.Error(), "Answer") {
		t.Fatalf("error should mention Answer, got %v", err)
	}

	// Chatflow must reject an End node.
	if err := validatePublish(chatflow, flattenedDSL(map[string]any{
		"answer": answerComponent(), "end": endComponent(),
	})); err == nil {
		t.Fatal("chatflow with End should be rejected")
	}
}

// Agent canvases keep legacy semantics: no End/Answer constraint.
func TestValidatePublish_AgentUnconstrained(t *testing.T) {
	agent := &entity.UserCanvas{CanvasCategory: entity.CanvasCategoryAgent}
	if err := validatePublish(agent, flattenedDSL(map[string]any{"begin": beginComponent()})); err != nil {
		t.Fatalf("agent canvas should not be constrained: %v", err)
	}
}
