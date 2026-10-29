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
)

// countGroupsByStatus counts the vocabulary rows of a base in one state. The
// tests below assert on the stored rows, not only on what the list returns:
// the bug they cover was a row that stayed in the table after a discard.
func countGroupsByStatus(t *testing.T, datasetID, status string) int64 {
	t.Helper()
	var count int64
	if err := dao.DB.Model(&entity.SynonymGroup{}).
		Where("dataset_id = ?", datasetID).
		Where("status = ?", status).
		Count(&count).Error; err != nil {
		t.Fatalf("failed to count groups with status %q: %v", status, err)
	}
	return count
}

// seedGroup inserts a group directly, so a test can build a version chain
// without replaying publish.
func seedGroup(t *testing.T, id, datasetID, name, status, sourceGroupID string) *entity.SynonymGroup {
	t.Helper()
	group := &entity.SynonymGroup{
		ID:            id,
		TenantID:      synTenantKB,
		DatasetID:     datasetID,
		Name:          name,
		Domain:        entity.SynonymDomainFund,
		Scope:         entity.SynonymScopeKB,
		GroupType:     entity.SynonymGroupTypeSynonym,
		Status:        status,
		SourceGroupID: sourceGroupID,
		ChangeSetID:   "cs-seed",
	}
	if err := dao.NewSynonymDAO().CreateGroup(context.Background(), dao.DB, group); err != nil {
		t.Fatalf("failed to seed group %s: %v", id, err)
	}
	return group
}

// TestDiscardStagedEditLeavesNoGhost is the regression test for the vocabulary
// manager showing 已被新版本替换 after a discard in the change centre.
//
// A staged edit is a pending copy pointing at the live group it would replace.
// Discarding it used to mark that copy disabled — the same status a published
// replacement leaves behind — so the manager listed a history row claiming a
// replacement that never happened, while the live group was still untouched.
func TestDiscardStagedEditLeavesNoGhost(t *testing.T) {
	svc := setupSynonymAccessFixtures(t)
	ctx := context.Background()

	live, err := svc.CreateSynonymGroup(ctx, synOwner, synKBPrivate, CreateSynonymGroupRequest{
		Name:  "退款",
		Words: []SynonymWordInput{{Word: "退款", IsPrimary: true}, {Word: "退钱"}},
	})
	if err != nil {
		t.Fatalf("failed to create the live group: %v", err)
	}

	staged, err := svc.UpdateSynonymGroup(ctx, synOwner, live.ID, UpdateSynonymGroupRequest{
		Words:       &[]SynonymWordInput{{Word: "退款", IsPrimary: true}, {Word: "退钱"}, {Word: "返钱"}},
		ChangeSetID: "cs-discard",
	})
	if err != nil {
		t.Fatalf("failed to stage the edit: %v", err)
	}
	if staged.Status != entity.SynonymStatusPending || staged.SourceGroupID != live.ID {
		t.Fatalf("staged copy = {status:%q source:%q}, want a pending copy of %q",
			staged.Status, staged.SourceGroupID, live.ID)
	}

	if err := svc.synonymDAO.DiscardPendingByGroupIDs(ctx, dao.DB, synTenantKB, synKBPrivate, "cs-discard", nil); err != nil {
		t.Fatalf("discard failed: %v", err)
	}

	// The staged copy and its words must be gone, not flagged.
	if got := countGroupsByStatus(t, synKBPrivate, entity.SynonymStatusPending); got != 0 {
		t.Fatalf("pending groups after discard = %d, want 0", got)
	}
	if got := countGroupsByStatus(t, synKBPrivate, entity.SynonymStatusDisabled); got != 0 {
		t.Fatalf("disabled groups after discard = %d, want 0 (a discarded copy was never live)", got)
	}
	var orphanWords int64
	if err := dao.DB.Model(&entity.SynonymWord{}).
		Where("group_id = ?", staged.ID).
		Count(&orphanWords).Error; err != nil {
		t.Fatalf("failed to count words of the discarded copy: %v", err)
	}
	if orphanWords != 0 {
		t.Fatalf("words of the discarded copy = %d, want 0", orphanWords)
	}

	groups, err := svc.ListSynonymGroups(ctx, synOwner, synKBPrivate, "")
	if err != nil {
		t.Fatalf("list failed: %v", err)
	}
	if len(groups) != 1 || groups[0].ID != live.ID {
		t.Fatalf("groups after discard = %#v, want only the live group %q", groups, live.ID)
	}
	if groups[0].Status != entity.SynonymStatusLive {
		t.Fatalf("live group status = %q, want live", groups[0].Status)
	}
	if groups[0].WordCount != 2 {
		t.Fatalf("live group word count = %d, want 2 (discard must not touch the live words)",
			groups[0].WordCount)
	}
}

