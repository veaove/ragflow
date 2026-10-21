// Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package canvas

import (
	"context"
	"errors"
	"testing"

	"gorm.io/gorm"

	"ragflow/internal/agent/runtime"
)

// fakeComponent counts Invoke calls and fails the first failN of them, so the
// retry / fallback wiring in realComponentBodyWithOptions can be exercised
// without a real component or any external dependency.
type fakeComponent struct {
	calls  int
	failN  int
	invoke func(ctx context.Context, in map[string]any) (map[string]any, error)
}

func (f *fakeComponent) Invoke(
	ctx context.Context,
	_ *gorm.DB,
	in map[string]any,
) (map[string]any, error) {
	f.calls++
	if f.invoke != nil {
		return f.invoke(ctx, in)
	}
	if f.calls <= f.failN {
		return nil, errors.New("fake component failure")
	}
	return map[string]any{"ok": true}, nil
}

func TestOuterRetryAttempts(t *testing.T) {
	cases := []struct {
		name  string
		class string
		in    map[string]any
		want  int
	}{
		{"default is no retry", "Invoke", nil, 1},
		{"int max_retries", "Invoke", map[string]any{"max_retries": 3}, 4},
		{"float64 max_retries", "Invoke", map[string]any{"max_retries": float64(2)}, 3},
		{"negative clamps to no retry", "Invoke", map[string]any{"max_retries": -5}, 1},
		// LLM / Agent 内部已有自己的重试循环，外层不能再叠加。
		{"llm skips outer retry", "LLM", map[string]any{"max_retries": 5}, 1},
		{"llm lowercase skips", "llm", map[string]any{"max_retries": 5}, 1},
		{"agent skips outer retry", "Agent", map[string]any{"max_retries": 5}, 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := outerRetryAttempts(tc.class, tc.in); got != tc.want {
				t.Fatalf("outerRetryAttempts(%q, %v) = %d, want %d",
					tc.class, tc.in, got, tc.want)
			}
		})
	}
}

func TestReadIntParam(t *testing.T) {
	cases := []struct {
		name string
		in   map[string]any
		want int
	}{
		{"missing", map[string]any{}, 0},
		{"nil", map[string]any{"n": nil}, 0},
		{"int", map[string]any{"n": 7}, 7},
		{"int64", map[string]any{"n": int64(8)}, 8},
		{"float64", map[string]any{"n": float64(9)}, 9},
		{"unsupported type", map[string]any{"n": "10"}, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := readIntParam(tc.in, "n"); got != tc.want {
				t.Fatalf("readIntParam(%v) = %d, want %d", tc.in, got, tc.want)
			}
		})
	}
}

// TestComponentBodyFallbackValue 覆盖异常策略「默认值」模式（ND-03）：
// 配置了 error_strategy=default_value 的节点失败时，不应把错误抛给流程，
// 而是输出 error_default_value 并打上 __error_fallback__ 标记。
func TestComponentBodyFallbackValue(t *testing.T) {
	comp := &fakeComponent{
		invoke: func(context.Context, map[string]any) (map[string]any, error) {
			return nil, errors.New("upstream 500")
		},
	}
	body := realComponentBodyWithOptions(
		"cpn-1", "Invoke", "HTTP", comp, runtime.ComponentExecutionOptions{},
	)

	out, err := body(context.Background(), map[string]any{
		"error_strategy":      "default_value",
		"error_default_value": "fallback-value",
	})
	if err != nil {
		t.Fatalf("fallback should swallow the error, got %v", err)
	}
	if out["result"] != "fallback-value" {
		t.Fatalf("result = %v, want fallback-value", out["result"])
	}
	if out["__error_fallback__"] != true {
		t.Fatalf("__error_fallback__ = %v, want true", out["__error_fallback__"])
	}
	if out["__cpn_id__"] != "cpn-1" {
		t.Fatalf("__cpn_id__ = %v, want cpn-1", out["__cpn_id__"])
	}
}

