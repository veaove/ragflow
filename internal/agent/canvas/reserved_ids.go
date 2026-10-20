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

import (
	"strings"

	"github.com/cloudwego/eino/compose"
	"go.uber.org/zap"

	"ragflow/internal/common"
)

// einoReservedNodeIDs are the graph node keys eino keeps for itself.
// compose.Workflow wires its own START/END terminals under these names and
// refuses to add a user node with the same key
// ("node '%s' is reserved, cannot add manually").
//
// The Dify port introduces a user-facing node type named "End", and a
// hand-written DSL may well use the obvious id "end" for it. Without a
// guard the compile fails with an opaque eino error, so the canvas
// renames such ids before building the graph.
var einoReservedNodeIDs = map[string]bool{
	compose.START: true,
	compose.END:   true,
}

// sanitizeReservedNodeIDs renames component ids that collide with eino's
// reserved graph terminals and rewrites every reference to them (upstream /
// downstream lists and `{cpnID@param}` variable references inside params).
//
// The rename happens on the decoded Canvas, before BuildWorkflow, so the
// eino node keys stay in sync with the (renamed) DSL topology while the
// state/outputs keys — and therefore user-facing variable references —
// keep working.
//
// It mutates c in place and returns the old→new id mapping (empty when
// nothing had to change).
func sanitizeReservedNodeIDs(c *Canvas) map[string]string {
	if c == nil || len(c.Components) == 0 {
		return nil
	}
	renames := make(map[string]string)
	for id := range c.Components {
		if !einoReservedNodeIDs[id] {
			continue
		}
		newID := id + "_node"
		// Keep bumping if the candidate is itself taken.
		for {
			if _, taken := c.Components[newID]; !taken {
				break
			}
			newID += "_"
		}
		renames[id] = newID
	}
	if len(renames) == 0 {
		return nil
	}

	// Rebuild the component map under the new keys.
	components := make(map[string]CanvasComponent, len(c.Components))
	for id, comp := range c.Components {
		newID := id
		if mapped, ok := renames[id]; ok {
			newID = mapped
		}
		comp.Upstream = rewriteIDList(comp.Upstream, renames)
		comp.Downstream = rewriteIDList(comp.Downstream, renames)
		comp.Obj.Params = rewriteParamRefs(comp.Obj.Params, renames)
		components[newID] = comp
	}
	c.Components = components

	// NodeParents mirrors the front-end graph metadata and is keyed by node
	// id; keep it aligned with the renamed components.
	if len(c.NodeParents) > 0 {
		parents := make(map[string]string, len(c.NodeParents))
		for id, parent := range c.NodeParents {
			if mapped, ok := renames[id]; ok {
				id = mapped
			}
			if mapped, ok := renames[parent]; ok {
				parent = mapped
			}
			parents[id] = parent
		}
		c.NodeParents = parents
	}

	common.Warn("agent: renamed component ids that collide with eino reserved graph terminals",
		zap.Any("renames", renames))
	return renames
}

// rewriteIDList applies the rename map to a list of node ids.
func rewriteIDList(ids []string, renames map[string]string) []string {
	if len(ids) == 0 {
		return ids
	}
	out := make([]string, len(ids))
	for i, id := range ids {
		if mapped, ok := renames[id]; ok {
			out[i] = mapped
		} else {
			out[i] = id
		}
	}
	return out
}

// rewriteParamRefs rewrites `{oldID@...}` variable references inside a
// params tree so renamed nodes stay addressable.
func rewriteParamRefs(params map[string]any, renames map[string]string) map[string]any {
	if params == nil || len(renames) == 0 {
		return params
	}
	out := make(map[string]any, len(params))
	for k, v := range params {
		out[k] = rewriteParamValue(v, renames)
	}
	return out
}

func rewriteParamValue(v any, renames map[string]string) any {
	switch x := v.(type) {
	case string:
		return rewriteRefString(x, renames)
	case map[string]any:
		out := make(map[string]any, len(x))
		for k, val := range x {
			out[k] = rewriteParamValue(val, renames)
		}
		return out
	case []any:
		out := make([]any, len(x))
		for i, val := range x {
			out[i] = rewriteParamValue(val, renames)
		}
		return out
	case []string:
		out := make([]string, len(x))
		for i, val := range x {
			out[i] = rewriteRefString(val, renames)
		}
		return out
	default:
		return v
	}
}

// rewriteRefString replaces `{oldID@` with `{newID@` inside a template
// string. Only the node id part of a reference is touched; the rest of the
// template is left byte-for-byte intact.
func rewriteRefString(s string, renames map[string]string) string {
	if !strings.Contains(s, "{") {
		return s
	}
	out := s
	for old, new := range renames {
		out = strings.ReplaceAll(out, "{"+old+"@", "{"+new+"@")
	}
	return out
}
