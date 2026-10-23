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

package handler

import "testing"

// TestAppTypeLabel locks the application-shape labels written into the
// consultation-log CSV export.
//
// The values mirror the canvas_category values used by the studio canvases
// plus "chat" for a dialog-backed chat app (the dialog table has no type
// column, so the chain itself is the type). The web UI localizes the same
// set; a mismatch here shows up as an empty column in the exported file.
func TestAppTypeLabel(t *testing.T) {
	cases := []struct {
		appType string
		want    string
	}{
		{appType: "chat", want: "知识问答"},
		{appType: "agent_canvas", want: "智能体"},
		{appType: "chatflow_canvas", want: "对话流"},
		{appType: "workflow_canvas", want: "工作流"},
		{appType: "dataflow_canvas", want: "数据管道"},
		{appType: "", want: ""},
		{appType: "unknown_kind", want: ""},
	}

	for _, tc := range cases {
		t.Run(tc.appType, func(t *testing.T) {
			if got := appTypeLabel(tc.appType); got != tc.want {
				t.Fatalf("appTypeLabel(%q) = %q, want %q", tc.appType, got, tc.want)
			}
		})
	}
}
