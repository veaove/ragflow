// Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package admin

import (
	"context"
	"testing"
	"time"

	"ragflow/internal/entity"
	"ragflow/internal/ingestion/testutil"
)

// TestListTenantsCountsOwnedResources pins the column each counter reads.
//
// The agent counter originally filtered user_canvas by tenant_id, a column that
// table does not have (canvases carry user_id, and the tenant id is the owner's
// user id). MySQL answered Error 1054, so the platform tenant list — a page in
// the admin console — failed outright. Running the same query against a real
// schema is what catches a column that only exists in the author's head.
func TestListTenantsCountsOwnedResources(t *testing.T) {
	db := testutil.SetupTestDB(t,
		&entity.Tenant{},
		&entity.UserTenant{},
		&entity.Knowledgebase{},
		&entity.UserCanvas{},
	)
	t.Cleanup(testutil.ReplaceDBForTest(t, db))
	ctx := context.Background()

	const tenantID = "tenant-1"
	statusValid := string(entity.StatusValid)
	firstName, secondName := "Tenant One", "Tenant Two"

	tenant := entity.Tenant{ID: tenantID, Name: &firstName, Status: &statusValid}
	if err := db.Create(&tenant).Error; err != nil {
		t.Fatalf("create tenant: %v", err)
	}
	// An extra tenant must not leak into the counts.
	if err := db.Create(&entity.Tenant{ID: "tenant-2", Name: &secondName, Status: &statusValid}).Error; err != nil {
		t.Fatalf("create second tenant: %v", err)
	}

	members := []entity.UserTenant{
		{ID: "m-1", UserID: "u-1", TenantID: tenantID, Role: "owner", InvitedBy: tenantID, Status: &statusValid},
		{ID: "m-2", UserID: "u-2", TenantID: tenantID, Role: "normal", InvitedBy: tenantID, Status: &statusValid},
		{ID: "m-3", UserID: "u-3", TenantID: "tenant-2", Role: "owner", InvitedBy: "tenant-2", Status: &statusValid},
	}
	for i := range members {
		if err := db.Create(&members[i]).Error; err != nil {
			t.Fatalf("create membership: %v", err)
		}
	}

	kbs := []entity.Knowledgebase{
		{ID: "kb-1", TenantID: tenantID, Name: "kb one"},
		{ID: "kb-2", TenantID: tenantID, Name: "kb two"},
		{ID: "kb-3", TenantID: "tenant-2", Name: "other tenant kb"},
	}
	for i := range kbs {
		if err := db.Create(&kbs[i]).Error; err != nil {
			t.Fatalf("create knowledgebase: %v", err)
		}
	}

	// Canvases belong to a user, not a tenant; the counter must join on user_id.
	titles := []string{"agent one", "agent two", "agent three", "member's agent"}
	canvases := []entity.UserCanvas{
		{ID: "c-1", UserID: tenantID, Title: &titles[0]},
		{ID: "c-2", UserID: tenantID, Title: &titles[1]},
		{ID: "c-3", UserID: tenantID, Title: &titles[2]},
		{ID: "c-4", UserID: "u-2", Title: &titles[3]},
	}
	for i := range canvases {
		if err := db.Create(&canvases[i]).Error; err != nil {
			t.Fatalf("create canvas: %v", err)
		}
	}

	svc := NewService()
	rows, total, err := svc.ListTenants(ctx, 1, 20, "", "", "")
	if err != nil {
		t.Fatalf("ListTenants: %v", err)
	}
	if total != 2 {
		t.Fatalf("total = %d, want 2", total)
	}
	var got *TenantListItem
	for i := range rows {
		if rows[i].ID == tenantID {
			got = &rows[i]
		}
	}
	if got == nil {
		t.Fatalf("tenant %s missing from %+v", tenantID, rows)
	}
	if got.MemberCount != 2 {
		t.Errorf("member_count = %d, want 2", got.MemberCount)
	}
	if got.KbCount != 2 {
		t.Errorf("kb_count = %d, want 2", got.KbCount)
	}
	// Three canvases are owned by the tenant id; the fourth belongs to another
	// member and must not be counted.
	if got.AgentCount != 3 {
		t.Errorf("agent_count = %d, want 3", got.AgentCount)
	}
	if got.Status != statusValid {
		t.Errorf("status = %q, want %q", got.Status, statusValid)
	}
}

