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

//go:build !enterprise

package permission

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"ragflow/internal/entity"

	"gorm.io/gorm"
)

type communityPolicy struct {
	source Source
}

type membershipResult struct {
	membership *Membership
	err        error
}

type evaluation struct {
	source      Source
	memberships map[string]membershipResult
	resources   map[ResourceRef]Resource
	resourceErr map[ResourceRef]error
}

func newPolicy(source Source) policy {
	return &communityPolicy{source: source}
}

func (p *communityPolicy) CheckFeature(ctx context.Context, subject Subject, feature Feature, action Action) error {
	if err := validateSubject(subject); err != nil {
		return err
	}
	if strings.TrimSpace(string(feature)) == "" || !validAction(action) {
		return ErrInvalidPermission
	}
	// Community edition has no role-based feature restrictions.
	return nil
}

func (p *communityPolicy) CheckTenant(ctx context.Context, subject Subject, tenantID string, requirement TenantRequirement) error {
	return newEvaluation(p.source).checkTenant(ctx, subject, tenantID, requirement)
}

func (p *communityPolicy) CheckResource(ctx context.Context, subject Subject, ref ResourceRef, operation Operation) error {
	if !validOperation(operation) {
		return ErrInvalidPermission
	}
	access, err := newEvaluation(p.source).resolveAccess(ctx, subject, ref)
	if err != nil {
		return err
	}
	if !accessAllows(access, operation) {
		return ErrPermissionDenied
	}
	return nil
}

func (p *communityPolicy) CheckDependency(ctx context.Context, subject Subject, entryRef, dependencyRef ResourceRef, entryOperation, dependencyOperation Operation) error {
	if !validOperation(entryOperation) || !validOperation(dependencyOperation) {
		return ErrInvalidPermission
	}
	evaluation := newEvaluation(p.source)
	return evaluation.checkDependency(ctx, subject, entryRef, dependencyRef, entryOperation, dependencyOperation)
}

func (p *communityPolicy) ResolveAccess(ctx context.Context, subject Subject, ref ResourceRef) (Access, error) {
	return newEvaluation(p.source).resolveAccess(ctx, subject, ref)
}

func (p *communityPolicy) Scope(ctx context.Context, subject Subject, query ScopeQuery) (Scope, error) {
	if err := validateSubject(subject); err != nil {
		return Scope{}, err
	}
	if strings.TrimSpace(string(query.Kind)) == "" || !validOperation(query.Operation) {
		return Scope{}, ErrInvalidPermission
	}
	if (query.Parent.ID == "") != (query.Parent.Kind == "") {
		return Scope{}, ErrInvalidPermission
	}
	if query.Entry != nil && (!validResourceRef(*query.Entry) || !validOperation(query.EntryOp)) {
		return Scope{}, ErrInvalidPermission
	}

	evaluation := newEvaluation(p.source)
	candidateRefs, err := p.source.ListResourceRefs(ctx, subject, query.Kind, query.Parent)
	if err != nil {
		return Scope{}, fmt.Errorf("permission: list resource candidates: %w", err)
	}
	candidateRefs = uniqueRefs(candidateRefs)
	resourcesToLoad := append([]ResourceRef(nil), candidateRefs...)
	if query.Parent.ID != "" {
		resourcesToLoad = append(resourcesToLoad, query.Parent)
	}
	if query.Entry != nil {
		resourcesToLoad = append(resourcesToLoad, *query.Entry)
	}
	if err := evaluation.loadResources(ctx, resourcesToLoad); err != nil {
		return Scope{}, err
	}

	var entryRef ResourceRef
	if query.Entry != nil {
		entryRef = *query.Entry
	}
	accessible := make([]ResourceRef, 0, len(candidateRefs))
	for _, ref := range candidateRefs {
		var checkErr error
		if query.Entry == nil {
			checkErr = evaluation.checkResource(ctx, subject, ref, query.Operation)
		} else {
			checkErr = evaluation.checkDependency(ctx, subject, entryRef, ref, query.EntryOp, query.Operation)
		}
		if checkErr == nil {
			accessible = append(accessible, ref)
			continue
		}
		if errorsIsPermissionDenial(checkErr) || errors.Is(checkErr, ErrResourceNotFound) {
			continue
		}
		return Scope{}, checkErr
	}

	// In the community edition the effective tenant comes from the persisted
	// resource boundary, not from a caller-selected tenant. Scopes without a
	// single parent or entry can contain resources from multiple tenants, so
	// their explicit authorized IDs are the boundary and TenantID stays empty.
	var tenantID string
	if query.Parent.ID != "" {
		if parent, parentErr := evaluation.getResource(query.Parent); parentErr == nil {
			tenantID = parent.TenantID
		}
	}
	if query.Entry != nil {
		if entry, entryErr := evaluation.getResource(*query.Entry); entryErr == nil {
			tenantID = entry.TenantID
		}
	}
	scope := Scope{TenantID: tenantID, Kind: query.Kind, Parent: query.Parent, Operation: query.Operation}
	if len(accessible) == 0 {
		scope.Mode = ScopeNone
		return scope, nil
	}
	scope.Mode = ScopeIDs
	scope.ResourceIDs = make([]string, 0, len(accessible))
	for _, ref := range accessible {
		scope.ResourceIDs = append(scope.ResourceIDs, ref.ID)
	}
	return scope, nil
}

