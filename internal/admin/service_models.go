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

package admin

import (
	"context"
	"sort"
	"strings"

	"ragflow/internal/dao"
	"ragflow/internal/entity"
)

// 本文件提供「模型配置」页所需的两个数据面：
//
//  1. 平台模型目录：conf/models/*.json 解析出的厂商 × 模型清单，即平台对
//     所有租户暴露的可选模型全集（当前 76 个厂商 / 919 个模型）。
//  2. 租户引用：tenant_model（现行）与 tenant_llm（历史表）里「某租户正在
//     使用某模型」的事实行。
//
// 为什么不拿 llm 表当目录：llm 表是「平台登记过的模型」，现网整表为空，
// 用它做列表会渲染出空页面；conf/models 则是随二进制发版的稳定全集。
// 反过来，租户自建 provider 能添加目录里没有的模型名，所以这些「目录外
// 但被引用」的模型必须补进列表（InCatalog=false），否则会漏掉真实用量。

// ModelReference 是「某租户正在使用某模型」的一条事实。
type ModelReference struct {
	TenantID   string `json:"tenant_id"`
	TenantName string `json:"tenant_name"`
	// ProviderName 是厂商名，与模型目录里的 factory 同一口径。
	ProviderName string `json:"provider_name"`
	// InstanceName 是租户给这个厂商起的接入实例名（同一厂商可有多套 API Key）。
	InstanceName string `json:"instance_name"`
	// ModelType 用可读名（chat/embedding/asr/vision/rerank/tts/ocr），不是位掩码。
	ModelType string `json:"model_type"`
	Status    string `json:"status"`
	// Source 区分数据来源：tenant_model 为现行模型配置，tenant_llm 为历史表。
	Source string `json:"source"`
}

// PlatformModelItem 是模型列表的一行：目录信息 + 引用汇总。
type PlatformModelItem struct {
	LLMName       string   `json:"llm_name"`
	LLMFactory    string   `json:"llm_factory"`
	ModelTypes    []string `json:"model_types"`
	ContextLength *int     `json:"context_length"`
	MaxOutput     *int     `json:"max_output"`
	// InCatalog 为 false 表示这是租户自建 provider 添加的模型，平台目录里没有。
	InCatalog      bool             `json:"in_catalog"`
	ReferenceCount int              `json:"reference_count"`
	TenantCount    int              `json:"tenant_count"`
	References     []ModelReference `json:"references"`
}

// ModelFactorySummary 厂商筛选项。
type ModelFactorySummary struct {
	Name            string `json:"name"`
	ModelCount      int    `json:"model_count"`
	ReferencedCount int    `json:"referenced_count"`
}

// ModelTypeSummary 模型类型筛选项。
type ModelTypeSummary struct {
	Value string `json:"value"`
	Count int    `json:"count"`
}

// PlatformModelSummary 页面顶部统计。
//
// 口径固定为「平台全量」，不随筛选条件变化——筛选只影响列表和 Total。
type PlatformModelSummary struct {
	ModelTotal           int `json:"model_total"`
	FactoryTotal         int `json:"factory_total"`
	ReferencedModelTotal int `json:"referenced_model_total"`
	TenantTotal          int `json:"tenant_total"`
	TenantWithModelTotal int `json:"tenant_with_model_total"`
}

// PlatformModelPage 是 GET /admin/models 的响应体。
type PlatformModelPage struct {
	List       []PlatformModelItem   `json:"list"`
	Total      int                   `json:"total"`
	Summary    PlatformModelSummary  `json:"summary"`
	Factories  []ModelFactorySummary `json:"factories"`
	ModelTypes []ModelTypeSummary    `json:"model_types"`
}

// PlatformModelQuery 是模型列表的筛选/分页条件。
type PlatformModelQuery struct {
	Page      int
	PageSize  int
	Keyword   string
	ModelType string
	Factory   string
	// ReferencedOnly 只看被租户引用过的模型。
	ReferencedOnly bool
}

// modelKey 用「厂商 + 模型名」定位一个模型。
//
// 同名模型可能挂在不同厂商下（例如 gpt-4o 走 OpenAI 和走 Azure），因此必须
// 带上厂商。统一转小写，避免租户侧写入的大小写差异造成漏匹配。
func modelKey(factory, modelName string) string {
	return strings.ToLower(strings.TrimSpace(factory)) + "\x00" + strings.ToLower(strings.TrimSpace(modelName))
}