// TestListTenantResourcesAgentsFiltersByUserID pins the column the agent
// drill-down reads.
//
// The drill-down originally filtered user_canvas by tenant_id — the same
// non-existent column that broke ListTenants — so clicking「智能体数」in the
// platform tenant list answered 500 (MySQL Error 1054). On a real schema the
// query has to go through user_id, and each row must carry its canvas type
// because the counter spans agents, chatflows, workflows and dataflow canvases.
func TestListTenantResourcesAgentsFiltersByUserID(t *testing.T) {
	db := testutil.SetupTestDB(t,
		&entity.Tenant{},
		&entity.UserCanvas{},
	)
	t.Cleanup(testutil.ReplaceDBForTest(t, db))
	ctx := context.Background()

	const tenantID = "tenant-1"
	statusValid := string(entity.StatusValid)
	tenantName := "Tenant One"
	if err := db.Create(&entity.Tenant{ID: tenantID, Name: &tenantName, Status: &statusValid}).Error; err != nil {
		t.Fatalf("create tenant: %v", err)
	}

	agentTitle, flowTitle, memberTitle := "agent one", "workflow one", "member agent"
	canvases := []entity.UserCanvas{
		{ID: "c-1", UserID: tenantID, Title: &agentTitle, CanvasCategory: entity.CanvasCategoryAgent},
		{ID: "c-2", UserID: tenantID, Title: &flowTitle, CanvasCategory: entity.CanvasCategoryWorkflow},
		{ID: "c-3", UserID: "u-2", Title: &memberTitle, CanvasCategory: entity.CanvasCategoryAgent},
	}
	for i := range canvases {
		if err := db.Create(&canvases[i]).Error; err != nil {
			t.Fatalf("create canvas: %v", err)
		}
	}

	svc := NewService()
	items, err := svc.ListTenantResources(ctx, tenantID, "agents")
	if err != nil {
		t.Fatalf("ListTenantResources(agents): %v", err)
	}
	// Only the tenant's own canvases; the member's one must not leak in,
	// otherwise the list would not match the agent_count the user clicked.
	if len(items) != 2 {
		t.Fatalf("len(items) = %d, want 2: %+v", len(items), items)
	}

	extraByName := map[string]string{}
	for _, item := range items {
		name, _ := item["name"].(string)
		extra, _ := item["extra"].(string)
		extraByName[name] = extra
	}
	if extraByName[agentTitle] != "智能体" {
		t.Errorf("extra for %q = %q, want 智能体", agentTitle, extraByName[agentTitle])
	}
	if extraByName[flowTitle] != "工作流" {
		t.Errorf("extra for %q = %q, want 工作流", flowTitle, extraByName[flowTitle])
	}
	if _, leaked := extraByName[memberTitle]; leaked {
		t.Errorf("member-owned canvas leaked into the drill-down: %+v", items)
	}

	// An unknown tenant is an explicit error, not a silent empty list.
	if _, err := svc.ListTenantResources(ctx, "missing", "agents"); err == nil {
		t.Error("ListTenantResources(missing tenant) = nil error, want tenant not found")
	}
}

