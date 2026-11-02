package service

import (
	"testing"

	"gorm.io/gorm"

	"ragflow/internal/entity"
	"ragflow/internal/permission"
)

// setupChatPermissionTestDB prepares the tables dataset permission resolution
// reads: datasets, their tenants and tenant memberships.
func setupChatPermissionTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := setupModelProviderServiceTestDB(t)
	useModelProviderServiceTestDB(t, db)
	if err := db.AutoMigrate(&entity.Knowledgebase{}, &entity.Tenant{}, &entity.ResourceGrant{}); err != nil {
		t.Fatalf("migrate chat permission tables: %v", err)
	}

	valid := string(entity.StatusValid)
	rows := []interface{}{
		&entity.Tenant{ID: "tenant-1", LLMID: "gpt-test", EmbdID: "bge-test", ASRID: "asr-test", Img2TxtID: "img-test", RerankID: "rerank-test", ParserIDs: "naive", Status: &valid},
		// owner-1 owns the tenant; member-1 is an ordinary member of it.
		&entity.UserTenant{ID: "ut-owner", UserID: "owner-1", TenantID: "tenant-1", Role: "owner", Status: &valid},
		&entity.UserTenant{ID: "ut-member", UserID: "member-1", TenantID: "tenant-1", Role: "normal", Status: &valid},
		// private-dataset is the owner's 仅本人可见 dataset: it never shows up in
		// member-1's 知识库 list.
		&entity.Knowledgebase{ID: "private-dataset", TenantID: "tenant-1", CreatedBy: "owner-1", Name: "private", EmbdID: "bge-test", Permission: string(entity.TenantPermissionMe), Status: &valid},
		&entity.Knowledgebase{ID: "team-dataset", TenantID: "tenant-1", CreatedBy: "owner-1", Name: "team", EmbdID: "bge-test", Permission: string(entity.TenantPermissionTeam), Status: &valid},
		// team-dataset 与 member-1 的共享关系落在 resource_grant 上：team 档本身
		// 只覆盖租户管理层。
		&entity.ResourceGrant{
			ID: "grant-team-dataset", TenantID: "tenant-1",
			ResourceKind: string(permission.ResourceKindDataset), ResourceID: "team-dataset",
			SubjectKind: entity.GrantSubjectUser, SubjectID: "member-1",
			Permission: "edit", Effect: entity.GrantEffectAllow,
		},
	}
	for _, row := range rows {
		if err := db.Create(row).Error; err != nil {
			t.Fatalf("seed %T: %v", row, err)
		}
	}
	return db
}

func chatWithKBs(kbIDs ...string) *entity.Chat {
	slice := make(entity.JSONSlice, 0, len(kbIDs))
	for _, id := range kbIDs {
		slice = append(slice, id)
	}
	return &entity.Chat{ID: "chat-1", TenantID: "tenant-1", KBIDs: slice}
}

// The reported bypass: a team-shared assistant bound to the owner's private
// dataset answered questions for a member who cannot open that dataset at all.
func TestRequireChatKBsForUserDeniesPrivateDatasetOfAnotherUser(t *testing.T) {
	setupChatPermissionTestDB(t)

	err := NewChatPipelineService().requireChatKBsForUser(t.Context(), "member-1", chatWithKBs("private-dataset"))
	if err == nil {
		t.Fatal("requireChatKBsForUser(member, private dataset) = nil, want permission error")
	}
}

// One unauthorized dataset in the binding is enough to refuse the turn: the
// remaining subset would answer for a corpus the assistant was not built on.
func TestRequireChatKBsForUserDeniesMixedBinding(t *testing.T) {
	setupChatPermissionTestDB(t)

	err := NewChatPipelineService().requireChatKBsForUser(t.Context(), "member-1", chatWithKBs("team-dataset", "private-dataset"))
	if err == nil {
		t.Fatal("requireChatKBsForUser(member, mixed binding) = nil, want permission error")
	}
}

func TestRequireChatKBsForUserAllowsSharedDataset(t *testing.T) {
	setupChatPermissionTestDB(t)

	if err := NewChatPipelineService().requireChatKBsForUser(t.Context(), "member-1", chatWithKBs("team-dataset")); err != nil {
		t.Fatalf("requireChatKBsForUser(member, team dataset) error = %v, want nil", err)
	}
}

func TestRequireChatKBsForUserAllowsOwner(t *testing.T) {
	setupChatPermissionTestDB(t)

	if err := NewChatPipelineService().requireChatKBsForUser(t.Context(), "owner-1", chatWithKBs("private-dataset")); err != nil {
		t.Fatalf("requireChatKBsForUser(owner, own private dataset) error = %v, want nil", err)
	}
}

// A binding that outlived its dataset (deleted, or disabled by the admin panel)
// must not fail the turn: getModels already skips it, and it holds no content to
// leak.
func TestRequireChatKBsForUserIgnoresUnresolvableBinding(t *testing.T) {
	setupChatPermissionTestDB(t)

	if err := NewChatPipelineService().requireChatKBsForUser(t.Context(), "member-1", chatWithKBs("team-dataset", "deleted-dataset")); err != nil {
		t.Fatalf("requireChatKBsForUser(member, stale binding) error = %v, want nil", err)
	}
}

func TestRequireChatKBsForUserSkipsChatsWithoutDatasets(t *testing.T) {
	setupChatPermissionTestDB(t)

	if err := NewChatPipelineService().requireChatKBsForUser(t.Context(), "member-1", chatWithKBs()); err != nil {
		t.Fatalf("requireChatKBsForUser(member, no datasets) error = %v, want nil", err)
	}
}
