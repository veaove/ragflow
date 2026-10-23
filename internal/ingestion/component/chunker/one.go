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

// OneChunker emits a single chunk per upstream document. It is the
// faithful Go port of the Python `one` chunk method
// (rag/app/one.py) and also covers the `picture` / `audio` methods,
// whose Python chunk() functions return exactly one chunk per file
// (rag/app/picture.py, rag/app/audio.py) — the latter additionally
// carrying the raw image / media context, which this chunker preserves.
//
// Unlike TokenChunker in "one" mode (which drops per-item media
// context), OneChunker carries the image attachment and doc_type of a
// single upstream item through unchanged, so picture/audio pipelines
// keep their media payload.
//
// OPTIONAL SPLITTING: by default OneChunker emits exactly one chunk per file,
// which is what picture pipelines need (one image, one chunk). An audio
// transcript of a few minutes, however, easily exceeds 2k tokens and retrieves
// poorly as a single chunk — the retrieved context is either the whole
// recording or nothing. Setting chunk_token_size > 0 splits the (text-only)
// body into retrieval-sized chunks with the TokenChunker merge core: sentence
// boundaries first, a hard cap at the budget, optional overlap. Media-carrying
// items keep the single-chunk shape so the image payload is never duplicated
// or detached.
package chunker

import (
	"context"
	"strings"

	"ragflow/internal/agent/runtime"
	"ragflow/internal/ingestion/component/schema"

	"gorm.io/gorm"
)

const ComponentNameOneChunker = "OneChunker"

type oneChunkerParam struct {
	schema.OneChunkerParam
}

func (p *oneChunkerParam) Update(conf map[string]any) {
	if conf == nil {
		return
	}
	if v, ok := schema.NumericFromAny(conf["chunk_token_size"]); ok {
		p.OneChunkerParam.ChunkTokenSize = int(v)
	}
	if v, ok := conf["overlapped_percent"]; ok {
		p.OneChunkerParam.OverlappedPercent = schema.NormalizeOverlappedPercent(v)
	}
	// A canvas saved before this parameter existed carries no delimiters key;
	// the default (["\n"]) applies. An explicitly empty list is honoured as
	// "no primary delimiter" — the merge core then splits on sentence
	// boundaries only.
	if v, ok := conf["delimiters"].([]any); ok {
		p.OneChunkerParam.Delimiters = stringListFromAny(v)
	} else if v, ok := conf["delimiters"].([]string); ok {
		p.OneChunkerParam.Delimiters = append([]string(nil), v...)
	}
}

func (oneChunkerParam) Defaults() oneChunkerParam {
	return oneChunkerParam{OneChunkerParam: schema.OneChunkerParam{}.Defaults()}
}

func (p oneChunkerParam) Validate() error { return p.OneChunkerParam.Validate() }

type OneChunkerComponent struct {
	name  string
	param oneChunkerParam
}

func NewOneChunker(params map[string]any) (runtime.Component, error) {
	p := oneChunkerParam{}.Defaults()
	(&p).Update(params)
	if err := p.Validate(); err != nil {
		return nil, err
	}
	return &OneChunkerComponent{
		name:  ComponentNameOneChunker,
		param: p,
	}, nil
}
func (c *OneChunkerComponent) Inputs() map[string]string { return ChunkerInputs }

func (c *OneChunkerComponent) Outputs() map[string]string { return ChunkerOutputs }

func (c *OneChunkerComponent) Invoke(ctx context.Context, db *gorm.DB, inputs map[string]any) (map[string]any, error) {
	return c.invoke(ctx, inputs)
}

