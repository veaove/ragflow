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
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"ragflow/internal/dao"
	"ragflow/internal/entity"
)

func setupUserActivityTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{TranslateError: true})
	if err != nil {
		t.Fatalf("failed to open sqlite: %v", err)
	}
	if err = db.AutoMigrate(
		&entity.User{},
		&entity.UserTenant{},
		&entity.Chat{},
		&entity.ChatSession{},
	); err != nil {
		t.Fatalf("failed to migrate test schema: %v", err)
	}

	origDB := dao.DB
	dao.DB = db
	t.Cleanup(func() { dao.DB = origDB })

	return db
}

func seedUserActivityUser(t *testing.T, db *gorm.DB, id string, lastLoginDaysAgo int) {
	t.Helper()

	lastLogin := time.Now().AddDate(0, 0, -lastLoginDaysAgo)
	if err := db.Create(&entity.User{
		ID:            id,
		Nickname:      id,
		Email:         id + "@test.com",
		IsActive:      "1",
		LastLoginTime: &lastLogin,
		Status:        sptr("1"),
	}).Error; err != nil {
		t.Fatalf("failed to create user %s: %v", id, err)
	}
}

func seedUserActivityMember(t *testing.T, db *gorm.DB, tenantID, userID string) {
	t.Helper()

	if err := db.Create(&entity.UserTenant{
		ID:        tenantID + "-" + userID,
		UserID:    userID,
		TenantID:  tenantID,
		Role:      "owner",
		InvitedBy: userID,
		Status:    sptr("1"),
	}).Error; err != nil {
		t.Fatalf("failed to create user_tenant %s/%s: %v", tenantID, userID, err)
	}
}

func seedUserActivityDialog(t *testing.T, db *gorm.DB, id, tenantID string) {
	t.Helper()

	status := string(entity.StatusValid)
	name := id
	if err := db.Create(&entity.Chat{
		ID:           id,
		TenantID:     tenantID,
		Name:         &name,
		LLMID:        "model-a",
		LLMSetting:   entity.JSONMap{},
		PromptType:   "simple",
		PromptConfig: entity.JSONMap{},
		KBIDs:        entity.JSONSlice{},
		Status:       &status,
	}).Error; err != nil {
		t.Fatalf("failed to create dialog %s: %v", id, err)
	}
}

func seedUserActivityConversation(t *testing.T, db *gorm.DB, id, dialogID, userID string, daysAgo int) {
	t.Helper()

	created := time.Now().AddDate(0, 0, -daysAgo)
	ms := created.UnixMilli()
	uid := userID
	if err := db.Create(&entity.ChatSession{
		ID:       id,
		DialogID: dialogID,
		UserID:   &uid,
		BaseModel: entity.BaseModel{
			CreateTime: &ms,
			CreateDate: &created,
		},
	}).Error; err != nil {
		t.Fatalf("failed to create conversation %s: %v", id, err)
	}
}

// 口径：活跃 = 窗口内登录过 OR 在本租户发起过会话，且必须是本租户成员。
func TestGetUserActivityCountsLoginAndConversationActivity(t *testing.T) {
	db := setupUserActivityTestDB(t)

	// 本租户 4 个成员
	seedUserActivityUser(t, db, "u-owner", 1)  // 登录活跃
	seedUserActivityUser(t, db, "u-chat", 40)  // 登录不活跃，但近 3 日有会话
	seedUserActivityUser(t, db, "u-idle", 40)  // 完全无活动
	seedUserActivityUser(t, db, "u-stale", 40) // 会话超出窗口
	for _, uid := range []string{"u-owner", "u-chat", "u-idle", "u-stale"} {
		seedUserActivityMember(t, db, "tenant-1", uid)
	}

	// 另一个租户的成员与活跃记录，不能串到这个租户
	seedUserActivityUser(t, db, "u-other", 1)
	seedUserActivityMember(t, db, "tenant-2", "u-other")

	seedUserActivityDialog(t, db, "dialog-1", "tenant-1")
	seedUserActivityDialog(t, db, "dialog-2", "tenant-2")

	seedUserActivityConversation(t, db, "conv-1", "dialog-1", "u-chat", 3)
	seedUserActivityConversation(t, db, "conv-2", "dialog-1", "u-stale", 40)
	seedUserActivityConversation(t, db, "conv-3", "dialog-2", "u-other", 1)
	// 非成员（例如匿名访客）在本租户产生会话，不应计入成员活跃数
	seedUserActivityConversation(t, db, "conv-4", "dialog-1", "u-guest", 1)

	stats, err := NewStatsService().GetUserActivity(t.Context(), "u-owner", 7)
	if err != nil {
		t.Fatalf("GetUserActivity failed: %v", err)
	}
	if stats.TotalUsers != 4 {
		t.Fatalf("expected total_users=4, got %d", stats.TotalUsers)
	}
	if stats.ActiveUsers != 2 {
		t.Fatalf("expected active_users=2 (u-owner via login, u-chat via conversation), got %d", stats.ActiveUsers)
	}
	if stats.Days != 7 {
		t.Fatalf("expected days=7, got %d", stats.Days)
	}
}

// 登录活跃与会话活跃是同一个人时只能算一次。
func TestGetUserActivityDeduplicatesActiveUser(t *testing.T) {
	db := setupUserActivityTestDB(t)

	seedUserActivityUser(t, db, "u-dupe", 1)
	seedUserActivityMember(t, db, "tenant-1", "u-dupe")
	seedUserActivityDialog(t, db, "dialog-1", "tenant-1")
	seedUserActivityConversation(t, db, "conv-1", "dialog-1", "u-dupe", 1)

	stats, err := NewStatsService().GetUserActivity(t.Context(), "u-dupe", 7)
	if err != nil {
		t.Fatalf("GetUserActivity failed: %v", err)
	}
	if stats.TotalUsers != 1 || stats.ActiveUsers != 1 {
		t.Fatalf("expected 1/1, got %d/%d", stats.ActiveUsers, stats.TotalUsers)
	}
}

// 非法 days 回落到默认 7 天，避免前端传参把窗口拉成 0 天或几十年。
func TestGetUserActivityFallsBackToDefaultDays(t *testing.T) {
	db := setupUserActivityTestDB(t)

	seedUserActivityUser(t, db, "u-1", 1)
	seedUserActivityMember(t, db, "tenant-1", "u-1")

	for _, days := range []int{0, -3, 1000} {
		stats, err := NewStatsService().GetUserActivity(t.Context(), "u-1", days)
		if err != nil {
			t.Fatalf("GetUserActivity(days=%d) failed: %v", days, err)
		}
		if stats.Days != defaultUserActivityDays {
			t.Fatalf("days=%d: expected fallback to %d, got %d", days, defaultUserActivityDays, stats.Days)
		}
	}
}

func TestGetUserActivityWithoutTenantReturnsErrTenantNotFound(t *testing.T) {
	db := setupUserActivityTestDB(t)

	seedUserActivityUser(t, db, "u-lonely", 1)

	_, err := NewStatsService().GetUserActivity(t.Context(), "u-lonely", 7)
	if err != ErrTenantNotFound {
		t.Fatalf("expected ErrTenantNotFound, got %v", err)
	}
}
