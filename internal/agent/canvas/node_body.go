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

// node_body.go — per-node lambda body construction.
//
// Both the outer graph (scheduler.go) and the Loop sub-graph
// (loop_subgraph.go) install lambda nodes that:
//
//  1. tag their output with __cpn_id__ so statePost can persist the
//     result into Outputs[cpnID]["result"];
//  2. either invoke a real factory-built component or fall back to a
//     no-op echo body.
//
// Centralising the construction here keeps both call sites consistent
// and makes the legacy-no-op / factory / placeholder routing logic the
// single source of truth.
package canvas

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"ragflow/internal/common"
	"ragflow/internal/dao"
	"strings"
	"time"

	"ragflow/internal/agent/runtime"

	"go.uber.org/zap"
)

// nodeBodyFn is the plain function shape compose.InvokableLambda accepts.
// We avoid a named type alias because compose.InvokableLambda's generic
// inference only accepts the underlying func literal type, not a named
// alias on top of it.
type nodeBodyFn = func(ctx context.Context, in map[string]any) (map[string]any, error)

// buildNodeBody returns the lambda body for a single canvas node.
//
// Routing rules:
//
//  1. isLegacyNoOp(name) → legacyNoOpBody (echo + __legacy_noop__ tag).
//     DSL v1 sentinels like "ExitLoop" land here.
//  2. name is "UserFillUp" (case-insensitive) → UserFillUpNodeBody.
//     This route takes precedence over the regular factory path so
//     the eino interrupt semantics replace the legacy
//     UserFillUpComponent.Invoke body. UserFillUpNodeBody calls
//     compose.Interrupt on first execution and reads the resume
//     payload via compose.GetResumeContext on subsequent runs.
//  3. runtime.DefaultFactory() is non-nil → call the factory once to
//     construct a runtime.Component, then return a body that delegates
//     to that component's Invoke. A factory error surfaces here with
//     the cpn_id wrapped for diagnostics.
//  4. otherwise → placeholderBody. This is the canvas-package-only
//     fallback used when no factory has been registered (most commonly
//     in canvas-only unit tests that do not import the component
//     package). Production runs always have a factory installed via
//     component.init() → runtime.SetDefaultFactory(component.New).
//
// The returned body always tags the output map with __cpn_id__ so the
// shared statePost handler can persist the result into the per-cpn
// Outputs bucket. UserFillUpNodeBody tags its output itself so the
// interrupt-driven branch still attributes the resume payload to the
// right cpn.
// ctxKeyOverrideParams carries the run-level override map into
// BuildWorkflow so a component's params can be merged with it
// at compile time. The map is keyed by cpnID; each component only sees the
// entry for its own id (an arbitrary string-keyed map). It mirrors the ctx
// plumbing used for the per-run component factory
// (componentFactoryFromContext): the override is threaded through
// canvas.Compile → BuildWorkflow → buildNodeBody without the canvas
// package ever importing the ingestion layer.
const ctxKeyOverrideParams = "canvas_override_params"

// withOverrideParams attaches a run-level override map to ctx. It is
// a no-op when m is nil so callers can pass a possibly-nil run parameter
// straight through.
func withOverrideParams(ctx context.Context, m map[string]any) context.Context {
	if m == nil {
		return ctx
	}
	return context.WithValue(ctx, ctxKeyOverrideParams, m)
}

func overrideParamsFromContext(ctx context.Context) map[string]any {
	m, _ := ctx.Value(ctxKeyOverrideParams).(map[string]any)
	return m
}

// applyOverrideParams returns a clone of params with the per-component
// override (already resolved for this cpnID by the caller) merged into
// params. The override wins on top-level key collisions. The original
// params map is never mutated — the merge result is a fresh map —
// because the params come from the shared *Canvas and a per-run override
// must not leak into the next Run on the same Pipeline.
func applyOverrideParams(params, cpnOverride map[string]any) map[string]any {
	if len(cpnOverride) == 0 {
		return params
	}
	out := make(map[string]any, len(params)+len(cpnOverride))
	for k, v := range params {
		out[k] = v
	}
	for k, v := range cpnOverride {
		out[k] = v
	}
	return out
}

func buildNodeBody(ctx context.Context, cpnID, name, displayName string, params map[string]any) (nodeBodyFn, error) {
	return buildNodeBodyWithOptions(ctx, cpnID, name, displayName, params, runtime.ComponentExecutionOptions{})
}

