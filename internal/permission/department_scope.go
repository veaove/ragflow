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

// DepartmentSubtree returns rootID plus every descendant department id.
//
// A department tree is shallow (usually ≤3 levels), so the subtree is assembled
// from one list query instead of a recursive CTE: the adjacency list is the
// storage format and MySQL cannot express the walk portably. Department ids are
// unique across tenants, so no tenant filter is needed — which lets the
// cross-tenant dataset listing reuse the result directly.
//
// An empty rootID yields nil. A rootID whose row has been deleted still yields
// itself: members may keep pointing at it, and dropping it would silently
// revoke visibility for content that is otherwise intact.
func DepartmentSubtree(ctx context.Context, db *gorm.DB, rootID string) ([]string, error) {
	rootID = strings.TrimSpace(rootID)
	if db == nil || rootID == "" {
		return nil, nil
	}

	departments := make([]*entity.Department, 0)
	if err := db.WithContext(ctx).Find(&departments).Error; err != nil {
		return nil, err
	}

	children := make(map[string][]string, len(departments))
	known := make(map[string]struct{}, len(departments))
	for _, department := range departments {
		if department == nil {
			continue
		}
		known[department.ID] = struct{}{}
		if department.ParentID != "" {
			children[department.ParentID] = append(children[department.ParentID], department.ID)
		}
	}

	ids := make([]string, 0, len(departments))
	queue := []string{rootID}
	seen := map[string]struct{}{rootID: {}}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		ids = append(ids, current)
		for _, childID := range children[current] {
			if _, dup := seen[childID]; dup {
				continue
			}
			seen[childID] = struct{}{}
			queue = append(queue, childID)
		}
	}
	if _, exists := known[rootID]; !exists {
		ids = []string{rootID}
	}
	return ids, nil
}

// administeredDepartmentIDs returns the departments a 部门管理员 manages inside
// one tenant: their own department plus every descendant of it.
//
// Returns (nil, nil) when the caller is not a department admin of that tenant or
// is not assigned to a department — both cases simply add no visibility, they
// are not errors.
//
// The rule this backs: 部门管理员 sees the resources created by the members of
// their department. Resources carry no department column — the creator's
// `user.department_id` is the only link — so callers resolve the creator
// separately.
func (e *evaluation) administeredDepartmentIDs(ctx context.Context, userID, tenantID string) ([]string, error) {
	key := userID + "\x00" + tenantID
	if ids, ok := e.departmentScope[key]; ok {
		return ids, nil
	}

	source, ok := e.source.(*databaseSource)
	if !ok || source.db == nil || strings.TrimSpace(userID) == "" || strings.TrimSpace(tenantID) == "" {
		e.departmentScope[key] = nil
		return nil, nil
	}

	// Only the seeded 部门管理员 role carries department-wide visibility. Custom
	// roles run on normal-member privileges plus their matrix; they deliberately
	// do not widen data visibility, so they are not considered here. The tenant
	// owner is out of scope too: it already sees the whole tenant through
	// Resource.OwnerUserID before visibility is evaluated at all.
	membership, err := e.getMembership(ctx, userID, tenantID)
	if err != nil || membership == nil || !membership.Active || !e.isDepartmentAdminMembership(ctx, membership) {
		e.departmentScope[key] = nil
		return nil, nil
	}

	ids, err := DepartmentSubtree(ctx, source.db, lookupDepartmentID(ctx, source.db, userID))
	if err != nil {
		return nil, err
	}
	e.departmentScope[key] = ids
	return ids, nil
}

// The three seeded builtin roles. Role ids are generated per tenant, so roles
// are matched by name — that is the only stable key they share.
const (
	builtinTenantAdminRoleName     = "租户管理员"
	builtinDepartmentAdminRoleName = "部门管理员"
)

// hasBuiltinRole reports whether the membership's assigned role row is the
// named builtin role of the same tenant.
//
// `user_tenant.role_id` matters because the console's member editor writes only
// that column and leaves the `role` enum at 'normal' — a member given 租户管理员
// or 部门管理员 through the UI therefore looks like a normal member to anything
// that reads the enum alone.
func (e *evaluation) hasBuiltinRole(ctx context.Context, membership *Membership, roleName string) bool {
	if membership == nil || membership.RoleID == "" {
		return false
	}
	source, ok := e.source.(*databaseSource)
	if !ok || source.db == nil {
		return false
	}
	var count int64
	err := source.db.WithContext(ctx).Model(&entity.Role{}).
		Where("id = ? AND tenant_id = ? AND is_builtin = ? AND name = ?",
			membership.RoleID, membership.TenantID, true, roleName).
		Count(&count).Error
	return err == nil && count > 0
}

