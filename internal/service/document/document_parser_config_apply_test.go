package document

import (
	"testing"

	"ragflow/internal/entity"
)

// audioOneChunkerID is the chunker node of the built-in audio pipeline.
const audioOneChunkerID = "OneChunker:BlueSkiesLaugh"

func audioDatasetParserConfig(chunkTokenSize int) entity.JSONMap {
	return entity.JSONMap{
		audioOneChunkerID: map[string]any{
			"chunk_token_size":   chunkTokenSize,
			"overlapped_percent": 7,
		},
	}
}

// TestApplyDatasetParserConfigRefreshesChunkingParams covers the reported
// symptom: a chunk size edited on the dataset page never reached files that
// were uploaded before the edit, so re-parsing produced one chunk again.
func TestApplyDatasetParserConfigRefreshesChunkingParams(t *testing.T) {
	ctx := t.Context()
	db := setupServiceTestDB(t)
	pushServiceDB(t, db)

	insertTestKB(t, "kb-audio", "user-1", 0, 0, 0)
	kb := &entity.Knowledgebase{
		ID:           "kb-audio",
		TenantID:     "user-1",
		ParserID:     "audio",
		ParserConfig: audioDatasetParserConfig(500),
	}
	// The document carries the stale snapshot taken at upload time: the
	// chunker node exists but holds no parameters.
	doc := &entity.Document{
		ID:           "doc-audio",
		KbID:         kb.ID,
		CreatedBy:    "user-1",
		ParserID:     "audio",
		ParserConfig: entity.JSONMap{audioOneChunkerID: map[string]any{}},
	}
	if err := db.Create(doc).Error; err != nil {
		t.Fatalf("create document: %v", err)
	}

	svc := testDocumentService(t)
	if err := svc.applyDatasetParserConfig(ctx, doc, kb); err != nil {
		t.Fatalf("applyDatasetParserConfig() error = %v", err)
	}

	assertChunkTokenSize(t, doc.ParserConfig, 500)

	stored := &entity.Document{}
	if err := db.Where("id = ?", doc.ID).First(stored).Error; err != nil {
		t.Fatalf("reload document: %v", err)
	}
	// A JSON round-trip through the longtext column turns numbers into
	// float64, so the persisted copy is compared as a float.
	assertChunkTokenSize(t, stored.ParserConfig, float64(500))
}

// TestApplyDatasetParserConfigKeepsFileSpecificSelection guards the escape
// hatch: a file pointed at another parser keeps its own settings, because the
// dataset's component ids do not exist in its DSL.
func TestApplyDatasetParserConfigKeepsFileSpecificSelection(t *testing.T) {
	ctx := t.Context()
	db := setupServiceTestDB(t)
	pushServiceDB(t, db)

	insertTestKB(t, "kb-audio", "user-1", 0, 0, 0)
	kb := &entity.Knowledgebase{
		ID:           "kb-audio",
		TenantID:     "user-1",
		ParserID:     "audio",
		ParserConfig: audioDatasetParserConfig(500),
	}
	own := entity.JSONMap{"GeneralChunker:SixApplesFall": map[string]any{"chunk_token_size": 128}}
	doc := &entity.Document{
		ID:           "doc-general",
		KbID:         kb.ID,
		CreatedBy:    "user-1",
		ParserID:     "general",
		ParserConfig: own,
	}
	if err := db.Create(doc).Error; err != nil {
		t.Fatalf("create document: %v", err)
	}

	svc := testDocumentService(t)
	if err := svc.applyDatasetParserConfig(ctx, doc, kb); err != nil {
		t.Fatalf("applyDatasetParserConfig() error = %v", err)
	}

	if _, ok := doc.ParserConfig["GeneralChunker:SixApplesFall"]; !ok {
		t.Fatalf("document config was replaced: %#v", doc.ParserConfig)
	}
	if _, ok := doc.ParserConfig[audioOneChunkerID]; ok {
		t.Fatalf("dataset chunker leaked into a different parser's document: %#v", doc.ParserConfig)
	}
}

// compilerCanvasDSL is a custom pipeline whose only user-facing node is a
// Compiler, so a rebuilt config that keeps it proves the DSL came from the
// canvas rather than from a builtin parser.
func compilerCanvasDSL() entity.JSONMap {
	return entity.JSONMap{
		"components": map[string]any{
			"File": map[string]any{
				"obj": map[string]any{"component_name": "File", "params": map[string]any{}},
			},
			compilerNodeID: map[string]any{
				"obj": map[string]any{
					"component_name": "Compiler",
					"params":         map[string]any{"compilation_template_group_id": "group-default"},
				},
			},
		},
	}
}

const compilerNodeID = "Compiler:Compile1"