// TestComponentBodyNoStrategyPropagatesError 保证未配置策略时行为不变：
// 失败必须原样抛给流程（这是绝大多数节点的默认语义）。
func TestComponentBodyNoStrategyPropagatesError(t *testing.T) {
	comp := &fakeComponent{
		invoke: func(context.Context, map[string]any) (map[string]any, error) {
			return nil, errors.New("boom")
		},
	}
	body := realComponentBodyWithOptions(
		"cpn-2", "Invoke", "HTTP", comp, runtime.ComponentExecutionOptions{},
	)

	if _, err := body(context.Background(), map[string]any{}); err == nil {
		t.Fatal("expected error to propagate when no error_strategy is configured")
	}
	if comp.calls != 1 {
		t.Fatalf("calls = %d, want 1 (no retry configured)", comp.calls)
	}
}

// TestComponentBodyRetries 覆盖通用节点重试（ND-01）：max_retries=1 时
// 第一次失败、第二次成功，最终返回成功结果。
// 注意：真实退避是 2s 起步，这个用例会耗时约 2s。
func TestComponentBodyRetries(t *testing.T) {
	comp := &fakeComponent{failN: 1}
	body := realComponentBodyWithOptions(
		"cpn-3", "Invoke", "HTTP", comp, runtime.ComponentExecutionOptions{},
	)

	out, err := body(context.Background(), map[string]any{"max_retries": 1})
	if err != nil {
		t.Fatalf("retry should have succeeded on the 2nd attempt, got %v", err)
	}
	if comp.calls != 2 {
		t.Fatalf("calls = %d, want 2", comp.calls)
	}
	if out["ok"] != true {
		t.Fatalf("ok = %v, want true", out["ok"])
	}
}

// TestComponentBodyRetryExhausted 覆盖重试次数用尽：错误仍然要抛出去。
func TestComponentBodyRetryExhausted(t *testing.T) {
	comp := &fakeComponent{failN: 10}
	body := realComponentBodyWithOptions(
		"cpn-4", "Invoke", "HTTP", comp, runtime.ComponentExecutionOptions{},
	)

	if _, err := body(context.Background(), map[string]any{"max_retries": 1}); err == nil {
		t.Fatal("expected error after retries are exhausted")
	}
	if comp.calls != 2 {
		t.Fatalf("calls = %d, want 2 (initial + 1 retry)", comp.calls)
	}
}

// TestComponentBodyLLMSkipsOuterRetry 保证 LLM 不走外层重试：
// LLM 组件内部已有 retryInvoker，外层再包一层会导致重试次数乘法叠加。
func TestComponentBodyLLMSkipsOuterRetry(t *testing.T) {
	comp := &fakeComponent{
		invoke: func(context.Context, map[string]any) (map[string]any, error) {
			return nil, errors.New("model timeout")
		},
	}
	body := realComponentBodyWithOptions(
		"cpn-5", "LLM", "LLM", comp, runtime.ComponentExecutionOptions{},
	)

	if _, err := body(context.Background(), map[string]any{"max_retries": 3}); err == nil {
		t.Fatal("expected error to propagate")
	}
	if comp.calls != 1 {
		t.Fatalf("calls = %d, want 1 (LLM must not be wrapped by outer retry)", comp.calls)
	}
}

// TestComponentBodyCancelSkipsFallback 取消属于控制流，不应被异常策略吞掉。
func TestComponentBodyCancelSkipsFallback(t *testing.T) {
	comp := &fakeComponent{
		invoke: func(context.Context, map[string]any) (map[string]any, error) {
			return nil, context.Canceled
		},
	}
	body := realComponentBodyWithOptions(
		"cpn-6", "Invoke", "HTTP", comp, runtime.ComponentExecutionOptions{},
	)

	_, err := body(context.Background(), map[string]any{
		"error_strategy":      "default_value",
		"error_default_value": "should-not-be-used",
	})
	if err == nil {
		t.Fatal("cancel must propagate even with a fallback configured")
	}
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
}