func (p *communityPolicy) QueryScope(ctx context.Context, subject Subject, query ScopeQuery) (QueryScope, bool, error) {
	if query.Kind != ResourceKindDataset || query.Operation != OperationRead || query.Parent.ID != "" || query.Parent.Kind != "" || query.Entry != nil {
		return QueryScope{}, false, nil
	}
	if err := validateSubject(subject); err != nil {
		return QueryScope{}, true, err
	}
	source, ok := p.source.(*databaseSource)
	if !ok || source.db == nil {
		return QueryScope{}, false, nil
	}
	if err := source.validateDatasetTenants(ctx, subject.UserID); err != nil {
		return QueryScope{}, true, err
	}

	return QueryScope{apply: func(query *gorm.DB) *gorm.DB {
		db := source.db.WithContext(ctx)
		activeOwner := db.Model(&entity.UserTenant{}).
			Select("1").
			Where("user_tenant.tenant_id = knowledgebase.tenant_id AND user_tenant.role = ? AND user_tenant.status = ?", string(RoleOwner), string(entity.StatusValid))
		callerIsOwner := db.Model(&entity.UserTenant{}).
			Select("1").
			Where("user_tenant.tenant_id = knowledgebase.tenant_id AND user_tenant.user_id = ? AND user_tenant.role = ? AND user_tenant.status = ?", subject.UserID, string(RoleOwner), string(entity.StatusValid))
		// 只认 normal：`user_tenant.role='admin'` 与平台超管（user.is_superuser）
		// 是两回事，且既有契约（见 database_source_test）明确 admin 不参与
		// team 资源可见性。改可见性属于安全敏感变更，不能"顺手修"。
		callerIsMember := db.Model(&entity.UserTenant{}).
			Select("1").
			Where("user_tenant.tenant_id = knowledgebase.tenant_id AND user_tenant.user_id = ? AND user_tenant.role = ? AND user_tenant.status = ?",
				subject.UserID, string(RoleNormal), string(entity.StatusValid))
		// 显式授权覆盖默认的二值可见性：命中 team / 本人 / 本人所在部门任一条即可见。
		// 部门在 Go 侧先解析成 id，而不是在 SQL 里嵌套 user 表 —— 少一次子查询，
		// 也让本包能在只迁移了部分表的测试库上跑通。
		deptID := lookupDepartmentID(ctx, source.db, subject.UserID)
		granted := db.Model(&entity.ResourceGrant{}).
			Select("1").
			Where("resource_grant.tenant_id = knowledgebase.tenant_id").
			Where("resource_grant.resource_kind = ?", string(ResourceKindDataset)).
			Where("resource_grant.resource_id = knowledgebase.id").
			Where(`resource_grant.subject_kind = ?
				OR (resource_grant.subject_kind = ? AND resource_grant.subject_id = ?)
				OR (resource_grant.subject_kind = ? AND resource_grant.subject_id = ?)`,
				entity.GrantSubjectTeam,
				entity.GrantSubjectUser, subject.UserID,
				entity.GrantSubjectDepartment, deptID)
		// 租户被停用后，库里的内容对**所有人**不可见（含 owner 与显式授权）。
		// 停用的语义是整个租户暂停，不是某个成员被降权，所以这一条不能放进
		// 上面那个「owner / team / 授权」的 OR 分支里。
		//
		// 判定方向是「有停用记录才隐藏」而不是「有启用记录才可见」：
		// 后者在租户行缺失（历史脏数据、部分迁移）时会把用户所有内容一次性
		// 隐藏掉，代价远大于收益。IFNULL 兼容 enabled 为 NULL 的存量行。
		tenantDisabled := db.Model(&entity.Tenant{}).
			Select("1").
			Where("tenant.id = knowledgebase.tenant_id").
			Where("IFNULL(tenant.enabled, 1) = 0")

		accessibleDatasets := db.Model(&entity.Knowledgebase{}).
			Select("knowledgebase.id").
			Where("knowledgebase.status = ?", string(entity.StatusValid)).
			Where("EXISTS (?)", activeOwner).
			Where("(EXISTS (?) OR (knowledgebase.permission = ? AND EXISTS (?)) OR EXISTS (?))",
				callerIsOwner, string(entity.TenantPermissionTeam), callerIsMember, granted).
			Where("NOT EXISTS (?)", tenantDisabled)
		return query.Where("knowledgebase.id IN (?)", accessibleDatasets)
	}}, true, nil
}

