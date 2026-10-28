package pipeline

import (
	"bytes"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

const builtinTemplatePrefix = "ingestion_pipeline_"

// builtinParserOrder matches Python's settings.PARSERS order, projected onto
// the canonical builtin templates shipped by Go. Templates not in this list
// are appended deterministically after the shared parser methods.
var builtinParserOrder = map[string]int{
	"general":      0,
	"qa":           1,
	"manual":       2,
	"table":        3,
	"paper":        4,
	"book":         5,
	"laws":         6,
	"presentation": 7,
	"picture":      8,
	"one":          9,
	"audio":        10,
	"email":        11,
}

//go:embed template/ingestion_pipeline_*.json
var builtinTemplateFS embed.FS

// BuiltinPipelineMeta is the API-facing metadata for one built-in ingestion
// pipeline template. The ParserID field is the value stored in the dataset's
// parser_id column for built-in pipelines.
// JSON tag "id" aligns with AgentItem.id for format consistency with
// GET /api/v1/agents?canvas_category=dataflow_canvas.
//
// Title/Description carry the English text so they stay the canonical,
// language-independent values used for matching and copy operations.
// TitleI18N/DescriptionI18N carry every translation declared by the template so
// the web client can render the catalog in the active UI language; it picks the
// entry for the current locale and falls back to the English Title/Description
// when a language has no translation.
type BuiltinPipelineMeta struct {
	ParserID        string            `json:"id"`
	Title           string            `json:"title"`
	Description     string            `json:"description,omitempty"`
	Filename        string            `json:"filename"`
	TitleI18N       map[string]string `json:"title_i18n,omitempty"`
	DescriptionI18N map[string]string `json:"description_i18n,omitempty"`
}

// BuiltinPipelineListResponse wraps the builtin pipeline list for
// format consistency with ListAgentsResponse.
type BuiltinPipelineListResponse struct {
	BuiltinPipelines []*BuiltinPipelineMeta `json:"canvas"`
	Total            int64                  `json:"total"`
}

type BuiltinPipeline struct {
	BuiltinPipelineMeta
	DSL map[string]any `json:"-"`
}

type Registry struct {
	templates map[string]*BuiltinPipeline
	// aliases maps legacy parser_id values to their canonical builtin
	// pipeline id. Example: "naive" -> "general". Aliases keep existing
	// dataset rows runnable after the hardcoded parser list is removed;
	// they are hidden from List/Refs so the front end only sees canonical
	// templates.
	aliases map[string]string
	list    []*BuiltinPipelineMeta
}

var (
	defaultRegistryOnce sync.Once
	defaultRegistry     *Registry
	defaultRegistryErr  error
)

func NewRegistryFromDir(dir string) (*Registry, error) {
	return NewRegistryFromFS(os.DirFS(dir), ".")
}

func DefaultRegistry() (*Registry, error) {
	defaultRegistryOnce.Do(func() {
		defaultRegistry, defaultRegistryErr = NewRegistryFromFS(builtinTemplateFS, "template")
	})
	return defaultRegistry, defaultRegistryErr
}

func NewRegistryFromFS(files fs.FS, dir string) (*Registry, error) {
	entries, err := fs.ReadDir(files, dir)
	if err != nil {
		return nil, err
	}
	templates := make(map[string]*BuiltinPipeline)
	list := make([]*BuiltinPipelineMeta, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !strings.HasPrefix(name, builtinTemplatePrefix) || !strings.HasSuffix(name, ".json") {
			continue
		}
		raw, err := fs.ReadFile(files, filepath.Join(dir, name))
		if err != nil {
			return nil, err
		}
		tpl, err := parseTemplate(name, raw)
		if err != nil {
			return nil, err
		}
		if _, exists := templates[tpl.ParserID]; exists {
			return nil, fmt.Errorf("duplicate parser_id %q", tpl.ParserID)
		}
		templates[tpl.ParserID] = tpl
		meta := tpl.BuiltinPipelineMeta
		list = append(list, &meta)
	}
	sort.SliceStable(list, func(i, j int) bool {
		iOrder, iKnown := builtinParserOrder[list[i].ParserID]
		jOrder, jKnown := builtinParserOrder[list[j].ParserID]
		if iKnown && jKnown {
			return iOrder < jOrder
		}
		if iKnown != jKnown {
			return iKnown
		}
		return list[i].ParserID < list[j].ParserID
	})
	return &Registry{templates: templates, aliases: builtinAliases(), list: list}, nil
}

// builtinAliases returns the legacy parser_id -> canonical pipeline id
// mappings. "naive" is the historical default parser; its behavior now
// lives in the "general" builtin template, so dataset rows storing
// parser_id="naive" resolve to "general" at lookup time.
func builtinAliases() map[string]string {
	return map[string]string{
		"naive": "general",
	}
}

// canonicalRef resolves a possibly-aliased ref to its canonical pipeline id.
// Unknown refs are returned unchanged so the caller can distinguish "alias
// target missing" from "not an alias".
func (r *Registry) canonicalRef(ref string) string {
	if r == nil {
		return ref
	}
	if canonical, ok := r.aliases[ref]; ok {
		return canonical
	}
	return ref
}

func (r *Registry) List() *BuiltinPipelineListResponse {
	if r == nil {
		return nil
	}
	out := make([]*BuiltinPipelineMeta, 0, len(r.list))
	for _, item := range r.list {
		if item == nil {
			continue
		}
		cp := *item
		out = append(out, &cp)
	}
	return &BuiltinPipelineListResponse{
		BuiltinPipelines: out,
		Total:            int64(len(out)),
	}
}

func (r *Registry) Refs() []string {
	if r == nil {
		return nil
	}
	out := make([]string, 0, len(r.list))
	for _, item := range r.list {
		if item == nil {
			continue
		}
		out = append(out, item.ParserID)
	}
	return out
}

func (r *Registry) Get(ref string) (*BuiltinPipeline, bool) {
	if r == nil {
		return nil, false
	}
	ref = strings.TrimSpace(ref)
	tpl, ok := r.templates[r.canonicalRef(ref)]
	if !ok || tpl == nil {
		return nil, false
	}
	cp := *tpl
	return &cp, true
}

// IsValid reports whether ref names a builtin template, either directly or
// through an alias. Use this for parser_id validation so legacy values
// (e.g. "naive") stay accepted after the hardcoded allow-list is removed.
func (r *Registry) IsValid(ref string) bool {
	if r == nil {
		return false
	}
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return false
	}
	_, ok := r.templates[r.canonicalRef(ref)]
	return ok
}

