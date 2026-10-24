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