func (s *databaseSource) validateDatasetTenants(ctx context.Context, userID string) error {
	var tenantIDs []string
	err := s.db.WithContext(ctx).Model(&entity.Knowledgebase{}).
		Joins("JOIN user_tenant member ON member.tenant_id = knowledgebase.tenant_id").
		Where("knowledgebase.status = ? AND member.user_id = ? AND member.status = ?", string(entity.StatusValid), userID, string(entity.StatusValid)).
		Distinct("knowledgebase.tenant_id").
		Pluck("knowledgebase.tenant_id", &tenantIDs).Error
	if err != nil {
		return err
	}
	_, err = s.loadTenantOwnerIDs(ctx, tenantIDs)
	return err
}

func (p *communityPolicy) FilterResources(ctx context.Context, subject Subject, refs []ResourceRef, operation Operation) ([]ResourceRef, error) {
	if err := validateSubject(subject); err != nil {
		return nil, err
	}
	if !validOperation(operation) {
		return nil, ErrInvalidPermission
	}
	evaluation := newEvaluation(p.source)
	refs = uniqueRefs(refs)
	if err := evaluation.loadResources(ctx, refs); err != nil {
		return nil, err
	}
	accessible := make([]ResourceRef, 0, len(refs))
	for _, ref := range refs {
		err := evaluation.checkResource(ctx, subject, ref, operation)
		if err == nil {
			accessible = append(accessible, ref)
			continue
		}
		if errorsIsPermissionDenial(err) || errors.Is(err, ErrResourceNotFound) {
			continue
		}
		return nil, err
	}
	return accessible, nil
}

func newEvaluation(source Source) *evaluation {
	return &evaluation{
		source:      source,
		memberships: make(map[string]membershipResult),
		resources:   make(map[ResourceRef]Resource),
		resourceErr: make(map[ResourceRef]error),
	}
}

func (e *evaluation) checkTenant(ctx context.Context, subject Subject, tenantID string, requirement TenantRequirement) error {
	if err := validateSubject(subject); err != nil {
		return err
	}
	if strings.TrimSpace(tenantID) == "" || !validTenantRequirement(requirement) {
		return ErrInvalidPermission
	}
	membership, err := e.getMembership(ctx, subject.UserID, tenantID)
	if err != nil {
		return err
	}
	if !membershipSatisfies(membership, requirement) {
		return ErrMembershipNotFound
	}
	return nil
}

func (e *evaluation) checkResource(ctx context.Context, subject Subject, ref ResourceRef, operation Operation) error {
	if !validOperation(operation) {
		return ErrInvalidPermission
	}
	access, err := e.resolveAccess(ctx, subject, ref)
	if err != nil {
		return err
	}
	if !accessAllows(access, operation) {
		return ErrPermissionDenied
	}
	return nil
}

