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

package entity

import "testing"

// TestNormalizeResourceVisibility pins the historical-value mapping: me stays
// "owner", team collapses into "tenant_owner", and anything unknown falls back
// to the strictest tier instead of opening up.
func TestNormalizeResourceVisibility(t *testing.T) {
	cases := map[string]string{
		"":               ResourceVisibilityOwner,
		"owner":          ResourceVisibilityOwner,
		"me":             ResourceVisibilityOwner,
		"private":        ResourceVisibilityOwner,
		"owner ":         ResourceVisibilityOwner,
		"tenant_owner":   ResourceVisibilityTenantOwner,
		"team":           ResourceVisibilityTenantOwner,
		"tenant":         ResourceVisibilityTenantOwner,
		"TENANT_OWNER":   ResourceVisibilityTenantOwner,
		"platform":       ResourceVisibilityPlatform,
		"public":         ResourceVisibilityPlatform,
		"platform_admin": ResourceVisibilityPlatform,
		// memory.permissions 允许 "all"（所有租户可见）：落到 owner 会让
		// 用户设了「公开」却只有自己看得见，所以按最外一档处理。
		"all":     ResourceVisibilityPlatform,
		"ALL":     ResourceVisibilityPlatform,
		"unknown": ResourceVisibilityOwner,
	}
	for input, want := range cases {
		if got := NormalizeResourceVisibility(input); got != want {
			t.Errorf("NormalizeResourceVisibility(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestIsResourceVisibility(t *testing.T) {
	for _, value := range []string{
		ResourceVisibilityOwner, ResourceVisibilityTenantOwner, ResourceVisibilityPlatform,
		"me", "team", "public", "",
	} {
		if !IsResourceVisibility(value) {
			t.Errorf("IsResourceVisibility(%q) = false, want true", value)
		}
	}
	// 归一化后不可能落到非法值，这里只是把"永远返回 true"钉住：
	// 非法输入会收敛到 owner，而不是让判定链拿到未知档位。
	if !IsResourceVisibility("definitely-not-a-tier") {
		t.Error("unknown values must converge to the owner tier")
	}
}
