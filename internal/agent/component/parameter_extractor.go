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

	"gorm.io/gorm"
)

const componentNameParameterExtractor = "ParameterExtractor"

// parameterField is one declared extraction field.
type parameterField struct {
	Name        string
	Type        string
	Required    bool
	Description string
}

// ParameterExtractorComponent extracts structured fields from free text via an
// LLM with a JSON schema, then validates required/type constraints (Dify
// `parameter-extractor`, FR-03-04). It reuses LLMComponent's model resolution
// and structured-output machinery, not a second model-call path.
type ParameterExtractorComponent struct {
	fields      []parameterField
	instruction string
	modelID     string
}

// NewParameterExtractorComponent builds the component from params.
// params: {"input": "...", "model_id": "...", "instruction": "...",
//          "fields": [{"name","type","required","description"}]}.
func NewParameterExtractorComponent(params map[string]any) (Component, error) {
	modelID, _ := params["model_id"].(string)
	instruction, _ := params["instruction"].(string)
	fields := parseParameterFields(params["fields"])
	return &ParameterExtractorComponent{fields: fields, instruction: instruction, modelID: modelID}, nil
}

func parseParameterFields(raw any) []parameterField {
	fields := []parameterField{}
	items, ok := raw.([]any)
	if !ok {
		return fields
	}
	for _, it := range items {
		m, ok := it.(map[string]any)
		if !ok {
			continue
		}
		name, _ := m["name"].(string)
		if name == "" {
			continue
		}
		typ, _ := m["type"].(string)
		if typ == "" {
			typ = "string"
		}
		required, _ := m["required"].(bool)
		desc, _ := m["description"].(string)
		fields = append(fields, parameterField{Name: name, Type: typ, Required: required, Description: desc})
	}
	return fields
}

// Name returns the registered component name.
func (p *ParameterExtractorComponent) Name() string { return componentNameParameterExtractor }

// Invoke runs the LLM with a JSON schema over the input and validates the
// result. Outputs: result (map), missing (list of required-but-empty fields),
// invalid (list of type-mismatch fields).
func (p *ParameterExtractorComponent) Invoke(ctx context.Context, db *gorm.DB, inputs map[string]any) (map[string]any, error) {
	if len(p.fields) == 0 {
		return nil, &ParamError{Field: "fields", Reason: "at least one field must be declared"}
	}
	inputText := resolveInputText(p, inputs)

	// Build the OutputStructure schema so LLMComponent emits JSON matching the
	// declared fields (LLMComponent already retries once on a schema miss).
	schema := make(map[string]any, len(p.fields))
	for _, f := range p.fields {
		schema[f.Name] = map[string]any{"type": f.Type, "description": f.Description}
	}

	sysPrompt := buildExtractorSystemPrompt(p.fields, p.instruction)
	llm := NewLLMComponent(LLMParam{
		ModelID:         p.modelID,
		SystemPrompt:    sysPrompt,
		UserPrompt:      inputText,
		JSONOutput:      true,
		OutputStructure: schema,
	})
	out, err := llm.Invoke(ctx, db, map[string]any{})
	if err != nil {
		return nil, fmt.Errorf("ParameterExtractor: %w", err)
	}

	structured, _ := out["structured"].(map[string]any)
	if structured == nil {
		structured = map[string]any{}
	}

	result := map[string]any{}
	var missing, invalid []string
	for _, f := range p.fields {
		v, present := structured[f.Name]
		if !present || v == nil || fmt.Sprintf("%v", v) == "" {
			if f.Required {
				missing = append(missing, f.Name)
			}
			result[f.Name] = ""
			continue
		}
		converted, ok := coerceFieldType(v, f.Type)
		if !ok {
			invalid = append(invalid, f.Name)
		}
		result[f.Name] = converted
	}

	resp := map[string]any{"result": result}
	if len(missing) > 0 {
		resp["missing"] = missing
	}
	if len(invalid) > 0 {
		resp["invalid"] = invalid
	}
	return resp, nil
}

// Stream mirrors Invoke.
func (p *ParameterExtractorComponent) Stream(ctx context.Context, db *gorm.DB, inputs map[string]any) (<-chan map[string]any, error) {
	out, err := p.Invoke(ctx, db, inputs)
	if err != nil {
		return nil, err
	}
	ch := make(chan map[string]any, 1)
	ch <- out
	close(ch)
	return ch, nil
}

// Inputs returns the parameter surface.
func (p *ParameterExtractorComponent) Inputs() map[string]string {
	return map[string]string{
		"input":       "Free text to extract fields from (usually {sys.query}).",
		"model_id":    "Chat model to use for extraction.",
		"fields":      "Array of {name, type, required, description} fields.",
		"instruction": "Optional extraction instruction appended to the system prompt.",
	}
}

// Outputs returns the output contract.
func (p *ParameterExtractorComponent) Outputs() map[string]string {
	return map[string]string{
		"result":  "Extracted field values keyed by field name.",
		"missing": "Required fields that could not be extracted.",
		"invalid": "Fields whose extracted value did not match the declared type.",
	}
}

// resolveInputText reads the input from inputs["input"] (already template-
// resolved by the canvas engine) or falls back to the DSL input reference.
func resolveInputText(p *ParameterExtractorComponent, inputs map[string]any) string {
	if v, ok := inputs["input"]; ok {
		if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
			return s
		}
	}
	return ""
}

// buildExtractorSystemPrompt composes the system prompt asking the model to
// emit only JSON matching the declared fields.
func buildExtractorSystemPrompt(fields []parameterField, instruction string) string {
	var b strings.Builder
	b.WriteString("你是信息抽取助手。请从用户文本中抽取以下字段，只输出 JSON，不要输出任何解释。\n字段：\n")
	for _, f := range fields {
		req := "可选"
		if f.Required {
			req = "必填"
		}
		b.WriteString(fmt.Sprintf("- %s (%s, %s)", f.Name, f.Type, req))
		if f.Description != "" {
			b.WriteString(fmt.Sprintf("：%s", f.Description))
		}
		b.WriteString("\n")
	}
	b.WriteString("缺失的字段填空字符串。不要猜测，只抽取文本中明确出现的信息。")
	if strings.TrimSpace(instruction) != "" {
		b.WriteString("\n\n" + instruction)
	}
	return b.String()
}

// coerceFieldType coerces an extracted value to the declared type. ok=false
// means the value cannot be coerced.
func coerceFieldType(v any, typ string) (any, bool) {
	switch typ {
	case "number":
		switch n := v.(type) {
		case float64, float32, int, int64, int32:
			return n, true
		case string:
			if strings.TrimSpace(n) == "" {
				return "", false
			}
			// attempt parse; on failure return raw with ok=false
			var f float64
			if _, err := fmt.Sscanf(n, "%f", &f); err == nil {
				return f, true
			}
			return n, false
		}
		return v, false
	case "boolean":
		switch b := v.(type) {
		case bool:
			return b, true
		case string:
			switch strings.ToLower(strings.TrimSpace(b)) {
			case "true", "1", "yes", "是":
				return true, true
			case "false", "0", "no", "否":
				return false, true
			}
			return b, false
		}
		return v, false
	default:
		return v, true
	}
}

func init() {
	Register(componentNameParameterExtractor, NewParameterExtractorComponent)
}