func (e *evaluation) checkDependency(ctx context.Context, subject Subject, entryRef, dependencyRef ResourceRef, entryOperation, dependencyOperation Operation) error {
	if err := validateSubject(subject); err != nil {
		return err
	}
	if !validOperation(entryOperation) || !validOperation(dependencyOperation) {
		return ErrInvalidPermission
	}
	if err := e.loadResources(ctx, []ResourceRef{entryRef, dependencyRef}); err != nil {
		return err
	}
	entry, err := e.getResource(entryRef)
	if err != nil {
		return err
	}
	entryAccess, err := e.resolveResource(ctx, subject, entry)
	if err != nil {
		return err
	}
	if !accessAllows(entryAccess, entryOperation) {
		return ErrPermissionDenied
	}
	dependency, err := e.getResource(dependencyRef)
	if err != nil {
		return err
	}
	userAccess, err := e.resolveResource(ctx, subject, dependency)
	if err != nil {
		return err
	}
	if !accessAllows(userAccess, dependencyOperation) {
		return ErrPermissionDenied
	}
	ownerSubject := Subject{UserID: entry.OwnerUserID, TenantID: entry.TenantID}
	ownerAccess, err := e.resolveResource(ctx, ownerSubject, dependency)
	if err != nil {
		if errorsIsPermissionDenial(err) {
			return ErrPermissionDenied
		}
		return err
	}
	if !accessAllows(ownerAccess, dependencyOperation) {
		return ErrPermissionDenied
	}
	return nil
}

// lookupDepartmentID resolves a user's department once, so the grant SQL does
// not have to nest a subquery against the user table. Returns "" when the user
// is unknown or unassigned — that simply never matches a department grant.
func lookupDepartmentID(ctx context.Context, db *gorm.DB, userID string) string {
	if db == nil || strings.TrimSpace(userID) == "" {
		return ""
	}
	var row struct {
		DepartmentID string `gorm:"column:department_id"`
	}
	if err := db.WithContext(ctx).Model(&entity.User{}).
		Select("department_id").
		Where("id = ?", userID).
		Take(&row).Error; err != nil {
		return ""
	}
	return row.DepartmentID
}

// grantAllows reports whether an explicit resource_grant row covers the subject.
//
// This is the bridge between the console's "visible to: team / department /
// user" setting and the engine: rows here override the legacy binary
// `permission` column. Department membership is resolved with a subquery so the
// check stays a single round trip.
func (e *evaluation) grantAllows(ctx context.Context, subject Subject, resource Resource) (bool, error) {
	source, ok := e.source.(*databaseSource)
	if !ok || source.db == nil {
		return false, nil
	}
	var count int64
	err := source.db.WithContext(ctx).
		Model(&entity.ResourceGrant{}).
		Where("resource_grant.tenant_id = ?", resource.TenantID).
		Where("resource_grant.resource_kind = ?", string(resource.Ref.Kind)).
		Where("resource_grant.resource_id = ?", resource.Ref.ID).
		Where(`resource_grant.subject_kind = ?
			OR (resource_grant.subject_kind = ? AND resource_grant.subject_id = ?)
			OR (resource_grant.subject_kind = ? AND resource_grant.subject_id = ?)`,
			entity.GrantSubjectTeam,
			entity.GrantSubjectUser, subject.UserID,
			entity.GrantSubjectDepartment, lookupDepartmentID(ctx, source.db, subject.UserID)).
		Count(&count).Error
	if err != nil {
		// 授权是"额外放行"而不是"额外限制"：这张表不可用（老库未迁移、测试库
		// 没建表）时降级回原有的二值可见性，private 资源仍然只有 owner 可见。
		// 反过来把错误抛上去会让整次权限判定 500，等于一张附加表能拖垮全站。
		return false, nil
	}
	return count > 0, nil
}

func (e *evaluation) resolveAccess(ctx context.Context, subject Subject, ref ResourceRef) (Access, error) {
	if err := validateSubject(subject); err != nil {
		return Access{}, err
	}
	if err := e.loadResources(ctx, []ResourceRef{ref}); err != nil {
		return Access{}, err
	}
	resource, err := e.getResource(ref)
	if err != nil {
		return Access{}, err
	}
	return e.resolveResource(ctx, subject, resource)
}

