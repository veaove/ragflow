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
	"context"
	"errors"
	"testing"

	"ragflow/internal/dao"
	"ragflow/internal/entity"
	"ragflow/internal/permission"
)

// Fixtures for the vocabulary access tests. The tenant/role layout mirrors the
// case this was written for: `member` is a normal member of the knowledge
// base's tenant while owning a tenant of their own — exactly the shape that
// used to fail, because the tenant was resolved from the caller instead of from
// the base.
const (
	synTenantKB       = "tenant-kb"
	synTenantMemberIn = "user-member" // doubles as the member's own tenant id
	synTenantOther    = "tenant-other"

	synOwner     = "user-owner"
	synMember    = "user-member"
	synOutsider  = "user-outsider"
	synKBPrivate = "kb-private"
	synKBTeam    = "kb-team"
	synKBMissing = "kb-does-not-exist"
)

// setupSynonymAccessFixtures builds a database with
//
//	tenant-kb     owned by synOwner, with synMember as a normal member
//	user-member   a tenant of its own, owned by synMember
//	tenant-other  owned by synOutsider, who has no access to either base
//
// kb-private keeps the legacy `permission=me` column set to private and relies
// on the resource_grant row that the console writes when a base is shared with
// the team; kb-team is tenant-visible through that same column.
func setupSynonymAccessFixtures(t *testing.T) *SynonymService {
	t.Helper()

	db := setupServiceTestDB(t)
	if err := db.AutoMigrate(
		&entity.ResourceGrant{},
		&entity.SynonymGroup{},
		&entity.SynonymWord{},
	); err != nil {
		t.Fatalf("failed to migrate synonym tables: %v", err)
	}
	pushServiceDB(t, db)

	memberships := []entity.UserTenant{
		{ID: "ut-owner", UserID: synOwner, TenantID: synTenantKB, Role: "owner", Status: sptr("1")},
		{ID: "ut-member", UserID: synMember, TenantID: synTenantKB, Role: "normal", Status: sptr("1")},
		// The member owns a tenant of their own. The buggy resolver returned this
		// one, looked the base up under it, missed, and reported the miss as
		// "synonym group not found".
		{ID: "ut-member-own", UserID: synMember, TenantID: synTenantMemberIn, Role: "owner", Status: sptr("1")},
		{ID: "ut-outsider", UserID: synOutsider, TenantID: synTenantOther, Role: "owner", Status: sptr("1")},
	}
	if err := db.Create(&memberships).Error; err != nil {
		t.Fatalf("failed to seed memberships: %v", err)
	}

	bases := []entity.Knowledgebase{
		{
			ID: synKBPrivate, TenantID: synTenantKB, Name: "kb-private",
			CreatedBy: synOwner, Permission: string(entity.TenantPermissionMe),
			Status: sptr(string(entity.StatusValid)),
		},
		{
			ID: synKBTeam, TenantID: synTenantKB, Name: "kb-team",
			CreatedBy: synOwner, Permission: string(entity.TenantPermissionTeam),
			Status: sptr(string(entity.StatusValid)),
		},
	}
	if err := db.Create(&bases).Error; err != nil {
		t.Fatalf("failed to seed knowledge bases: %v", err)
	}

	// Sharing a private base with the team is stored as a team grant, which is
	// the only thing that can widen a private dataset.
	grant := entity.ResourceGrant{
		ID: "grant-1", TenantID: synTenantKB,
		ResourceKind: string(permission.ResourceKindDataset), ResourceID: synKBPrivate,
		SubjectKind: entity.GrantSubjectTeam,
	}
	if err := db.Create(&grant).Error; err != nil {
		t.Fatalf("failed to seed grant: %v", err)
	}

	return NewSynonymService()
}

// TestResolveTenantUsesKnowledgeBaseTenant is the regression test for the
// vocabulary page reporting "synonym group not found" to a normal member of the
// base's tenant: the tenant must come from the base, and the caller is
// authorized against the base, not against a tenant they happen to own.
func TestResolveTenantUsesKnowledgeBaseTenant(t *testing.T) {
	svc := setupSynonymAccessFixtures(t)
	ctx := context.Background()

	cases := []struct {
		name      string
		userID    string
		datasetID string
		wantErr   error
	}{
		{name: "tenant owner reads a private base", userID: synOwner, datasetID: synKBPrivate},
		{name: "normal member of the base tenant reads a private base", userID: synMember, datasetID: synKBPrivate},
		{name: "normal member of the base tenant reads a team base", userID: synMember, datasetID: synKBTeam},
		{name: "outsider is refused", userID: synOutsider, datasetID: synKBPrivate, wantErr: ErrDatasetNotFound},
		{name: "outsider is refused on a team base", userID: synOutsider, datasetID: synKBTeam, wantErr: ErrDatasetNotFound},
		{name: "missing base is reported as missing", userID: synMember, datasetID: synKBMissing, wantErr: ErrDatasetNotFound},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tenantID, err := svc.resolveTenant(ctx, tc.userID, tc.datasetID)
			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Fatalf("err = %v, want %v", err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if tenantID != synTenantKB {
				t.Fatalf("tenant = %q, want %q (the base's tenant, not the caller's)", tenantID, synTenantKB)
			}
		})
	}
}

