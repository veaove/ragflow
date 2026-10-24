// Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package admin

import (
	"context"
	"strings"
	"testing"

	"ragflow/internal/entity"
	"ragflow/internal/ingestion/testutil"

	"gorm.io/gorm"
)

func setupPlatformModelDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := testutil.SetupTestDB(t,
		&entity.Tenant{},
		&entity.TenantModelProvider{},
		&entity.TenantModelInstance{},
		&entity.TenantModel{},
		&entity.TenantLLM{},
	)
	t.Cleanup(testutil.ReplaceDBForTest(t, db))

	nameA, nameB := "租户A", "租户B"
	statusValid := "1"
	if err := db.Create(&entity.Tenant{ID: "t-a", Name: &nameA, Status: &statusValid}).Error; err != nil {
		t.Fatalf("create tenant A: %v", err)
	}
	if err := db.Create(&entity.Tenant{ID: "t-b", Name: &nameB, Status: &statusValid}).Error; err != nil {
		t.Fatalf("create tenant B: %v", err)
	}

	providers := []entity.TenantModelProvider{
		{ID: "p-a", ProviderName: "Tongyi-Qianwen", TenantID: "t-a"},
		{ID: "p-b", ProviderName: "DeepSeek", TenantID: "t-b"},
	}
	for i := range providers {
		if err := db.Create(&providers[i]).Error; err != nil {
			t.Fatalf("create provider: %v", err)
		}
	}

	instances := []entity.TenantModelInstance{
		{ID: "i-a", InstanceName: "tongyi", ProviderID: "p-a", APIKey: "sk-a", Status: "active"},
		{ID: "i-b", InstanceName: "yidaitianjiao", ProviderID: "p-b", APIKey: "sk-b", Status: "active"},
	}
	for i := range instances {
		if err := db.Create(&instances[i]).Error; err != nil {
			t.Fatalf("create instance: %v", err)
		}
	}

	models := []entity.TenantModel{
		// 目录内模型：qwen-flash / text-embedding-v3 都在 conf/models/aliyun.json 里。
		{ID: "m-1", ModelName: "qwen-flash", ProviderID: "p-a", InstanceID: "i-a", ModelType: int(entity.ModelTypeChat), Status: "active"},
		{ID: "m-2", ModelName: "text-embedding-v3", ProviderID: "p-a", InstanceID: "i-a", ModelType: int(entity.ModelTypeEmbedding), Status: "active"},
		// 目录外模型：租户自建厂商加的模型名，平台目录里没有。
		{ID: "m-3", ModelName: "deepseek-v5-custom", ProviderID: "p-b", InstanceID: "i-b", ModelType: int(entity.ModelTypeChat), Status: "active"},
	}
	for i := range models {
		if err := db.Create(&models[i]).Error; err != nil {
			t.Fatalf("create tenant model: %v", err)
		}
	}

	// 历史表里留一条与 m-1 重复的引用，用来验证两张表 union 后不会重复计数。
	factory, llmName, modelType, llmStatus := "Tongyi-Qianwen", "qwen-flash", "chat", "1"
	if err := db.Create(&entity.TenantLLM{
		TenantID:   "t-a",
		LLMFactory: factory,
		LLMName:    &llmName,
		ModelType:  &modelType,
		Status:     llmStatus,
	}).Error; err != nil {
		t.Fatalf("create tenant llm: %v", err)
	}

	return db
}

