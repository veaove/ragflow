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

// Package kgview turns extracted entity/relation rows into the browseable
// domain knowledge graph the UI renders: canonical entity/relation types,
// normalized names, corroboration-based confidence and per-relation evidence.
//
// The package is deliberately engine-free. Callers hand it already-projected
// rows (see internal/service/knowledge_graph_view.go) so every rule that
// changes what a user sees — type normalization, alias merging, confidence —
// is unit-testable without MySQL/Elasticsearch.
package kgview

import (
	"strings"

	"golang.org/x/text/unicode/norm"
)

// Domains the taxonomy knows about. A graph is never restricted to one domain;
// the inferred domain only picks the label set the UI shows first.
const (
	DomainFinance = "finance"
	DomainAuto    = "auto"
	DomainGeneric = "generic"
)

// EntityTypeSpec is one canonical entity type. Type is the stable id used by
// the API and the filters; Label/Color/Icon are presentation, bound to the
// business role so the same type always looks the same (rules orange, risk or
// regulation red) instead of being randomly coloured per run.
type EntityTypeSpec struct {
	Type   string `json:"type"`
	Label  string `json:"label"`
	Color  string `json:"color"`
	Icon   string `json:"icon"`
	Domain string `json:"domain"`
}

// RelationTypeSpec is one canonical relation type.
type RelationTypeSpec struct {
	Type  string `json:"type"`
	Label string `json:"label"`
}

var entityTypeSpecs = []EntityTypeSpec{
	// finance
	{Type: "fund_company", Label: "基金公司", Color: "#2563eb", Icon: "🏢", Domain: DomainFinance},
	{Type: "fund_product", Label: "基金产品", Color: "#7c3aed", Icon: "📈", Domain: DomainFinance},
	{Type: "rule", Label: "交易规则", Color: "#ea580c", Icon: "⚙️", Domain: DomainFinance},
	{Type: "risk", Label: "风险等级", Color: "#dc2626", Icon: "⚠️", Domain: DomainFinance},
	{Type: "regulator", Label: "监管机构", Color: "#57534e", Icon: "🏛️", Domain: DomainFinance},
	// auto
	{Type: "oem", Label: "整车厂", Color: "#2563eb", Icon: "🏭", Domain: DomainAuto},
	{Type: "vehicle_model", Label: "车型", Color: "#7c3aed", Icon: "🚗", Domain: DomainAuto},
	{Type: "component", Label: "零部件", Color: "#ea580c", Icon: "⚙️", Domain: DomainAuto},
	{Type: "supplier", Label: "供应商", Color: "#639922", Icon: "🔧", Domain: DomainAuto},
	{Type: "plant", Label: "工厂", Color: "#57534e", Icon: "🏗️", Domain: DomainAuto},
	{Type: "standard", Label: "法规标准", Color: "#dc2626", Icon: "📋", Domain: DomainAuto},
	// shared
	{Type: "organization", Label: "组织", Color: "#2563eb", Icon: "🏢", Domain: DomainGeneric},
	{Type: "person", Label: "人物", Color: "#0891b2", Icon: "👤", Domain: DomainGeneric},
	{Type: "concept", Label: "业务概念", Color: "#0891b2", Icon: "🧩", Domain: DomainGeneric},
	{Type: "location", Label: "地点", Color: "#639922", Icon: "📍", Domain: DomainGeneric},
	{Type: "event", Label: "事件", Color: "#ba7517", Icon: "📅", Domain: DomainGeneric},
	{Type: "document", Label: "文档", Color: "#6b6a64", Icon: "📄", Domain: DomainGeneric},
	{Type: "metric", Label: "指标", Color: "#0891b2", Icon: "📊", Domain: DomainGeneric},
	{Type: "other", Label: "其他", Color: "#9a998f", Icon: "•", Domain: DomainGeneric},
}

