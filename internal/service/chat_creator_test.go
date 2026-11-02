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

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"ragflow/internal/dao"
	"ragflow/internal/entity"
	"ragflow/internal/permission"
)

func createChatWithCreator(t *testing.T, db *gorm.DB, chat *entity.Chat) {
	t.Helper()
	status := string(entity.StatusValid)
	chat.LLMID = "model-a"
	chat.LLMSetting = entity.JSONMap{}
	chat.PromptType = "simple"
	chat.PromptConfig = entity.JSONMap{}
	chat.KBIDs = entity.JSONSlice{}
	chat.DoRefer = "1"
	chat.Status = &status
	if err := db.Create(chat).Error; err != nil {
		t.Fatalf("create chat %q: %v", chat.ID, err)
	}
}

// TestChatServiceCreateStoresTenantAndCreator pins the split the list column
// depends on: tenant_id owns the app (visibility, model lookup), created_by
// names the member. Writing the creator into tenant_id made every chat a
// personal asset in disguise, and it resolved models against the member's
// personal tenant instead of the tenant the app belongs to.
func TestChatServiceCreateStoresTenantAndCreator(t *testing.T) {
	chat := buildCreateChatEntity(map[string]interface{}{"name": "问答"}, "team-1", "member-1")

	if chat.TenantID != "team-1" {
		t.Errorf("tenant_id = %q, want team-1", chat.TenantID)
	}
	if chat.CreatedBy != "member-1" {
		t.Errorf("created_by = %q, want member-1", chat.CreatedBy)
	}
}

func setupChatCreatorServiceTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{TranslateError: true})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err = db.AutoMigrate(
		&entity.Chat{}, &entity.Tenant{}, &entity.User{}, &entity.UserTenant{},
		&entity.TenantModelProvider{}, &entity.TenantModelInstance{}, &entity.TenantModel{},
	); err != nil {
		t.Fatalf("migrate test schema: %v", err)
	}

	origDB := dao.DB
	dao.DB = db
	t.Cleanup(func() { dao.DB = origDB })

	status := string(entity.StatusValid)
	// The chat must resolve its model from the tenant it belongs to, so only
	// that tenant carries a model named "model-team"; resolving against the
	// creator's personal tenant would fail and the create would error out.
	if err := db.Create(&entity.Tenant{
		ID: "team-1", LLMID: "model-team", EmbdID: "embd-team", ParserIDs: "naive", Status: &status,
	}).Error; err != nil {
		t.Fatalf("create team tenant: %v", err)
	}
	if err := db.Create(&entity.User{ID: "member-1", Nickname: "成员", Status: &status}).Error; err != nil {
		t.Fatalf("create member: %v", err)
	}
	if err := db.Create(&entity.UserTenant{
		ID: "rel-1", UserID: "member-1", TenantID: "team-1", Role: "normal", Status: &status,
	}).Error; err != nil {
		t.Fatalf("create membership: %v", err)
	}
	// 每个租户都有 owner：模型这类租户级资源的授权事实要按 owner 归属计算。
	if err := db.Create(&entity.UserTenant{
		ID: "rel-owner", UserID: "owner-1", TenantID: "team-1", Role: "owner", Status: &status,
	}).Error; err != nil {
		t.Fatalf("create tenant owner: %v", err)
	}
	if err := db.Create(&entity.TenantModelProvider{
		ID: "provider-team", TenantID: "team-1", ProviderName: "OpenAI",
	}).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	if err := db.Create(&entity.TenantModelInstance{
		ID: "instance-team", ProviderID: "provider-team", InstanceName: "default",
		APIKey: "sk-test", Status: "active", Extra: "{}",
	}).Error; err != nil {
		t.Fatalf("create instance: %v", err)
	}
	if err := db.Create(&entity.TenantModel{
		ID: "model-team", ProviderID: "provider-team", InstanceID: "instance-team",
		ModelName: "gpt-test", ModelType: int(entity.ModelTypeChat), Status: "active", Extra: "{}",
	}).Error; err != nil {
		t.Fatalf("create model: %v", err)
	}

	return db
}

