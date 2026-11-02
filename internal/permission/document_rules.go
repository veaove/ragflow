//
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

package permission

import (
	"context"
	"strings"

	"gorm.io/gorm"

	"ragflow/internal/entity"
)

// RestrictedDocumentIDs returns the subset of documentIDs that carries at least
// one file-level rule.
//
// 批量写操作（删除、改状态）要按文件判定，但绝大多数文件根本没有规则。
// 先用这一条查询把候选收敛到真正有规则的少数文件，再逐条判定，避免"删 50 个
// 文件跑 200 次权限查询"。
func RestrictedDocumentIDs(ctx context.Context, db *gorm.DB, documentIDs []string) ([]string, error) {
	if db == nil || len(documentIDs) == 0 {
		return nil, nil
	}
	ids := make([]string, 0, len(documentIDs))
	for _, id := range documentIDs {
		if strings.TrimSpace(id) != "" {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return nil, nil
	}

	restricted := make([]string, 0, len(ids))
	if err := db.WithContext(ctx).Model(&entity.ResourceGrant{}).
		Distinct("resource_grant.resource_id").
		Where("resource_grant.resource_kind = ?", string(ResourceKindDocument)).
		Where("resource_grant.resource_id IN ?", ids).
		Pluck("resource_grant.resource_id", &restricted).Error; err != nil {
		return nil, err
	}
	return restricted, nil
}
