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

package service

import (
	"context"
	"errors"
	"strings"

	"ragflow/internal/dao"
	"ragflow/internal/permission"
)

func requireOwnedTenantID(ctx context.Context, userID string) (string, error) {
	if strings.TrimSpace(userID) == "" {
		return "", permission.ErrUnauthenticated
	}
	tenantDAO := dao.NewUserTenantDAO()
	tenants, err := tenantDAO.GetByUserIDAndRole(ctx, dao.DB, userID, string(permission.RoleOwner))
	if err != nil {
		return "", err
	}
	checker := permission.NewDatabaseChecker(dao.DB)
	for _, tenant := range tenants {
		if tenant == nil || strings.TrimSpace(tenant.TenantID) == "" {
			continue
		}
		if err := checker.CheckTenant(ctx, permission.Subject{UserID: userID}, tenant.TenantID, permission.TenantOwner); err == nil {
			return tenant.TenantID, nil
		} else if !errors.Is(err, permission.ErrMembershipNotFound) {
			return "", err
		}
	}
	return "", permission.ErrMembershipNotFound
}

// readableTenantID 取调用者可见的默认租户：owner 租户优先，其次最早加入的
// 成员租户（与 handler.DefaultTenantIDForUser / tenant.GetReadableInfoByUserID
// 同一顺序）。只用于只读场景。
//
// 为什么需要它：被邀请或直接添加的普通成员没有 owner 行（user_tenant.role 是
// normal），requireOwnedTenantID 对他们只会返回 ErrMembershipNotFound，调用方
// 于是拿到空列表 —— 模型目录、默认模型全都「消失」，前端据此把已保存的模型
// 判成已删除/无权限。
func readableTenantID(ctx context.Context, userID string) (string, error) {
	if strings.TrimSpace(userID) == "" {
		return "", permission.ErrUnauthenticated
	}
	tenantInfos, err := dao.NewTenantDAO().GetReadableInfoByUserID(ctx, dao.DB, userID)
	if err != nil {
		return "", err
	}
	checker := permission.NewDatabaseChecker(dao.DB)
	for _, info := range tenantInfos {
		if info == nil || strings.TrimSpace(info.TenantID) == "" {
			continue
		}
		// 待接受的邀请行同样是 status='1'，可读列表里会出现；成员关系由
		// permission 判定，别把还没入租户的人放进来。
		if err := checker.CheckTenant(ctx, permission.Subject{UserID: userID}, info.TenantID, permission.TenantMember); err == nil {
			return info.TenantID, nil
		} else if !errors.Is(err, permission.ErrMembershipNotFound) {
			return "", err
		}
	}
	return "", permission.ErrMembershipNotFound
}

// resolveReadTenantID 决定只读接口作用于哪个租户：
//   - requested 非空（?tenant_id= 或 X-Tenant-ID）：必须是调用者所属租户，
//     否则报权限错误 —— 显式请求一个不属于自己的租户不能被静默忽略；
//   - requested 为空：回落到 readableTenantID。
//
// 返回 permission.ErrMembershipNotFound 表示调用者没有任何可用租户，调用方按
// 「空结果」处理（新用户还没被指派租户，这不是错误）。
func resolveReadTenantID(ctx context.Context, userID, requestedTenantID string) (string, error) {
	requestedTenantID = strings.TrimSpace(requestedTenantID)
	if requestedTenantID == "" {
		return readableTenantID(ctx, userID)
	}
	if err := permission.NewDatabaseChecker(dao.DB).CheckTenant(ctx, permission.Subject{UserID: userID}, requestedTenantID, permission.TenantMember); err != nil {
		return "", err
	}
	return requestedTenantID, nil
}
