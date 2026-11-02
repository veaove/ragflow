package service

import (
	"errors"
	"testing"

	"gorm.io/gorm"

	"ragflow/internal/common"
	"ragflow/internal/entity"
	"ragflow/internal/permission"
)

// seedReadableTenantScope prepares a tenant plus a scope that already carries a
// provider, an instance and one chat model, so the model-catalog reads have
// something to return.
func seedReadableTenantScope(t *testing.T, db *gorm.DB) {
	t.Helper()
	seedModelProviderServiceScope(t, db)
	status := string(entity.StatusValid)
	if err := db.AutoMigrate(&entity.Tenant{}); err != nil {
		t.Fatalf("migrate tenant: %v", err)
	}
	row := &entity.Tenant{
		ID:        "tenant-1",
		LLMID:     "gpt-test",
		EmbdID:    "bge-test",
		ASRID:     "asr-test",
		Img2TxtID: "img-test",
		RerankID:  "rerank-test",
		ParserIDs: "naive",
		Status:    &status,
	}
	if err := db.Create(row).Error; err != nil {
		t.Fatalf("seed tenant: %v", err)
	}
}

func seedMembership(t *testing.T, db *gorm.DB, id, userID, tenantID, role string) {
	t.Helper()
	status := string(entity.StatusValid)
	row := &entity.UserTenant{
		ID:       id,
		UserID:   userID,
		TenantID: tenantID,
		Role:     role,
		Status:   &status,
	}
	if err := db.Create(row).Error; err != nil {
		t.Fatalf("seed membership %s: %v", id, err)
	}
}

// An invited / directly added member has no owner row in user_tenant. The model
// catalog must still resolve their tenant by membership: resolving by ownership
// returns an empty list, and the web client then reports every persisted model
// as "unavailable (deleted or no permission)" — the red banner on the knowledge
// search settings page.
func TestListTenantAddedModelsForInvitedMember(t *testing.T) {
	db := setupModelProviderServiceTestDB(t)
	useModelProviderServiceTestDB(t, db)
	seedReadableTenantScope(t, db)
	seedMembership(t, db, "user-tenant-member", "member-1", "tenant-1", string(permission.RoleNormal))

	models, code, err := NewModelProviderService().ListTenantAddedModels(t.Context(), "member-1", "", "")
	if err != nil || code != common.CodeSuccess {
		t.Fatalf("ListTenantAddedModels() = (%v, %v), want success", code, err)
	}
	if len(models) != 1 || models[0]["model_id"] != "model-1" {
		t.Fatalf("ListTenantAddedModels() = %v, want the tenant's chat model", models)
	}
	if types, ok := models[0]["model_type"].([]string); !ok || len(types) != 1 || types[0] != "chat" {
		t.Fatalf("model_type = %#v, want [chat]", models[0]["model_type"])
	}
}

// An explicit tenant the caller does not belong to stays a permission error: a
// silently ignored request would show another tenant's models.
func TestListTenantAddedModelsRejectsForeignTenant(t *testing.T) {
	db := setupModelProviderServiceTestDB(t)
	useModelProviderServiceTestDB(t, db)
	seedReadableTenantScope(t, db)
	seedMembership(t, db, "user-tenant-member", "member-1", "tenant-1", string(permission.RoleNormal))

	models, code, err := NewModelProviderService().ListTenantAddedModels(t.Context(), "member-1", "tenant-2", "")
	if err == nil || code == common.CodeSuccess {
		t.Fatalf("ListTenantAddedModels(foreign tenant) = (%v, %v, %v), want permission error", models, code, err)
	}
}

// A pending invitation row also carries status='1' and shows up in the readable
// tenant list, but the user is not a member yet and must not read its models.
func TestReadableTenantIDSkipsPendingInvitation(t *testing.T) {
	db := setupModelProviderServiceTestDB(t)
	useModelProviderServiceTestDB(t, db)
	seedReadableTenantScope(t, db)
	seedMembership(t, db, "user-tenant-invite", "invitee-1", "tenant-1", string(permission.RoleInvite))

	tenantID, err := readableTenantID(t.Context(), "invitee-1")
	if !errors.Is(err, permission.ErrMembershipNotFound) {
		t.Fatalf("readableTenantID(invitee) = (%q, %v), want ErrMembershipNotFound", tenantID, err)
	}
}