// TestListTenantResourcesKBsShowsOperationalColumns pins the knowledge-base
// drill-down.
//
// Knowledge bases are the riskiest of the three resource types to summarise:
// every interesting field is either a code (parser_id, permission), a foreign id
// (embd_id, created_by) or a flag that is easy to confuse with another column
// (enabled vs status — the latter is the soft-delete marker). The agents branch
// already paid for getting a column name wrong with MySQL Error 1054, so the
// knowledge-base query gets the same treatment: run it against a real schema and
// assert each surfaced value, not just the row count.
func TestListTenantResourcesKBsShowsOperationalColumns(t *testing.T) {
	db := testutil.SetupTestDB(t,
		&entity.Tenant{},
		&entity.User{},
		&entity.Knowledgebase{},
	)
	t.Cleanup(testutil.ReplaceDBForTest(t, db))
	ctx := context.Background()

	const tenantID = "tenant-1"
	statusValid := string(entity.StatusValid)
	deleted := "0"
	tenantName := "Tenant One"
	if err := db.Create(&entity.Tenant{ID: tenantID, Name: &tenantName, Status: &statusValid}).Error; err != nil {
		t.Fatalf("create tenant: %v", err)
	}

	// u-2 has no nickname: the drill-down must fall back to the e-mail so the
	// creator column never renders empty.
	users := []entity.User{
		{ID: "u-1", Nickname: "Nick One", Email: "nick@example.com", IsAuthenticated: "1", IsActive: "1"},
		{ID: "u-2", Nickname: "", Email: "plain@example.com", IsAuthenticated: "1", IsActive: "1"},
	}
	for i := range users {
		if err := db.Create(&users[i]).Error; err != nil {
			t.Fatalf("create user: %v", err)
		}
	}

	// embd_id pointing at a tenant_model row that does not exist in this schema:
	// the model catalog is optional, so the column must degrade instead of
	// failing the whole list.
	missingModelID := "66efe49d791f41629de93675f4bf9a7c"
	created := time.Date(2026, 10, 20, 9, 30, 0, 0, time.Local)
	updated := time.Date(2026, 10, 24, 18, 5, 0, 0, time.Local)

	kbs := []entity.Knowledgebase{
		{
			ID: "kb-1", TenantID: tenantID, Name: "kb one", Permission: "me",
			EmbdID: "BAAI/bge-large-zh-v1.5@BAAI", ParserID: "qa", CreatedBy: "u-1",
			DocNum: 3, ChunkNum: 42,
			BaseModel: entity.BaseModel{CreateDate: &created, UpdateDate: &updated},
		},
		{
			ID: "kb-2", TenantID: tenantID, Name: "kb two", Permission: "me",
			EmbdID: missingModelID, ParserID: "general", CreatedBy: "u-2",
			DocNum: 50, ChunkNum: 58,
		},
		{
			ID: "kb-3", TenantID: "tenant-2", Name: "other tenant kb", Permission: "me",
			EmbdID: missingModelID, ParserID: "general", CreatedBy: "u-1",
		},
		{
			ID: "kb-4", TenantID: tenantID, Name: "soft deleted kb", Permission: "me",
			EmbdID: missingModelID, ParserID: "general", CreatedBy: "u-1", Status: &deleted,
		},
	}
	for i := range kbs {
		if err := db.Create(&kbs[i]).Error; err != nil {
			t.Fatalf("create knowledgebase: %v", err)
		}
	}
	// enabled is a plain pointer bool with a DB default; write it explicitly so
	// the "disabled" case does not depend on how the default tag is rendered.
	if err := db.Model(&entity.Knowledgebase{}).Where("id = ?", "kb-2").Update("enabled", false).Error; err != nil {
		t.Fatalf("disable kb-2: %v", err)
	}

	svc := NewService()
	items, err := svc.ListTenantResources(ctx, tenantID, "kbs")
	if err != nil {
		t.Fatalf("ListTenantResources(kbs): %v", err)
	}
	// kb-3 belongs to another tenant and kb-4 is soft deleted (status = '0'):
	// neither may show up, otherwise the list will not match kb_count.
	if len(items) != 2 {
		t.Fatalf("len(items) = %d, want 2: %+v", len(items), items)
	}

	cellsByName := map[string]map[string]string{}
	for _, item := range items {
		name, _ := item["name"].(string)
		cells, _ := item["cells"].(map[string]string)
		cellsByName[name] = cells
	}

	want := map[string]map[string]string{
		"kb one": {
			"docs":      "3",
			"chunks":    "42",
			"parser":    "问答",
			"embedding": "BAAI/bge-large-zh-v1.5",
			"status":    "enabled",
			"creator":   "Nick One",
			"created":   "2026-10-20",
			"updated":   "2026-10-24 18:05",
		},
		"kb two": {
			"docs":   "50",
			"chunks": "58",
			"parser": "通用",
			// 未收录在模型目录里的 id 不能原样甩给用户。
			"embedding": "已删除的模型",
			"status":    "disabled",
			// 没昵称的账号回落到邮箱。
			"creator": "plain@example.com",
		},
	}
	for name, wantCells := range want {
		got, ok := cellsByName[name]
		if !ok {
			t.Errorf("%q missing from drill-down: %+v", name, items)
			continue
		}
		for key, wantValue := range wantCells {
			if got[key] != wantValue {
				t.Errorf("%s.cells[%s] = %q, want %q", name, key, got[key], wantValue)
			}
		}
	}
	if _, leaked := cellsByName["other tenant kb"]; leaked {
		t.Errorf("other tenant's knowledge base leaked into the drill-down: %+v", items)
	}
	if _, leaked := cellsByName["soft deleted kb"]; leaked {
		t.Errorf("soft-deleted knowledge base leaked into the drill-down: %+v", items)
	}
}
