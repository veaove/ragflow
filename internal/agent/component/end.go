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
	"fmt"
	"strconv"

	"ragflow/internal/agent/runtime"

	"gorm.io/gorm"
)

const componentNameEnd = "End"

// EndComponent is the Workflow terminal output node (Dify `end`). It declares
// a set of named output fields, resolves each field's value template against
// the canvas state, and returns the typed map that becomes the Workflow API
// response body (FR-03-01).
type EndComponent struct {
	outputs map[string]endOutputField
}

type endOutputField struct {
	Type  string // string / number / boolean / object / array
	Value string // template / variable reference, resolved at run time
}

// NewEndComponent builds an End from params. The canonical params shape is
// {"outputs": { "<name>": {"type": "string", "value": "{node@param}"} }}.
func NewEndComponent(params map[string]any) (Component, error) {
	outputs := map[string]endOutputField{}
	raw, _ := params["outputs"].(map[string]any)
	// JSON-decode may produce []any-of-map for object forms; tolerate map only
	// here and let the publish validator enforce the canonical shape.
	if raw == nil {
		if m, ok := params["outputs"].(map[string]interface{}); ok {
			raw = m
		}
	}
	for name, def := range raw {
		dm, ok := def.(map[string]any)
		if !ok {
			continue
		}
		typ, _ := dm["type"].(string)
		if typ == "" {
			typ = "string"
		}
		val, _ := dm["value"].(string)
		outputs[name] = endOutputField{Type: typ, Value: val}
	}
	return &EndComponent{outputs: outputs}, nil
}

// Name returns the registered component name.
func (e *EndComponent) Name() string { return componentNameEnd }

// Invoke resolves every output field template and returns the typed map.
func (e *EndComponent) Invoke(ctx context.Context, db *gorm.DB, inputs map[string]any) (map[string]any, error) {
	state, err := runtime.GetStateFromContext(ctx)
	if err != nil {
		return nil, err
	}
	out := make(map[string]any, len(e.outputs))
	for name, field := range e.outputs {
		resolved, rerr := runtime.ResolveTemplate(field.Value, state)
		if rerr != nil {
			return nil, fmt.Errorf("End: output %q: %w", name, rerr)
		}
		converted, cerr := convertEndValue(resolved, field.Type)
		if cerr != nil {
			return nil, fmt.Errorf("End: output %q: %w", name, cerr)
		}
		out[name] = converted
	}
	return out, nil
}

// Stream mirrors Invoke (End is a terminal, not a streaming node).
func (e *EndComponent) Stream(ctx context.Context, db *gorm.DB, inputs map[string]any) (<-chan map[string]any, error) {
	out, err := e.Invoke(ctx, db, inputs)
	if err != nil {
		return nil, err
	}
	ch := make(chan map[string]any, 1)
	ch <- out
	close(ch)
	return ch, nil
}

// Inputs returns the parameter surface.
func (e *EndComponent) Inputs() map[string]string {
	return map[string]string{
		"outputs": "Map of output fields: name → {type, value}; the resolved map becomes the Workflow response.",
	}
}

// Outputs returns the declared output contract (dynamic; keys are user-defined).
func (e *EndComponent) Outputs() map[string]string {
	return map[string]string{
		"*": "Each declared output field, resolved to its declared type.",
	}
}

// convertEndValue coerces a resolved template string into the declared type.
func convertEndValue(v any, typ string) (any, error) {
	switch typ {
	case "number":
		if f, ok := v.(float64); ok {
			return f, nil
		}
		if i, ok := v.(int); ok {
			return float64(i), nil
		}
		f, err := strconv.ParseFloat(fmt.Sprintf("%v", v), 64)
		if err != nil {
			return v, nil // non-numeric → keep raw, don't hard-fail
		}
		return f, nil
	case "boolean":
		if b, ok := v.(bool); ok {
			return b, nil
		}
		b, err := strconv.ParseBool(fmt.Sprintf("%v", v))
		if err != nil {
			return v, nil
		}
		return b, nil
	case "string":
		if v == nil {
			return "", nil
		}
		return fmt.Sprintf("%v", v), nil
	default:
		// object / array / unknown → pass through (already structured, or a
		// JSON string the client is expected to parse).
		return v, nil
	}
}

func init() {
	Register(componentNameEnd, NewEndComponent)
}