// isTenantAdmin reports whether the subject administers the tenant: either the
// `owner` enum (which also drives `Resource.OwnerUserID` for datasets) or the
// builtin 租户管理员 role assigned from the console.
//
// Both spellings appear in production — a tenant can have an owner whose enum
// stayed 'normal' because the role was assigned through the member editor.
func (e *evaluation) isTenantAdmin(ctx context.Context, userID, tenantID string) bool {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(tenantID) == "" {
		return false
	}
	key := userID + "\x00" + tenantID
	if cached, ok := e.tenantAdmins[key]; ok {
		return cached
	}
	membership, err := e.getMembership(ctx, userID, tenantID)
	admin := err == nil && membership != nil && membership.Active &&
		(membership.Role == RoleOwner || e.hasBuiltinRole(ctx, membership, builtinTenantAdminRoleName))
	e.tenantAdmins[key] = admin
	return admin
}

// isDepartmentAdminMembership reports whether this tenant membership is the
// builtin 部门管理员.
func (e *evaluation) isDepartmentAdminMembership(ctx context.Context, membership *Membership) bool {
	if membership == nil {
		return false
	}
	if membership.Role == RoleAdmin {
		return true
	}
	return e.hasBuiltinRole(ctx, membership, builtinDepartmentAdminRoleName)
}

// departmentAdminRoleIDs collects every seeded 部门管理员 role id so a list
// query can accept the role_id key in one IN clause. Role ids are unique across
// tenants, so a global set is safe: a match still has to line up with the
// resource's own tenant through the role row it points at.
func departmentAdminRoleIDs(ctx context.Context, db *gorm.DB) ([]string, error) {
	return builtinRoleIDs(ctx, db, builtinDepartmentAdminRoleName)
}

// tenantAdminRoleIDs is the same lookup for the seeded 租户管理员 role.
func tenantAdminRoleIDs(ctx context.Context, db *gorm.DB) ([]string, error) {
	return builtinRoleIDs(ctx, db, builtinTenantAdminRoleName)
}

func builtinRoleIDs(ctx context.Context, db *gorm.DB, roleName string) ([]string, error) {
	if db == nil {
		return nil, nil
	}
	var ids []string
	err := db.WithContext(ctx).Model(&entity.Role{}).
		Where("is_builtin = ? AND name = ?", true, roleName).
		Pluck("id", &ids).Error
	if err != nil {
		return nil, err
	}
	return ids, nil
}

// departmentAdminCovers reports whether the caller is a 部门管理员 of the
// resource's tenant and the resource was created by someone inside the
// department subtree they manage.
func (e *evaluation) departmentAdminCovers(ctx context.Context, subject Subject, resource Resource) (bool, error) {
	if strings.TrimSpace(resource.CreatedBy) == "" {
		return false, nil
	}
	departmentIDs, err := e.administeredDepartmentIDs(ctx, subject.UserID, resource.TenantID)
	if err != nil {
		return false, err
	}
	if len(departmentIDs) == 0 {
		return false, nil
	}
	creatorDepartment := e.creatorDepartmentID(ctx, resource.CreatedBy)
	if creatorDepartment == "" {
		return false, nil
	}
	for _, departmentID := range departmentIDs {
		if departmentID == creatorDepartment {
			return true, nil
		}
	}
	return false, nil
}

// creatorDepartmentID caches the creator's department for the lifetime of one
// evaluation: a listing checks many resources, and most of them share a handful
// of creators.
func (e *evaluation) creatorDepartmentID(ctx context.Context, userID string) string {
	if id, ok := e.creatorDepartments[userID]; ok {
		return id
	}
	source, ok := e.source.(*databaseSource)
	if !ok || source.db == nil {
		e.creatorDepartments[userID] = ""
		return ""
	}
	id := lookupDepartmentID(ctx, source.db, userID)
	e.creatorDepartments[userID] = id
	return id
}