var relationTypeSpecs = []RelationTypeSpec{
	{Type: "issue", Label: "发行"},
	{Type: "applies_to", Label: "适用"},
	{Type: "adopts", Label: "采用"},
	{Type: "supports", Label: "支持"},
	{Type: "constrains", Label: "约束"},
	{Type: "requires", Label: "需要"},
	{Type: "publishes", Label: "发布"},
	{Type: "regulated_by", Label: "受监管"},
	{Type: "produces", Label: "生产"},
	{Type: "assembles", Label: "装配"},
	{Type: "supplies", Label: "供应"},
	{Type: "produced_at", Label: "生产于"},
	{Type: "complies_with", Label: "符合"},
	{Type: "part_of", Label: "属于"},
	{Type: "subsidiary_of", Label: "隶属"},
	{Type: "holds", Label: "持股"},
	{Type: "cooperates", Label: "合作"},
	{Type: "located_in", Label: "位于"},
	{Type: "related", Label: "相关"},
}

var (
	entityTypeByID = func() map[string]EntityTypeSpec {
		index := make(map[string]EntityTypeSpec, len(entityTypeSpecs))
		for _, spec := range entityTypeSpecs {
			index[spec.Type] = spec
		}
		return index
	}()

	relationTypeByID = func() map[string]RelationTypeSpec {
		index := make(map[string]RelationTypeSpec, len(relationTypeSpecs))
		for _, spec := range relationTypeSpecs {
			index[spec.Type] = spec
		}
		return index
	}()
)

// entityTypeAliases maps normalized raw type words to canonical ids. Extraction
// emits free-form types ("公司", "Organization", "标的公司"), so without this
// table one concept shatters into a dozen legend rows.
var entityTypeAliases = map[string]string{
	// finance
	"基金公司": "fund_company", "基金管理公司": "fund_company", "基金管理人": "fund_company", "fundcompany": "fund_company",
	"基金": "fund_product", "基金产品": "fund_product", "基金份额": "fund_product", "fund": "fund_product", "fundproduct": "fund_product",
	"产品": "fund_product", "金融产品": "fund_product", "product": "fund_product",
	"规则": "rule", "交易规则": "rule", "条款": "rule", "rule": "rule", "regulationrule": "rule",
	"风险": "risk", "风险等级": "risk", "risk": "risk", "risklevel": "risk",
	"监管机构": "regulator", "监管": "regulator", "监管方": "regulator", "regulator": "regulator", "authority": "regulator",
	// auto
	"整车厂": "oem", "主机厂": "oem", "oem": "oem", "整车企业": "oem",
	"车型": "vehicle_model", "车辆": "vehicle_model", "车款": "vehicle_model", "model": "vehicle_model", "vehicle": "vehicle_model", "carmodel": "vehicle_model",
	"零部件": "component", "零件": "component", "部件": "component", "总成": "component", "part": "component", "component": "component",
	"供应商": "supplier", "厂商": "supplier", "supplier": "supplier", "vendor": "supplier",
	"工厂": "plant", "产线": "plant", "基地": "plant", "plant": "plant", "factory": "plant",
	"法规标准": "standard", "法规": "standard", "标准": "standard", "国标": "standard", "standard": "standard", "compliance": "standard",
	// shared
	"组织": "organization", "机构": "organization", "公司": "organization", "企业": "organization", "集团": "organization",
	"organization": "organization", "organisation": "organization", "company": "organization", "org": "organization", "institution": "organization",
	"人物": "person", "人": "person", "个人": "person", "自然人": "person", "person": "person", "people": "person", "founder": "person",
	"概念": "concept", "业务概念": "concept", "术语": "concept", "concept": "concept", "term": "concept",
	"地点": "location", "地区": "location", "城市": "location", "国家": "location", "location": "location", "city": "location", "country": "location", "place": "location",
	"事件": "event", "活动": "event", "event": "event",
	"文档": "document", "文件": "document", "报告": "document", "document": "document", "report": "document", "file": "document",
	"指标": "metric", "数值": "metric", "metric": "metric", "kpi": "metric",
	"其他": "other", "未知": "other", "other": "other", "unknown": "other", "misc": "other",
}

