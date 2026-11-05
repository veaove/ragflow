package service

import (
	"context"
	"testing"

	"ragflow/internal/entity"
)

// 五类带三档可见性的资源都要能写「排除」。
//
// 弹窗里的「不可见（排除）」由后端的 supports_deny 驱动，一旦拒写就变成
// 「能选、保存报错」，比根本不提供这个选项更糟。
func TestSetGrantsAcceptsDenyForEveryVisibilityKind(t *testing.T) {
	fixture := setupGrantDenyFixture(t)
	svc := NewResourceGrantService()
	ctx := context.Background()

	name := "资源"
	title := "智能体"
	valid := string(entity.StatusValid)
	resources := []struct {
		kind string
		id   string
		row  any
	}{
		{
			kind: "chat", id: "chat1",
			row: &entity.Chat{
				ID: "chat1", TenantID: "t1", CreatedBy: "user-creator", Name: &name,
				LLMSetting: entity.JSONMap{}, PromptConfig: entity.JSONMap{},
				DoRefer: "1", KBIDs: entity.JSONSlice{},
				Permission: entity.ResourceVisibilityTenantOwner, Status: &valid,
			},
		},
		{
			kind: "search_app", id: "search1",
			row: &entity.Search{
				ID: "search1", TenantID: "t1", CreatedBy: "user-creator", Name: name,
				SearchConfig: entity.JSONMap{},
				Permission:   entity.ResourceVisibilityTenantOwner, Status: &valid,
			},
		},
		{
			kind: "canvas", id: "canvas1",
			row: &entity.UserCanvas{
				ID: "canvas1", TenantID: "t1", UserID: "user-creator", Title: &title,
				Permission: entity.ResourceVisibilityTenantOwner,
			},
		},
		{
			kind: "memory", id: "memory1",
			row: &entity.Memory{
				ID: "memory1", TenantID: "t1", Name: name, CreatedBy: "user-creator",
				Permissions: entity.ResourceVisibilityTenantOwner,
			},
		},
	}
	for _, res := range resources {
		if err := fixture.db.Create(res.row).Error; err != nil {
			t.Fatalf("seed %s: %v", res.kind, err)
		}
	}

	for _, res := range resources {
		err := svc.SetGrants(ctx, "t1", res.kind, res.id, "", []GrantSubject{
			{Kind: entity.GrantSubjectTeam, Permission: GrantPermissionEdit, Effect: entity.GrantEffectAllow},
			{Kind: entity.GrantSubjectUser, ID: "user-victim", Permission: GrantPermissionRead, Effect: entity.GrantEffectDeny},
		})
		if err != nil {
			t.Fatalf("%s: SetGrants deny: %v", res.kind, err)
		}
		if got := fixture.effectOf(t, res.kind, res.id, "user-victim"); got != entity.GrantEffectDeny {
			t.Fatalf("%s: victim effect = %q, want deny", res.kind, got)
		}
	}
}

// 「能写排除」的必须是与知识库走同一套判定的那几类。
//
// 文件 / MCP 服务 / 数据源 / 技能空间没有 deny 判定，误开会让配置与实际
// 可见性脱节（配置里排除了，实际照样能看）。
func TestGrantKindDenySupportMatchesCatalog(t *testing.T) {
	want := map[string]bool{
		"dataset":         true,
		"chat":            true,
		"search_app":      true,
		"canvas":          true,
		"memory":          true,
		GrantKindDocument: true,
		"file":            false,
		"folder":          false,
		"mcp_server":      false,
		"connector":       false,
		"skill_space":     false,
	}
	for kind, support := range want {
		spec, err := grantKindSpecFor(kind)
		if err != nil {
			t.Fatalf("kind %s: %v", kind, err)
		}
		if spec.SupportsDeny != support {
			t.Fatalf("%s SupportsDeny = %v, want %v", kind, spec.SupportsDeny, support)
		}
		if grantDenyKinds[kind] != support {
			t.Fatalf("%s deny map = %v, want %v", kind, grantDenyKinds[kind], support)
		}
	}
}