func buildNodeBodyWithOptions(ctx context.Context, cpnID, name, displayName string, params map[string]any, opts runtime.ComponentExecutionOptions) (nodeBodyFn, error) {
	if overrides := overrideParamsFromContext(ctx); len(overrides) > 0 {
		// overrides is keyed by cpnID; a component only sees its own
		// entry. Components absent from the map are left untouched.
		if cpnOverride, ok := overrides[cpnID].(map[string]any); ok && len(cpnOverride) > 0 {
			params = applyOverrideParams(params, cpnOverride)
		}
	}
	if isLegacyNoOp(name) {
		return legacyNoOpBody(cpnID), nil
	}
	// UserFillUp routes to the eino interrupt-based node body
	// regardless of whether the legacy UserFillUpComponent is
	// registered. The component's Invoke path renders tips / fields
	// but never emits an interrupt signal — it was the missing
	// producer half of the old sentinel chain. With this routing,
	// every UserFillUp node pauses the graph on first execution
	// (compose.Interrupt) and resumes from the orchestrator's
	// compose.ResumeWithData call.
	if strings.EqualFold(name, "UserFillUp") {
		return UserFillUpNodeBody(cpnID, params), nil
	}
	if factory := resolveComponentFactory(ctx); factory != nil {
		comp, err := factory(name, params)
		if err != nil {
			return nil, fmt.Errorf("agent: component %q (%s): factory: %w", cpnID, name, err)
		}
		if comp == nil {
			return nil, fmt.Errorf("agent: component %q (%s): factory returned nil component", cpnID, name)
		}
		// Pass the class name through to the body for structured logging
		// without the runtime.Component interface needing to expose Name().
		// The factory returns the class name as the DSL's `component_name`
		// field, which is also what ComponentBase.Name() would have returned.
		return realComponentBodyWithOptions(cpnID, name, displayName, comp, opts), nil
	}
	// Fallback: no factory registered. This path is only exercised by
	// canvas-only unit tests; production wiring always installs a
	// factory via component.init().
	if !isKnownPrimitive(name) {
		return nil, fmt.Errorf("agent: component %q has unknown component_name %q (typo? not in isKnownPrimitive, not in legacyNoOpNames)", cpnID, name)
	}
	return placeholderBody(cpnID), nil
}

// legacyNoOpBody returns the body installed for DSL v1 sentinel
// components (legacyNoOpNames). It echoes the input and tags
// __legacy_noop__ so downstream debuggers can tell the node fired but
// did nothing.

func resolveComponentFactory(ctx context.Context) runtime.ComponentFactory {
	if factory := componentFactoryFromContext(ctx); factory != nil {
		return factory
	}
	return runtime.DefaultFactory()
}

func legacyNoOpBody(cpnID string) nodeBodyFn {
	return func(_ context.Context, in map[string]any) (map[string]any, error) {
		out := make(map[string]any, len(in)+2)
		for k, v := range in {
			out[k] = v
		}
		out["__cpn_id__"] = cpnID
		out["__legacy_noop__"] = true
		return out, nil
	}
}

// realComponentBody returns a body that delegates to the supplied
// runtime.Component. The component is constructed once at build time
// (in buildNodeBody) and re-invoked per iteration.
//
// This is the SINGLE chokepoint through which every component Invoke
// passes — both the agent canvas and the ingestion pipeline
// (internal/ingestion/pipeline compiles a canvas and runs its workflow)
// reach components here. Cross-cutting concerns therefore belong here,
// not inside each component's Invoke:
//
//   - execution context: derived from the parent with cancellation only — no
//     framework-level wall-clock deadline is imposed on any component, so a
//     long knowledge-compilation step (many LLM calls) is not cut short by a
//     fixed ceiling. A cancelled task still interrupts via the parent cancel;
//     per-call model deadlines stay at the model driver.
//   - progress: runtime.TrackProgress, with the callback pulled from
//     ctx (nil ⇒ no observer). This makes progress a framework-level
//     concern — components no longer wrap themselves.
//   - elapsed-time accounting: runtime.TrackElapsed stamps
//     _created_time / _elapsed_time into the output map so the
//     dataflow-result UI can show per-node timing without each
//     component repeating the bookkeeping.
//
// Invocation errors identify the component by display name, falling back to the
// cpn_id when no display name is available.
//
// The output map is tagged with __cpn_id__ before return so statePost
// can attribute the result; if the component already populated that
// key it is overwritten with the canvas-controlled value to keep
// attribution authoritative.
func realComponentBody(cpnID, componentClass, displayName string, comp runtime.Component) nodeBodyFn {
	return realComponentBodyWithOptions(cpnID, componentClass, displayName, comp, runtime.ComponentExecutionOptions{})
}