// TestChatServiceCreateInTeamTenantUsesTenantScope covers the whole create
// path for a team member: the row lands under the team tenant, remembers the
// member as creator, and its tenant_llm_id is a model the team tenant owns.
func TestChatServiceCreateInTeamTenantUsesTenantScope(t *testing.T) {
	db := setupChatCreatorServiceTestDB(t)

	svc := NewChatService()
	_, code, err := svc.Create(t.Context(), "team-1", "member-1", map[string]interface{}{
		"name":   "团队问答",
		"llm_id": "model-team",
	})
	if err != nil {
		t.Fatalf("Create: %v (code %d)", err, code)
	}

	var stored entity.Chat
	if err := db.Where("name = ?", "团队问答").Take(&stored).Error; err != nil {
		t.Fatalf("load created chat: %v", err)
	}
	if stored.TenantID != "team-1" {
		t.Errorf("tenant_id = %q, want team-1", stored.TenantID)
	}
	if stored.CreatedBy != "member-1" {
		t.Errorf("created_by = %q, want member-1", stored.CreatedBy)
	}
	if stored.TenantLLMID == nil || *stored.TenantLLMID != "model-team" {
		t.Errorf("tenant_llm_id = %v, want model-team", stored.TenantLLMID)
	}
}

// TestChatServiceListChatsResolvesCreator covers both storage generations in
// one page: a chat written with created_by, and a legacy row that only carries
// the creator's user id in tenant_id. The owner column and the owner filter
// must agree on who that is.
func TestChatServiceListChatsResolvesCreator(t *testing.T) {
	db := setupChatListTestDB(t)

	status := string(entity.StatusValid)
	if err := db.Create(&entity.User{ID: "member-1", Nickname: "成员", Status: &status}).Error; err != nil {
		t.Fatalf("create teammate: %v", err)
	}
	if err := db.Create(&entity.UserTenant{
		ID: "rel-team", UserID: "user-1", TenantID: "team-1", Role: "normal",
		InvitedBy: "member-1", Status: &status,
	}).Error; err != nil {
		t.Fatalf("create membership: %v", err)
	}

	createChatWithCreator(t, db, &entity.Chat{
		ID: "chat-team", TenantID: "team-1", CreatedBy: "member-1", Name: sptr("team_chat"),
	})
	// 问答应用默认只对创建者可见，团队共享靠一条显式授权。
	grantTestResource(t, "team-1", permission.ResourceKindChat, "chat-team", "user-1")
	// Legacy shape: no created_by, tenant_id holds the creator's user id.
	createChatWithCreator(t, db, &entity.Chat{
		ID: "chat-legacy", TenantID: "user-1", Name: sptr("legacy_chat"),
	})

	svc := NewChatService()
	terms := []dao.OrderTerm{{Column: "create_time", Desc: true}}
	result, err := svc.ListChats(t.Context(), "user-1", "1", "", "", "", 0, 0, terms, nil)
	if err != nil {
		t.Fatalf("ListChats: %v", err)
	}
	if result.Total != 2 {
		t.Fatalf("total = %d, want 2", result.Total)
	}

	byID := map[string]*ChatWithKBNames{}
	for _, chat := range result.Chats {
		byID[chat.ID] = chat
	}
	teamChat := byID["chat-team"]
	if teamChat == nil || teamChat.CreatedBy != "member-1" || teamChat.Nickname != "成员" {
		t.Errorf("team chat = %+v, want created_by member-1 / nickname 成员", teamChat)
	}
	legacyChat := byID["chat-legacy"]
	if legacyChat == nil || legacyChat.CreatedBy != "user-1" || legacyChat.Nickname != "tester" {
		t.Errorf("legacy chat = %+v, want created_by user-1 / nickname tester", legacyChat)
	}

	// Owner filter is the creator, so filtering by the teammate's id keeps only
	// the chat they created — legacy rows still match their own creator id.
	filtered, err := svc.ListChats(t.Context(), "user-1", "1", "", "", "", 0, 0, terms, []string{"member-1"})
	if err != nil {
		t.Fatalf("ListChats(owner=member-1): %v", err)
	}
	if filtered.Total != 1 || len(filtered.Chats) != 1 || filtered.Chats[0].ID != "chat-team" {
		t.Errorf("owner filter = %+v, want only chat-team", filtered.Chats)
	}
	legacyOnly, err := svc.ListChats(t.Context(), "user-1", "1", "", "", "", 0, 0, terms, []string{"user-1"})
	if err != nil {
		t.Fatalf("ListChats(owner=user-1): %v", err)
	}
	if legacyOnly.Total != 1 || len(legacyOnly.Chats) != 1 || legacyOnly.Chats[0].ID != "chat-legacy" {
		t.Errorf("legacy owner filter = %+v, want only chat-legacy", legacyOnly.Chats)
	}
}