// relationTypeAliases is the normalization layer. Extraction words the same
// edge a dozen ways ("发行/发售/推出/管理"); queries for "所有发行关系" then miss
// everything that was stored under a synonym.
var relationTypeAliases = map[string]string{
	// finance
	"发行": "issue", "发售": "issue", "推出": "issue", "募集": "issue", "管理": "issue", "发行方": "issue",
	"issue": "issue", "issues": "issue", "issued": "issue", "issuer": "issue", "offers": "issue", "funded": "issue",
	"适用": "applies_to", "适用于": "applies_to", "对应": "applies_to", "适用风险等级": "applies_to",
	"applies": "applies_to", "appliesto": "applies_to", "applicable": "applies_to",
	"采用": "adopts", "使用": "adopts", "采纳": "adopts", "执行": "adopts", "adopt": "adopts", "adopts": "adopts", "uses": "adopts",
	"支持": "supports", "允许": "supports", "提供": "supports", "support": "supports", "supports": "supports",
	"约束": "constrains", "限制": "constrains", "规定": "constrains", "要求": "constrains", "管控": "constrains",
	"constrain": "constrains", "constrains": "constrains", "restricts": "constrains", "governs": "constrains",
	"需要": "requires", "需": "requires", "必须先完成": "requires", "require": "requires", "requires": "requires", "needs": "requires",
	"发布": "publishes", "颁布": "publishes", "出台": "publishes", "印发": "publishes", "publish": "publishes", "publishes": "publishes", "issuedby": "publishes",
	"受监管": "regulated_by", "监管": "regulated_by", "受…监管": "regulated_by", "regulatedby": "regulated_by", "supervisedby": "regulated_by",
	// auto
	"生产": "produces", "制造": "produces", "造": "produces", "produce": "produces", "produces": "produces", "manufactures": "produces",
	"装配": "assembles", "组装": "assembles", "搭载": "assembles", "配置": "assembles", "assemble": "assembles", "assembles": "assembles", "equippedwith": "assembles",
	"供应": "supplies", "供货": "supplies", "配套": "supplies", "供给": "supplies", "supply": "supplies", "supplies": "supplies", "supplierof": "supplies",
	"生产于": "produced_at", "产自": "produced_at", "位于工厂": "produced_at", "producedat": "produced_at", "builtat": "produced_at",
	"符合": "complies_with", "满足": "complies_with", "达到": "complies_with", "comply": "complies_with", "complieswith": "complies_with", "meets": "complies_with",
	// shared
	"属于": "part_of", "隶属": "part_of", "归属于": "part_of", "包含": "part_of", "part": "part_of", "partof": "part_of", "belongsto": "part_of",
	"子公司": "subsidiary_of", "母公司": "subsidiary_of", "控股": "subsidiary_of", "subsidiary": "subsidiary_of", "subsidiaryof": "subsidiary_of",
	"持股": "holds", "持有": "holds", "投资": "holds", "hold": "holds", "holds": "holds", "owns": "holds", "invests": "holds",
	"合作": "cooperates", "伙伴": "cooperates", "联合": "cooperates", "cooperate": "cooperates", "partnerswith": "cooperates",
	"位于": "located_in", "所在": "located_in", "坐落于": "located_in", "locatedin": "located_in", "basedin": "located_in",
	"相关": "related", "关联": "related", "涉及": "related", "related": "related", "relatedto": "related", "associatedwith": "related",
}

// normTypeKey folds case/width/spacing/punctuation so "Organization ",
// "organization" and "ＯＲＧＡＮＩＺＡＴＩＯＮ" hit the same alias row.
func normTypeKey(raw string) string {
	key := strings.ToLower(norm.NFKC.String(raw))
	var b strings.Builder
	b.Grow(len(key))
	for _, r := range key {
		switch r {
		case ' ', '\t', '\n', '\r', '_', '-', '/', '\\', '(', ')', '（', '）', '、', '，', ',', '。', '.', ':', '：', ';', '；', '"', '\'', '“', '”', '《', '》', '<', '>':
			continue
		}
		b.WriteRune(r)
	}
	return strings.TrimSpace(b.String())
}