func realComponentBodyWithOptions(cpnID, componentClass, displayName string, comp runtime.Component, opts runtime.ComponentExecutionOptions) nodeBodyFn {
	logName := strings.TrimSpace(displayName)
	if logName == "" {
		logName = cpnID
	}
	return func(ctx context.Context, in map[string]any) (map[string]any, error) {
		// The framework imposes no wall-clock deadline on component execution.
		// Long-running components (notably knowledge compilation, which fans out
		// over many model calls) exceed any fixed ceiling and would otherwise
		// fail with "context deadline exceeded". We derive a cancellation-only
		// context so a cancelled task (parent cancel) still interrupts the
		// component mid-run, while no arbitrary timeout is applied. Per-call
		// model deadlines remain enforced at the model driver.
		cctx, cancel := context.WithCancel(ctx)
		defer cancel()
		// Bind the node id into the fraction reporter so the component's
		// runtime.ReportComponentFraction calls are attributed to this node
		// without the component knowing its own cpnID.
		cctx = runtime.BindComponentFraction(cctx, cpnID)

		var out map[string]any
		invokeErr := func() error {
			// 通用节点重试（ND-01）。max_retries 是 DSL 里的通用参数，默认 0
			// = 不重试；LLM / Agent 内部已有自己的重试循环，这里跳过外层重试，
			// 避免两套重试乘法叠加（详见 component/llm_retry.go 的说明）。
			attempts := outerRetryAttempts(componentClass, in)
			var lastErr error
			for attempt := 0; attempt < attempts; attempt++ {
				var e error
				_ = runtime.TrackProgress(cpnID, runtime.ProgressCallbackFromContext(ctx), func() error {
					out, e = runtime.TrackElapsed(componentClass, func() (map[string]any, error) {
						return comp.Invoke(runtime.WithComponentExecutionOptions(cctx, opts), dao.DB, in)
					})
					return e
				})
				if e == nil {
					return nil
				}
				lastErr = e
				if attempt < attempts-1 {
					// 指数退避（2s 起步、翻倍、上限 30s），期间尊重取消。
					backoff := time.Duration(2<<attempt) * time.Second
					if backoff > 30*time.Second {
						backoff = 30 * time.Second
					}
					common.Info("agent: component invoke will retry",
						zap.String("component_id", cpnID),
						zap.String("component_class", componentClass),
						zap.Int("attempt", attempt+1),
						zap.Int("max_attempts", attempts))
					select {
					case <-ctx.Done():
						return ctx.Err()
					case <-time.After(backoff):
					}
				}
			}
			return lastErr
		}()
		if invokeErr != nil {
			// 异常策略（ND-03 的「默认值」模式）：节点配置 error_strategy=
			// "default_value" 时，失败不中断整条流程，改为输出 error_default_value
			// 并标记 __error_fallback__，下游可据此感知「该节点走了兜底值」。
			// 取消/超时属控制流，不走兜底（用户主动取消不该被吞掉）。
			if !errors.Is(invokeErr, context.Canceled) &&
				!errors.Is(invokeErr, context.DeadlineExceeded) {
				if strategy, _ := in["error_strategy"].(string); strategy == "default_value" {
					if def, ok := in["error_default_value"]; ok {
						common.Warn("agent: component failed, using fallback value",
							zap.String("component_id", cpnID),
							zap.String("component_class", componentClass),
							zap.Error(invokeErr))
						out = map[string]any{
							"result":           def,
							"__cpn_id__":       cpnID,
							"__error_fallback__": true,
						}
						return out, nil
					}
				}
			}
			switch {
			case errors.Is(invokeErr, context.Canceled):
				// A user cancel is a normal control path; the authoritative
				// "Task ... cancelled" line is logged by the service layer, so
				// keep this at debug to avoid duplicate noise.
				common.Debug("agent: component invoke cancelled",
					zap.String("component_id", cpnID),
					zap.String("component_class", componentClass))
				return nil, fmt.Errorf("agent: component %q invoke: cancelled: %w", logName, invokeErr)
			case errors.Is(invokeErr, context.DeadlineExceeded):
				common.Error("agent: component invoke failed", invokeErr,
					zap.String("component_id", cpnID),
					zap.String("component_class", componentClass))
				return nil, fmt.Errorf("agent: component %q invoke: context deadline exceeded: %w", logName, invokeErr)
			default:
				// Surface the failure as a structured log line. The wrapped error
				// already carries the full cause chain (e.g. deepseek DNS/timeout),
				// but without this the failure only showed up as a generic
				// "Task ... failed" line with no clear cause in the logs.
				common.Error("agent: component invoke failed", invokeErr,
					zap.String("component_id", cpnID),
					zap.String("component_class", componentClass))
				return nil, fmt.Errorf("agent: component %q invoke: %w", logName, invokeErr)
			}
		}
		if out == nil {
			out = make(map[string]any, 1)
		}
		out["__cpn_id__"] = cpnID
		return out, nil
	}
}


