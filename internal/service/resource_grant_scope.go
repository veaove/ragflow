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

// grantReadKinds 把授权页的资源类型映射到权限包的类型。两者取值基本一致，
// 只有 search_app 与 permission 里的 search 不同名。
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
	case "file":
		return []permission.ResourceKind{permission.ResourceKindFile}, true
	case "folder":
		return []permission.ResourceKind{permission.ResourceKindFolder}, true
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
// 授权页回答的是「谁能看什么」，所以资源清单本身必须先按调用者的读权限收窄：
// 内置「普通成员」默认对每个模块都有 view，不收窄就等于把全租户的资源名单
// （含别人 permission=me 的私库）交给任何成员（E2E D2）。
//
// 未登记的类型返回空集合（fail closed）：宁可让新增类型在收窄逻辑写完之前
// 显示为空，也不要默认把整租户清单发出去。
//
// 这里走通用的 Scope（逐条判权）而不是 SQL 快路径：调用方本来就已经把资源行
// 全部取回内存，多一次判定比再拼一层子查询更直观；本租户资源量级在千行以内。
func (s *ResourceGrantService) visibleGrantIDs(ctx context.Context, userID, kind string) (map[string]struct{}, error) {
	kinds, ok := grantReadKinds(kind)
	visible := make(map[string]struct{})
	if !ok || userID == "" {
		return visible, nil
	}
	checker := permission.NewDatabaseChecker(dao.DB)
	for _, readKind := range kinds {
		scope, err := checker.Scope(ctx, permission.Subject{UserID: userID}, permission.ScopeQuery{
			Kind: readKind, Operation: permission.OperationRead,
		})
		if err != nil {
			return nil, err
		}
		for _, id := range scope.ResourceIDs {
			visible[id] = struct{}{}
		}
	}
	return visible, nil
}

// canReadGrantResource 判断调用者能否读某一个具体资源，用于按 id 展开的子查询
// （子项例外）。拒绝时统一按「资源不存在」回报，不泄露存在性。
func (s *ResourceGrantService) canReadGrantResource(ctx context.Context, userID, kind, resourceID string) bool {
	kinds, ok := grantReadKinds(kind)
	if !ok || userID == "" || resourceID == "" {
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