// TestListSynonymGroupsForTenantMember locks the user-visible behaviour: a
// normal member of the base's tenant sees the vocabulary list (empty, not an
// error) and the groups they create are stored under the base's tenant so
// retrieval — which loads the dictionary with that tenant — can find them.
func TestListSynonymGroupsForTenantMember(t *testing.T) {
	svc := setupSynonymAccessFixtures(t)
	ctx := context.Background()

	groups, err := svc.ListSynonymGroups(ctx, synMember, synKBPrivate, "")
	if err != nil {
		t.Fatalf("list for a tenant member failed: %v", err)
	}
	if len(groups) != 0 {
		t.Fatalf("expected an empty vocabulary, got %d groups", len(groups))
	}

	created, err := svc.CreateSynonymGroup(ctx, synMember, synKBPrivate, CreateSynonymGroupRequest{
		Name:  "退款",
		Words: []SynonymWordInput{{Word: "退款", IsPrimary: true}, {Word: "退钱"}},
	})
	if err != nil {
		t.Fatalf("create for a tenant member failed: %v", err)
	}
	if created.TenantID != synTenantKB {
		t.Fatalf("group tenant = %q, want %q (retrieval loads the dictionary with the base's tenant)",
			created.TenantID, synTenantKB)
	}

	groups, err = svc.ListSynonymGroups(ctx, synMember, synKBPrivate, "")
	if err != nil {
		t.Fatalf("list after create failed: %v", err)
	}
	if len(groups) != 1 || groups[0].ID != created.ID {
		t.Fatalf("created group is not listed: %#v", groups)
	}

	// The same member, addressed through a group id instead of a dataset id.
	group, err := svc.GetSynonymGroup(ctx, synMember, created.ID)
	if err != nil {
		t.Fatalf("get by member failed: %v", err)
	}
	if group.WordCount != 2 {
		t.Fatalf("word count = %d, want 2", group.WordCount)
	}

	// Someone outside the base's tenant must not reach the row at all, and the
	// answer must not distinguish "denied" from "missing".
	if _, err := svc.GetSynonymGroup(ctx, synOutsider, created.ID); !errors.Is(err, ErrDatasetNotFound) {
		t.Fatalf("outsider get err = %v, want ErrDatasetNotFound", err)
	}
	if err := svc.DeleteSynonymGroup(ctx, synOutsider, created.ID); !errors.Is(err, ErrDatasetNotFound) {
		t.Fatalf("outsider delete err = %v, want ErrDatasetNotFound", err)
	}
	if _, err := svc.CreateSynonymGroup(ctx, synOutsider, synKBPrivate, CreateSynonymGroupRequest{
		Name:  "x",
		Words: []SynonymWordInput{{Word: "a", IsPrimary: true}, {Word: "b"}},
	}); !errors.Is(err, ErrDatasetNotFound) {
		t.Fatalf("outsider create err = %v, want ErrDatasetNotFound", err)
	}

	// A member can edit and delete through the group-id endpoints too.
	if _, err := svc.UpdateSynonymGroup(ctx, synMember, created.ID, UpdateSynonymGroupRequest{
		Words: &[]SynonymWordInput{{Word: "退款", IsPrimary: true}, {Word: "退钱"}, {Word: "返还"}},
	}); err != nil {
		t.Fatalf("update by member failed: %v", err)
	}
	if err := svc.DeleteSynonymGroup(ctx, synMember, created.ID); err != nil {
		t.Fatalf("delete by member failed: %v", err)
	}
}

// TestResolveGroupRejectsTenantMismatch covers a row whose stored tenant no
// longer matches its base: it must not become writable under the base's scope.
func TestResolveGroupRejectsTenantMismatch(t *testing.T) {
	svc := setupSynonymAccessFixtures(t)

	stale := &entity.SynonymGroup{
		ID: "group-stale", TenantID: synTenantOther, DatasetID: synKBPrivate,
		Name: "stale", Domain: entity.SynonymDomainFund,
		Scope: entity.SynonymScopeKB, GroupType: entity.SynonymGroupTypeSynonym,
		Status: entity.SynonymStatusLive,
	}
	if err := svc.synonymDAO.CreateGroup(context.Background(), dao.DB, stale); err != nil {
		t.Fatalf("failed to seed stale group: %v", err)
	}

	if _, err := svc.GetSynonymGroup(context.Background(), synMember, stale.ID); !errors.Is(err, ErrSynonymGroupNotFound) {
		t.Fatalf("err = %v, want ErrSynonymGroupNotFound", err)
	}
}