func parseTemplate(filename string, raw []byte) (*BuiltinPipeline, error) {
	// Strip UTF-8 BOM if present. Windows editors (including PowerShell) often
	// add one, and Go's json.Decoder does not skip it — the entire registry
	// load fails when a single template carries a BOM.
	raw = bytes.TrimPrefix(raw, []byte{0xEF, 0xBB, 0xBF})
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var data map[string]any
	if err := decoder.Decode(&data); err != nil {
		return nil, err
	}
	ref := builtinRefFromFilename(filename)
	if ref == "" {
		return nil, fmt.Errorf("invalid builtin filename %q", filename)
	}
	dsl, ok := data["dsl"].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("builtin template %q missing dsl", filename)
	}
	tpl := &BuiltinPipeline{
		BuiltinPipelineMeta: BuiltinPipelineMeta{
			ParserID:        ref,
			Title:           englishText(data["title"], ref),
			Description:     englishText(data["description"], ""),
			Filename:        filename,
			TitleI18N:       localizedText(data["title"]),
			DescriptionI18N: localizedText(data["description"]),
		},
		DSL: dsl,
	}
	return tpl, nil
}

func builtinRefFromFilename(filename string) string {
	name := strings.TrimSuffix(filename, filepath.Ext(filename))
	name = strings.TrimPrefix(name, builtinTemplatePrefix)
	if name == filename || name == "" {
		return ""
	}
	return name
}

// LoadBuiltinDSL returns the canonical DSL JSON for a builtin parser_id,
// resolving aliases transparently. "naive" returns the "general" template.
func LoadBuiltinDSL(parserID string) (string, error) {
	r, err := DefaultRegistry()
	if err != nil {
		return "", fmt.Errorf("builtin pipeline registry: %w", err)
	}
	tpl, ok := r.Get(parserID)
	if !ok {
		return "", fmt.Errorf("unknown builtin parser_id: %s", parserID)
	}
	dslBytes, err := json.Marshal(tpl.DSL)
	if err != nil {
		return "", fmt.Errorf("marshal builtin DSL %s: %w", parserID, err)
	}
	return string(dslBytes), nil
}

// englishText extracts the English text from a localized template field. It
// backs the canonical Title/Description, which stay English so server-side
// matching and the copy flow never depend on the requester's locale. The
// front end renders its own translation out of TitleI18N/DescriptionI18N.
// When the field is a plain string it is returned as-is; when "en" is missing,
// any available translation is used as a last resort.
func englishText(v any, fallback string) string {
	switch x := v.(type) {
	case string:
		return strings.TrimSpace(x)
	case map[string]any:
		if s, ok := x["en"].(string); ok && strings.TrimSpace(s) != "" {
			return strings.TrimSpace(s)
		}
		for _, raw := range x {
			if s, ok := raw.(string); ok && strings.TrimSpace(s) != "" {
				return strings.TrimSpace(s)
			}
		}
	}
	return fallback
}

// localizedText collects every translation of a localized template field so the
// API can serve the catalog in the caller's language. Keys are normalised to
// their bare language subtag ("zh-Hans" => "zh") because the web client's
// locale codes carry script/region subtags the templates do not use. A plain
// string field yields nil: there is nothing to choose between.
func localizedText(v any) map[string]string {
	m, ok := v.(map[string]any)
	if !ok || len(m) == 0 {
		return nil
	}
	out := make(map[string]string, len(m))
	for lang, raw := range m {
		s, ok := raw.(string)
		if !ok {
			continue
		}
		if s = strings.TrimSpace(s); s == "" {
			continue
		}
		key := normalizeTemplateLang(lang)
		if key == "" {
			continue
		}
		// 优先级：key 本身就是规范形式（"zh"、"en"）> 需要归一化的（"zh-Hans"）。
		// map 遍历无序，若两者都按"先到先得"，结果会随遍历顺序漂移 —— 先遇到
		// "zh-Hans" 就会把显式的 "zh" 挤掉（中文标题从"通用"变成"通用变体"）。
		// 规范形式总是覆盖，归一化形式只在空位时填，两种顺序都稳定。
		// "en" 同理：显式英文条目必须赢，TitleI18N["en"] 才和 Title 一致。
		if strings.EqualFold(strings.TrimSpace(lang), key) || out[key] == "" {
			out[key] = s
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// normalizeTemplateLang reduces a template language key to its bare lowercase
// subtag. "zh-Hans", "zh_Hant" and "ZH" all collapse to "zh", which is what the
// templates actually key on; an empty result means the key is unusable.
func normalizeTemplateLang(lang string) string {
	lang = strings.ToLower(strings.TrimSpace(lang))
	if lang == "" {
		return ""
	}
	if i := strings.IndexAny(lang, "-_"); i >= 0 {
		lang = lang[:i]
	}
	return lang
}