// TestListPlatformModelsJoinsTenantReferences 覆盖「模型配置」页的核心口径：
// 目录行、引用数、租户数、目录外模型、以及 tenant_llm 与 tenant_model 的去重。
func TestListPlatformModelsJoinsTenantReferences(t *testing.T) {
	setupPlatformModelDB(t)
	ctx := context.Background()
	svc := NewService()

	page, err := svc.ListPlatformModels(ctx, PlatformModelQuery{Page: 1, PageSize: 20})
	if err != nil {
		t.Fatalf("ListPlatformModels: %v", err)
	}

	// 目录来自 conf/models，数量必须是几百级别；为 0 说明 provider 目录没加载。
	if page.Summary.ModelTotal < 500 {
		t.Fatalf("model_total = %d, want the built-in catalog to be loaded", page.Summary.ModelTotal)
	}
	if page.Summary.FactoryTotal < 10 {
		t.Errorf("factory_total = %d, want >= 10", page.Summary.FactoryTotal)
	}
	if page.Summary.ReferencedModelTotal != 3 {
		t.Errorf("referenced_model_total = %d, want 3", page.Summary.ReferencedModelTotal)
	}
	if page.Summary.TenantWithModelTotal != 2 {
		t.Errorf("tenant_with_model_total = %d, want 2", page.Summary.TenantWithModelTotal)
	}
	if page.Summary.TenantTotal != 2 {
		t.Errorf("tenant_total = %d, want 2", page.Summary.TenantTotal)
	}

	// 引用过的模型必须排在最前面，否则管理员得翻页才能看到有用信息。
	if len(page.List) == 0 {
		t.Fatal("empty page")
	}
	if page.List[0].ReferenceCount == 0 {
		t.Errorf("first row %q has no reference; referenced models must sort first", page.List[0].LLMName)
	}

	catalog, err := svc.ListPlatformModels(ctx, PlatformModelQuery{
		Page: 1, PageSize: 50, Keyword: "qwen-flash",
	})
	if err != nil {
		t.Fatalf("ListPlatformModels(qwen-flash): %v", err)
	}
	flash := findModel(t, catalog.List, "Tongyi-Qianwen", "qwen-flash")
	if !flash.InCatalog {
		t.Error("qwen-flash should be in the built-in catalog")
	}
	if flash.ReferenceCount != 1 {
		t.Errorf("qwen-flash reference_count = %d, want 1 (tenant_llm duplicate must be deduped)",
			flash.ReferenceCount)
	}
	if flash.TenantCount != 1 {
		t.Errorf("qwen-flash tenant_count = %d, want 1", flash.TenantCount)
	}
	if flash.References[0].TenantName != "租户A" {
		t.Errorf("qwen-flash tenant_name = %q, want 租户A", flash.References[0].TenantName)
	}
	if flash.References[0].ModelType != "chat" {
		t.Errorf("qwen-flash model_type = %q, want chat (bitmask must be decoded)",
			flash.References[0].ModelType)
	}
	if flash.References[0].InstanceName != "tongyi" {
		t.Errorf("qwen-flash instance = %q, want tongyi", flash.References[0].InstanceName)
	}

	// 目录外模型必须补进列表，否则真实用量会被漏掉。
	custom, err := svc.ListPlatformModels(ctx, PlatformModelQuery{
		Page: 1, PageSize: 50, Keyword: "deepseek-v5-custom",
	})
	if err != nil {
		t.Fatalf("ListPlatformModels(custom): %v", err)
	}
	outside := findModel(t, custom.List, "DeepSeek", "deepseek-v5-custom")
	if outside.InCatalog {
		t.Error("deepseek-v5-custom is not in conf/models, in_catalog must be false")
	}
	if len(outside.ModelTypes) != 1 || outside.ModelTypes[0] != "chat" {
		t.Errorf("deepseek-v5-custom model_types = %v, want [chat] derived from references",
			outside.ModelTypes)
	}
	if outside.ReferenceCount != 1 {
		t.Errorf("deepseek-v5-custom reference_count = %d, want 1", outside.ReferenceCount)
	}
}

