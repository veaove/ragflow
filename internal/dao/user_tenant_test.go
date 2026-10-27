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

package dao

import (
	"context"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"ragflow/internal/entity"
)

func setupUserTenantTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{TranslateError: true})
	if err != nil {
		t.Fatalf("failed to open sqlite: %v", err)
	}
	if err = db.AutoMigrate(&entity.User{}, &entity.UserTenant{}); err != nil {
		t.Fatalf("failed to migrate: %v", err)
	}
	return db
}

// TestGetTenantsByUserIDFindsTenantsCreatedAfterTheSplit covers the shape that
// broke /tenant/list in production: a tenant row created from the console has a
// random id, so the legacy "tenant_id == owner user id" join matched nothing and
// its members got an empty tenant list — no tenant name in the top bar, no
// switcher. The legacy personal tenant (id == owner user id) must keep working.
func TestGetTenantsByUserIDFindsTenantsCreatedAfterTheSplit(t *testing.T) {
	db := setupUserTenantTestDB(t)
	valid := "1"

	users := []entity.User{
		{ID: "liudehua", Nickname: "刘德华", Email: "liudehua@qq.com"},
		{ID: "huaxia-owner", Nickname: "华夏老板", Email: "huaxia@example.com"},
		{ID: "huaxia-member", Nickname: "华夏成员", Email: "member@example.com"},
	}
	for i := range users {
		if err := db.Create(&users[i]).Error; err != nil {
			t.Fatalf("create user %q: %v", users[i].ID, err)
		}
	}
	memberships := []entity.UserTenant{
		// 控制台新建的租户：id 与任何 user.id 都不相等。
		{ID: "m-jiashi", UserID: "liudehua", TenantID: "7a698902be1c4347adbad3dac6f497e4", Role: "owner", Status: &valid},
		// 个人租户时代的遗产：tenant_id 就是创建者的 user_id。
		{ID: "m-huaxia-owner", UserID: "huaxia-owner", TenantID: "huaxia-owner", Role: "owner", Status: &valid},
		{ID: "m-huaxia-member", UserID: "huaxia-member", TenantID: "huaxia-owner", Role: "normal", Status: &valid},
	}
	for i := range memberships {
		if err := db.Create(&memberships[i]).Error; err != nil {
			t.Fatalf("create membership %q: %v", memberships[i].ID, err)
		}
	}

	userTenantDAO := NewUserTenantDAO()
	cases := []struct {
		name       string
		userID     string
		wantTenant string
		wantNick   string
	}{
		{
			name:       "new_tenant_resolved_through_owner_membership",
			userID:     "liudehua",
			wantTenant: "7a698902be1c4347adbad3dac6f497e4",
			wantNick:   "刘德华",
		},
		{
			name:       "legacy_personal_tenant_still_resolves",
			userID:     "huaxia-member",
			wantTenant: "huaxia-owner",
			wantNick:   "华夏老板",
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			got, err := userTenantDAO.GetTenantsByUserID(context.Background(), db, testCase.userID)
			if err != nil {
				t.Fatalf("GetTenantsByUserID(%q) error = %v", testCase.userID, err)
			}
			if len(got) != 1 {
				t.Fatalf("GetTenantsByUserID(%q) = %d rows, want 1", testCase.userID, len(got))
			}
			if got[0].TenantID != testCase.wantTenant {
				t.Errorf("tenant_id = %q, want %q", got[0].TenantID, testCase.wantTenant)
			}
			if got[0].Nickname != testCase.wantNick {
				t.Errorf("nickname = %q, want %q（应取租户 owner 的身份）", got[0].Nickname, testCase.wantNick)
			}
		})
	}
}

// TestGetTenantsByUserIDDeduplicatesMultipleOwners keeps the top bar from
// rendering the same tenant twice when the data holds two owner rows.
func TestGetTenantsByUserIDDeduplicatesMultipleOwners(t *testing.T) {
	db := setupUserTenantTestDB(t)
	valid := "1"

	if err := db.Create(&entity.User{ID: "member", Nickname: "成员", Email: "m@example.com"}).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	for _, row := range []entity.UserTenant{
		{ID: "m-member", UserID: "member", TenantID: "tenant-x", Role: "normal", Status: &valid},
		{ID: "m-owner-1", UserID: "owner-a", TenantID: "tenant-x", Role: "owner", Status: &valid},
		{ID: "m-owner-2", UserID: "owner-b", TenantID: "tenant-x", Role: "owner", Status: &valid},
	} {
		row := row
		if err := db.Create(&row).Error; err != nil {
			t.Fatalf("create membership %q: %v", row.ID, err)
		}
	}

	got, err := NewUserTenantDAO().GetTenantsByUserID(context.Background(), db, "member")
	if err != nil {
		t.Fatalf("GetTenantsByUserID error = %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("GetTenantsByUserID = %d rows, want 1（同一租户只出现一次）", len(got))
	}
}
