/*
 *  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

package handler

import (
	"strings"

	"github.com/gin-gonic/gin"

	"ragflow/internal/dao"
	"ragflow/internal/entity"
)

// TenantHeader 是前端切换租户时携带的请求头。
const TenantHeader = "X-Tenant-ID"

// GetTenantID 返回本次请求应当生效的租户 ID。
//
// 优先级：
//  1. 请求头 X-Tenant-ID —— 但必须校验该用户确实属于这个租户，
//     否则忽略（不返回 403，避免前端残留的旧租户值让整站不可用）。
//  2. 用户默认租户 —— owner 优先，其次最早加入的。
//  3. 兜底回退到 userID —— 兼容「用户即租户」的历史数据；
//     新用户在没有被指派租户时也会走到这里（结果自然为空）。
//
// 注意：这是「当前租户」的唯一权威入口。业务代码里不要再直接拿 user.ID
// 当 tenant_id 用 —— 用户与租户解耦后那个假设已经不成立。
func GetTenantID(c *gin.Context) string {
	user, _, _ := GetUser(c)
	if user == nil {
		return ""
	}
	if requested := strings.TrimSpace(c.GetHeader(TenantHeader)); requested != "" {
		if UserBelongsToTenant(c, user.ID, requested) {
			return requested
		}
	}
	return DefaultTenantIDForUser(c, user.ID)
}

// CurrentTenantID 是 GetTenantID 的别名，语义更贴近调用点。
func CurrentTenantID(c *gin.Context) string {
	return GetTenantID(c)
}

// UserBelongsToTenant 判断用户是否属于某个租户（仅统计 status='1' 的成员关系）。
func UserBelongsToTenant(c *gin.Context, userID, tenantID string) bool {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(tenantID) == "" {
		return false
	}
	var count int64
	err := dao.DB.WithContext(c.Request.Context()).
		Model(&entity.UserTenant{}).
		Where("user_id = ? AND tenant_id = ? AND status = '1'", userID, tenantID).
		Count(&count).Error
	if err != nil {
		return false
	}
	return count > 0
}

// DefaultTenantIDForUser 取用户默认租户：owner 优先，其次最早加入的。
func DefaultTenantIDForUser(c *gin.Context, userID string) string {
	var tenantID string
	_ = dao.DB.WithContext(c.Request.Context()).
		Model(&entity.UserTenant{}).
		Select("tenant_id").
		Where("user_id = ? AND status = '1'", userID).
		Order("CASE WHEN role = 'owner' THEN 0 ELSE 1 END, create_time ASC").
		Limit(1).
		Scan(&tenantID).Error
	if strings.TrimSpace(tenantID) == "" {
		return userID
	}
	return tenantID
}
