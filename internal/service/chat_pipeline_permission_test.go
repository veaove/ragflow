package service

import (
	"errors"
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

// Strict mode (allow_partial_kb=false): one unauthorized dataset in the binding
// is enough to refuse the turn, because the remaining subset would answer for a
// corpus the assistant was not built on.
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

func chatWithPromptKBs(allowPartial bool, kbIDs ...string) *entity.Chat {
	chat := chatWithKBs(kbIDs...)
	chat.PromptConfig = entity.JSONMap{"allow_partial_kb": allowPartial}
	return chat
}

func kbIDsOf(chat *entity.Chat) []string {
	ids := make([]string, 0, len(chat.KBIDs))
	for _, raw := range chat.KBIDs {
		if id, ok := raw.(string); ok {
			ids = append(ids, id)
		}
	}
	return ids
}

// allow_partial_kb 默认必须为 true：存量助手没有这个字段，语义变化要让它们
// 立刻按可见库返回，而不是继续整体失败。
func TestAllowPartialChatKBDefaultsToTrue(t *testing.T) {
	if !allowPartialChatKB(nil) {
		t.Error("allowPartialChatKB(nil) = false, want true")
	}
	if !allowPartialChatKB(&entity.Chat{}) {
		t.Error("allowPartialChatKB(no prompt_config) = false, want true")
	}
	if !allowPartialChatKB(&entity.Chat{PromptConfig: entity.JSONMap{}}) {
		t.Error("allowPartialChatKB(empty prompt_config) = false, want true")
	}
	if !allowPartialChatKB(&entity.Chat{PromptConfig: entity.JSONMap{"allow_partial_kb": "true"}}) {
		t.Error("allowPartialChatKB(non-bool value) = false, want the default true")
	}
	if allowPartialChatKB(&entity.Chat{PromptConfig: entity.JSONMap{"allow_partial_kb": false}}) {
		t.Error("allowPartialChatKB(explicit false) = true, want false")
	}
}

// 默认路径：混合绑定收敛到调用者可见的库，不再整体拒绝。
func TestScopeChatKBsForUserNarrowsMixedBindingByDefault(t *testing.T) {
	setupChatPermissionTestDB(t)

	chat := chatWithKBs("team-dataset", "private-dataset")
	if err := NewChatPipelineService().scopeChatKBsForUser(t.Context(), "member-1", chat); err != nil {
		t.Fatalf("scopeChatKBsForUser(member, mixed binding) error = %v, want nil", err)
	}
	got := kbIDsOf(chat)
	if len(got) != 1 || got[0] != "team-dataset" {
		t.Fatalf("scoped KBIDs = %v, want [team-dataset]", got)
	}
}

// 显式开启与默认行为一致。
func TestScopeChatKBsForUserNarrowsWhenPartialAllowed(t *testing.T) {
	setupChatPermissionTestDB(t)

	chat := chatWithPromptKBs(true, "team-dataset", "private-dataset")
	if err := NewChatPipelineService().scopeChatKBsForUser(t.Context(), "member-1", chat); err != nil {
		t.Fatalf("scopeChatKBsForUser(allow_partial_kb=true) error = %v, want nil", err)
	}
	if got := kbIDsOf(chat); len(got) != 1 || got[0] != "team-dataset" {
		t.Fatalf("scoped KBIDs = %v, want [team-dataset]", got)
	}
}

// 严格模式仍然整体拒绝，供需要「全库一致」语义的助手回退。
func TestScopeChatKBsForUserRefusesMixedBindingWhenStrict(t *testing.T) {
	setupChatPermissionTestDB(t)

	chat := chatWithPromptKBs(false, "team-dataset", "private-dataset")
	if err := NewChatPipelineService().scopeChatKBsForUser(t.Context(), "member-1", chat); err == nil {
		t.Fatal("scopeChatKBsForUser(allow_partial_kb=false, mixed binding) = nil, want permission error")
	}
}

// 每个绑定都不可见时不能退化成纯 LLM 回答，否则等于绕开知识库。
func TestScopeChatKBsForUserRejectsWhenEveryBindingDenied(t *testing.T) {
	setupChatPermissionTestDB(t)

	chat := chatWithKBs("private-dataset")
	err := NewChatPipelineService().scopeChatKBsForUser(t.Context(), "member-1", chat)
	if !errors.Is(err, errNoVisibleChatKB) {
		t.Fatalf("scopeChatKBsForUser(member, only denied binding) error = %v, want errNoVisibleChatKB", err)
	}
}

// 已删除或停用的绑定不算「拒绝」：它们没有内容可泄露，直接丢弃。
func TestScopeChatKBsForUserDropsUnresolvableBinding(t *testing.T) {
	setupChatPermissionTestDB(t)

	chat := chatWithKBs("team-dataset", "deleted-dataset")
	if err := NewChatPipelineService().scopeChatKBsForUser(t.Context(), "member-1", chat); err != nil {
		t.Fatalf("scopeChatKBsForUser(stale binding) error = %v, want nil", err)
	}
	if got := kbIDsOf(chat); len(got) != 1 || got[0] != "team-dataset" {
		t.Fatalf("scoped KBIDs = %v, want [team-dataset]", got)
	}
}

// 全部可见时列表原样保留，顺序不变。
func TestScopeChatKBsForUserKeepsAllVisibleBindings(t *testing.T) {
	setupChatPermissionTestDB(t)

	chat := chatWithKBs("team-dataset")
	if err := NewChatPipelineService().scopeChatKBsForUser(t.Context(), "member-1", chat); err != nil {
		t.Fatalf("scopeChatKBsForUser(all visible) error = %v, want nil", err)
	}
	if got := kbIDsOf(chat); len(got) != 1 || got[0] != "team-dataset" {
		t.Fatalf("scoped KBIDs = %v, want [team-dataset]", got)
	}
}

func TestScopeChatKBsForUserSkipsChatsWithoutDatasets(t *testing.T) {
	setupChatPermissionTestDB(t)

	chat := chatWithKBs()
	if err := NewChatPipelineService().scopeChatKBsForUser(t.Context(), "member-1", chat); err != nil {
		t.Fatalf("scopeChatKBsForUser(no datasets) error = %v, want nil", err)
	}
	if got := kbIDsOf(chat); len(got) != 0 {
		t.Fatalf("scoped KBIDs = %v, want empty", got)
	}
}
