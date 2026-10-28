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

package service

import (
	"testing"

	"ragflow/internal/entity"
)

// Regression test for the search page's "103 model configuration unavailable".
//
// The completion path used to hand the caller's user id to the model factory as
// if it were the tenant id. That only works when a user occupies a tenant of
// their own; in a multi-member tenant it produces
//
//	tenant <user id> has no access to provider owned by tenant <tenant id>
//
// so the tenant must always come from user_tenant, never from the user id.
func TestResolveTenantIDForUserReturnsTenantNotUserID(t *testing.T) {
	testDB := setupServiceTestDB(t)
	pushServiceDB(t, testDB)

	const (
		tenantID = "3823be5cc5fc4172a0271118d0c612ab"
		ownerID  = "e8e6e282737f4dc9b71a48003a3f0449"
		memberID = "4344bfbb2a724ef996c3942041fefc7a"
	)

	enabled := true
	if err := testDB.Create(&entity.Tenant{ID: tenantID, Enabled: &enabled}).Error; err != nil {
		t.Fatalf("create tenant: %v", err)
	}

	status := string(entity.StatusValid)
	memberships := []struct {
		id     string
		userID string
		role   string
	}{
		{"ut-owner", ownerID, "owner"},
		{"ut-member", memberID, "normal"},
	}
	for _, membership := range memberships {
		if err := testDB.Create(&entity.UserTenant{
			ID:       membership.id,
			UserID:   membership.userID,
			TenantID: tenantID,
			Role:     membership.role,
			Status:   &status,
		}).Error; err != nil {
			t.Fatalf("create user_tenant %s: %v", membership.id, err)
		}
	}

	// Both the owner and a plain member must resolve to the tenant they belong
	// to; neither may fall back to their own user id.
	for _, membership := range memberships {
		got := resolveTenantIDForUser(t.Context(), membership.userID)
		if got != tenantID {
			t.Fatalf("resolveTenantIDForUser(%q) = %q, want %q", membership.userID, got, tenantID)
		}
	}
}

// A user with no membership must not be handed back as their own tenant. Empty
// makes the model lookup fail loudly instead of silently reading someone else's
// configuration.
func TestResolveTenantIDForUserWithoutMembershipIsEmpty(t *testing.T) {
	testDB := setupServiceTestDB(t)
	pushServiceDB(t, testDB)

	const orphanUserID = "user-without-tenant"
	if got := resolveTenantIDForUser(t.Context(), orphanUserID); got != "" {
		t.Fatalf("resolveTenantIDForUser(%q) = %q, want empty", orphanUserID, got)
	}
}
