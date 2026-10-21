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
	"reflect"
	"testing"

	"ragflow/internal/service"
)

// TestUpdateDatasetAcceptsRetrievalTestSettings guards the field whitelist that
// runs before the service is ever reached.
//
// The retrieval-test panel saves its setup through PUT /datasets/:id with
// top-level similarity_threshold / keywords_similarity_weight / rerank_id.
// UpdateDatasetRequest carried all three and the service persisted them, but the
// whitelist did not list them, so every save was rejected with
// "Extra inputs are not permitted: similarity_threshold" while every layer below
// looked correct. Asserting the whitelist directly is the only place this gap is
// observable without a live dataset.
func TestUpdateDatasetAcceptsRetrievalTestSettings(t *testing.T) {
	for _, field := range []string{
		"similarity_threshold",
		"keywords_similarity_weight",
		"rerank_id",
	} {
		if !updateDatasetAllowedFields[field] {
			t.Fatalf("PUT /datasets/:id rejects %q, so the retrieval-test panel cannot save its settings", field)
		}
	}
}

// TestUpdateDatasetWhitelistCoversRequestJSONFields keeps the whitelist from
// silently drifting behind UpdateDatasetRequest. A field that the request type
// can carry but the whitelist does not list is dead on arrival: the handler
// rejects it before unmarshalling into the request.
func TestUpdateDatasetWhitelistCoversRequestJSONFields(t *testing.T) {
	// parser_config_provided is derived from the raw body rather than sent by a
	// caller, so it is intentionally absent from the whitelist. embd_id is the
	// column-level alias of embedding_model: the API contract only exposes
	// embedding_model, and nothing in the service reads EmbdID off this request,
	// so it stays out of the whitelist on purpose.
	skip := map[string]bool{"parser_config_provided": true, "embd_id": true}

	typ := reflect.TypeOf(service.UpdateDatasetRequest{})
	for i := 0; i < typ.NumField(); i++ {
		field := typ.Field(i)
		name := field.Tag.Get("json")
		if idx := len(name); idx > 0 {
			for j, c := range name {
				if c == ',' {
					name = name[:j]
					break
				}
			}
		}
		if name == "" || name == "-" || skip[name] {
			continue
		}
		if !updateDatasetAllowedFields[name] {
			t.Errorf("UpdateDatasetRequest carries json field %q but updateDatasetAllowedFields does not list it", name)
		}
	}

	// Sanity check: every whitelisted key must be valid JSON member syntax so a
	// typo cannot pass as "some other field is allowed".
	for name := range updateDatasetAllowedFields {
		var probe map[string]json.RawMessage
		body := `{"` + name + `":1}`
		if err := json.Unmarshal([]byte(body), &probe); err != nil {
			t.Errorf("whitelist key %q is not a usable JSON field name: %v", name, err)
		}
	}
}