// TestListPlatformModelsFilters 验证四个筛选条件真的生效，且 Total 跟着变。
func TestListPlatformModelsFilters(t *testing.T) {
	setupPlatformModelDB(t)
	ctx := context.Background()
	svc := NewService()

	referenced, err := svc.ListPlatformModels(ctx, PlatformModelQuery{
		Page: 1, PageSize: 200, ReferencedOnly: true,
	})
	if err != nil {
		t.Fatalf("ListPlatformModels(referenced): %v", err)
	}
	if referenced.Total != 3 {
		t.Errorf("referenced total = %d, want 3", referenced.Total)
	}
	for _, item := range referenced.List {
		if item.ReferenceCount == 0 {
			t.Errorf("%q leaked into referenced-only list", item.LLMName)
		}
	}

	// 「只看已引用 + embedding」应当只剩 text-embedding-v3 这一条。
	embedding, err := svc.ListPlatformModels(ctx, PlatformModelQuery{
		Page: 1, PageSize: 200, ReferencedOnly: true, ModelType: "embedding",
	})
	if err != nil {
		t.Fatalf("ListPlatformModels(embedding): %v", err)
	}
	if embedding.Total != 1 {
		t.Fatalf("referenced embedding total = %d, want 1: %+v", embedding.Total, modelNames(embedding.List))
	}
	if embedding.List[0].LLMName != "text-embedding-v3" {
		t.Errorf("embedding row = %q, want text-embedding-v3", embedding.List[0].LLMName)
	}

	byFactory, err := svc.ListPlatformModels(ctx, PlatformModelQuery{
		Page: 1, PageSize: 200, Factory: "DeepSeek", ReferencedOnly: true,
	})
	if err != nil {
		t.Fatalf("ListPlatformModels(factory): %v", err)
	}
	for _, item := range byFactory.List {
		if item.LLMFactory != "DeepSeek" {
			t.Errorf("factory filter leaked %q", item.LLMFactory)
		}
	}
	if byFactory.Total == 0 {
		t.Error("factory filter returned nothing, want the DeepSeek custom model")
	}

	// 分页必须稳定：两页拼起来不能有重复、不能漏。
	first, err := svc.ListPlatformModels(ctx, PlatformModelQuery{
		Page: 1, PageSize: 10, ReferencedOnly: true,
	})
	if err != nil {
		t.Fatalf("ListPlatformModels(page 1): %v", err)
	}
	second, err := svc.ListPlatformModels(ctx, PlatformModelQuery{
		Page: 2, PageSize: 10, ReferencedOnly: true,
	})
	if err != nil {
		t.Fatalf("ListPlatformModels(page 2): %v", err)
	}
	if len(first.List)+len(second.List) != 3 {
		t.Errorf("paged rows = %d + %d, want 3", len(first.List), len(second.List))
	}
	seen := make(map[string]struct{}, 3)
	for _, item := range append(append([]PlatformModelItem{}, first.List...), second.List...) {
		key := modelKey(item.LLMFactory, item.LLMName)
		if _, ok := seen[key]; ok {
			t.Errorf("duplicate row across pages: %s/%s", item.LLMFactory, item.LLMName)
		}
		seen[key] = struct{}{}
	}
}

// TestListPlatformModelsIgnoresRemovedRows 确保软删除/停用的配置不算引用。
func TestListPlatformModelsIgnoresRemovedRows(t *testing.T) {
	db := setupPlatformModelDB(t)
	ctx := context.Background()
	svc := NewService()

	// 停用租户 B 的模型：引用数应当从 3 掉到 2，且目录外模型消失。
	if err := db.Model(&entity.TenantModel{}).Where("id = ?", "m-3").
		Update("status", "disabled").Error; err != nil {
		t.Fatalf("disable model: %v", err)
	}
	// 历史表里软删除的租户引用也不能算。
	if err := db.Model(&entity.TenantLLM{}).Where("tenant_id = ?", "t-a").
		Update("status", "0").Error; err != nil {
		t.Fatalf("soft delete tenant_llm: %v", err)
	}

	page, err := svc.ListPlatformModels(ctx, PlatformModelQuery{Page: 1, PageSize: 200})
	if err != nil {
		t.Fatalf("ListPlatformModels: %v", err)
	}
	if page.Summary.ReferencedModelTotal != 2 {
		t.Errorf("referenced_model_total = %d, want 2 after disabling one model",
			page.Summary.ReferencedModelTotal)
	}
	if page.Summary.TenantWithModelTotal != 1 {
		t.Errorf("tenant_with_model_total = %d, want 1", page.Summary.TenantWithModelTotal)
	}
	for _, item := range page.List {
		if strings.EqualFold(item.LLMName, "deepseek-v5-custom") {
			t.Errorf("disabled model %q still listed", item.LLMName)
		}
	}
}

func findModel(t *testing.T, items []PlatformModelItem, factory, name string) PlatformModelItem {
	t.Helper()
	for _, item := range items {
		if item.LLMFactory == factory && item.LLMName == name {
			return item
		}
	}
	t.Fatalf("%s/%s not found in %v", factory, name, modelNames(items))
	return PlatformModelItem{}
}

func modelNames(items []PlatformModelItem) []string {
	names := make([]string, 0, len(items))
	for _, item := range items {
		names = append(names, item.LLMFactory+"/"+item.LLMName)
	}
	return names
}
