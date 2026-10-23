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

package chunker

import (
	"context"
	"strings"
	"testing"
)

// oneChunksOfWithParams drives OneChunker.Invoke with explicit params.
func oneChunksOfWithParams(t *testing.T, params, inputs map[string]any) []map[string]any {
	t.Helper()
	comp, err := NewOneChunker(params)
	if err != nil {
		t.Fatalf("NewOneChunker(%v): %v", params, err)
	}
	out, err := comp.Invoke(context.Background(), nil, inputs)
	if err != nil {
		t.Fatalf("OneChunker.Invoke: %v", err)
	}
	chunks, ok := out["chunks"].([]map[string]any)
	if !ok {
		t.Fatalf("chunks not []map[string]any: %T", out["chunks"])
	}
	return chunks
}

// longTranscript builds an ASR-like transcript: one line of sentences with no
// newline, so the split can only come from sentence boundaries — the shape an
// audio chunker actually receives.
func longTranscript(sentences int) string {
	var b strings.Builder
	for i := 0; i < sentences; i++ {
		b.WriteString("这是第一段用于测试分块的音频转写内容。")
	}
	return b.String()
}

// TestOneChunker_DefaultKeepsSingleChunk pins the backwards-compatibility
// contract: without chunk_token_size every file still yields exactly one
// chunk, however long it is.
func TestOneChunker_DefaultKeepsSingleChunk(t *testing.T) {
	text := longTranscript(40)
	chunks := oneChunksOfWithParams(t, nil, map[string]any{
		"name":          "long.wav",
		"output_format": "text",
		"text":          text,
	})
	if len(chunks) != 1 {
		t.Fatalf("want 1 chunk by default, got %d", len(chunks))
	}
	if got := chunks[0]["text"]; got != text {
		t.Errorf("text changed: got %d chars, want %d", len(got.(string)), len(text))
	}
}

// TestOneChunker_SplitsLongTranscript is the audio fix: a token budget turns
// the single oversized transcript into several retrieval-sized chunks.
func TestOneChunker_SplitsLongTranscript(t *testing.T) {
	const budget = 80
	text := longTranscript(40)
	chunks := oneChunksOfWithParams(t, map[string]any{"chunk_token_size": float64(budget)}, map[string]any{
		"name":          "long.wav",
		"output_format": "text",
		"text":          text,
	})
	if len(chunks) < 2 {
		t.Fatalf("want the transcript split into several chunks, got %d", len(chunks))
	}
	var joined strings.Builder
	for i, ck := range chunks {
		body, _ := ck["text"].(string)
		if strings.TrimSpace(body) == "" {
			t.Fatalf("chunk %d is empty", i)
		}
		if got := tokenizeStr(body); got > budget {
			t.Errorf("chunk %d has %d tokens, exceeds the %d budget", i, got, budget)
		}
		if dt, _ := ck["doc_type_kwd"].(string); dt != "text" {
			t.Errorf("chunk %d doc_type_kwd = %q, want text", i, dt)
		}
		joined.WriteString(body)
	}
	// Splitting is lossless: the pieces reproduce the source text.
	if got := joined.String(); got != text {
		t.Errorf("split is not lossless: got %d chars, want %d", len(got), len(text))
	}
}

// TestOneChunker_SplitKeepsMediaChunkWhole guards the picture pipeline: an item
// carrying an image keeps the one-chunk-per-file shape even when a budget is
// configured, so the image payload is never detached or duplicated.
func TestOneChunker_SplitKeepsMediaChunkWhole(t *testing.T) {
	chunks := oneChunksOfWithParams(t, map[string]any{"chunk_token_size": float64(40)}, map[string]any{
		"name":          "pic.png",
		"output_format": "json",
		"json": []map[string]any{
			{
				"text":         longTranscript(40),
				"image":        "data:image/png;base64,AAAA",
				"doc_type_kwd": "image",
				"doc_type":     "image",
			},
		},
	})
	if len(chunks) != 1 {
		t.Fatalf("media item must stay one chunk, got %d", len(chunks))
	}
	if got := chunks[0]["image"]; got != "data:image/png;base64,AAAA" {
		t.Errorf("image = %v, want preserved", got)
	}
}

// TestOneChunker_SplitKeepsNonTextChunkWhole keeps a table/image item intact even
// without an image payload: slicing it into text pieces would drop the table
// semantics (the same reason the merge path never splits media blocks).
func TestOneChunker_SplitKeepsNonTextChunkWhole(t *testing.T) {
	chunks := oneChunksOfWithParams(t, map[string]any{"chunk_token_size": float64(40)}, map[string]any{
		"name":          "sheet.xlsx",
		"output_format": "json",
		"json": []map[string]any{
			{"text": longTranscript(40), "doc_type_kwd": "table"},
		},
	})
	if len(chunks) != 1 {
		t.Fatalf("non-text item must stay one chunk, got %d", len(chunks))
	}
	if got := chunks[0]["doc_type_kwd"]; got != "table" {
		t.Errorf("doc_type_kwd = %v, want table", got)
	}
}

// TestOneChunker_ParamValidation rejects an impossible budget and normalizes a
// fractional overlap to the percentage scale the merge core expects.
func TestOneChunker_ParamValidation(t *testing.T) {
	if _, err := NewOneChunker(map[string]any{"chunk_token_size": float64(-1)}); err == nil {
		t.Fatal("want an error for a negative chunk_token_size")
	}
	comp, err := NewOneChunker(map[string]any{"overlapped_percent": 0.2})
	if err != nil {
		t.Fatalf("NewOneChunker: %v", err)
	}
	one, ok := comp.(*OneChunkerComponent)
	if !ok {
		t.Fatalf("component type = %T", comp)
	}
	if got := one.param.OverlappedPercent; got != 20 {
		t.Errorf("overlapped_percent = %v, want 20 (0.2 normalized to a percentage)", got)
	}
	// No budget configured -> no splitter, so the single-chunk path runs.
	if one.splitter() != nil {
		t.Error("splitter must be nil when chunk_token_size is 0")
	}
}
