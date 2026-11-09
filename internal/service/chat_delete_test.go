package service

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"ragflow/internal/dao"
	"ragflow/internal/entity"
	"ragflow/internal/permission"
)

func setupChatDeleteServiceTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		TranslateError: true,
	})
	if err != nil {
		t.Fatalf("failed to open sqlite: %v", err)
	}

	if err := db.AutoMigrate(&entity.Chat{}, &entity.UserTenant{}, &entity.ResourceGrant{}); err != nil {
		t.Fatalf("failed to migrate test schema: %v", err)
	}

	origDB := dao.DB
	dao.DB = db
	t.Cleanup(func() {
		dao.DB = origDB
	})

	return db
}

func createChatDeleteServiceTestChat(t *testing.T, db *gorm.DB, id, tenantID string) {
	t.Helper()

	name := "chat-" + id
	status := string(entity.StatusValid)
	chat := &entity.Chat{
		ID:           id,
		TenantID:     tenantID,
		Name:         &name,
		LLMID:        "model-a",
		LLMSetting:   entity.JSONMap{},
		PromptType:   "simple",
		PromptConfig: entity.JSONMap{"system": "sys"},
		KBIDs:        entity.JSONSlice{},
		Status:       &status,
	}
	if err := db.Create(chat).Error; err != nil {
		t.Fatalf("failed to create chat: %v", err)
	}
}

func TestChatServiceDeleteChatRejectsNonOwner(t *testing.T) {
	db := setupChatDeleteServiceTestDB(t)
	createChatDeleteServiceTestChat(t, db, "chat-1", "tenant-1")

	svc := NewChatService()
	ctx := t.Context()
	err := svc.DeleteChat(ctx, "user-1", "chat-1")
	if !errors.Is(err, permission.ErrPermissionDenied) {
		t.Fatalf("expected permission denied, got %v", err)
	}

	chat, getErr := svc.chatDAO.GetByID(ctx, dao.DB, "chat-1")
	if getErr != nil {
		t.Fatalf("failed to fetch chat: %v", getErr)
	}
	if chat.Status == nil || *chat.Status != string(entity.StatusValid) {
		t.Fatalf("expected chat status to remain valid, got %+v", chat.Status)
	}
}

func TestChatServiceBulkDeleteChatsDeleteAllOnlyDeletesOwnedChats(t *testing.T) {
	db := setupChatDeleteServiceTestDB(t)
	createChatDeleteServiceTestChat(t, db, "chat-1", "user-1")
	createChatDeleteServiceTestChat(t, db, "chat-2", "user-1")
	createChatDeleteServiceTestChat(t, db, "chat-3", "tenant-2")

	svc := NewChatService()
	ctx := t.Context()
	result, err := svc.BulkDeleteChats(ctx, "user-1", &BulkDeleteChatsRequest{DeleteAll: true})
	if err != nil {
		t.Fatalf("BulkDeleteChats failed: %v", err)
	}

	if got, ok := result["success_count"].(int); !ok || got != 2 {
		t.Fatalf("expected success_count 2, got %+v", result["success_count"])
	}

	owned1, err := svc.chatDAO.GetByID(ctx, dao.DB, "chat-1")
	if err != nil {
		t.Fatalf("failed to fetch chat-1: %v", err)
	}
	if owned1.Status == nil || *owned1.Status != string(entity.StatusInvalid) {
		t.Fatalf("expected chat-1 invalid, got %+v", owned1.Status)
	}

	owned2, err := svc.chatDAO.GetByID(ctx, dao.DB, "chat-2")
	if err != nil {
		t.Fatalf("failed to fetch chat-2: %v", err)
	}
	if owned2.Status == nil || *owned2.Status != string(entity.StatusInvalid) {
		t.Fatalf("expected chat-2 invalid, got %+v", owned2.Status)
	}

	other, err := svc.chatDAO.GetByID(ctx, dao.DB, "chat-3")
	if err != nil {
		t.Fatalf("failed to fetch chat-3: %v", err)
	}
	if other.Status == nil || *other.Status != string(entity.StatusValid) {
		t.Fatalf("expected chat-3 to remain valid, got %+v", other.Status)
	}
}

func TestChatServiceBulkDeleteChatsReturnsPartialSuccessErrors(t *testing.T) {
	db := setupChatDeleteServiceTestDB(t)
	createChatDeleteServiceTestChat(t, db, "chat-1", "user-1")
	createChatDeleteServiceTestChat(t, db, "chat-2", "tenant-2")

	svc := NewChatService()
	ctx := t.Context()
	result, err := svc.BulkDeleteChats(ctx, "user-1", &BulkDeleteChatsRequest{
		IDs: []string{"chat-1", "chat-2", "chat-1"},
	})
	if err != nil {
		t.Fatalf("BulkDeleteChats failed: %v", err)
	}

	if got, ok := result["success_count"].(int); !ok || got != 1 {
		t.Fatalf("expected success_count 1, got %+v", result["success_count"])
	}

	errorsList, ok := result["errors"].([]string)
	if !ok {
		t.Fatalf("expected errors list, got %+v", result["errors"])
	}
	joined := strings.Join(errorsList, " | ")
	if !strings.Contains(joined, "Duplicate chat ids: chat-1") {
		t.Fatalf("expected duplicate id error, got %v", errorsList)
	}
	if !strings.Contains(joined, "Chat(chat-2) not found.") {
		t.Fatalf("expected not found error, got %v", errorsList)
	}
}

// 软删只是把 status 置 0，规则若不同步清掉，就会变成指向"已删应用"的孤儿。
func TestChatServiceDeleteChatDropsItsGrants(t *testing.T) {
	db := setupChatDeleteServiceTestDB(t)
	createChatDeleteServiceTestChat(t, db, "chat-1", "user-1")

	now := time.Now().UnixMilli()
	for _, grant := range []*entity.ResourceGrant{
		{
			ID: "grant-chat-1", TenantID: "user-1", ResourceKind: "chat", ResourceID: "chat-1",
			SubjectKind: entity.GrantSubjectUser, SubjectID: "user-2", Permission: "read",
			Effect: entity.GrantEffectAllow, BaseModel: entity.BaseModel{CreateTime: &now, UpdateTime: &now},
		},
		{
			ID: "grant-chat-2", TenantID: "user-1", ResourceKind: "chat", ResourceID: "chat-2",
			SubjectKind: entity.GrantSubjectUser, SubjectID: "user-2", Permission: "read",
			Effect: entity.GrantEffectAllow, BaseModel: entity.BaseModel{CreateTime: &now, UpdateTime: &now},
		},
	} {
		if err := db.Create(grant).Error; err != nil {
			t.Fatalf("insert grant %s: %v", grant.ID, err)
		}
	}

	svc := NewChatService()
	if err := svc.DeleteChat(t.Context(), "user-1", "chat-1"); err != nil {
		t.Fatalf("DeleteChat failed: %v", err)
	}

	var rules []entity.ResourceGrant
	if err := db.Order("id").Find(&rules).Error; err != nil {
		t.Fatalf("reload grants: %v", err)
	}
	if len(rules) != 1 || rules[0].ID != "grant-chat-2" {
		t.Fatalf("remaining chat grants = %v, want only grant-chat-2", rules)
	}
}
