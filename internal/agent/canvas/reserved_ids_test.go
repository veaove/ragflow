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

package canvas

import "testing"

func canvasWithEndID() *Canvas {
	return &Canvas{
		Components: map[string]CanvasComponent{
			"begin": {
				Obj:        CanvasComponentObj{ComponentName: "Begin"},
				Downstream: []string{"end"},
			},
			"end": {
				Obj: CanvasComponentObj{
					ComponentName: "End",
					Params: map[string]any{
						"outputs": map[string]any{
							"broadcast_text": map[string]any{"type": "string", "value": "{end@answer}"},
						},
					},
				},
				Upstream: []string{"begin"},
			},
		},
	}
}

func TestSanitizeReservedNodeIDs_RenamesEnd(t *testing.T) {
	c := canvasWithEndID()
	renames := sanitizeReservedNodeIDs(c)

	if len(renames) != 1 || renames["end"] != "end_node" {
		t.Fatalf("expected end→end_node rename, got %v", renames)
	}
	if _, ok := c.Components["end"]; ok {
		t.Fatal("the reserved id must no longer exist as a component key")
	}
	comp, ok := c.Components["end_node"]
	if !ok {
		t.Fatal("expected the renamed component to exist")
	}
	if comp.Obj.ComponentName != "End" {
		t.Fatalf("component name must be preserved, got %q", comp.Obj.ComponentName)
	}
	// Topology must follow the rename.
	if got := c.Components["begin"].Downstream; len(got) != 1 || got[0] != "end_node" {
		t.Fatalf("downstream not rewritten: %v", got)
	}
	if got := comp.Upstream; len(got) != 1 || got[0] != "begin" {
		t.Fatalf("upstream should be untouched, got %v", got)
	}
	// Variable references must follow the rename too.
	outputs := comp.Obj.Params["outputs"].(map[string]any)
	field := outputs["broadcast_text"].(map[string]any)
	if field["value"] != "{end_node@answer}" {
		t.Fatalf("variable reference not rewritten: %v", field["value"])
	}
}

func TestSanitizeReservedNodeIDs_StartReserved(t *testing.T) {
	c := &Canvas{
		Components: map[string]CanvasComponent{
			"start": {Obj: CanvasComponentObj{ComponentName: "Begin"}},
		},
	}
	renames := sanitizeReservedNodeIDs(c)
	if renames["start"] != "start_node" {
		t.Fatalf("expected start→start_node rename, got %v", renames)
	}
	if _, ok := c.Components["start_node"]; !ok {
		t.Fatal("expected the renamed component to exist")
	}
}

func TestSanitizeReservedNodeIDs_CollisionWithExistingID(t *testing.T) {
	c := &Canvas{
		Components: map[string]CanvasComponent{
			"end":      {Obj: CanvasComponentObj{ComponentName: "End"}},
			"end_node": {Obj: CanvasComponentObj{ComponentName: "Note"}},
		},
	}
	renames := sanitizeReservedNodeIDs(c)
	if renames["end"] == "end_node" {
		t.Fatal("rename must not collide with an existing component id")
	}
	if _, ok := c.Components["end_node"]; !ok {
		t.Fatal("the pre-existing end_node component must be preserved")
	}
}

func TestSanitizeReservedNodeIDs_NoopForNormalIDs(t *testing.T) {
	c := &Canvas{
		Components: map[string]CanvasComponent{
			"begin": {Obj: CanvasComponentObj{ComponentName: "Begin"}},
			"llm":   {Obj: CanvasComponentObj{ComponentName: "LLM"}},
		},
	}
	if renames := sanitizeReservedNodeIDs(c); len(renames) != 0 {
		t.Fatalf("expected no renames, got %v", renames)
	}
	if _, ok := c.Components["llm"]; !ok {
		t.Fatal("normal ids must be untouched")
	}
}

// A nested params tree (slices of maps) must also be rewritten.
func TestSanitizeReservedNodeIDs_NestedParams(t *testing.T) {
	c := &Canvas{
		Components: map[string]CanvasComponent{
			"end": {
				Obj: CanvasComponentObj{
					ComponentName: "End",
					Params: map[string]any{
						"items": []any{
							map[string]any{"ref": "{end@a}"},
							"plain {end@b} tail",
						},
					},
				},
			},
		},
	}
	sanitizeReservedNodeIDs(c)
	comp := c.Components["end_node"]
	items := comp.Obj.Params["items"].([]any)
	first := items[0].(map[string]any)
	if first["ref"] != "{end_node@a}" {
		t.Fatalf("nested map ref not rewritten: %v", first["ref"])
	}
	if items[1] != "plain {end_node@b} tail" {
		t.Fatalf("nested string ref not rewritten: %v", items[1])
	}
}
