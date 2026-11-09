package component

import (
	"context"
	"errors"
	"net/url"
	"testing"

	"ragflow/internal/agent/runtime"
	"ragflow/internal/entity"
	"ragflow/internal/permission"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func TestCheckCanvasRetrievalDependencies(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+url.QueryEscape(t.Name())+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&entity.UserCanvas{}, &entity.Knowledgebase{}, &entity.Memory{}, &entity.UserTenant{}, &entity.ResourceGrant{}); err != nil {
		t.Fatalf("migrate permission tables: %v", err)
	}

	valid := string(entity.StatusValid)
	canvas := entity.UserCanvas{ID: "canvas-1", UserID: "canvas-owner", Permission: string(entity.TenantPermissionTeam)}
	dataset := entity.Knowledgebase{
		ID: "dataset-1", TenantID: "canvas-owner", CreatedBy: "canvas-owner",
		Permission: string(entity.TenantPermissionTeam), Status: &valid,
	}
	privateDataset := entity.Knowledgebase{
		ID: "private-dataset", TenantID: "other-owner", CreatedBy: "other-owner",
		Permission: string(entity.TenantPermissionMe), Status: &valid,
	}
	sharedMemory := entity.Memory{
		ID: "shared-memory", Name: "Shared", TenantID: "canvas-owner",
		Permissions: string(entity.TenantPermissionTeam),
	}
	callerOnlyMemory := entity.Memory{
		ID: "caller-only-memory", Name: "Caller only", TenantID: "caller",
		Permissions: string(entity.TenantPermissionMe),
	}
	ownerOnlyMemory := entity.Memory{
		ID: "owner-only-memory", Name: "Owner only", TenantID: "canvas-owner",
		Permissions: string(entity.TenantPermissionMe),
	}
	for _, row := range []any{&canvas, &dataset, &privateDataset, &sharedMemory, &callerOnlyMemory, &ownerOnlyMemory} {
		if err := db.Create(row).Error; err != nil {
			t.Fatalf("create permission resource: %v", err)
		}
	}
	memberships := []entity.UserTenant{
		{ID: "canvas-owner-membership", UserID: "canvas-owner", TenantID: "canvas-owner", Role: string(permission.RoleOwner), Status: &valid},
		{ID: "caller-membership", UserID: "caller", TenantID: "canvas-owner", Role: string(permission.RoleNormal), Status: &valid},
		{ID: "dataset-owner-membership", UserID: "other-owner", TenantID: "other-owner", Role: string(permission.RoleOwner), Status: &valid},
	}
	for i := range memberships {
		if err := db.Create(&memberships[i]).Error; err != nil {
			t.Fatalf("create membership: %v", err)
		}
	}
	// team 档只覆盖租户管理层：调用方对画布、库、共享记忆都要有显式授权。
	for _, grant := range []entity.ResourceGrant{
		{ID: "grant-canvas", TenantID: "canvas-owner", ResourceKind: string(permission.ResourceKindCanvas), ResourceID: canvas.ID},
		{ID: "grant-dataset", TenantID: "canvas-owner", ResourceKind: string(permission.ResourceKindDataset), ResourceID: dataset.ID},
		{ID: "grant-memory", TenantID: "canvas-owner", ResourceKind: string(permission.ResourceKindMemory), ResourceID: sharedMemory.ID},
	} {
		grant.SubjectKind = entity.GrantSubjectUser
		grant.SubjectID = "caller"
		grant.Permission = "edit"
		grant.Effect = entity.GrantEffectAllow
		if err := db.Create(&grant).Error; err != nil {
			t.Fatalf("create grant %s: %v", grant.ID, err)
		}
	}

	state := runtime.NewCanvasState("run-1", "session-1")
	state.Sys["canvas_id"] = canvas.ID
	state.Sys["user_id"] = "caller"
	ctx := runtime.WithState(t.Context(), state)

	if err := checkCanvasRetrievalDependencies(ctx, db, map[string]any{"dataset_ids": []string{dataset.ID}}); err != nil {
		t.Fatalf("check accessible dataset dependency: %v", err)
	}
	if err := checkCanvasRetrievalDependencies(ctx, db, map[string]any{"dataset_ids": []string{privateDataset.ID}}); !errors.Is(err, permission.ErrPermissionDenied) {
		t.Fatalf("check private dataset dependency error = %v, want permission denied", err)
	}
	if err := checkCanvasRetrievalDependencies(ctx, db, map[string]any{"memory_ids": []string{sharedMemory.ID}}); err != nil {
		t.Fatalf("check shared memory dependency: %v", err)
	}
	if err := checkCanvasRetrievalDependencies(ctx, db, map[string]any{
		"retrieval_from": "memory",
		"dataset_ids":    []string{privateDataset.ID},
		"memory_ids":     []string{sharedMemory.ID},
	}); err != nil {
		t.Fatalf("memory retrieval should ignore inactive dataset bindings: %v", err)
	}
	if err := checkCanvasRetrievalDependencies(ctx, db, map[string]any{
		"retrieval_from": "dataset",
		"dataset_ids":    []string{dataset.ID},
		"memory_ids":     []string{ownerOnlyMemory.ID},
	}); err != nil {
		t.Fatalf("dataset retrieval should ignore inactive memory bindings: %v", err)
	}
	for _, memoryID := range []string{callerOnlyMemory.ID, ownerOnlyMemory.ID} {
		if err := checkCanvasRetrievalDependencies(ctx, db, map[string]any{"memory_ids": []string{memoryID}}); !errors.Is(err, permission.ErrPermissionDenied) {
			t.Fatalf("check non-intersection memory %q error = %v, want permission denied", memoryID, err)
		}
	}

	missingCanvasState := runtime.NewCanvasState("run-2", "session-2")
	missingCanvasState.Sys["user_id"] = "caller"
	if err := checkCanvasRetrievalDependencies(runtime.WithState(t.Context(), missingCanvasState), db, nil); !errors.Is(err, permission.ErrInvalidPermission) {
		t.Fatalf("check missing canvas identity error = %v, want invalid permission", err)
	}
}

// allow_partial_kb 默认必须为 true：存量画布没有这个参数，要让它们立刻按可
// 见库返回，而不是整轮失败。
func TestAllowPartialRetrievalKBDefaultsToTrue(t *testing.T) {
	if !allowPartialRetrievalKB(map[string]any{}) {
		t.Error("allowPartialRetrievalKB(empty) = false, want true")
	}
	if !allowPartialRetrievalKB(map[string]any{"allow_partial_kb": "true"}) {
		t.Error("allowPartialRetrievalKB(non-bool) = false, want the default true")
	}
	if allowPartialRetrievalKB(map[string]any{"allow_partial_kb": false}) {
		t.Error("allowPartialRetrievalKB(explicit false) = true, want false")
	}
}

// 非画布调用没有入口依赖，绑定原样保留，交给各自的资源校验。
func TestCheckCanvasRetrievalDependenciesKeepsBindingsOutsideCanvas(t *testing.T) {
	inputs := map[string]any{"dataset_ids": []string{"dataset-a", "dataset-b"}}
	if err := checkCanvasRetrievalDependencies(context.Background(), nil, inputs); err != nil {
		t.Fatalf("checkCanvasRetrievalDependencies(outside canvas) error = %v", err)
	}
	if got, _ := inputs["dataset_ids"].([]string); len(got) != 2 {
		t.Fatalf("dataset_ids = %v, want both bindings kept", inputs["dataset_ids"])
	}
}
