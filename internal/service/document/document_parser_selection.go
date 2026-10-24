package document

import (
	"context"
	"fmt"
	"strings"

	"ragflow/internal/common"
	"ragflow/internal/dao"
	"ragflow/internal/entity"
	componentpkg "ragflow/internal/ingestion/component"
	"ragflow/internal/ingestion/component/schema"
	pipelinepkg "ragflow/internal/ingestion/pipeline"
	"ragflow/internal/service"
	"ragflow/internal/utility"

	"go.uber.org/zap"
)

// generalParserID is the built-in catch-all ingestion pipeline. A file whose
// family the dataset's selection does not declare and which no dedicated
// pipeline owns falls back to it.
const generalParserID = "general"

// dedicatedDocumentParserID returns the pipeline that owns a document of the
// given file type, or "" when no pipeline owns it and the dataset's selection
// governs the file. Mirrors Python's FileService.get_parser
// (api/db/services/file_service.py:734-743): images and video are parsed by the
// picture pipeline, audio by audio, presentations by presentation and mail by
// email.
func dedicatedDocumentParserID(filetype utility.FileType, filename string) string {
	switch filetype {
	case utility.FileTypeVISUAL:
		return "picture"
	case utility.FileTypeAURAL:
		return "audio"
	}

	// The presentation and email extensions all classify as FileTypeDOC, so the
	// name decides (same name-based rule as Python's get_parser and the
	// document parser_id guard in document_dataset_update.go).
	name := strings.ToLower(filename)
	switch {
	case strings.HasSuffix(name, ".ppt"),
		strings.HasSuffix(name, ".pptx"),
		strings.HasSuffix(name, ".pages"):
		return "presentation"
	case strings.HasSuffix(name, ".msg"),
		strings.HasSuffix(name, ".eml"):
		return "email"
	}
	return ""
}

// parserParamsDeclaresFamily reports whether a Parser component's params
// declare the given file family ("pdf", "text&code", "slides", ...). The
// declaration is the one the web parser-gap validation reads
// (transformParserConfigSetups), so both sides judge files by one contract.
func parserParamsDeclaresFamily(params map[string]any, family string) bool {
	_, declared := schema.FlattenLegacyParserSetups(params)[family]
	return declared
}

// configDeclaredFamily reports whether a parser_config declares the family.
// found is false when the config has no readable Parser entry (a legacy flat
// config, or a malformed one): the config cannot answer then.
func configDeclaredFamily(config entity.JSONMap, family string) (declared, found bool) {
	for cpnID, raw := range config {
		if !pipelinepkg.IsParserComponentID(cpnID) {
			continue
		}
		params, ok := raw.(map[string]any)
		if !ok {
			return false, false
		}
		declared = declared || parserParamsDeclaresFamily(params, family)
		found = true
	}
	return declared, found
}

// templateDeclaredFamily reports whether a builtin template declares the family.
// found is false when the template cannot be loaded or carries no Parser
// component. The registry resolves legacy aliases ("naive" -> "general"), so a
// dataset row storing a historical parser_id is judged by the template it
// actually runs.
func templateDeclaredFamily(ctx context.Context, parserID, family string) (declared, found bool) {
	dslJSON, err := service.LoadPipelineDSL(ctx, false, parserID, nil)
	if err != nil {
		return false, false
	}
	defaults, err := pipelinepkg.ComponentParamsDefaults(dslJSON)
	if err != nil {
		return false, false
	}
	for cpnID, params := range defaults {
		if !pipelinepkg.IsParserComponentID(cpnID) {
			continue
		}
		return parserParamsDeclaresFamily(params, family), true
	}
	return false, false
}

