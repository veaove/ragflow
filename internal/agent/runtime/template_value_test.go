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

package runtime

import (
	"strings"
	"testing"
)

// 数组要按空行连接：Parallel 收集每章输出后，merge 靠这个把全文拼成一篇文章。
// 回归点：以前走 fmt 的 %v，会渲染成 "[第一章 第二章]"（空格分隔 + 方括号），
// 段落结构全丢，章节标题挤在同一行。
func TestStringifyTemplateValueJoinsSliceWithBlankLine(t *testing.T) {
	got := stringifyTemplateValue([]string{"## 第一章\n正文一", "## 第二章\n正文二"})

	if strings.Contains(got, "[") || strings.Contains(got, "]") {
		t.Fatalf("slice rendered with brackets: %q", got)
	}
	want := "## 第一章\n正文一\n\n## 第二章\n正文二"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

// []any 也要按空行连接，保持和 []string 一致。
func TestStringifyTemplateValueJoinsAnySlice(t *testing.T) {
	got := stringifyTemplateValue([]any{"第一段", "第二段"})
	if got != "第一段\n\n第二段" {
		t.Fatalf("got %q, want %q", got, "第一段\n\n第二段")
	}
}

// 标量必须保持原样，不能因为这次改动影响既有的变量替换。
func TestStringifyTemplateValueKeepsScalars(t *testing.T) {
	cases := map[string]any{
		"text": "hello",
		"42":   42,
		"1.5":  1.5,
		"true": true,
	}
	for want, in := range cases {
		if got := stringifyTemplateValue(in); got != want {
			t.Errorf("stringifyTemplateValue(%v) = %q, want %q", in, got, want)
		}
	}
}

// 空数组不该产生多余的分隔符。
func TestStringifyTemplateValueEmptySlice(t *testing.T) {
	if got := stringifyTemplateValue([]string{}); got != "" {
		t.Fatalf("empty slice = %q, want empty string", got)
	}
}
