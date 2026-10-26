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
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"ragflow/internal/entity"
)

func setupTenantDAOTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{TranslateError: true})
	if err != nil {
		t.Fatalf("failed to open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&entity.Tenant{}); err != nil {
		t.Fatalf("failed to migrate tenant: %v", err)
	}
	return db
}

func useTenantDAOTestDB(t *testing.T, db *gorm.DB) {
	t.Helper()
	orig := DB
	DB = db
	t.Cleanup(func() { DB = orig })
}

// TestTenantDAOGetByIDSkipsInactiveTenant pins the behaviour GetByID relies on:
// it filters status = "1", so a tenant row that is still present but inactive is
// reported as not found. This is the part of the old soft-delete test that
// covered live code; it no longer needs a delete helper to set up.
func TestTenantDAOGetByIDSkipsInactiveTenant(t *testing.T) {
	db := setupTenantDAOTestDB(t)
	useTenantDAOTestDB(t, db)
	ctx := t.Context()

	seed := func(id, status string) {
		t.Helper()
		tenant := &entity.Tenant{
			ID:        id,
			LLMID:     "llm",
			EmbdID:    "embd",
			ASRID:     "asr",
			Img2TxtID: "img2txt",
			RerankID:  "rerank",
			ParserIDs: "naive",
			Status:    &status,
		}
		if err := NewTenantDAO().Create(ctx, db, tenant); err != nil {
			t.Fatalf("Create(%s) error = %v", id, err)
		}
	}
	seed("tenant-active", "1")
	seed("tenant-inactive", "0")

	got, err := NewTenantDAO().GetByID(ctx, db, "tenant-active")
	if err != nil {
		t.Fatalf("GetByID(active) error = %v", err)
	}
	if got.ID != "tenant-active" {
		t.Fatalf("GetByID(active) = %+v", got)
	}

	if _, err := NewTenantDAO().GetByID(ctx, db, "tenant-inactive"); err == nil {
		t.Fatal("GetByID(inactive) error = nil, want not found")
	}
}

func TestTenantDAOUpdateStatus(t *testing.T) {
	db := setupTenantDAOTestDB(t)
	useTenantDAOTestDB(t, db)
	ctx := t.Context()

	active := "1"
	tenant := &entity.Tenant{
		ID:        "tenant-update",
		LLMID:     "llm",
		EmbdID:    "embd",
		ASRID:     "asr",
		Img2TxtID: "img2txt",
		RerankID:  "rerank",
		ParserIDs: "naive",
		Status:    &active,
	}
	if err := NewTenantDAO().Create(ctx, db, tenant); err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	if err := NewTenantDAO().Update(ctx, db, tenant.ID, map[string]interface{}{"status": "0"}); err != nil {
		t.Fatalf("Update() error = %v", err)
	}

	var got entity.Tenant
	if err := db.WithContext(ctx).Where("id = ?", tenant.ID).First(&got).Error; err != nil {
		t.Fatalf("failed to reload tenant: %v", err)
	}
	if got.Status == nil || *got.Status != "0" {
		t.Fatalf("status = %v, want 0", got.Status)
	}
}

// TestTenantDAOReadableInfoIncludesInvitedMember 覆盖「被邀请的普通成员」：
// GetInfoByUserID 把 role = 'owner' 写死在 SQL 里，成员查不到任何租户，
// 调用方据此返回 102 Tenant not found!（前端一进首页就弹这个错）。
// GetReadableInfoByUserID 必须在 owner 租户缺席时回落到成员租户。
func TestTenantDAOReadableInfoIncludesInvitedMember(t *testing.T) {
	db := setupTenantDAOTestDB(t)
	if err := db.AutoMigrate(&entity.UserTenant{}); err != nil {
		t.Fatalf("failed to migrate user_tenant: %v", err)
	}
	useTenantDAOTestDB(t, db)
	ctx := t.Context()

	status := "1"
	tenant := &entity.Tenant{
		ID:        "tenant-shared",
		LLMID:     "llm",
		EmbdID:    "embd",
		ASRID:     "asr",
		Img2TxtID: "img2txt",
		RerankID:  "rerank",
		ParserIDs: "naive",
		Status:    &status,
	}
	if err := NewTenantDAO().Create(ctx, db, tenant); err != nil {
		t.Fatalf("Create(tenant-shared) error = %v", err)
	}
	rel := &entity.UserTenant{
		ID:        "ut-1",
		UserID:    "member-user",
		TenantID:  "tenant-shared",
		Role:      "normal",
		InvitedBy: "owner-user",
		Status:    &status,
	}
	if err := db.Create(rel).Error; err != nil {
		t.Fatalf("create user_tenant: %v", err)
	}

	// owner 版查不到 —— 这正是 102 的来源，留作回归锚点。
	owned, err := NewTenantDAO().GetInfoByUserID(ctx, db, "member-user")
	if err != nil {
		t.Fatalf("GetInfoByUserID error = %v", err)
	}
	if len(owned) != 0 {
		t.Fatalf("GetInfoByUserID(member) = %d rows, want 0", len(owned))
	}

	readable, err := NewTenantDAO().GetReadableInfoByUserID(ctx, db, "member-user")
	if err != nil {
		t.Fatalf("GetReadableInfoByUserID error = %v", err)
	}
	if len(readable) != 1 || readable[0].TenantID != "tenant-shared" {
		t.Fatalf("GetReadableInfoByUserID(member) = %+v, want tenant-shared", readable)
	}
	if readable[0].Role != "normal" {
		t.Fatalf("Role = %q, want normal", readable[0].Role)
	}
}
