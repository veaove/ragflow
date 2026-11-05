//go:build !enterprise

package permission

import (
	"context"
	"errors"
	"net/url"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"ragflow/internal/entity"
)

// 知识问答 / 知识搜索 / 智能体 / 记忆与知识库共用一条判定链（resolveResource
// → tieredAccess → grantLevel）。这里只验证「排除生效」和「租户停用可见性」
// 两件与知识库对齐的行为，三档与授权的细节由 dataset_deny_test 覆盖。
type visibilityKindFixture struct {
	db      *gorm.DB
	checker *Checker
}

var visibilityKindRefs = []ResourceRef{
	{Kind: ResourceKindChat, ID: "chat1"},
	{Kind: ResourceKindSearchApp, ID: "search1"},
	{Kind: ResourceKindCanvas, ID: "canvas1"},
	{Kind: ResourceKindMemory, ID: "memory1"},
}

func newVisibilityKindFixture(t *testing.T) visibilityKindFixture {
	t.Helper()

	db, err := gorm.Open(sqlite.Open("file:"+url.QueryEscape(t.Name())+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&entity.Tenant{}, &entity.User{}, &entity.UserTenant{},
		&entity.Chat{}, &entity.Search{}, &entity.UserCanvas{}, &entity.Memory{},
		&entity.ResourceGrant{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	const tenantID = "t-vi"
	valid := string(entity.StatusValid)
	enabled := true
	tenantName := "vi"
	resName := "资源"
	if err := db.Create(&entity.Tenant{ID: tenantID, Name: &tenantName, Enabled: &enabled}).Error; err != nil {
		t.Fatalf("seed tenant: %v", err)
	}
	for _, uid := range []string{"owner-1", "creator", "member-1", "member-2"} {
		if err := db.Create(&entity.User{ID: uid, Email: uid + "@example.com"}).Error; err != nil {
			t.Fatalf("seed user %s: %v", uid, err)
		}
	}
	for _, m := range []struct{ id, user, role string }{
		{"ut-owner", "owner-1", "owner"},
		{"ut-creator", "creator", "normal"},
		{"ut-m1", "member-1", "normal"},
		{"ut-m2", "member-2", "normal"},
	} {
		if err := db.Create(&entity.UserTenant{
			ID: m.id, UserID: m.user, TenantID: tenantID, Role: m.role, Status: &valid,
		}).Error; err != nil {
			t.Fatalf("seed membership %s: %v", m.id, err)
		}
	}

	// 四类资源都设为 tenant_owner：普通成员本来就能看到，排除才看得出效果。
	rows := []any{
		&entity.Chat{
			ID: "chat1", TenantID: tenantID, CreatedBy: "creator", Name: &resName,
			LLMSetting: entity.JSONMap{}, PromptConfig: entity.JSONMap{},
			DoRefer: "1", KBIDs: entity.JSONSlice{}, Status: &valid,
			Permission: entity.ResourceVisibilityTenantOwner,
		},
		&entity.Search{
			ID: "search1", TenantID: tenantID, CreatedBy: "creator", Name: resName,
			SearchConfig: entity.JSONMap{}, Status: &valid,
			Permission: entity.ResourceVisibilityTenantOwner,
		},
		&entity.UserCanvas{
			ID: "canvas1", TenantID: tenantID, UserID: "creator", Title: &resName,
			Permission: entity.ResourceVisibilityTenantOwner,
		},
		&entity.Memory{
			ID: "memory1", TenantID: tenantID, Name: resName, CreatedBy: "creator",
			Permissions: entity.ResourceVisibilityTenantOwner,
		},
	}
	for _, row := range rows {
		if err := db.Create(row).Error; err != nil {
			t.Fatalf("seed resource: %v", err)
		}
	}

	for _, ref := range visibilityKindRefs {
		grants := []*entity.ResourceGrant{
			{
				ID: "g-team-" + ref.ID, TenantID: tenantID, ResourceKind: string(ref.Kind),
				ResourceID: ref.ID, SubjectKind: entity.GrantSubjectTeam,
				Permission: "edit", Effect: entity.GrantEffectAllow,
			},
			{
				ID: "g-deny-" + ref.ID, TenantID: tenantID, ResourceKind: string(ref.Kind),
				ResourceID: ref.ID, SubjectKind: entity.GrantSubjectUser,
				SubjectID: "member-1", Permission: "read", Effect: entity.GrantEffectDeny,
			},
		}
		for _, grant := range grants {
			if err := db.Create(grant).Error; err != nil {
				t.Fatalf("seed grant %s: %v", grant.ID, err)
			}
		}
	}

	return visibilityKindFixture{db: db, checker: NewDatabaseChecker(db)}
}

func (f visibilityKindFixture) check(userID string, ref ResourceRef, operation Operation) error {
	return f.checker.CheckResource(context.Background(), Subject{UserID: userID}, ref, operation)
}

// 排除对四类资源都要生效，且只作用于被排除的那个人。
func TestDenyAppliesToNonDatasetKinds(t *testing.T) {
	fixture := newVisibilityKindFixture(t)

	for _, ref := range visibilityKindRefs {
		// 全团队允许也盖不回单人的排除。
		if err := fixture.check("member-1", ref, OperationRead); !errors.Is(err, ErrPermissionDenied) {
			t.Fatalf("member-1 读 %s/%s error = %v, want %v", ref.Kind, ref.ID, err, ErrPermissionDenied)
		}
		// 写操作同样进不去：排除是整体不可见，不是只挡读。
		if err := fixture.check("member-1", ref, OperationUpdate); !errors.Is(err, ErrPermissionDenied) {
			t.Fatalf("member-1 改 %s/%s error = %v, want %v", ref.Kind, ref.ID, err, ErrPermissionDenied)
		}
		// 同一条 team allow 对没被排除的人照常生效。
		if err := fixture.check("member-2", ref, OperationRead); err != nil {
			t.Fatalf("member-2 读 %s/%s error = %v, want nil", ref.Kind, ref.ID, err)
		}
	}
}

// 列表与单条判定同一口径：被排除的人不该在列表里看到那条资源。
// 少了这条，表现就是「列表里有、点进去 403」（与知识库 D1 同型的反向缺陷）。
func TestScopeHidesDeniedNonDatasetKinds(t *testing.T) {
	fixture := newVisibilityKindFixture(t)

	for _, ref := range visibilityKindRefs {
		denied, err := fixture.checker.Scope(context.Background(), Subject{UserID: "member-1"},
			ScopeQuery{Kind: ref.Kind, Operation: OperationRead})
		if err != nil {
			t.Fatalf("Scope(member-1, %s): %v", ref.Kind, err)
		}
		for _, id := range denied.ResourceIDs {
			if id == ref.ID {
				t.Fatalf("member-1 的 %s 列表里出现了被排除的 %s", ref.Kind, ref.ID)
			}
		}

		other, err := fixture.checker.Scope(context.Background(), Subject{UserID: "member-2"},
			ScopeQuery{Kind: ref.Kind, Operation: OperationRead})
		if err != nil {
			t.Fatalf("Scope(member-2, %s): %v", ref.Kind, err)
		}
		found := false
		for _, id := range other.ResourceIDs {
			if id == ref.ID {
				found = true
			}
		}
		if !found {
			t.Fatalf("member-2 的 %s 列表里应当有 %s", ref.Kind, ref.ID)
		}
	}
}

// 租户停用后，四类资源对所有人不可见 —— 与知识库列表 SQL 里那条谓词同口径。
// 这条判定必须排在 owner / 创建者短路之前，否则停用只挡住了普通成员。
func TestDisabledTenantHidesEveryKind(t *testing.T) {
	fixture := newVisibilityKindFixture(t)

	disabled := false
	if err := fixture.db.Model(&entity.Tenant{}).Where("id = ?", "t-vi").
		Update("enabled", disabled).Error; err != nil {
		t.Fatalf("disable tenant: %v", err)
	}

	for _, ref := range visibilityKindRefs {
		for _, uid := range []string{"owner-1", "creator", "member-2"} {
			if err := fixture.check(uid, ref, OperationRead); !errors.Is(err, ErrResourceNotFound) {
				t.Fatalf("租户停用后 %s 读 %s/%s error = %v, want %v",
					uid, ref.Kind, ref.ID, err, ErrResourceNotFound)
			}
		}
	}
}
