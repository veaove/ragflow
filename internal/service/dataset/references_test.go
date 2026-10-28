package dataset

import (
	"strings"
	"testing"

	"ragflow/internal/entity"
)

func TestJSONColumnContains(t *testing.T) {
	const datasetID = "0123456789abcdef0123456789abcdef"

	tests := []struct {
		name string
		raw  string
		want bool
	}{
		{
			name: "kb_ids array holds the dataset",
			raw:  `["` + datasetID + `","feddba9876543210fedcba9876543210"]`,
			want: true,
		},
		{
			name: "canvas dsl holds the dataset in a retrieval node",
			raw:  `{"components":[{"obj":{"component_name":"Retrieval","params":{"kb_ids":["` + datasetID + `"]}}}]}`,
			want: true,
		},
		{
			name: "other dataset ids do not match",
			raw:  `["feddba9876543210fedcba9876543210"]`,
			want: false,
		},
		{
			// A LIKE query matching on the id prefix must not be reported as a
			// reference once the raw value is checked.
			name: "prefix of the id is not a reference",
			raw:  `["0123456789abcdef0123456789abcde"]`,
			want: false,
		},
		{
			name: "empty column",
			raw:  "",
			want: false,
		},
		{
			name: "double encoded json column",
			raw:  `"[\"` + datasetID + `\"]"`,
			want: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := jsonColumnContains(tt.raw, `"`+datasetID+`"`); got != tt.want {
				t.Fatalf("jsonColumnContains(%q) = %v, want %v", tt.raw, got, tt.want)
			}
		})
	}
}

func TestDatasetReferencedErrorNamesEveryBinding(t *testing.T) {
	err := &DatasetReferencedError{References: []DatasetReference{
		{Kind: DatasetReferenceKindChat, ID: "chat-1", Name: "客服助手"},
		{Kind: DatasetReferenceKindAgent, ID: "agent-1"},
	}}

	message := err.Error()
	for _, want := range []string{"客服助手", "agent-1", "unbind it before disabling"} {
		if !strings.Contains(message, want) {
			t.Fatalf("error message %q is missing %q", message, want)
		}
	}
}

// TestFindDatasetReferencesReportsEveryAppKind pins the lookup that backs both
// the disable guard and the dataset overview "apps" tab. Every app type keeps
// the binding in a different column — dialog.kb_ids, search.search_config.kb_ids,
// user_canvas.dsl and evaluation_datasets.kb_ids — and only rows that actually
// carry the dataset id may be reported.
func TestFindDatasetReferencesReportsEveryAppKind(t *testing.T) {
	db := setupServiceTestDB(t)
	pushServiceDB(t, db)

	const (
		tenantID   = "tenant-1"
		datasetID  = "0123456789abcdef0123456789abcdef"
		otherID    = "feddba9876543210fedcba9876543210"
		ownerID    = "user-in-tenant"
		outsiderID = "user-elsewhere"
	)
	ensureDatasetTestMembership(t, ownerID, tenantID, "owner")

	exec := func(query string, args ...any) {
		t.Helper()
		if err := db.Exec(query, args...).Error; err != nil {
			t.Fatalf("seed %q: %v", query, err)
		}
	}

	// Knowledge Q&A keeps the binding in dialog.kb_ids.
	exec(`INSERT INTO dialog (id, tenant_id, name, kb_ids, status, llm_id, llm_setting, prompt_config, do_refer)
		VALUES (?, ?, ?, ?, ?, '', '{}', '{}', '1')`, "chat-1", tenantID, "客服助手", `["`+datasetID+`"]`, "1")
	exec(`INSERT INTO dialog (id, tenant_id, name, kb_ids, status, llm_id, llm_setting, prompt_config, do_refer)
		VALUES (?, ?, ?, ?, ?, '', '{}', '{}', '1')`, "chat-2", tenantID, "别的知识库", `["`+otherID+`"]`, "1")

	// Knowledge search keeps it in search_config.kb_ids; legacy rows hold `{}`.
	exec(`INSERT INTO search (id, tenant_id, name, search_config, status, created_by)
		VALUES (?, ?, ?, ?, ?, ?)`, "search-1", tenantID, "知识搜索", `{"kb_ids":["`+datasetID+`"]}`, "1", ownerID)
	exec(`INSERT INTO search (id, tenant_id, name, search_config, status, created_by)
		VALUES (?, ?, ?, ?, ?, ?)`, "search-2", tenantID, "空配置", `{}`, "1", ownerID)

	// Agent canvases keep it in dsl; the tenant scope goes through user_tenant.
	exec(`INSERT INTO user_canvas (id, user_id, tenant_id, title, dsl, canvas_category)
		VALUES (?, ?, ?, ?, ?, ?)`, "canvas-1", ownerID, tenantID, "智能体A",
		`{"components":[{"obj":{"params":{"kb_ids":["`+datasetID+`"]}}}]}`, "agent_canvas")
	exec(`INSERT INTO user_canvas (id, user_id, tenant_id, title, dsl, canvas_category)
		VALUES (?, ?, ?, ?, ?, ?)`, "canvas-2", outsiderID, "other-tenant", "外租户的智能体",
		`{"components":[{"obj":{"params":{"kb_ids":["`+datasetID+`"]}}}]}`, "agent_canvas")

	exec(`INSERT INTO evaluation_datasets (id, tenant_id, name, kb_ids, created_by, create_time, update_time)
		VALUES (?, ?, ?, ?, ?, 0, 0)`, "eval-1", tenantID, "评估集", `["`+datasetID+`"]`, ownerID)

	refs, err := findDatasetReferences(t.Context(), db, &entity.Knowledgebase{ID: datasetID, TenantID: tenantID})
	if err != nil {
		t.Fatalf("findDatasetReferences: %v", err)
	}

	got := make(map[string]string, len(refs))
	for _, ref := range refs {
		got[ref.Kind+":"+ref.ID] = ref.Name
	}

	want := map[string]string{
		"chat:chat-1":       "客服助手",
		"search:search-1":   "知识搜索",
		"agent:canvas-1":    "智能体A",
		"evaluation:eval-1": "评估集",
	}
	for key, name := range want {
		gotName, ok := got[key]
		if !ok {
			t.Fatalf("references missing %s, got %#v", key, got)
		}
		if gotName != name {
			t.Fatalf("%s name = %q, want %q", key, gotName, name)
		}
	}
	// A row that only mentions another dataset, an empty search config and a
	// canvas owned by someone outside the tenant are not references.
	for _, key := range []string{"chat:chat-2", "search:search-2", "agent:canvas-2"} {
		if _, ok := got[key]; ok {
			t.Fatalf("%s must not be reported, got %#v", key, got)
		}
	}
}