// invoke collapses the decoded upstream payload into a single chunk, or into
// retrieval-sized chunks when the operator configured a token budget
// (chunk_token_size > 0).
func (c *OneChunkerComponent) invoke(_ context.Context, inputs map[string]any) (map[string]any, error) {
	if inputs == nil {
		return emptyOutputs(), nil
	}
	upstream, err := decodeChunkerFromUpstream(inputs)
	if err != nil {
		return inputErrorOutput(err), nil
	}
	splitText := c.splitter()

	switch upstream.OutputFormat {
	case schema.PayloadFormatMarkdown:
		if upstream.MarkdownResult == nil {
			return emptyOutputs(), nil
		}
		return emitOneWith(*upstream.MarkdownResult, "text", splitText), nil
	case schema.PayloadFormatText:
		if upstream.TextResult == nil {
			return emptyOutputs(), nil
		}
		return emitOneWith(*upstream.TextResult, "text", splitText), nil
	case schema.PayloadFormatHTML:
		if upstream.HTMLResult == nil {
			return emptyOutputs(), nil
		}
		return emitOneWith(*upstream.HTMLResult, "text", splitText), nil
	default:
		return emitOneFromItemsWith(upstream.JSONResult, upstream.Chunks, splitText), nil
	}
}

// splitFunc slices one chunk body into retrieval-sized pieces. A nil splitter
// means "keep the historical one-chunk-per-file behaviour".
type splitFunc func(text, docType string) []schema.ChunkDoc

// splitter returns the configured splitter, or nil when chunk_token_size is
// unset — the default, so every existing canvas and template is unaffected.
func (c *OneChunkerComponent) splitter() splitFunc {
	target := c.param.ChunkTokenSize
	if target <= 0 {
		return nil
	}
	overlappedPct := c.param.OverlappedPercent
	delimiters := c.param.Delimiters
	return func(text, docType string) []schema.ChunkDoc {
		return splitOneText(text, target, overlappedPct, delimiters, docType)
	}
}

// emitOne wraps a single text payload as one chunk.
func emitOne(text, docType string) map[string]any {
	return emitOneWith(text, docType, nil)
}

// emitOneWith is emitOne plus the opt-in split: when splitText yields more than
// one piece the pieces are emitted instead of the single merged chunk. Pieces
// are produced by the TokenChunker merge core, so each one is already
// tag-stripped and hard-capped at the token budget.
func emitOneWith(text, docType string, splitText splitFunc) map[string]any {
	if strings.TrimSpace(text) == "" {
		return emptyOutputs()
	}
	// Strip parser coordinate tags so they never reach embedding/index,
	// matching the Python flow chunker's tag-free "one" output
	// (rag/flow/chunker/token_chunker.py delimiter_mode one). The legacy
	// rag/app/one.py predates tag stripping and is intentionally out of
	// scope here.
	clean := removeTag(text)
	if splitText != nil {
		if pieces := splitText(clean, docType); len(pieces) > 1 {
			return chunkOutputs(pieces)
		}
	}
	return chunkOutputs([]schema.ChunkDoc{{
		Text:    clean,
		DocType: docType,
		CKType:  docType,
	}})
}

// emitOneFromItems collapses a structured upstream payload into a single
// chunk. When the payload is a single item, its media context (image)
// and doc_type are preserved. When it is many items, their text is
// concatenated and the first available image attachment is carried over —
// mirroring the Python "one chunk per file" behavior for picture/audio,
// where each upstream item is one page/slide/transcript segment of the
// same source file.
func emitOneFromItems(items, chunks []schema.ChunkDoc) map[string]any {
	return emitOneFromItemsWith(items, chunks, nil)
}

