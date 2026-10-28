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
	"testing"

	"ragflow/internal/agent/canvas"
)

// The 夏管家推送 canvas routes on the retrieval node's formalized_content so an
// empty retrieval gets a deterministic fixed reply instead of reaching the
// model. Before this branch existed the agent was asked to answer with an empty
// 「参考资料」 and improvised a "系统检测到风险" answer, which reads like a
// compliance warning and scared users away.
//
// The DSL shape is pinned here because it is authored outside the editor: the
// switch addresses the upstream output by cpn_id (not by a {{...}} template),
// uses the "empty" operator, and relies on end_cpn_ids as the default branch.
const (
	emptyRouteRetrieval = "Retrieval:RipePeasThank"
	emptyRouteAgent     = "Agent:ShaggyStatesReturn"
	emptyRouteReply     = "Message:CalmGeeseRest"
)

func newEmptyRouteSwitch(t *testing.T) Component {
	t.Helper()
	sw, err := NewSwitchComponent(map[string]any{
		"conditions": []any{
			map[string]any{
				"items": []any{
					map[string]any{
						"cpn_id":   emptyRouteRetrieval + "@formalized_content",
						"operator": "empty",
						"value":    "",
					},
				},
				"logical_operator": "and",
				"to":               []any{emptyRouteReply},
			},
		},
		"end_cpn_ids": []any{emptyRouteAgent},
	})
	if err != nil {
		t.Fatalf("NewSwitchComponent: %v", err)
	}
	return sw
}

// Empty retrieval content must take the fixed-reply branch.
func TestSwitchEmptyRoute_EmptyContentGoesToFixedReply(t *testing.T) {
	state := canvas.NewCanvasState("run-1", "task-1")
	state.SetVar(emptyRouteRetrieval, "formalized_content", "")

	out, err := newEmptyRouteSwitch(t).Invoke(
		withStateForTest(t.Context(), state), nil, map[string]any{})
	if err != nil {
		t.Fatalf("Invoke: %v", err)
	}
	if got := nextTargets(out); len(got) != 1 || got[0] != emptyRouteReply {
		t.Fatalf("_next = %v, want [%s]", got, emptyRouteReply)
	}
}

// Non-empty retrieval content must fall through to the default branch, i.e. the
// agent still answers normally.
func TestSwitchEmptyRoute_ContentStillReachesAgent(t *testing.T) {
	state := canvas.NewCanvasState("run-1", "task-1")
	state.SetVar(emptyRouteRetrieval, "formalized_content", "基金转换按持有时间收赎回费。")

	out, err := newEmptyRouteSwitch(t).Invoke(
		withStateForTest(t.Context(), state), nil, map[string]any{})
	if err != nil {
		t.Fatalf("Invoke: %v", err)
	}
	if got := nextTargets(out); len(got) != 1 || got[0] != emptyRouteAgent {
		t.Fatalf("_next = %v, want [%s]", got, emptyRouteAgent)
	}
}
