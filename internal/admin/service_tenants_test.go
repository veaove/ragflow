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
	rows, total, err := svc.ListTenants(ctx, 1, 20, "", "")
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
