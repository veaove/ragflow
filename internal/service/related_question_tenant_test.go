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

// Regression test for "103" raised by the related-search call on the search
// page.
//
// Related questions are fetched in parallel with the answer, so this one fails
// on every single question, not just occasionally. The generator used to build
// ModelAccess{TenantID: userID}, which leaves UserID empty; the factory then
// takes the strict branch and compares the provider's tenant with a personal
// id, producing
//
//	tenant <user id> has no access to provider owned by tenant <tenant id>
//
// Both fields must be filled: TenantID from user_tenant so the provider lookup
// finds the right rows, UserID so the factory runs the permission check that
// recognises tenant members instead of the raw owner comparison.
func TestRelatedQuestionsModelAccessUsesRealTenant(t *testing.T) {
	testDB := setupServiceTestDB(t)
	pushServiceDB(t, testDB)

	const (
		tenantID = "3823be5cc5fc4172a0271118d0c612ab"
		ownerID  = "e8e6e282737f4dc9b71a48003a3f0449"
	)

	enabled := true
	if err := testDB.Create(&entity.Tenant{ID: tenantID, Enabled: &enabled}).Error; err != nil {
		t.Fatalf("create tenant: %v", err)
	}
	status := string(entity.StatusValid)
	if err := testDB.Create(&entity.UserTenant{
		ID:       "ut-owner",
		UserID:   ownerID,
		TenantID: tenantID,
		Role:     "owner",
		Status:   &status,
	}).Error; err != nil {
		t.Fatalf("create user_tenant: %v", err)
	}

	access := relatedQuestionsModelAccess(t.Context(), ownerID)
	if access.TenantID != tenantID {
		t.Fatalf("TenantID = %q, want the membership tenant %q", access.TenantID, tenantID)
	}
	if access.UserID != ownerID {
		t.Fatalf("UserID = %q, want the caller %q", access.UserID, ownerID)
	}
}