// TestEditSupersededVersionIsRefused covers the tab that was already open when
// someone else published a replacement: the row it points at is now history.
// A direct write would flip only the words live while the group stays disabled,
// so the edit would silently never reach retrieval.
func TestEditSupersededVersionIsRefused(t *testing.T) {
	svc := setupSynonymAccessFixtures(t)
	ctx := context.Background()

	superseded := seedGroup(t, "group-archived", synKBPrivate, "退款", entity.SynonymStatusDisabled, "")
	seedGroup(t, "group-live", synKBPrivate, "退款", entity.SynonymStatusLive, superseded.ID)

	_, err := svc.UpdateSynonymGroup(ctx, synOwner, superseded.ID, UpdateSynonymGroupRequest{
		Words:       &[]SynonymWordInput{{Word: "退款", IsPrimary: true}, {Word: "退钱"}},
		ChangeSetID: "cs-edit-archived",
	})
	if !errors.Is(err, ErrSynonymGroupReplaced) {
		t.Fatalf("err = %v, want ErrSynonymGroupReplaced", err)
	}
	// The row it points at must be untouched.
	reloaded, err := svc.synonymDAO.GetGroup(ctx, dao.DB, synTenantKB, superseded.ID)
	if err != nil {
		t.Fatalf("failed to reload the superseded group: %v", err)
	}
	if reloaded.Status != entity.SynonymStatusDisabled {
		t.Fatalf("superseded status = %q, want disabled", reloaded.Status)
	}
}

// TestListShowsOnlyCurrentVersions locks the manager's contract: publishing a
// replacement keeps the superseded row as an audit trail, but the manager lists
// only what is current — the live version plus any staged (pending) one.
//
// Listing the replaced row beside its successor put the same group name in the
// table twice, one of them labelled 已替换 — a state the user cannot act on and
// did not ask for.
func TestListShowsOnlyCurrentVersions(t *testing.T) {
	svc := setupSynonymAccessFixtures(t)
	ctx := context.Background()

	superseded := seedGroup(t, "group-old", synKBPrivate, "赎回基金", entity.SynonymStatusDisabled, "")
	live := seedGroup(t, "group-live", synKBPrivate, "赎回基金", entity.SynonymStatusLive, superseded.ID)
	staged := seedGroup(t, "group-stage", synKBPrivate, "购买基金", entity.SynonymStatusPending, "")

	groups, err := svc.ListSynonymGroups(ctx, synOwner, synKBPrivate, "")
	if err != nil {
		t.Fatalf("list failed: %v", err)
	}
	seen := map[string]bool{}
	for _, g := range groups {
		seen[g.ID] = true
	}
	if seen[superseded.ID] {
		t.Fatalf("the superseded version %q is still listed beside the version that replaced it",
			superseded.ID)
	}
	if !seen[live.ID] {
		t.Fatalf("the live version %q is missing from the list", live.ID)
	}
	if !seen[staged.ID] {
		t.Fatalf("the staged version %q must stay visible so the user can see it is pending",
			staged.ID)
	}
	if len(groups) != 2 {
		t.Fatalf("groups = %d, want 2 (live + pending)", len(groups))
	}
}