// modelRefIndex 是把「所有租户引用」按模型归组后的索引。
type modelRefIndex struct {
	// byKey 模型关键字 → 引用明细，已按租户名排序。
	byKey map[string][]ModelReference
	// names 模型关键字 → 数据库里的原始厂商名/模型名，用于回显目录外模型。
	names map[string]modelKeyName
}

// modelKeyName 保存一个模型的原始大小写名称。
type modelKeyName struct {
	Factory string
	Model   string
}

// loadModelReferences 汇总所有租户引用，按 modelKey 分组。
//
// 两张表 union 后按 (租户, 模型, 类型, 实例) 去重：tenant_llm 是历史表，
// 迁移后可能与 tenant_model 同时存在同一份引用，不去重会把引用数翻倍。
func (s *Service) loadModelReferences(ctx context.Context) (*modelRefIndex, error) {
	db := dao.DB.WithContext(ctx)

	index := &modelRefIndex{
		byKey: make(map[string][]ModelReference),
		names: make(map[string]modelKeyName),
	}
	seen := make(map[string]struct{})

	add := func(key string, ref ModelReference, factory, model string) {
		if _, ok := index.names[key]; !ok {
			index.names[key] = modelKeyName{Factory: factory, Model: model}
		}
		// Source 不参与去重：同一份引用被两张表同时记录时只算一次。
		dedupe := strings.Join([]string{ref.TenantID, key, ref.ModelType, ref.InstanceName}, "|")
		if _, ok := seen[dedupe]; ok {
			return
		}
		seen[dedupe] = struct{}{}
		index.byKey[key] = append(index.byKey[key], ref)
	}

	// 1) 现行模型配置：tenant_model → provider → instance。
	//
	// tenant_model.model_type 是位掩码（1=chat 2=embedding 4=asr 8=vision
	// 16=rerank 32=tts 64=ocr），用 entity.ModelType 的可读名输出，前端不必
	// 再懂位运算。
	type tenantModelRow struct {
		TenantID     string
		TenantName   string
		ProviderName string
		InstanceName string
		ModelName    string
		ModelType    int
		Status       string
	}
	var tenantModelRows []tenantModelRow
	if err := db.Raw(`
		SELECT p.tenant_id AS tenant_id,
		       IFNULL(t.name, '') AS tenant_name,
		       IFNULL(p.provider_name, '') AS provider_name,
		       IFNULL(i.instance_name, '') AS instance_name,
		       IFNULL(m.model_name, '') AS model_name,
		       m.model_type AS model_type,
		       IFNULL(m.status, '') AS status
		FROM tenant_model m
		JOIN tenant_model_provider p ON p.id = m.provider_id
		LEFT JOIN tenant t ON t.id = p.tenant_id
		LEFT JOIN tenant_model_instance i ON i.id = m.instance_id
		WHERE IFNULL(m.model_name, '') <> ''
	`).Scan(&tenantModelRows).Error; err != nil {
		return nil, err
	}
	for _, row := range tenantModelRows {
		// status='active' 才是生效配置；其他值代表租户已停用/删除该模型。
		if row.Status != "" && row.Status != "active" {
			continue
		}
		add(modelKey(row.ProviderName, row.ModelName), ModelReference{
			TenantID:     row.TenantID,
			TenantName:   tenantDisplayName(row.TenantName, row.TenantID),
			ProviderName: row.ProviderName,
			InstanceName: row.InstanceName,
			ModelType:    strings.Join(entity.ModelType(row.ModelType).HumanReadable(), ","),
			Status:       "active",
			Source:       "tenant_model",
		}, row.ProviderName, row.ModelName)
	}

	// 2) 历史表：tenant_llm。status='1' 表示仍生效（'0' 是软删除）。
	type tenantLLMRow struct {
		TenantID   string
		TenantName string
		LLMFactory string
		LLMName    string
		ModelType  string
		Status     string
	}
	var tenantLLMRows []tenantLLMRow
	if err := db.Raw(`
		SELECT tl.tenant_id AS tenant_id,
		       IFNULL(t.name, '') AS tenant_name,
		       IFNULL(tl.llm_factory, '') AS llm_factory,
		       IFNULL(tl.llm_name, '') AS llm_name,
		       IFNULL(tl.model_type, '') AS model_type,
		       IFNULL(tl.status, '') AS status
		FROM tenant_llm tl
		LEFT JOIN tenant t ON t.id = tl.tenant_id
		WHERE IFNULL(tl.llm_name, '') <> ''
	`).Scan(&tenantLLMRows).Error; err != nil {
		return nil, err
	}
	for _, row := range tenantLLMRows {
		if row.Status != "" && row.Status != "1" {
			continue
		}
		add(modelKey(row.LLMFactory, row.LLMName), ModelReference{
			TenantID:     row.TenantID,
			TenantName:   tenantDisplayName(row.TenantName, row.TenantID),
			ProviderName: row.LLMFactory,
			ModelType:    row.ModelType,
			Status:       "active",
			Source:       "tenant_llm",
		}, row.LLMFactory, row.LLMName)
	}

	// 引用明细排序固定，避免 Go map 随机序让前端每次刷新都在换顺序。
	for key := range index.byKey {
		refs := index.byKey[key]
		sort.Slice(refs, func(i, j int) bool {
			if refs[i].TenantName != refs[j].TenantName {
				return refs[i].TenantName < refs[j].TenantName
			}
			if refs[i].InstanceName != refs[j].InstanceName {
				return refs[i].InstanceName < refs[j].InstanceName
			}
			return refs[i].ModelType < refs[j].ModelType
		})
		index.byKey[key] = refs
	}

	return index, nil
}