// emitOneFromItemsWith is emitOneFromItems plus the opt-in split. Splitting is
// skipped whenever the payload carries media (an image) or a non-text doc type:
// a picture pipeline relies on the one-file/one-chunk mapping, and slicing a
// table/image block would turn it into plain text pieces.
func emitOneFromItemsWith(items, chunks []schema.ChunkDoc, splitText splitFunc) map[string]any {
	src := items
	if len(src) == 0 {
		src = chunks
	}
	if len(src) == 0 {
		return emptyOutputs()
	}
	if len(src) == 1 {
		it := src[0]
		docType := itemDocType(it)
		text := itemTextOrFallback(it)
		if strings.TrimSpace(text) == "" && it.Image == "" {
			return emptyOutputs()
		}
		// Strip parser coordinate tags (see emitOne).
		clean := removeTag(text)
		if it.Image == "" && docType == "text" && splitText != nil {
			if pieces := splitText(clean, docType); len(pieces) > 1 {
				return chunkOutputs(pieces)
			}
		}
		out := schema.ChunkDoc{
			Text:         clean,
			DocType:      docType,
			CKType:       docType,
			Image:        it.Image,
			Positions:    it.Positions,
			PDFPositions: it.PDFPositions,
			Sheet:        it.Sheet,
			SheetIndex:   it.SheetIndex,
		}
		return chunkOutputs([]schema.ChunkDoc{out})
	}

	var parts []string
	var img string
	allText := true
	for _, it := range src {
		if t := itemTextOrFallback(it); t != "" {
			// Strip parser coordinate tags before joining (see emitOne).
			parts = append(parts, removeTag(t))
		}
		if img == "" && it.Image != "" {
			img = it.Image
		}
		if itemDocType(it) != "text" {
			allText = false
		}
	}
	merged := strings.Join(parts, "\n")
	if strings.TrimSpace(merged) == "" && img == "" {
		return emptyOutputs()
	}
	if img == "" && allText && splitText != nil {
		if pieces := splitText(merged, "text"); len(pieces) > 1 {
			return chunkOutputs(pieces)
		}
	}
	out := schema.ChunkDoc{Text: merged, DocType: "text", CKType: "text"}
	// Multi-item merge produces a single text-only chunk mirroring Python
	// one.py:166-168. Per-item Positions/PDFPositions are intentionally
	// not carried — merging coordinates from different source items would
	// produce meaningless composite geometry, and the downstream
	// processChunkPositions would map them to incorrect pages.
	if img != "" {
		out.Image = img
	}
	return chunkOutputs([]schema.ChunkDoc{out})
}

// splitOneText divides one chunk body into <= target-token chunks using the
// TokenChunker merge core, so the opt-in OneChunker split behaves exactly like
// TokenChunker: split on the configured delimiters (a bare delimiter is kept,
// a backtick one is dropped), expand an oversized unit on sentence boundaries
// with a hard token-split fallback, then greedily merge to the budget with
// optional overlap. Every emitted piece carries docType so the downstream
// doc_type_kwd stays "text" (the single-chunk path sets it too).
func splitOneText(text string, target int, overlappedPct float64, delimiters []string, docType string) []schema.ChunkDoc {
	if target <= 0 || strings.TrimSpace(text) == "" {
		return nil
	}
	// Normalize line endings before splitting, mirroring mergeByTokenSize.
	text = strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n")

	var units []schema.ChunkDoc
	custom := hasCustomDelim(delimiters)
	if pattern := compileDelimPattern(delimiters); hasActiveDelimiter(pattern) {
		for _, sub := range splitByDelim(text, pattern, !custom) {
			if custom {
				sub = strings.TrimSpace(sub)
			}
			if sub == "" {
				continue
			}
			units = append(units, schema.ChunkDoc{Text: sub, TKNums: intPtr(tokenizeStr(sub)), CKType: "text"})
		}
	}
	if len(units) == 0 {
		// No active delimiter (or none matched): the whole body is one unit and
		// the merge core splits it on sentence boundaries when it overflows.
		units = []schema.ChunkDoc{{Text: text, TKNums: intPtr(tokenizeStr(text)), CKType: "text"}}
	}

	merged := mergeUnits(units, target, overlappedPct, "")
	out := make([]schema.ChunkDoc, 0, len(merged))
	for _, ch := range merged {
		if ch.CKType != "text" {
			continue
		}
		// Re-strip tags: mergeUnits may join units that each carried tags.
		setChunkText(&ch, removeTag(ch.Text))
		if strings.TrimSpace(ch.Text) == "" {
			continue
		}
		ch.DocType = docType
		ch.CKType = "text"
		out = append(out, ch)
	}
	return out
}

func init() {
	MustRegisterChunker(ComponentNameOneChunker)
}
