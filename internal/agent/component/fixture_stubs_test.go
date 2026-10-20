package component_test

import (
	"strings"
	"testing"

	"ragflow/internal/agent/canvas"
	_ "ragflow/internal/agent/component"
)

// TestCompileAcceptsAnswerComponent covers the Chatflow terminal node.
//
// This used to assert that Compile REJECTED an "Answer" component, back when
// Answer did not exist. The Dify port made Answer a first-class node
// (FR-03-02), so the premise flipped: the component is now registered and a
// canvas that uses it must compile.
func TestCompileAcceptsAnswerComponent(t *testing.T) {
	c := &canvas.Canvas{
		Components: map[string]canvas.CanvasComponent{
			"begin": {
				Obj:        canvas.CanvasComponentObj{ComponentName: "Begin"},
				Downstream: []string{"answer"},
			},
			"answer": {
				Obj:      canvas.CanvasComponentObj{ComponentName: "Answer"},
				Upstream: []string{"begin"},
			},
		},
	}

	if _, err := canvas.Compile(t.Context(), c); err != nil {
		t.Fatalf("Compile rejected the Answer component: %v", err)
	}
}

// TestCompileRejectsUnknownComponent keeps the original guard, now against a
// component name that genuinely does not exist. Without it, a typo in a DSL
// would silently produce a canvas that fails only at run time.
func TestCompileRejectsUnknownComponent(t *testing.T) {
	c := &canvas.Canvas{
		Components: map[string]canvas.CanvasComponent{
			"begin": {
				Obj:        canvas.CanvasComponentObj{ComponentName: "Begin"},
				Downstream: []string{"nope"},
			},
			"nope": {
				Obj:      canvas.CanvasComponentObj{ComponentName: "NotARealComponent"},
				Upstream: []string{"begin"},
			},
		},
	}

	_, err := canvas.Compile(t.Context(), c)
	if err == nil {
		t.Fatal("Compile accepted an unknown component")
	}
	if !strings.Contains(err.Error(), "unknown component") {
		t.Fatalf("Compile error = %q, want unknown component", err)
	}
}
