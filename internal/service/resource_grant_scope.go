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
//

package service

import (
	"context"

	"ragflow/internal/dao"
	"ragflow/internal/permission"
)

// grantReadKinds 把授权页的资源类型映射到权限包的类型。
//
// ok=false 表示这类资源没有「逐资源可见性」，调用方不得收窄：
//   - 文件 / 文件夹是租户级资产（fileResource 一律 VisibilityTenant +
//     TenantNormalMember），同租户成员本来就能读全部文件，按人收窄没有意义；
//   - permission 的候选列举对 file/folder 还要求带 parent 作用域，拿不到
//     「全租户文件集合」。
func grantReadKinds(kind string) ([]permission.ResourceKind, bool) {
	switch kind {
	case "dataset":
		return []permission.ResourceKind{permission.ResourceKindDataset}, true
	case "chat":
		return []permission.ResourceKind{permission.ResourceKindChat}, true
	case "search_app":
		return []permission.ResourceKind{permission.ResourceKindSearchApp}, true
	case "canvas":
		return []permission.ResourceKind{permission.ResourceKindCanvas}, true
	case "memory":
		return []permission.ResourceKind{permission.ResourceKindMemory}, true
	case "connector":
		return []permission.ResourceKind{permission.ResourceKindConnector}, true
	case "mcp_server":
		return []permission.ResourceKind{permission.ResourceKindMCPServer}, true
	case "skill_space":
		return []permission.ResourceKind{permission.ResourceKindSkillSpace}, true
	}
	return nil, false
}

// visibleGrantIDs 返回调用者在该类资源里**能读**的 id 集合。
//
// 第二个返回值 scoped=false 表示该类资源不做逐资源收窄（见 grantReadKinds），
// 调用方应当整表返回。
//
// 授权页回答的是「谁能看什么」，所以资源清单本身必须先按调用者的读权限收窄：
// 内置「普通成员」默认对每个模块都有 view，不收窄就等于把全租户的资源名单
// （含别人 permission=me 的私库）交给任何成员（E2E D2）。
func (s *ResourceGrantService) visibleGrantIDs(ctx context.Context, userID, kind string) (map[string]struct{}, bool, error) {
	kinds, scoped := grantReadKinds(kind)
	if !scoped {
		return nil, false, nil
	}
	visible := make(map[string]struct{})
	if userID == "" {
		return visible, true, nil
	}
	checker := permission.NewDatabaseChecker(dao.DB)
	for _, readKind := range kinds {
		scope, err := checker.Scope(ctx, permission.Subject{UserID: userID}, permission.ScopeQuery{
			Kind: readKind, Operation: permission.OperationRead,
		})
		if err != nil {
			return nil, true, err
		}
		for _, id := range scope.ResourceIDs {
			visible[id] = struct{}{}
		}
	}
	return visible, true, nil
}

// canReadGrantResource 判断调用者能否读某一个具体资源，用于按 id 展开的子查询
// （子项例外）。拒绝时调用方统一按「资源不存在」回报，不泄露存在性。
//
// 未做逐资源收窄的类型直接放行：租户归属已由 handler 的 requireTenantAccess
// 判过（文件/文件夹就是这一类）。
func (s *ResourceGrantService) canReadGrantResource(ctx context.Context, userID, kind, resourceID string) bool {
	kinds, scoped := grantReadKinds(kind)
	if !scoped {
		return true
	}
	if userID == "" || resourceID == "" {
		return false
	}
	checker := permission.NewDatabaseChecker(dao.DB)
	for _, readKind := range kinds {
		err := checker.CheckResource(ctx, permission.Subject{UserID: userID}, permission.ResourceRef{
			Kind: readKind, ID: resourceID,
		}, permission.OperationRead)
		if err == nil {
			return true
		}
	}
	return false
}
