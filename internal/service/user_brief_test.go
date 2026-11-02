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
	"testing"

	"ragflow/internal/entity"
	"ragflow/internal/permission"
)

// TestBatchUserBriefResolvesTenantMembersOnly pins the two properties the list
// columns depend on: a member of the caller's tenant resolves to nickname +
// email, and an id outside the caller's tenants resolves to nothing.
//
// The second one is the security half — this endpoint takes arbitrary ids, so
// returning rows for them would turn it into a cross-tenant user enumeration
// API. The UI renders unresolved ids as a placeholder instead of a name.
func TestBatchUserBriefResolvesTenantMembersOnly(t *testing.T) {
	db := setupServiceTestDB(t)
	pushServiceDB(t, db)

	users := []*entity.User{
		{ID: "caller", Nickname: "张三", Email: "caller@example.com"},
		{ID: "teammate", Nickname: "李四", Email: "teammate@example.com"},
		// Nickname missing: the table would render a blank cell, so the email
		// stands in for it.
		{ID: "no-nickname", Email: "nonick@example.com"},
		{ID: "outsider", Nickname: "外租户", Email: "outsider@example.com"},
	}
	for _, u := range users {
		if err := db.Create(u).Error; err != nil {
			t.Fatalf("create user %q: %v", u.ID, err)
		}
	}

	active := string(entity.StatusValid)
	tenants := []*entity.UserTenant{
		{ID: "ut-caller", UserID: "caller", TenantID: "tenant-1", Role: string(permission.RoleOwner), Status: &active},
		{ID: "ut-teammate", UserID: "teammate", TenantID: "tenant-1", Role: string(permission.RoleNormal), Status: &active},
		{ID: "ut-no-nickname", UserID: "no-nickname", TenantID: "tenant-1", Role: string(permission.RoleNormal), Status: &active},
		{ID: "ut-outsider", UserID: "outsider", TenantID: "tenant-2", Role: string(permission.RoleOwner), Status: &active},
	}
	for _, ut := range tenants {
		if err := db.Create(ut).Error; err != nil {
			t.Fatalf("create user_tenant %q/%q: %v", ut.UserID, ut.TenantID, err)
		}
	}

	briefs, err := NewUserService().BatchUserBrief(context.Background(), "caller",
		[]string{" teammate ", "teammate", "", "no-nickname", "outsider"})
	if err != nil {
		t.Fatalf("BatchUserBrief: %v", err)
	}

	if got := briefs["teammate"]; got == nil || got.Nickname != "李四" || got.Email != "teammate@example.com" {
		t.Errorf("teammate = %+v, want 李四 / teammate@example.com", got)
	}
	if got := briefs["no-nickname"]; got == nil || got.Nickname != "nonick@example.com" {
		t.Errorf("no-nickname = %+v, want email as fallback nickname", got)
	}
	if got, ok := briefs["outsider"]; ok {
		t.Errorf("outsider resolved across tenants: %+v", got)
	}
	if len(briefs) != 2 {
		t.Errorf("len(briefs) = %d, want 2: %+v", len(briefs), briefs)
	}
}

// TestBatchUserBriefWithoutCallerTenant covers a caller that belongs to no
// tenant: it must return an empty map rather than fall through to an unscoped
// user query.
func TestBatchUserBriefWithoutCallerTenant(t *testing.T) {
	db := setupServiceTestDB(t)
	pushServiceDB(t, db)

	if err := db.Create(&entity.User{ID: "target", Nickname: "目标", Email: "target@example.com"}).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}

	briefs, err := NewUserService().BatchUserBrief(context.Background(), "tenantless", []string{"target"})
	if err != nil {
		t.Fatalf("BatchUserBrief: %v", err)
	}
	if len(briefs) != 0 {
		t.Errorf("briefs = %+v, want empty for a caller without tenants", briefs)
	}
}

// TestBatchUserBriefSkipsPendingMemberships pins both ends of the status
// filter. user_tenant carries rows for invitations that were never accepted:
// the invitee must not be able to read the inviting tenant's member list, and
// a pending invitee must not resolve for the members who are already in.
func TestBatchUserBriefSkipsPendingMemberships(t *testing.T) {
	db := setupServiceTestDB(t)
	pushServiceDB(t, db)

	for _, u := range []*entity.User{
		{ID: "caller", Nickname: "已加入", Email: "caller@example.com"},
		{ID: "pending-caller", Nickname: "受邀未接受", Email: "pending-caller@example.com"},
		{ID: "member", Nickname: "成员", Email: "member@example.com"},
		{ID: "pending-member", Nickname: "待接受成员", Email: "pending-member@example.com"},
	} {
		if err := db.Create(u).Error; err != nil {
			t.Fatalf("create user %q: %v", u.ID, err)
		}
	}

	active := string(entity.StatusValid)
	pending := string(entity.StatusInvalid)
	for _, ut := range []*entity.UserTenant{
		{ID: "ut-caller", UserID: "caller", TenantID: "tenant-1", Role: string(permission.RoleOwner), Status: &active},
		{ID: "ut-member", UserID: "member", TenantID: "tenant-1", Role: string(permission.RoleNormal), Status: &active},
		{ID: "ut-pending-member", UserID: "pending-member", TenantID: "tenant-1", Role: string(permission.RoleNormal), Status: &pending},
		{ID: "ut-pending-caller", UserID: "pending-caller", TenantID: "tenant-1", Role: string(permission.RoleNormal), Status: &pending},
	} {
		if err := db.Create(ut).Error; err != nil {
			t.Fatalf("create user_tenant %q: %v", ut.ID, err)
		}
	}

	briefs, err := NewUserService().BatchUserBrief(context.Background(), "caller",
		[]string{"member", "pending-member"})
	if err != nil {
		t.Fatalf("BatchUserBrief: %v", err)
	}
	if got := briefs["member"]; got == nil || got.Email != "member@example.com" {
		t.Errorf("member = %+v, want resolved", got)
	}
	if got, ok := briefs["pending-member"]; ok {
		t.Errorf("pending member resolved: %+v", got)
	}

	pendingCallerBriefs, err := NewUserService().BatchUserBrief(context.Background(), "pending-caller",
		[]string{"member"})
	if err != nil {
		t.Fatalf("BatchUserBrief pending caller: %v", err)
	}
	if len(pendingCallerBriefs) != 0 {
		t.Errorf("pending caller resolved %+v, want empty", pendingCallerBriefs)
	}
}