// tenantDisplayName 在租户已被删除（LEFT JOIN 取不到名字）时回落到 id，
// 避免页面上出现一排空白的租户名。
func tenantDisplayName(name, tenantID string) string {
	if strings.TrimSpace(name) != "" {
		return name
	}
	return tenantID
}

// ListPlatformModels 返回平台模型目录 + 租户引用情况。
//
// 全量目录只有几百条且根本不在数据库里，所以在 Go 里做筛选/排序/分页，
// 比下推 SQL 简单。引用表最多是「租户数 × 模型数」量级，一次全取即可。
func (s *Service) ListPlatformModels(ctx context.Context, query PlatformModelQuery) (*PlatformModelPage, error) {
	refs, err := s.loadModelReferences(ctx)
	if err != nil {
		return nil, err
	}

	// 目录里的全部模型。同一厂商内同名模型只保留一条（配置里不该重复，
	// 真出现重复时合并，避免列表里出现两行一样的）。
	items := make([]PlatformModelItem, 0, 1024)
	catalogKeys := make(map[string]struct{}, 1024)
	if manager := dao.GetModelProviderManager(); manager != nil {
		for _, provider := range manager.Providers {
			for _, model := range provider.Models {
				if model == nil {
					continue
				}
				key := modelKey(provider.Name, model.Name)
				if _, ok := catalogKeys[key]; ok {
					continue
				}
				catalogKeys[key] = struct{}{}
				items = append(items, PlatformModelItem{
					LLMName:       model.Name,
					LLMFactory:    provider.Name,
					ModelTypes:    model.ModelTypes,
					ContextLength: model.ContextLength,
					MaxOutput:     model.MaxOutput,
					InCatalog:     true,
				})
			}
		}
	}

	// 补上「被引用但不在目录里」的模型（租户自建 provider 自己加的模型名）。
	extraKeys := make([]string, 0, len(refs.byKey))
	for key := range refs.byKey {
		if _, ok := catalogKeys[key]; !ok {
			extraKeys = append(extraKeys, key)
		}
	}
	sort.Strings(extraKeys)
	for _, key := range extraKeys {
		name := refs.names[key]
		items = append(items, PlatformModelItem{
			LLMName:    name.Model,
			LLMFactory: name.Factory,
			ModelTypes: modelTypesOfRefs(refs.byKey[key]),
			InCatalog:  false,
		})
	}

	// 挂引用 + 平台全量统计。
	summary := PlatformModelSummary{ModelTotal: len(items)}
	factoryMap := make(map[string]*ModelFactorySummary)
	typeMap := make(map[string]int)
	referencedTenants := make(map[string]struct{})

	for i := range items {
		item := &items[i]
		item.References = refs.byKey[modelKey(item.LLMFactory, item.LLMName)]
		if len(item.References) == 0 {
			// 空切片而不是 null，前端可以无条件 .length / map。
			item.References = []ModelReference{}
		} else {
			item.ReferenceCount = len(item.References)
			tenants := make(map[string]struct{}, len(item.References))
			for _, ref := range item.References {
				tenants[ref.TenantID] = struct{}{}
				referencedTenants[ref.TenantID] = struct{}{}
			}
			item.TenantCount = len(tenants)
			summary.ReferencedModelTotal++
		}

		factory := factoryMap[item.LLMFactory]
		if factory == nil {
			factory = &ModelFactorySummary{Name: item.LLMFactory}
			factoryMap[item.LLMFactory] = factory
		}
		factory.ModelCount++
		if item.ReferenceCount > 0 {
			factory.ReferencedCount++
		}

		if len(item.ModelTypes) == 0 {
			typeMap[modelTypeUnknown]++
		}
		for _, mt := range item.ModelTypes {
			typeMap[mt]++
		}
	}

	summary.FactoryTotal = len(factoryMap)
	summary.TenantWithModelTotal = len(referencedTenants)
	tenantTotal, err := countOf(dao.DB.WithContext(ctx), "SELECT COUNT(*) FROM tenant")
	if err != nil {
		return nil, err
	}
	summary.TenantTotal = int(tenantTotal)

	// 筛选。
	keyword := strings.ToLower(strings.TrimSpace(query.Keyword))
	modelType := strings.ToLower(strings.TrimSpace(query.ModelType))
	factoryFilter := strings.TrimSpace(query.Factory)
	filtered := make([]PlatformModelItem, 0, len(items))
	for _, item := range items {
		if query.ReferencedOnly && item.ReferenceCount == 0 {
			continue
		}
		if factoryFilter != "" && item.LLMFactory != factoryFilter {
			continue
		}
		if modelType != "" && modelType != modelTypeUnknown && !hasModelType(item, modelType) {
			continue
		}
		if keyword != "" &&
			!strings.Contains(strings.ToLower(item.LLMName), keyword) &&
			!strings.Contains(strings.ToLower(item.LLMFactory), keyword) {
			continue
		}
		filtered = append(filtered, item)
	}

	// 排序：被引用的排前面（引用数降序），其余按厂商 + 模型名，保证分页稳定。
	sort.SliceStable(filtered, func(i, j int) bool {
		if filtered[i].ReferenceCount != filtered[j].ReferenceCount {
			return filtered[i].ReferenceCount > filtered[j].ReferenceCount
		}
		if filtered[i].LLMFactory != filtered[j].LLMFactory {
			return filtered[i].LLMFactory < filtered[j].LLMFactory
		}
		return filtered[i].LLMName < filtered[j].LLMName
	})

	total := len(filtered)

	page := query.Page
	if page < 1 {
		page = 1
	}
	pageSize := query.PageSize
	if pageSize < 1 {
		pageSize = 20
	}
	start := (page - 1) * pageSize
	if start > total {
		start = total
	}
	end := start + pageSize
	if end > total {
		end = total
	}
	paged := make([]PlatformModelItem, end-start)
	copy(paged, filtered[start:end])

	factories := make([]ModelFactorySummary, 0, len(factoryMap))
	for _, f := range factoryMap {
		factories = append(factories, *f)
	}
	sort.Slice(factories, func(i, j int) bool {
		return factories[i].Name < factories[j].Name
	})

	modelTypes := make([]ModelTypeSummary, 0, len(typeMap))
	for value, count := range typeMap {
		modelTypes = append(modelTypes, ModelTypeSummary{Value: value, Count: count})
	}
	sort.Slice(modelTypes, func(i, j int) bool {
		return modelTypes[i].Value < modelTypes[j].Value
	})

	return &PlatformModelPage{
		List:       paged,
		Total:      total,
		Summary:    summary,
		Factories:  factories,
		ModelTypes: modelTypes,
	}, nil
}

// modelTypeUnknown 是「目录外且引用里也没写类型」的兜底类型，前端显示为「未知」。
const modelTypeUnknown = "unknown"

// hasModelType 判断模型是否属于给定类型。目录外模型的 ModelTypes 可能是
// 从引用反推的，也可能是空的，因此再兜一层引用里的 model_type。
func hasModelType(item PlatformModelItem, modelType string) bool {
	for _, mt := range item.ModelTypes {
		if strings.EqualFold(mt, modelType) {
			return true
		}
	}
	for _, ref := range item.References {
		if strings.EqualFold(ref.ModelType, modelType) {
			return true
		}
	}
	return false
}

// modelTypesOfRefs 用引用记录里的类型作为目录外模型的类型，去重且保序。
func modelTypesOfRefs(refs []ModelReference) []string {
	out := make([]string, 0, 2)
	seen := make(map[string]struct{}, 2)
	for _, ref := range refs {
		if ref.ModelType == "" {
			continue
		}
		if _, ok := seen[ref.ModelType]; ok {
			continue
		}
		seen[ref.ModelType] = struct{}{}
		out = append(out, ref.ModelType)
	}
	return out
}
