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

package common

import (
	"encoding/base64"
	"strings"
	"testing"
)

// 前缀是使用者唯一能看到的品牌位，换品牌时只改 APITokenPrefix 一处；
// 这里钉住「生成结果一定带这个前缀、且前缀之后就是 32 字节的 URL-safe base64」，
// 免得以后有人手写字符串把两处改歪。
func TestGenerateAPITokenUsesBrandPrefix(t *testing.T) {
	token := GenerateAPIToken()

	if !strings.HasPrefix(token, APITokenPrefix) {
		t.Fatalf("token = %q, want prefix %q", token, APITokenPrefix)
	}

	body := strings.TrimPrefix(token, APITokenPrefix)
	wantLen := base64.RawURLEncoding.EncodedLen(32)
	if len(body) != wantLen {
		t.Fatalf("token body length = %d, want %d (32 bytes raw-url base64)", len(body), wantLen)
	}

	if _, err := base64.RawURLEncoding.DecodeString(body); err != nil {
		t.Fatalf("token body %q is not raw-url base64: %v", body, err)
	}
}

func TestGenerateAPITokenIsUnique(t *testing.T) {
	seen := make(map[string]struct{}, 64)
	for i := 0; i < 64; i++ {
		token := GenerateAPIToken()
		if _, dup := seen[token]; dup {
			t.Fatalf("GenerateAPIToken returned a duplicate: %q", token)
		}
		seen[token] = struct{}{}
	}
}