func (e *evaluation) resolveResource(ctx context.Context, subject Subject, resource Resource) (Access, error) {
	if resource.TenantID == "" || resource.OwnerUserID == "" || !validResourceRef(resource.Ref) {
		return Access{}, fmt.Errorf("%w: incomplete resource authorization facts", ErrInvalidPermission)
	}
	if !resource.Active {
		return Access{}, ErrResourceNotFound
	}
	if !validOperations(resource.OwnerOperations) {
		return Access{}, fmt.Errorf("%w: invalid owner operations", ErrInvalidPermission)
	}
	if !validOperations(resource.TenantOperations) || !validOperations(resource.CreatorOperations) {
		return Access{}, fmt.Errorf("%w: invalid delegated operations", ErrInvalidPermission)
	}
	switch resource.Visibility {
	case VisibilityPrivate, VisibilityTenant, VisibilityShared:
	default:
		return Access{}, fmt.Errorf("%w: unknown resource visibility %q", ErrInvalidPermission, resource.Visibility)
	}
	if subject.UserID == resource.OwnerUserID {
		return resourceAccess(resource, AccessSourceOwner), nil
	}

	switch resource.Visibility {
	case VisibilityPrivate:
		// private 默认只有 owner 可见；resource_grant 是它的唯一例外。
		// 只在这一支查授权表：tenant 可见性已经放行，没必要为它多一次查询。
		if granted, err := e.grantAllows(ctx, subject, resource); err != nil {
			return Access{}, err
		} else if granted {
			operations := resource.TenantOperations
			if operations == nil {
				operations = resource.OwnerOperations
			}
			return resourceAccessWithOperations(resource, AccessSourceShared, operations), nil
		}
		return Access{}, ErrPermissionDenied
	case VisibilityTenant:
		requirement := resource.TenantRequirement
		if requirement == "" {
			requirement = TenantNormalMember
		}
		if err := e.checkTenant(ctx, subject, resource.TenantID, requirement); err != nil {
			if errors.Is(err, ErrMembershipNotFound) {
				return Access{}, ErrPermissionDenied
			}
			return Access{}, err
		}
		if subject.UserID == resource.CreatedBy && resource.CreatorOperations != nil {
			return resourceAccessWithOperations(resource, AccessSourceCreator, resource.CreatorOperations), nil
		}
		operations := resource.TenantOperations
		if operations == nil {
			operations = resource.OwnerOperations
		}
		return resourceAccessWithOperations(resource, AccessSourceTenant, operations), nil
	case VisibilityShared:
		if contains(resource.SharedWithUserIDs, subject.UserID) {
			return resourceAccess(resource, AccessSourceShared), nil
		}
		for _, tenantID := range resource.SharedWithTenantIDs {
			if err := e.checkTenant(ctx, subject, tenantID, TenantNormalMember); err != nil {
				if errors.Is(err, ErrMembershipNotFound) {
					continue
				}
				return Access{}, err
			}
			return resourceAccess(resource, AccessSourceShared), nil
		}
		return Access{}, ErrPermissionDenied
	default:
		return Access{}, fmt.Errorf("%w: unknown resource visibility %q", ErrInvalidPermission, resource.Visibility)
	}
}

func (e *evaluation) loadResources(ctx context.Context, refs []ResourceRef) error {
	if e.source == nil {
		return ErrSourceUnavailable
	}
	var missing []ResourceRef
	for _, ref := range uniqueRefs(refs) {
		if _, ok := e.resources[ref]; ok {
			continue
		}
		if _, ok := e.resourceErr[ref]; ok {
			continue
		}
		if !validResourceRef(ref) {
			return ErrInvalidPermission
		}
		missing = append(missing, ref)
	}
	if len(missing) == 0 {
		return nil
	}
	resources, err := e.source.GetResources(ctx, missing)
	if err != nil {
		return fmt.Errorf("permission: load resources: %w", err)
	}
	for _, ref := range missing {
		e.resourceErr[ref] = ErrResourceNotFound
	}
	for _, resource := range resources {
		if _, requested := e.resourceErr[resource.Ref]; requested {
			e.resources[resource.Ref] = resource
			delete(e.resourceErr, resource.Ref)
		}
	}
	return nil
}

