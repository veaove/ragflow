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
	"fmt"

	"ragflow/internal/entity"
)

// ErrPublishValidation is returned when the canvas fails form-factor
// constraints before publish. The message lists each failure for the client
// to render (FR-07-01).
type ErrPublishValidation struct {
	Reasons []string
}

func (e *ErrPublishValidation) Error() string {
	return fmt.Sprintf("publish validation failed: %v", e.Reasons)
}

// validatePublish enforces form-factor constraints on the DSL before it is
// snapshotted (D2 / 10.1). agent_canvas keeps its legacy semantics (no new
// exit constraints); workflow requires exactly one End with non-empty outputs;
// chatflow requires at least one Answer and forbids End.
func validatePublish(canvas *entity.UserCanvas, dsl map[string]any) error {
	if dsl == nil {
		return &ErrPublishValidation{Reasons: []string{"canvas is empty"}}
	}
	names := collectComponentNames(dsl)
	endCount := countName(names, "End")
	answerCount := countName(names, "Answer")

	switch canvas.CanvasCategory {
	case entity.CanvasCategoryWorkflow:
		var reasons []string
		if endCount != 1 {
			reasons = append(reasons, fmt.Sprintf("Workflow 必须且只能有一个 End 节点（当前 %d 个）", endCount))
		}
		if answerCount > 0 {
			reasons = append(reasons, "Workflow 不允许 Answer 节点")
		}
		if endCount == 1 && !endHasOutputs(dsl) {
			reasons = append(reasons, "End 节点必须声明至少一个输出字段")
		}
		if len(reasons) > 0 {
			return &ErrPublishValidation{Reasons: reasons}
		}
	case entity.CanvasCategoryChatflow:
		var reasons []string
		if answerCount < 1 {
			reasons = append(reasons, "Chatflow 至少需要一个可达的 Answer 节点")
		}
		if endCount > 0 {
			reasons = append(reasons, "Chatflow 不允许 End 节点")
		}
		if len(reasons) > 0 {
			return &ErrPublishValidation{Reasons: reasons}
		}
	}
	return nil
}

// componentView normalizes the two shapes a component can take on the wire:
//   - flattened (what dsl.NormalizeForCanvas emits): {id, name, params}
//   - nested (what a hand-written DSL carries):      {obj:{component_name, params}}
// Reading only one shape silently finds zero nodes and makes every workflow
// look like it has no End, so both are resolved here once.
type componentView struct {
	name   string
	params map[string]any
}

func viewComponent(cm map[string]any) componentView {
	if obj, ok := cm["obj"].(map[string]any); ok {
		name, _ := obj["component_name"].(string)
		params, _ := obj["params"].(map[string]any)
		return componentView{name: name, params: params}
	}
	name, _ := cm["name"].(string)
	if name == "" {
		name, _ = cm["component_name"].(string)
	}
	params, _ := cm["params"].(map[string]any)
	return componentView{name: name, params: params}
}

// collectComponentNames returns the component name of every component,
// tolerating both the flattened and nested DSL shapes.
func collectComponentNames(dsl map[string]any) []string {
	comps, ok := dsl["components"].(map[string]any)
	if !ok {
		return nil
	}
	names := make([]string, 0, len(comps))
	for _, raw := range comps {
		cm, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if name := viewComponent(cm).name; name != "" {
			names = append(names, name)
		}
	}
	return names
}

func countName(names []string, target string) int {
	n := 0
	for _, name := range names {
		if name == target {
			n++
		}
	}
	return n
}

// endHasOutputs checks whether the single End node declares a non-empty
// outputs map.
func endHasOutputs(dsl map[string]any) bool {
	comps, ok := dsl["components"].(map[string]any)
	if !ok {
		return false
	}
	for _, raw := range comps {
		cm, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		view := viewComponent(cm)
		if view.name != "End" {
			continue
		}
		if view.params == nil {
			return false
		}
		outputs, _ := view.params["outputs"].(map[string]any)
		return len(outputs) > 0
	}
	return false
}
