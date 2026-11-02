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

package service

import (
	"context"
	"strings"

	"ragflow/internal/dao"
	"ragflow/internal/entity"
)

// UserBrief is the identity pair the UI needs to render a resource owner:
// a display name and the address behind it.
type UserBrief struct {
	ID       string `json:"id"`
	Nickname string `json:"nickname"`
	Email    string `json:"email"`
}

// maxUserBriefIDs caps one request. A list page never needs more, and the cap
// keeps an unbounded IN clause off the database.
const maxUserBriefIDs = 200

// BatchUserBrief resolves user ids to display name + email.
//
// 资源列表里的 created_by 只是 id，前端要显示昵称、点开看邮箱。做成批量接口
// 而不是给八个列表各补一个 email 字段：一次查询就能覆盖一页表格里的所有人，
// 也不用把邮箱散进每个业务响应。
//
// 只返回与调用者同租户的成员。按 id 任意查人是跨租户枚举的入口，这个接口
// 不该成为那条路 —— 查不到的 id 直接不出现在结果里，前端显示为占位。
//
// 两侧都只认 status=1 的成员关系：user_tenant 里还有「已邀请未接受」的行，
// 未接受的邀请不该换来一份对方租户全员的昵称和邮箱。
func (s *UserService) BatchUserBrief(ctx context.Context, callerID string, ids []string) (map[string]*UserBrief, error) {
	out := make(map[string]*UserBrief, len(ids))
	unique := dedupeUserIDs(ids)
	if callerID == "" || len(unique) == 0 {
		return out, nil
	}
	if len(unique) > maxUserBriefIDs {
		unique = unique[:maxUserBriefIDs]
	}

	var tenantIDs []string
	if err := dao.DB.WithContext(ctx).
		Model(&entity.UserTenant{}).
		Where("user_id = ? AND status = ?", callerID, string(entity.StatusValid)).
		Pluck("tenant_id", &tenantIDs).Error; err != nil {
		return nil, err
	}
	if len(tenantIDs) == 0 {
		return out, nil
	}

	type row struct {
		ID       string
		Nickname string
		Email    string
	}
	var rows []row
	if err := dao.DB.WithContext(ctx).
		Model(&entity.User{}).
		Select("DISTINCT user.id, user.nickname, user.email").
		Joins("JOIN user_tenant ut ON ut.user_id = user.id").
		Where("user.id IN ? AND ut.tenant_id IN ? AND ut.status = ?", unique, tenantIDs, string(entity.StatusValid)).
		Scan(&rows).Error; err != nil {
		return nil, err
	}

	for _, r := range rows {
		name := strings.TrimSpace(r.Nickname)
		if name == "" {
			// 昵称没填就用邮箱兜底：表格里显示一列空白比显示邮箱更糟。
			name = r.Email
		}
		out[r.ID] = &UserBrief{ID: r.ID, Nickname: name, Email: r.Email}
	}
	return out, nil
}

// dedupeUserIDs trims, drops empties and removes duplicates while keeping the
// first-seen order.
func dedupeUserIDs(ids []string) []string {
	seen := make(map[string]struct{}, len(ids))
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}
