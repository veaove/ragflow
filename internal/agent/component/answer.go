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

package component

import (
	"context"
	"errors"

	"gorm.io/gorm"
)

const componentNameAnswer = "Answer"

// AnswerComponent is the Chatflow terminal node (Dify `answer`). It reuses the
// Message component's template resolution and streaming, overriding only the
// component name and accepting the Chatflow field names (content / stream /
// with_citation / markdown).
//
// Design (D2): Answer is a plain component that internally delegates to
// MessageComponent; the canvas scheduler already wires no-downstream nodes to
// compose.END, so no graph-engine change is needed.
type AnswerComponent struct {
	*MessageComponent
}

// NewAnswerComponent builds an Answer. params accepts the Chatflow field names;
// "content" (string template) and "stream" (bool) map onto the Message engine.
func NewAnswerComponent(params map[string]any) (Component, error) {
	// Answer uses "content" as the template field; Message already reads both
	// "text" and "content", so pass-through is enough.
	inner, err := NewMessageComponent(params)
	if err != nil {
		return nil, err
	}
	msg, ok := inner.(*MessageComponent)
	if !ok {
		return nil, errors.New("Answer: expected MessageComponent inner")
	}
	return &AnswerComponent{MessageComponent: msg}, nil
}

// Name returns "Answer" (the Chatflow-specific component name).
func (a *AnswerComponent) Name() string { return componentNameAnswer }

// Invoke delegates to the embedded MessageComponent.
func (a *AnswerComponent) Invoke(ctx context.Context, db *gorm.DB, inputs map[string]any) (map[string]any, error) {
	return a.MessageComponent.Invoke(ctx, db, inputs)
}

// Stream delegates to the embedded MessageComponent (streaming is mandatory
// for Chatflow Answer).
func (a *AnswerComponent) Stream(ctx context.Context, db *gorm.DB, inputs map[string]any) (<-chan map[string]any, error) {
	return a.MessageComponent.Stream(ctx, db, inputs)
}

// Inputs returns the Answer parameter surface.
func (a *AnswerComponent) Inputs() map[string]string {
	return map[string]string{
		"content":       "Answer body template with {{...}} references; streamed to the client.",
		"stream":        "Must be true for Chatflow; delivers the answer as an SSE stream.",
		"with_citation": "When true, carry retrieval citations in the output.",
		"markdown":      "When true, render the answer as Markdown.",
	}
}

// Outputs returns the Answer output contract.
func (a *AnswerComponent) Outputs() map[string]string {
	return map[string]string{
		"content":   "The streamed answer body.",
		"citations": "Retrieval citations (doc_id + chunk_id + snippet) when with_citation is enabled.",
	}
}

func init() {
	Register(componentNameAnswer, NewAnswerComponent)
}
