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

package kgview

import "testing"

func TestNormalizeEntityType(t *testing.T) {
	cases := []struct {
		raw     string
		want    string
		unknown bool
	}{
		{raw: "公司", want: "organization"},
		{raw: "Organization", want: "organization"},
		{raw: " 基金公司 ", want: "fund_company"},
		{raw: "ＯＥＭ", want: "oem"},
		{raw: "整车厂", want: "oem"},
		{raw: "车型", want: "vehicle_model"},
		{raw: "零部件", want: "component"},
		{raw: "供应商", want: "supplier"},
		{raw: "国标", want: "standard"},
		{raw: "风险等级", want: "risk"},
		{raw: "公司/机构", want: "organization"},
		{raw: "", want: "other"},
		{raw: "完全没见过的类型", want: "other"},
	}
	for _, tc := range cases {
		if got := NormalizeEntityType(tc.raw); got.Type != tc.want {
			t.Errorf("NormalizeEntityType(%q) = %q, want %q", tc.raw, got.Type, tc.want)
		}
	}
}

func TestNormalizeRelationTypeCollapsesSynonyms(t *testing.T) {
	groups := map[string][]string{
		"issue":       {"发行", "发售", "推出", "募集", "issue", "Issued"},
		"constrains":  {"约束", "限制", "规定", "要求", "restricts"},
		"supplies":    {"供应", "供货", "配套", "supply"},
		"assembles":   {"装配", "组装", "搭载"},
		"complies_with": {"符合", "满足", "comply"},
	}
	for want, raws := range groups {
		for _, raw := range raws {
			typ, label, known := NormalizeRelationType(raw)
			if typ != want {
				t.Errorf("NormalizeRelationType(%q) type = %q, want %q", raw, typ, want)
			}
			if !known {
				t.Errorf("NormalizeRelationType(%q) reported unknown, want known", raw)
			}
			if label == "" {
				t.Errorf("NormalizeRelationType(%q) returned empty label", raw)
			}
		}
	}
}

func TestNormalizeRelationTypeKeepsUnknownVocabulary(t *testing.T) {
	typ, label, known := NormalizeRelationType("颠覆")
	if known {
		t.Fatalf("unknown type reported as known: %q", typ)
	}
	if typ != "raw:颠覆" || label != "颠覆" {
		t.Fatalf("NormalizeRelationType(颠覆) = (%q, %q), want (raw:颠覆, 颠覆)", typ, label)
	}

	typ, label, known = NormalizeRelationType("   ")
	if !known || typ != "related" || label != "相关" {
		t.Fatalf("blank type = (%q, %q, %v), want (related, 相关, true)", typ, label, known)
	}
}

func TestInferDomain(t *testing.T) {
	if got := InferDomain([]string{"fund_company", "fund_product", "fund_product"}); got != DomainFinance {
		t.Errorf("finance graph domain = %q", got)
	}
	if got := InferDomain([]string{"oem", "vehicle_model", "component"}); got != DomainAuto {
		t.Errorf("auto graph domain = %q", got)
	}
	if got := InferDomain([]string{"person", "document"}); got != DomainGeneric {
		t.Errorf("generic graph domain = %q", got)
	}
	if got := InferDomain(nil); got != DomainGeneric {
		t.Errorf("empty graph domain = %q", got)
	}
}