// outerRetryAttempts 返回外层重试的总尝试次数（含首次）。max_retries 默认 0
// 表示不重试（总尝试 1 次）。LLM / Agent 内部自带重试，外层跳过避免叠加。
func outerRetryAttempts(componentClass string, in map[string]any) int {
	switch strings.ToLower(componentClass) {
	case "llm", "agent":
		return 1
	}
	maxRetries := readIntParam(in, "max_retries")
	if maxRetries < 0 {
		maxRetries = 0
	}
	return maxRetries + 1
}

// readIntParam 从组件输入里读一个整数参数。运行时输入值通常是 float64
// （JSON 解码）或 int；其它类型按 0 处理，缺省即不重试。
func readIntParam(in map[string]any, key string) int {
	v, ok := in[key]
	if !ok || v == nil {
		return 0
	}
	switch n := v.(type) {
	case int:
		return n
	case int64:
		return int(n)
	case float64:
		return int(n)
	case float32:
		return int(n)
	case json.Number:
		if i, err := n.Int64(); err == nil {
			return int(i)
		}
	}
	return 0
}

// placeholderBody is the canvas-only fallback used when no factory
// has been registered. It echoes the input map untouched (except for
// the __cpn_id__ tag) so canvas unit tests can exercise topology
// wiring without depending on any real component implementation.
func placeholderBody(cpnID string) nodeBodyFn {
	return func(ctx context.Context, in map[string]any) (map[string]any, error) {
		out, err := placeholderLambda(ctx, in)
		if err != nil {
			return nil, err
		}
		out["__cpn_id__"] = cpnID
		return out, nil
	}
}

// withStateBracket wraps body so that it performs the same pre/post
// state work as the outer-graph's eino StatePreHandler / StatePostHandler
// pair, but reads the state from the request context (attached via
// runtime.WithState) instead of an eino-managed graph-local state.
//
// This is the path used by the Loop sub-graph: its nodes do not have
// access to the outer graph's WithGenLocalState, but they do inherit
// the context-attached *CanvasState that the outer graph (or the
// invoking caller) installed. Wrapping the body lets sub-graph nodes
// participate in the same state snapshot / result-persistence
// contract as outer nodes.
//
// If no state is attached to ctx (e.g. a sub-graph test that runs
// the body directly), the wrapper degrades to a plain invocation:
// the body still runs, its output is still tagged with __cpn_id__,
// but no state snapshot is injected and no result is persisted.
func withStateBracket(cpnID, componentName string, body nodeBodyFn) nodeBodyFn {
	return func(ctx context.Context, in map[string]any) (map[string]any, error) {
		originalIn := in
		state, _ := runtime.GetStateFromContext(ctx)
		if state != nil {
			nodeStartedAt(ctx, state, cpnID, componentName, componentName, originalIn)
			if in == nil {
				in = map[string]any{}
			}
			snapshot := state.Snapshot()
			wrapped := make(map[string]any, len(in)+1)
			for k, v := range in {
				wrapped[k] = v
			}
			wrapped["state"] = snapshot
			in = wrapped
		}
		out, err := body(ctx, in)
		if err != nil {
			if state != nil {
				nodeFinishedNow(ctx, state, cpnID, componentName, componentName, err)
			}
			return nil, err
		}
		if state == nil {
			return out, nil
		}
		if out == nil {
			nodeFinishedNow(ctx, state, cpnID, componentName, componentName, nil)
			return out, nil
		}
		outputCpnID, _ := out["__cpn_id__"].(string)
		if outputCpnID == "" {
			nodeFinishedNow(ctx, state, cpnID, componentName, componentName, nil)
			return out, nil
		}
		for k, v := range out {
			if k == "__cpn_id__" || k == "state" || k == "__legacy_noop__" {
				continue
			}
			state.SetVar(outputCpnID, k, v)
		}
		if runtime.IsDeferredStream(out["content"]) {
			runtime.RegisterDeferredNode(ctx, cpnID, func() {
				nodeFinishedNow(ctx, state, cpnID, componentName, componentName, nil)
			})
		} else {
			nodeFinishedNow(ctx, state, cpnID, componentName, componentName, nil)
		}
		return out, nil
	}
}
