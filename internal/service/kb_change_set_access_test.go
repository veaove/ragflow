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
	"context"
	"errors"
	"testing"

	"ragflow/internal/entity"
)

// 只读授权（resource_grant.permission=read）的成员必须能打开变更中心：
// 列待生效变更、看 diff、跑测试对比都是读操作，早期统一按 update 判定，页面
// 一进来就被折成「数据集不存在」。写操作仍然要拒，而且要说清是只读，不能
// 继续谎报「库不存在」。
func TestChangeSetReadOnlyMemberReadsButCannotWrite(t *testing.T) {
	db := setupServiceTestDB(t)
	pushServiceDB(t, db)

	const (
		tenantID = "tenant-cs"
		kbID     = "kb-cs"
		memberID = "member-cs"
	)
	valid := string(entity.StatusValid)
	enabled := true
	tenantName := "变更中心只读"
	if err := db.Create(&entity.Tenant{ID: tenantID, Name: &tenantName, Enabled: &enabled}).Error; err != nil {
		t.Fatalf("seed tenant: %v", err)
	}
	if err := db.Create(&entity.User{ID: memberID, Email: "member-cs@example.com"}).Error; err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if err := db.Create(&entity.UserTenant{
		ID: "ut-cs", UserID: memberID, TenantID: tenantID, Role: "normal", Status: &valid,
	}).Error; err != nil {
		t.Fatalf("seed membership: %v", err)
	}
	if err := db.Create(&entity.Knowledgebase{
		ID: kbID, TenantID: tenantID, Name: "只读库", CreatedBy: "owner-cs",
		Permission: entity.ResourceVisibilityTenantOwner, Status: &valid,
	}).Error; err != nil {
		t.Fatalf("seed knowledge base: %v", err)
	}
	if err := db.Create(&entity.ResourceGrant{
		ID: "g-cs", TenantID: tenantID, ResourceKind: "dataset", ResourceID: kbID,
		SubjectKind: entity.GrantSubjectUser, SubjectID: memberID,
		Permission: "read", Effect: entity.GrantEffectAllow,
	}).Error; err != nil {
		t.Fatalf("seed grant: %v", err)
	}
	// 一条待生效变更集：要证明的是列表真的读到了这行，而不只是「没报错」。
	if err := db.Create(&entity.KbChangeSet{
		ID: "cs-cs", KbID: kbID, TenantID: tenantID, CreatedBy: memberID,
		Status: entity.ChangeSetStatusOpen,
	}).Error; err != nil {
		t.Fatalf("seed change set: %v", err)
	}

	svc := NewChangeSetService()
	ctx := context.Background()

	sets, err := svc.ListChangeSets(ctx, memberID, kbID)
	if err != nil {
		t.Fatalf("只读成员 ListChangeSets error = %v, want nil", err)
	}
	if len(sets) != 1 || sets[0].ID != "cs-cs" {
		t.Fatalf("只读成员 ListChangeSets = %#v, want [cs-cs]", sets)
	}

	// diff 入口同样放行：变更集不存在时报 not found，而不是权限错误。
	if _, err := svc.GetChangeSetDiff(ctx, memberID, kbID, "missing"); !errors.Is(err, ErrChangeSetNotFound) {
		t.Fatalf("只读成员 GetChangeSetDiff(missing) error = %v, want %v", err, ErrChangeSetNotFound)
	}

	// 写入口按 update 判定：被拒，且报「只读」而不是「库不存在」。
	if _, err := svc.CreateChangeSet(ctx, memberID, kbID); !errors.Is(err, ErrDatasetReadOnly) {
		t.Fatalf("只读成员 CreateChangeSet error = %v, want %v", err, ErrDatasetReadOnly)
	}
	if _, err := svc.GetOrCreateChangeSet(ctx, memberID, kbID); !errors.Is(err, ErrDatasetReadOnly) {
		t.Fatalf("只读成员 GetOrCreateChangeSet error = %v, want %v", err, ErrDatasetReadOnly)
	}
}

// 完全读不到的库仍然报「不存在」：只读与不可见是两件事，不能因为新增
// ErrDatasetReadOnly 就把不可见也暴露成「库还在，只是只读」。
func TestChangeSetInvisibleDatasetStaysNotFound(t *testing.T) {
	db := setupServiceTestDB(t)
	pushServiceDB(t, db)

	const (
		tenantID = "tenant-cs-hidden"
		kbID     = "kb-hidden"
		outsider = "outsider-cs"
	)
	valid := string(entity.StatusValid)
	enabled := true
	tenantName := "变更中心不可见"
	if err := db.Create(&entity.Tenant{ID: tenantID, Name: &tenantName, Enabled: &enabled}).Error; err != nil {
		t.Fatalf("seed tenant: %v", err)
	}
	if err := db.Create(&entity.User{ID: outsider, Email: "outsider-cs@example.com"}).Error; err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if err := db.Create(&entity.UserTenant{
		ID: "ut-hidden", UserID: outsider, TenantID: tenantID, Role: "normal", Status: &valid,
	}).Error; err != nil {
		t.Fatalf("seed membership: %v", err)
	}
	// permission=owner：除了创建者本人，同租户成员看不到，也没有任何授权。
	if err := db.Create(&entity.Knowledgebase{
		ID: kbID, TenantID: tenantID, Name: "别人的私库", CreatedBy: "someone-else",
		Permission: entity.ResourceVisibilityOwner, Status: &valid,
	}).Error; err != nil {
		t.Fatalf("seed knowledge base: %v", err)
	}

	svc := NewChangeSetService()
	ctx := context.Background()
	if _, err := svc.ListChangeSets(ctx, outsider, kbID); !errors.Is(err, ErrDatasetNotFound) {
		t.Fatalf("不可见库 ListChangeSets error = %v, want %v", err, ErrDatasetNotFound)
	}
	if _, err := svc.CreateChangeSet(ctx, outsider, kbID); !errors.Is(err, ErrDatasetNotFound) {
		t.Fatalf("不可见库 CreateChangeSet error = %v, want %v", err, ErrDatasetNotFound)
	}
}
