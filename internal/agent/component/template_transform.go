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
	"strings"

	"ragflow/internal/agent/runtime"

	"gorm.io/gorm"
)

const componentNameTemplateTransform = "TemplateTransform"

// TemplateTransformComponent renders a Jinja template against declared
// variables (Dify `template-transform`). The template may reference variables
// by their declared names ({{ name }}) which are bound from upstream refs.
type TemplateTransformComponent struct {
	template  string
	variables map[string]string // declared name → variable reference (e.g. "{start@user_name}")
}

// NewTemplateTransformComponent builds the component from params.
// params: {"template": "...", "variables": {"name": "{node@param}"}}.
func NewTemplateTransformComponent(params map[string]any) (Component, error) {
	tpl, _ := params["template"].(string)
	vars := map[string]string{}
	if raw, ok := params["variables"]; ok {
		if m, ok := raw.(map[string]any); ok {
			for k, v := range m {
				if s, ok := v.(string); ok {
					vars[k] = s
				}
			}
		}
	}
	return &TemplateTransformComponent{template: tpl, variables: vars}, nil
}

// Name returns the registered component name.
func (t *TemplateTransformComponent) Name() string { return componentNameTemplateTransform }

// Invoke binds each declared variable from the state, then renders the
// template by substituting {{ name }} tokens. Unbound variables resolve to ""
// and surface a warning entry. Complex Jinja (loops/conditionals) is out of
// scope for V1.0; ResolveTemplateJinja handles the canvas-ref form.
func (t *TemplateTransformComponent) Invoke(ctx context.Context, db *gorm.DB, inputs map[string]any) (map[string]any, error) {
	state, err := runtime.GetStateFromContext(ctx)
	if err != nil {
		return nil, err
	}
	// Bind declared variables from their references.
	bindings := make(map[string]any, len(t.variables))
	var missing []string
	for name, ref := range t.variables {
		v, gerr := state.GetVar(ref)
		if gerr != nil || v == nil {
			missing = append(missing, name)
			bindings[name] = ""
			continue
		}
		bindings[name] = v
	}

	rendered := substituteNamedVars(t.template, bindings)

	result := map[string]any{"output": rendered}
	if len(missing) > 0 {
		result["missing"] = missing
	}
	return result, nil
}

// Stream mirrors Invoke.
func (t *TemplateTransformComponent) Stream(ctx context.Context, db *gorm.DB, inputs map[string]any) (<-chan map[string]any, error) {
	out, err := t.Invoke(ctx, db, inputs)
	if err != nil {
		return nil, err
	}
	ch := make(chan map[string]any, 1)
	ch <- out
	close(ch)
	return ch, nil
}

// Inputs returns the parameter surface.
func (t *TemplateTransformComponent) Inputs() map[string]string {
	return map[string]string{
		"template":  "Jinja template string; may reference declared variables as {{ name }}.",
		"variables": "Map of variable name → canvas reference (e.g. {start@user_name}).",
	}
}

// Outputs returns the output contract.
func (t *TemplateTransformComponent) Outputs() map[string]string {
	return map[string]string{
		"output":  "Rendered template string.",
		"missing": "List of declared variable names that could not be resolved.",
	}
}

// substituteNamedVars replaces {{ name }} tokens with their bound values.
func substituteNamedVars(template string, bindings map[string]any) string {
	out := template
	for name, v := range bindings {
		out = replaceToken(out, name, fmt.Sprintf("%v", v))
	}
	return out
}

func replaceToken(s, name, value string) string {
	// Simple {{ name }} and {{name}} replacement; matches the Jinja subset the
	// template node documents. More complex Jinja is already handled by
	// ResolveTemplateJinja before this pass.
	tokens := []string{"{{ " + name + " }}", "{{" + name + "}}", "{{ " + name + "}}", "{{" + name + " }}"}
	for _, tok := range tokens {
		for {
			idx := strings.Index(s, tok)
			if idx < 0 {
				break
			}
			s = s[:idx] + value + s[idx+len(tok):]
		}
	}
	return s
}

func init() {
	Register(componentNameTemplateTransform, NewTemplateTransformComponent)
}