func (e *evaluation) getResource(ref ResourceRef) (Resource, error) {
	if !validResourceRef(ref) {
		return Resource{}, ErrInvalidPermission
	}
	if resource, ok := e.resources[ref]; ok {
		return resource, nil
	}
	if err, ok := e.resourceErr[ref]; ok {
		return Resource{}, err
	}
	return Resource{}, ErrResourceNotFound
}

func (e *evaluation) getMembership(ctx context.Context, userID, tenantID string) (*Membership, error) {
	if e.source == nil {
		return nil, ErrSourceUnavailable
	}
	key := userID + "\x00" + tenantID
	if result, ok := e.memberships[key]; ok {
		return result.membership, result.err
	}
	membership, err := e.source.GetMembership(ctx, userID, tenantID)
	if err != nil {
		err = fmt.Errorf("permission: load tenant membership: %w", err)
	} else if membership == nil || !membership.Active || membership.UserID != userID || membership.TenantID != tenantID || membership.Role == RoleInvite {
		membership = nil
		err = ErrMembershipNotFound
	}
	e.memberships[key] = membershipResult{membership: membership, err: err}
	return membership, err
}

func errorsIsPermissionDenial(err error) bool {
	return errors.Is(err, ErrPermissionDenied) || errors.Is(err, ErrMembershipNotFound)
}

func validateSubject(subject Subject) error {
	if strings.TrimSpace(subject.UserID) == "" {
		return ErrUnauthenticated
	}
	return nil
}

func validResourceRef(ref ResourceRef) bool {
	return strings.TrimSpace(string(ref.Kind)) != "" && strings.TrimSpace(ref.ID) != ""
}

func validAction(action Action) bool {
	switch action {
	case ActionEnable, ActionRead, ActionWrite, ActionShare:
		return true
	default:
		return false
	}
}

func validOperation(operation Operation) bool {
	switch operation {
	case OperationRead, OperationCreate, OperationUpdate, OperationDelete, OperationDeleteContent, OperationShare, OperationRun, OperationUse:
		return true
	default:
		return false
	}
}

func validTenantRequirement(requirement TenantRequirement) bool {
	switch requirement {
	case TenantMember, TenantNormalMember, TenantAdmin, TenantOwner:
		return true
	default:
		return false
	}
}

func membershipSatisfies(membership *Membership, requirement TenantRequirement) bool {
	if membership == nil || !membership.Active || membership.Role == RoleInvite {
		return false
	}
	switch requirement {
	case TenantMember:
		return membership.Role == RoleOwner || membership.Role == RoleAdmin || membership.Role == RoleNormal
	case TenantNormalMember:
		return membership.Role == RoleNormal
	case TenantAdmin:
		return membership.Role == RoleOwner || membership.Role == RoleAdmin
	case TenantOwner:
		return membership.Role == RoleOwner
	default:
		return false
	}
}

func validOperations(operations []Operation) bool {
	for _, operation := range operations {
		if !validOperation(operation) {
			return false
		}
	}
	return true
}

func resourceAccess(resource Resource, source AccessSource) Access {
	return resourceAccessWithOperations(resource, source, resource.OwnerOperations)
}

func resourceAccessWithOperations(resource Resource, source AccessSource, operations []Operation) Access {
	return Access{
		Resource:   resource.Ref,
		TenantID:   resource.TenantID,
		Source:     source,
		Operations: append([]Operation(nil), operations...),
	}
}

func accessAllows(access Access, operation Operation) bool {
	return access.Allows(operation)
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func uniqueRefs(refs []ResourceRef) []ResourceRef {
	seen := make(map[ResourceRef]struct{}, len(refs))
	unique := make([]ResourceRef, 0, len(refs))
	for _, ref := range refs {
		if !validResourceRef(ref) {
			continue
		}
		if _, ok := seen[ref]; ok {
			continue
		}
		seen[ref] = struct{}{}
		unique = append(unique, ref)
	}
	return unique
}
