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

package storage

import (
	"fmt"
	"testing"

	"github.com/minio/minio-go/v7"
)

// A tag source file pointing at a deleted bucket used to make every retrieval
// pay two 1s sleeps: Get retried an error that could never resolve. These pin
// the classification that lets Get fail fast.
func TestIsMissingObjectErr(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"missing bucket", minio.ErrorResponse{Code: "NoSuchBucket", Message: "The specified bucket does not exist"}, true},
		{"missing key", minio.ErrorResponse{Code: "NoSuchKey"}, true},
		{"wrapped missing bucket", fmt.Errorf("load tag source: %w", minio.ErrorResponse{Code: "NoSuchBucket"}), true},
		{"server error stays retryable", minio.ErrorResponse{Code: "InternalError"}, false},
		{"timeout stays retryable", fmt.Errorf("read: i/o timeout"), false},
		{"nil error", nil, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isMissingObjectErr(tc.err); got != tc.want {
				t.Fatalf("isMissingObjectErr(%v) = %v, want %v", tc.err, got, tc.want)
			}
		})
	}
}