// typeAliasCandidates expands a raw type into the keys worth looking up: the
// whole string first, then each part when extraction concatenated alternatives
// ("公司/机构", "fund | product").
func typeAliasCandidates(raw string) []string {
	key := normTypeKey(raw)
	if key == "" {
		return nil
	}
	candidates := []string{key}
	for _, sep := range []string{"/", "|", "、", ",", "，", "或", "&"} {
		if !strings.Contains(raw, sep) {
			continue
		}
		for _, part := range strings.Split(raw, sep) {
			if partKey := normTypeKey(part); partKey != "" && partKey != key {
				candidates = append(candidates, partKey)
			}
		}
	}
	return candidates
}

// NormalizeEntityType maps a raw extracted type onto the canonical taxonomy.
// Unknown types fall back to "other" instead of creating one legend row per
// spelling; the raw value is still returned to the caller for the detail panel.
func NormalizeEntityType(raw string) EntityTypeSpec {
	if spec, ok := lookupEntityType(raw); ok {
		return spec
	}
	return entityTypeByID["other"]
}

func lookupEntityType(raw string) (EntityTypeSpec, bool) {
	for _, candidate := range typeAliasCandidates(raw) {
		if canonical, ok := entityTypeAliases[candidate]; ok {
			return entityTypeByID[canonical], true
		}
	}
	if spec, ok := entityTypeByID[normTypeKey(raw)]; ok {
		return spec, true
	}
	return EntityTypeSpec{}, false
}

// NormalizeRelationType maps a raw extracted relation type onto the canonical
// vocabulary. Unknown types keep their own identity (prefixed with "raw:") so
// information is not silently dropped, but they never collide with a canonical
// type and are marked as un-normalized by the caller.
func NormalizeRelationType(raw string) (typ, label string, known bool) {
	for _, candidate := range typeAliasCandidates(raw) {
		if canonical, ok := relationTypeAliases[candidate]; ok {
			return canonical, relationTypeByID[canonical].Label, true
		}
	}
	if spec, ok := relationTypeByID[normTypeKey(raw)]; ok {
		return spec.Type, spec.Label, true
	}
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "related", relationTypeByID["related"].Label, true
	}
	return "raw:" + trimmed, trimmed, false
}

// EntityTypeSpecByID returns the presentation for a canonical entity type.
func EntityTypeSpecByID(typ string) EntityTypeSpec {
	if spec, ok := entityTypeByID[typ]; ok {
		return spec
	}
	return entityTypeByID["other"]
}

// RelationTypeLabel returns the display label for a canonical relation type.
func RelationTypeLabel(typ string) string {
	if spec, ok := relationTypeByID[typ]; ok {
		return spec.Label
	}
	if strings.HasPrefix(typ, "raw:") {
		return strings.TrimPrefix(typ, "raw:")
	}
	return typ
}

// EntityTypes exposes the taxonomy so callers can document/serve it.
func EntityTypes() []EntityTypeSpec {
	out := make([]EntityTypeSpec, len(entityTypeSpecs))
	copy(out, entityTypeSpecs)
	return out
}

// RelationTypes exposes the canonical relation vocabulary.
func RelationTypes() []RelationTypeSpec {
	out := make([]RelationTypeSpec, len(relationTypeSpecs))
	copy(out, relationTypeSpecs)
	return out
}

// InferDomain guesses which label set a graph belongs to from its evidence:
// the domain that owns the most canonical entity types wins. A graph with no
// domain-specific type is generic, so the UI does not claim a finance domain
// for a pile of people and documents.
func InferDomain(types []string) string {
	finance, auto := 0, 0
	for _, typ := range types {
		switch EntityTypeSpecByID(typ).Domain {
		case DomainFinance:
			finance++
		case DomainAuto:
			auto++
		}
	}
	switch {
	case auto > finance:
		return DomainAuto
	case finance > 0:
		return DomainFinance
	default:
		return DomainGeneric
	}
}