// selectionGovernsFamily reports whether the dataset's selection declares a
// file family.
//
// The saved config carries the declaration the web gap validation reads, so it
// decides whenever it has a Parser entry. A legacy flat config has none, and a
// builtin selection is then judged by the template its parser_id actually runs;
// a canvas has no template to consult. Callers only ask about a family the
// pipeline vocabulary can name; an unreadable declaration answers true, keeping
// the choice that cannot be judged.
func selectionGovernsFamily(ctx context.Context, sel *service.ParserSelection, config entity.JSONMap, family string) bool {
	if declared, found := configDeclaredFamily(config, family); found {
		return declared
	}
	if sel != nil && sel.IsBuiltIn() {
		if declared, found := templateDeclaredFamily(ctx, sel.ParserID, family); found {
			return declared
		}
	}
	return true
}

// parserSelectionColumns maps a resolved parser selection onto the document
// row's (parser_id, pipeline_id) columns. A canvas selection leaves parser_id
// empty: parser_id is not applicable in canvas pipeline mode.
func parserSelectionColumns(sel *service.ParserSelection) (string, *string) {
	if sel != nil && sel.IsPipeline() {
		pipelineID := sel.PipelineID
		return "", &pipelineID
	}
	parserID := ""
	if sel != nil {
		parserID = sel.ParserID
	}
	return parserID, nil
}

// resolveDocumentParser returns the parser selection and parser_config a newly
// created document should carry.
//
// The dataset's selection governs every file family its config declares; a file
// the selection does not declare is handed to the pipeline that owns its family
// (picture / audio / presentation / email), and failing that to the catch-all
// general pipeline, with the config reseeded from that template. A family the
// pipeline vocabulary cannot name cannot be judged against a declaration: the
// owning pipeline still takes the file, and with no owner (rtf, wps, ...) the
// dataset's choice is honored. The row then matches the pipeline that actually
// runs it: document parser_config drives both the parser-gap validation and the
// runtime override params, and a row left on a parser that cannot run its file
// is reported as unsupported by its own type. An unchanged parser keeps its
// config, and on a DSL failure the selection and config are kept: a registry
// lookup must not fail an upload, and a half-switched row (new parser, old
// config) is the inconsistent state this function exists to avoid.
func resolveDocumentParser(ctx context.Context, kb *entity.Knowledgebase, filename string, filetype utility.FileType, base entity.JSONMap) (*service.ParserSelection, entity.JSONMap) {
	selection := service.CurrentSelection(kb.ParserID, kb.PipelineID)
	family := componentpkg.ParserFileFamily(utility.GetFileExtension(filename))
	if family != "" && selectionGovernsFamily(ctx, selection, kb.ParserConfig, family) {
		return selection, base
	}

	target := dedicatedDocumentParserID(filetype, filename)
	if target == "" {
		if family == "" {
			return selection, base
		}
		target = generalParserID
	}
	if selection.IsBuiltIn() && selection.ParserID == target {
		return selection, base
	}
	if rebuilt, ok := rebuildParserConfig(ctx, kb, target, filename, base); ok {
		return &service.ParserSelection{Mode: service.ParseModeBuiltIn, ParserID: target}, rebuilt
	}
	return selection, base
}

// rebuildParserConfig reseeds a document's parser_config from the target
// built-in pipeline's DSL. It reports false when the DSL cannot be loaded, so
// the caller keeps the dataset's selection instead of writing a half-switched
// row.
func rebuildParserConfig(ctx context.Context, kb *entity.Knowledgebase, target, filename string, base entity.JSONMap) (entity.JSONMap, bool) {
	dslJSON, err := service.LoadPipelineDSL(ctx, false, target, nil)
	if err != nil {
		common.Warn("document: target pipeline DSL unavailable, keeping dataset selection",
			zap.String("parser_id", target), zap.String("filename", filename), zap.Error(err))
		return nil, false
	}
	raw := map[string]interface{}(base)
	cleaned := pipelinepkg.BuildParserConfig(dslJSON, raw)
	// The dataset-level metadata group is parser-independent; keep it so the
	// target pipeline's Extractor node inherits the dataset setting instead of
	// falling back to disabled.
	if meta, ok := raw["metadata"]; ok {
		cleaned["metadata"] = meta
	}
	pipelinepkg.ApplyParentChildChunkerConfig(cleaned, raw)
	if tenant, tenantErr := dao.NewTenantDAO().GetByID(ctx, dao.DB, kb.TenantID); tenantErr == nil && tenant != nil {
		cleaned = service.ApplyComponentScopedParserConfig(cleaned, tenant.LLMID)
	}
	return cleaned, true
}

