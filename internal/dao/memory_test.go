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
	"net/url"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"ragflow/internal/entity"
)

// memoryOwnerDB seeds a tenant that is NOT a user id, which is the shape the
// old owner join could not resolve.
func memoryOwnerDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+url.QueryEscape(t.Name())+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err = db.AutoMigrate(&entity.Memory{}, &entity.User{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if err = db.Create(&entity.User{ID: "user-1", Nickname: "彭燕", Email: "user1@example.com"}).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	// tenant-1 is a real tenant with no matching user row: joining owner on
	// tenant_id (the pre-created_by behaviour) yields no name at all.
	memories := []*entity.Memory{
		{
			ID: "m-tenant", Name: "shared", TenantID: "tenant-1", CreatedBy: "user-1",
			StorageType: "table", EmbdID: "embedding", LLMID: "chat",
			Permissions: string(entity.TenantPermissionTeam), MemorySize: 1024,
			ForgettingPolicy: "FIFO", Temperature: 0.5,
		},
		{
			// Legacy row: tenant_id is a user id, created_by empty.
			ID: "m-legacy", Name: "legacy", TenantID: "user-1",
			StorageType: "table", EmbdID: "embedding", LLMID: "chat",
			Permissions: string(entity.TenantPermissionMe), MemorySize: 1024,
			ForgettingPolicy: "FIFO", Temperature: 0.5,
		},
	}
	for _, m := range memories {
		if err = db.Create(m).Error; err != nil {
			t.Fatalf("create memory %q: %v", m.ID, err)
		}
	}
	return db
}

// TestGetWithOwnerNameByIDResolvesCreator pins the owner join to created_by.
// A team memory lives in a tenant, but the "创建人" column still has to name the
// person — joining user on tenant_id loses it for every multi-member tenant.
func TestGetWithOwnerNameByIDResolvesCreator(t *testing.T) {
	db := memoryOwnerDB(t)
	memoryDAO := NewMemoryDAO()

	got, err := memoryDAO.GetWithOwnerNameByID(context.Background(), db, "m-tenant")
	if err != nil {
		t.Fatalf("GetWithOwnerNameByID: %v", err)
	}
	if got.OwnerName == nil || *got.OwnerName != "彭燕" {
		t.Errorf("owner_name = %v, want 彭燕", got.OwnerName)
	}
	if got.CreatedBy != "user-1" {
		t.Errorf("created_by = %q, want user-1", got.CreatedBy)
	}
	if got.TenantID != "tenant-1" {
		t.Errorf("tenant_id = %q, want tenant-1", got.TenantID)
	}

	// Legacy row: created_by is empty, so the join falls back to tenant_id,
	// which held the creator's user id before the column existed.
	legacy, err := memoryDAO.GetWithOwnerNameByID(context.Background(), db, "m-legacy")
	if err != nil {
		t.Fatalf("GetWithOwnerNameByID(legacy): %v", err)
	}
	if legacy.OwnerName == nil || *legacy.OwnerName != "彭燕" {
		t.Errorf("legacy owner_name = %v, want 彭燕", legacy.OwnerName)
	}
}

// TestGetByFilterResolvesCreator covers the list endpoint path, which builds
// its own SQL instead of reusing the single-row query.
func TestGetByFilterResolvesCreator(t *testing.T) {
	db := memoryOwnerDB(t)

	rows, total, err := NewMemoryDAO().GetByFilter(
		context.Background(), db, []string{"m-tenant", "m-legacy"},
		nil, nil, "", "", 1, 10,
	)
	if err != nil {
		t.Fatalf("GetByFilter: %v", err)
	}
	if total != 2 {
		t.Fatalf("total = %d, want 2", total)
	}
	names := map[string]string{}
	for _, row := range rows {
		if row.OwnerName != nil {
			names[row.ID] = *row.OwnerName
		}
	}
	for _, id := range []string{"m-tenant", "m-legacy"} {
		if names[id] != "彭燕" {
			t.Errorf("memory %q owner_name = %q, want 彭燕", id, names[id])
		}
	}
}