// TestApplyDatasetParserConfigFollowsDatasetPipeline covers the reported
// symptom: the dataset bound a pipeline with a Compiler after its files were
// uploaded, so every document still ran the builtin parser and re-parsing
// produced no compiled artifacts. Applying the dataset config must move the
// document onto the dataset pipeline — both the config (keyed by the canvas
// component ids) and the persisted selection the task runs.
func TestApplyDatasetParserConfigFollowsDatasetPipeline(t *testing.T) {
	ctx := t.Context()
	db := setupServiceTestDB(t)
	pushServiceDB(t, db)

	canvasID := "canvas-compiler"
	if err := db.Create(&entity.UserCanvas{
		ID:       canvasID,
		UserID:   "user-1",
		TenantID: "user-1",
		DSL:      compilerCanvasDSL(),
	}).Error; err != nil {
		t.Fatalf("create canvas: %v", err)
	}

	insertTestKB(t, "kb-docs", "user-1", 0, 0, 0)
	kb := &entity.Knowledgebase{
		ID:         "kb-docs",
		TenantID:   "user-1",
		ParserID:   "general",
		PipelineID: sptr(canvasID),
		ParserConfig: entity.JSONMap{
			compilerNodeID: map[string]any{"compilation_template_group_id": "group-1"},
		},
	}
	doc := &entity.Document{
		ID:           "doc-stale",
		KbID:         kb.ID,
		CreatedBy:    "user-1",
		ParserID:     "general",
		PipelineID:   nil,
		ParserConfig: entity.JSONMap{"GeneralChunker:SixApplesFall": map[string]any{}},
	}
	if err := db.Create(doc).Error; err != nil {
		t.Fatalf("create document: %v", err)
	}

	svc := testDocumentService(t)
	if err := svc.applyDatasetParserConfig(ctx, doc, kb); err != nil {
		t.Fatalf("applyDatasetParserConfig() error = %v", err)
	}

	node, ok := doc.ParserConfig[compilerNodeID].(map[string]any)
	if !ok {
		t.Fatalf("compiler node missing from rebuilt config: %#v", doc.ParserConfig)
	}
	if got := node["compilation_template_group_id"]; got != "group-1" {
		t.Fatalf("compilation_template_group_id = %#v, want group-1", got)
	}
	if doc.PipelineID == nil || *doc.PipelineID != canvasID {
		t.Fatalf("document pipeline_id = %v, want %q", doc.PipelineID, canvasID)
	}

	stored := &entity.Document{}
	if err := db.Where("id = ?", doc.ID).First(stored).Error; err != nil {
		t.Fatalf("reload document: %v", err)
	}
	if stored.PipelineID == nil || *stored.PipelineID != canvasID {
		t.Fatalf("persisted pipeline_id = %v, want %q", stored.PipelineID, canvasID)
	}
}

// TestApplyDatasetParserConfigKeepsOtherPipeline guards the escape hatch: a file
// bound to a different pipeline owns its own config and must not be moved onto
// the dataset's pipeline.
func TestApplyDatasetParserConfigKeepsOtherPipeline(t *testing.T) {
	ctx := t.Context()
	db := setupServiceTestDB(t)
	pushServiceDB(t, db)

	insertTestKB(t, "kb-docs", "user-1", 0, 0, 0)
	kb := &entity.Knowledgebase{
		ID:         "kb-docs",
		TenantID:   "user-1",
		ParserID:   "general",
		PipelineID: sptr("canvas-dataset"),
		ParserConfig: entity.JSONMap{
			compilerNodeID: map[string]any{"compilation_template_group_id": "group-1"},
		},
	}
	own := entity.JSONMap{"Parser:Mine": map[string]any{}}
	doc := &entity.Document{
		ID:           "doc-own",
		KbID:         kb.ID,
		CreatedBy:    "user-1",
		ParserID:     "general",
		PipelineID:   sptr("canvas-own"),
		ParserConfig: own,
	}
	if err := db.Create(doc).Error; err != nil {
		t.Fatalf("create document: %v", err)
	}

	svc := testDocumentService(t)
	if err := svc.applyDatasetParserConfig(ctx, doc, kb); err != nil {
		t.Fatalf("applyDatasetParserConfig() error = %v", err)
	}

	if doc.PipelineID == nil || *doc.PipelineID != "canvas-own" {
		t.Fatalf("document pipeline_id = %v, want canvas-own preserved", doc.PipelineID)
	}
	if _, ok := doc.ParserConfig["Parser:Mine"]; !ok {
		t.Fatalf("document config was replaced: %#v", doc.ParserConfig)
	}
}

func assertChunkTokenSize(t *testing.T, config entity.JSONMap, want any) {
	t.Helper()
	node, ok := config[audioOneChunkerID].(map[string]any)
	if !ok {
		t.Fatalf("chunker node missing from parser_config: %#v", config)
	}
	if got := node["chunk_token_size"]; got != want {
		t.Fatalf("chunk_token_size = %#v, want %#v (%#v)", got, want, node)
	}
}