// applyDatasetParserConfig rewrites a document's parser_config from the
// dataset's current parser_config.
//
// A document is seeded with a full copy of the dataset config when it is
// uploaded, and the ingestion pipeline runs that copy as its override params
// (see runPipelineWithDSL). The copy is therefore a snapshot: editing the
// dataset config afterwards — a new chunk size, a new parser option — changes
// nothing for files that already exist until the snapshot is refreshed. This
// is what the re-parse "apply dataset config" option does.
//
// The rebuild runs against the document's OWN selection so a file that was
// pointed at a different parser keeps its own component set: the dataset's
// component IDs do not exist in that DSL and BuildParserConfig drops them.
// Such a file is skipped entirely rather than being reset to its DSL defaults.
func (s *DocumentService) applyDatasetParserConfig(ctx context.Context, doc *entity.Document, kb *entity.Knowledgebase) error {
	if doc == nil || kb == nil || len(kb.ParserConfig) == 0 {
		return nil
	}
	if !documentFollowsDatasetSelection(doc, kb) {
		return nil
	}
	isPipeline := doc.PipelineID != nil && strings.TrimSpace(*doc.PipelineID) != ""
	dslJSON, err := service.LoadPipelineDSL(ctx, isPipeline, doc.ParserID, doc.PipelineID)
	if err != nil {
		return fmt.Errorf("load pipeline dsl for document %s: %w", doc.ID, err)
	}
	raw := map[string]interface{}(kb.ParserConfig)
	rebuilt := pipelinepkg.BuildParserConfig(dslJSON, raw)
	// The dataset-level metadata group is parser-independent; keep it so the
	// document's Extractor node inherits the dataset setting instead of falling
	// back to disabled (same carry as rebuildParserConfig).
	if meta, ok := raw["metadata"]; ok {
		rebuilt["metadata"] = meta
	}
	pipelinepkg.ApplyParentChildChunkerConfig(rebuilt, raw)
	if tenant, tenantErr := dao.NewTenantDAO().GetByID(ctx, dao.DB, kb.TenantID); tenantErr == nil && tenant != nil {
		rebuilt = service.ApplyComponentScopedParserConfig(rebuilt, tenant.LLMID)
	}
	if err := s.documentDAO.UpdateByID(ctx, dao.DB, doc.ID, map[string]interface{}{
		"parser_config": rebuilt,
	}); err != nil {
		return fmt.Errorf("update parser_config for document %s: %w", doc.ID, err)
	}
	doc.ParserConfig = rebuilt
	return nil
}

// documentFollowsDatasetSelection reports whether the document still runs the
// dataset's parser or pipeline. A file switched to another parser through the
// per-document "change parser" flow owns its own config, so the dataset's
// settings must not overwrite it.
func documentFollowsDatasetSelection(doc *entity.Document, kb *entity.Knowledgebase) bool {
	if !strings.EqualFold(strings.TrimSpace(doc.ParserID), strings.TrimSpace(kb.ParserID)) {
		return false
	}
	return pipelineSelectionID(doc.PipelineID) == pipelineSelectionID(kb.PipelineID)
}

// pipelineSelectionID normalizes an optional canvas id for comparison: nil and
// the empty string both mean "builtin parser".
func pipelineSelectionID(id *string) string {
	if id == nil {
		return ""
	}
	return strings.TrimSpace(*id)
}
