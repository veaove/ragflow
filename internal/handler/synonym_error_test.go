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

package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"ragflow/internal/common"
	"ragflow/internal/service"

	"github.com/gin-gonic/gin"
)

// TestRespondSynonymErrorKeepsDatasetAndGroupApart locks the distinction the
// vocabulary page needs: a request that never resolved the knowledge base must
// not be reported as "synonym group not found", because the page renders that
// as an empty vocabulary and the user cannot tell an access problem from a
// genuinely empty word list.
func TestRespondSynonymErrorKeepsDatasetAndGroupApart(t *testing.T) {
	gin.SetMode(gin.TestMode)

	cases := []struct {
		name        string
		err         error
		wantCode    float64
		wantMessage string
	}{
		{
			name:        "unresolved knowledge base",
			err:         service.ErrDatasetNotFound,
			wantCode:    float64(common.CodeDataError),
			wantMessage: "dataset not found or access denied",
		},
		{
			name:        "missing group",
			err:         service.ErrSynonymGroupNotFound,
			wantCode:    float64(common.CodeDataError),
			wantMessage: "synonym group not found",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/datasets/d1/synonym-groups", nil)

			respondSynonymError(c, tc.err)

			if recorder.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
			}
			var body map[string]interface{}
			if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode body: %v", err)
			}
			if got := body["code"]; got != tc.wantCode {
				t.Fatalf("code = %v, want %v", got, tc.wantCode)
			}
			if got := body["message"]; got != tc.wantMessage {
				t.Fatalf("message = %v, want %q", got, tc.wantMessage)
			}
		})
	}
}
