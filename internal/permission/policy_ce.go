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
	"gorm.io/gorm/logger"
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
	// departmentScope caches the department subtree a 部门管理员 manages, keyed
	// by "userID\x00tenantID". A nil value means "not a department admin", which
	// is the common case and must not re-query per resource.
	departmentScope map[string][]string
	// creatorDepartments caches the department of a resource creator for the
	// lifetime of one evaluation; listing checks many resources written by the
	// same few people.
	creatorDepartments map[string]string
	// tenantAdmins caches "does this user administer this tenant", keyed by
	// "userID\x00tenantID". A listing touches the same tenant over and over.
	tenantAdmins map[string]bool
	// platformAdmins caches "is this user a platform super admin". The flag lives
	// on the user row and never changes mid-evaluation, so one read per user is
	// enough even when a listing walks hundreds of resources.
	platformAdmins map[string]bool
	// disabledTenants caches "is this tenant switched off", keyed by tenant id.
	// A listing walks many resources of the same tenant; one read is enough.
	disabledTenants map[string]bool
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
		// 租户管理员：枚举 owner，或控制台分配的内置「租户管理员」角色
		// （UpdateMember 只写 role_id，枚举留在 normal —— 线上真实存在这种
		// 数据，zhangsan / 和君测试 都是）。两者都不认的话，被设成租户管理员
		// 的人在控制台里是管理员、在数据面上是普通成员，什么都看不到。
		tenantAdminRoles, tenantRoleErr := tenantAdminRoleIDs(ctx, source.db)
		ownerKey := "user_tenant.tenant_id = knowledgebase.tenant_id AND user_tenant.user_id = ? AND user_tenant.status = ? AND (user_tenant.role = ?"
		ownerKeyArgs := []any{subject.UserID, string(entity.StatusValid), string(RoleOwner)}
		if tenantRoleErr == nil && len(tenantAdminRoles) > 0 {
			ownerKey += " OR user_tenant.role_id IN ?"
			ownerKeyArgs = append(ownerKeyArgs, tenantAdminRoles)
		}
		ownerKey += ")"
		callerIsOwner := db.Model(&entity.UserTenant{}).
			Select("1").
			Where(ownerKey, ownerKeyArgs...)
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
		grantWhere, grantArgs := grantSubjectCondition(db, subject.UserID, deptID)
		// 同一份主体条件既判「授予」也判「排除」：deny 必须和 allow 落在完全
		// 相同的判定面上，否则「全团队允许 + 张三排除」里被排除的人会因为
		// 两个子查询口径不同而漏网。
		datasetRules := func() *gorm.DB {
			return db.Model(&entity.ResourceGrant{}).
				Select("1").
				Where("resource_grant.tenant_id = knowledgebase.tenant_id").
				Where("resource_grant.resource_kind = ?", string(ResourceKindDataset)).
				Where("resource_grant.resource_id = knowledgebase.id")
		}
		// 空 effect 按 allow 处理：这列出现之前的存量行语义就是"授予"。
		granted := datasetRules().
			Where("COALESCE(NULLIF(resource_grant.effect, ''), ?) <> ?", entity.GrantEffectAllow, entity.GrantEffectDeny).
			Where(grantWhere, grantArgs...)
		denied := datasetRules().
			Where("COALESCE(NULLIF(resource_grant.effect, ''), ?) = ?", entity.GrantEffectAllow, entity.GrantEffectDeny).
			Where(grantWhere, grantArgs...)
		// 部门管理员看得到本部门（含子部门）成员建的知识库，即使它仍是
		// permission=me —— 与 resolveResource 里的 departmentAdminCovers 同一条
		// 规则。资源表没有部门列，只能反查创建者的 user.department_id，所以
		// 子树在 Go 侧先算成 id 列表，SQL 里只做一次 IN。
		//
		// 角色按 knowledgebase.tenant_id 逐行匹配，而不是先在 Go 侧挑一个租户：
		// 这条查询本身跨租户，同一个人可能在 A 租户是部门管理员、在 B 租户只是
		// 普通成员，只有 A 的知识库能因此可见。
		//
		// 两个键都要认：邀请路径写 user_tenant.role='admin'，控制台编辑成员却
		// 只写 role_id（枚举留在 'normal'），只认枚举会漏掉从界面上分配的人。
		departmentAdminRoles, roleErr := departmentAdminRoleIDs(ctx, source.db)
		departmentAdminKey := "(user_tenant.tenant_id = knowledgebase.tenant_id AND user_tenant.user_id = ? AND user_tenant.status = ? AND (user_tenant.role = ?"
		adminKeyArgs := []any{subject.UserID, string(entity.StatusValid), string(RoleAdmin)}
		if roleErr == nil && len(departmentAdminRoles) > 0 {
			departmentAdminKey += " OR user_tenant.role_id IN ?"
			adminKeyArgs = append(adminKeyArgs, departmentAdminRoles)
		}
		departmentAdminKey += "))"
		callerIsDepartmentAdmin := db.Model(&entity.UserTenant{}).
			Select("1").
			Where(departmentAdminKey, adminKeyArgs...)
		departmentSubtree, subtreeErr := DepartmentSubtree(ctx, source.db, deptID)
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

		// 创建者恒可见：permission=me 约束的是「别人」，不是本人。缺这一条时
		// 成员自建的库详情能读、列表里却没有（E2E D1），用户会以为库丢了。
		// 这里用列比较而不是 EXISTS 子查询：knowledgebase 就是当前行。
		//
		// 括号的位置是语义：deny 只压在「靠成员身份或显式授权拿到可见性」这一支
		// 上，租户 owner 与创建者两支写在最外层，所以「把自己排除」不会真的让
		// 自己进不去（与 resolveResource 的短路同一口径）。
		visible := "(EXISTS (?) OR knowledgebase.created_by = ? OR (" +
			"((knowledgebase.permission = ? AND EXISTS (?)) OR EXISTS (?)) AND NOT EXISTS (?)))"
		args := []any{callerIsOwner, subject.UserID,
			string(entity.TenantPermissionTeam), callerIsMember, granted, denied}
		// 子树为空（不是部门管理员，或没被分配部门）时不接这一段：既省一次
		// 判断，也避免拼出 `IN ()` 这种依赖 MySQL 容错性的语法。
		if subtreeErr == nil && len(departmentSubtree) > 0 {
			creatorInDepartment := db.Model(&entity.User{}).
				Select("1").
				Where("user.id = knowledgebase.created_by").
				Where("user.department_id IN ?", departmentSubtree)
			visible += " OR (EXISTS (?) AND EXISTS (?))"
			args = append(args, callerIsDepartmentAdmin, creatorInDepartment)
		}

		accessibleDatasets := db.Model(&entity.Knowledgebase{}).
			Select("knowledgebase.id").
			Where("knowledgebase.status = ?", string(entity.StatusValid)).
			Where("EXISTS (?)", activeOwner).
			Where(visible, args...).
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
		source:             source,
		memberships:        make(map[string]membershipResult),
		resources:          make(map[ResourceRef]Resource),
		resourceErr:        make(map[ResourceRef]error),
		departmentScope:    make(map[string][]string),
		creatorDepartments: make(map[string]string),
		tenantAdmins:       make(map[string]bool),
		platformAdmins:     make(map[string]bool),
		disabledTenants:    make(map[string]bool),
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

// readOnlyOperations 把一次授权收敛成「只能看」。
//
// 保留 read/run/use：run/use 是"拿这个库去检索、去问答"，属于查看的一种形态；
// 剔除 create/update/delete/delete_content/share：能改内容、能再授权出去，
// 都不算只读。
func readOnlyOperations(ops []Operation) []Operation {
	out := make([]Operation, 0, len(ops))
	for _, op := range ops {
		switch op {
		case OperationRead, OperationRun, OperationUse:
			out = append(out, op)
		}
	}
	if len(out) == 0 {
		out = []Operation{OperationRead}
	}
	return out
}

// grantSubjectCondition 构造「这条授权是否落在此主体身上」的 SQL 片段。
//
// QueryScope 的批量过滤与 grantLevel 的单条判定必须用同一份条件。两份各写
// 一遍时，任何一边漏了限制都会变成「列表里看得到、点进去 404」，或者更糟的
// 「列表里看不到、直连 id 能读」——所以这里只有一份。
func grantSubjectCondition(db *gorm.DB, userID, deptID string) (string, []any) {
	// 「全团队」的语义是「本租户成员可见」，不是「任何人可见」。grant 表只
	// 记了被授权的租户，成员关系得回查 user_tenant —— 少了这一层，别的租户
	// 的库只要挂了一条 team 授权，全站每个登录用户都会在列表里看到它。
	member := db.Model(&entity.UserTenant{}).
		Select("1").
		Where("user_tenant.tenant_id = resource_grant.tenant_id").
		Where("user_tenant.user_id = ? AND user_tenant.status = ?", userID, string(entity.StatusValid))

	conditions := []string{"(resource_grant.subject_kind = ? AND EXISTS (?))"}
	args := []any{entity.GrantSubjectTeam, member}
	// 点名到人的授权不需要成员关系：它本身就是例外，按 id 精确匹配即可。
	conditions = append(conditions, "(resource_grant.subject_kind = ? AND resource_grant.subject_id = ?)")
	args = append(args, entity.GrantSubjectUser, userID)
	// 没有部门时不接这一段：deptID 为空串会匹配到 subject_id 同样为空的脏行。
	if deptID != "" {
		conditions = append(conditions, "(resource_grant.subject_kind = ? AND resource_grant.subject_id = ?)")
		args = append(args, entity.GrantSubjectDepartment, deptID)
	}
	return "(" + strings.Join(conditions, " OR ") + ")", args
}

// grantLevel 返回该主体在这条资源上的最高授权级别。
//
// 返回值："edit" / "read" / ""（无授权），denied 表示命中了一条「排除」规则。
// 多条授权可能同时命中（部门只读 + 个人可编辑、或全团队 + 个人），取最高的：
// 被单独授予编辑权的人，不该被部门级的只读授权覆盖掉。
// 取最高不能用 MAX(permission) —— 字符串比较里 'read' > 'edit'，会取反。
//
// deny 恒压 allow（与文件级规则同一条优先级）：只要命中一条 deny，level 一律
// 返回空。调用方负责保留「创建者 / 管理层不受排除影响」的例外，否则一条 deny
// 就能把资源锁到没人能取消它。
func (e *evaluation) grantLevel(ctx context.Context, subject Subject, resource Resource) (string, bool, error) {
	// 这张表是控制台「可见范围：全团队 / 部门 / 用户」与权限引擎之间的桥：
	// 命中即覆盖资源原本的二值可见性。部门归属在子查询里解析，保持一次往返。
	source, ok := e.source.(*databaseSource)
	if !ok || source.db == nil {
		return "", false, nil
	}
	var row struct {
		Total  int64
		Denied int64
		Edits  int64
	}
	// effect 列是后加的：空值按 allow 处理，否则这列出现之前的存量行会全部
	// 变成"未授权"。两个 COUNT 都基于同一份收敛后的取值，避免一处漏判。
	effectAllows := "COALESCE(NULLIF(resource_grant.effect, ''), ?)"
	grantWhere, grantArgs := grantSubjectCondition(source.db.WithContext(ctx), subject.UserID, lookupDepartmentID(ctx, source.db, subject.UserID))
	err := source.db.WithContext(ctx).
		Model(&entity.ResourceGrant{}).
		Select("COUNT(*) AS total, "+
			"COALESCE(SUM(CASE WHEN "+effectAllows+" = ? THEN 1 ELSE 0 END), 0) AS denied, "+
			"COALESCE(SUM(CASE WHEN "+effectAllows+" <> ? AND resource_grant.permission = ? THEN 1 ELSE 0 END), 0) AS edits",
			entity.GrantEffectAllow, entity.GrantEffectDeny,
			entity.GrantEffectAllow, entity.GrantEffectDeny, "edit").
		Where("resource_grant.tenant_id = ?", resource.TenantID).
		Where("resource_grant.resource_kind = ?", string(resource.Ref.Kind)).
		Where("resource_grant.resource_id = ?", resource.Ref.ID).
		Where(grantWhere, grantArgs...).
		Scan(&row).Error
	if err != nil {
		// 授权是"额外放行"而不是"额外限制"：这张表不可用（老库未迁移、测试库
		// 没建表）时降级回原有的二值可见性，private 资源仍然只有 owner 可见。
		// 反过来把错误抛上去会让整次权限判定 500，等于一张附加表能拖垮全站。
		return "", false, nil
	}
	if row.Total == 0 {
		return "", false, nil
	}
	if row.Denied > 0 {
		return "", true, nil
	}
	if row.Edits > 0 {
		return "edit", false, nil
	}
	return "read", false, nil
}

// tieredAccess 判定三级收窄档位（owner / tenant_owner / platform）里「租户
// 管理层之外」的可见性：创建者始终可用，部门管理员只读可见，其余人只能靠
// resource_grant 显式授权。
//
// 与 VisibilityPrivate 的差别只有一处：租户管理员由调用方在进这一支之前判定
// （owner 档不放行、tenant_owner / platform 档放行），这里不再放行租户管理员。
func (e *evaluation) tieredAccess(ctx context.Context, subject Subject, resource Resource) (Access, error) {
	if resource.CreatedBy != "" && subject.UserID == resource.CreatedBy {
		return resourceAccess(resource, AccessSourceOwner), nil
	}
	level, denied, err := e.grantLevel(ctx, subject, resource)
	if err != nil {
		return Access{}, err
	}
	// deny 压过任何 allow，但不作用于创建者（上面已返回）与部门管理员：
	// 排除表达的是"看不见"，不是"降权"；管理角色能被排除的话，部门范围的
	// 可见性承诺就自相矛盾了。
	if denied {
		level = ""
	}
	if level != "" {
		operations := resource.TenantOperations
		if operations == nil {
			operations = resource.OwnerOperations
		}
		if level == "read" {
			operations = readOnlyOperations(operations)
		}
		return resourceAccessWithOperations(resource, AccessSourceShared, operations), nil
	}
	// 部门管理员看得到本部门（含子部门）成员创建的内容：只给「看 + 用」，
	// 改 / 删 / 再授权仍归创建者与租户管理层。与 VisibilityPrivate 一致。
	if covered, err := e.departmentAdminCovers(ctx, subject, resource); err != nil {
		return Access{}, err
	} else if covered {
		operations := resource.TenantOperations
		if operations == nil {
			operations = resource.OwnerOperations
		}
		return resourceAccessWithOperations(resource, AccessSourceTenant, readOnlyOperations(operations)), nil
	}
	return Access{}, ErrPermissionDenied
}

// isPlatformAdmin reports whether userID is a platform super administrator.
//
// 平台超管（user.is_superuser）与租户内 owner / 管理员是三件不同的事：前者
// 不受租户边界约束，只用于平台运维与审计。读不到标志位时按「不是」处理 ——
// 收紧比放开安全。
func (e *evaluation) isPlatformAdmin(ctx context.Context, userID string) bool {
	if strings.TrimSpace(userID) == "" {
		return false
	}
	if cached, ok := e.platformAdmins[userID]; ok {
		return cached
	}
	admin := false
	if source, ok := e.source.(*databaseSource); ok && source.db != nil {
		var row struct {
			IsSuperuser *bool `gorm:"column:is_superuser"`
		}
		// 判定用的查询不写日志：user 表缺失（老库 / 精简测试库）属于"不是超管"
		// 的常规分支，不该在每次权限判定时刷一条 SQL 错误。
		if err := source.db.Session(&gorm.Session{Logger: logger.Discard}).WithContext(ctx).
			Model(&entity.User{}).
			Select("is_superuser").Where("id = ?", userID).Take(&row).Error; err == nil {
			admin = row.IsSuperuser != nil && *row.IsSuperuser
		}
	}
	e.platformAdmins[userID] = admin
	return admin
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

// tenantDisabled 判断租户是否已停用。
//
// 停用语义是「整个租户暂停」，不是某个成员被降权，所以判定必须排在 owner /
// 创建者短路之前 —— 否则停用之后资源 owner 仍读得到自己名下的内容。
//
// 口径与知识库列表 SQL（QueryScope 里的 tenantDisabled 子查询）一致：只有存在
// enabled=0 的记录才算停用；租户行缺失（历史脏数据、部分迁移）按启用处理，
// 避免一次把所有人的内容全隐藏。
func (e *evaluation) tenantDisabled(ctx context.Context, tenantID string) bool {
	if strings.TrimSpace(tenantID) == "" {
		return false
	}
	if cached, ok := e.disabledTenants[tenantID]; ok {
		return cached
	}
	disabled := false
	if source, ok := e.source.(*databaseSource); ok && source.db != nil {
		var count int64
		err := source.db.WithContext(ctx).Model(&entity.Tenant{}).
			Where("id = ? AND IFNULL(enabled, 1) = 0", tenantID).
			Count(&count).Error
		disabled = err == nil && count > 0
	}
	e.disabledTenants[tenantID] = disabled
	return disabled
}

func (e *evaluation) resolveResource(ctx context.Context, subject Subject, resource Resource) (Access, error) {
	if resource.TenantID == "" || resource.OwnerUserID == "" || !validResourceRef(resource.Ref) {
		return Access{}, fmt.Errorf("%w: incomplete resource authorization facts", ErrInvalidPermission)
	}
	if !resource.Active {
		return Access{}, ErrResourceNotFound
	}
	// 租户停用后，租户内资源对所有人不可见。知识库的列表 SQL 里已经有这条
	// 谓词，其余四类（知识问答/知识搜索/智能体/记忆）走逐条判定，在这里补齐
	// 才能得到同样的结果，而不是「列表里还在、点进去也没事」。
	if e.tenantDisabled(ctx, resource.TenantID) {
		return Access{}, ErrResourceNotFound
	}
	if !validOperations(resource.OwnerOperations) {
		return Access{}, fmt.Errorf("%w: invalid owner operations", ErrInvalidPermission)
	}
	if !validOperations(resource.TenantOperations) || !validOperations(resource.CreatorOperations) {
		return Access{}, fmt.Errorf("%w: invalid delegated operations", ErrInvalidPermission)
	}
	switch resource.Visibility {
	case VisibilityPrivate, VisibilityTenant, VisibilityShared,
		VisibilityOwner, VisibilityTenantOwner, VisibilityPlatform:
	default:
		return Access{}, fmt.Errorf("%w: unknown resource visibility %q", ErrInvalidPermission, resource.Visibility)
	}
	if subject.UserID == resource.OwnerUserID {
		return resourceAccess(resource, AccessSourceOwner), nil
	}
	// 平台超级管理员是跨租户的运维 / 审计身份：任何一档可见性下都能看，
	// 但来源被单独标记，排障时能和「资源 owner」区分开。
	if e.isPlatformAdmin(ctx, subject.UserID) {
		return resourceAccess(resource, AccessSourcePlatformAdmin), nil
	}
	// 租户管理员看得到本租户的一切，包括 owner（仅所有者可见）档。
	//
	// 与知识库列表 SQL 的 callerIsOwner 分支同一口径：那条 SQL 不看可见性列，
	// 租户管理员对 permission=owner 的库照样可见。这条判定必须对五类资源都成立，
	// 否则同一份授权在知识库能看到、在知识问答/搜索/智能体/记忆里看不到。
	//
	// 控制台分配的「租户管理员」只落在 role_id 上、枚举仍是 normal，所以按角色判，
	// 不能只看枚举。跨租户不会误放：用的是 resource.TenantID 上的成员关系。
	if e.isTenantAdmin(ctx, subject.UserID, resource.TenantID) {
		return resourceAccess(resource, AccessSourceTenant), nil
	}
	// 三档收窄在这里收口：管理层已在上面放行，剩下的人一律逐主体判定
	// （创建者、显式授权、部门管理员）。
	switch resource.Visibility {
	case VisibilityOwner, VisibilityTenantOwner, VisibilityPlatform:
		return e.tieredAccess(ctx, subject, resource)
	}

	switch resource.Visibility {
	case VisibilityPrivate:
		// 创建者对自己的私有资源始终可用。OwnerUserID 是「租户 owner」，
		// 不是创建者 —— 普通成员建完一个 permission=me 的知识库，紧接着
		// 打开它就会被自己的私有库挡住（列表能看到，点进去 403/404）。
		// 'me' 的语义就是「只有自己」，创建者必须在 owner 之外单独放行。
		if resource.CreatedBy != "" && subject.UserID == resource.CreatedBy {
			return resourceAccess(resource, AccessSourceOwner), nil
		}
		// private 默认只有 owner 可见；resource_grant 是它的唯一例外。
		// 只在这一支查授权表：tenant 可见性已经放行，没必要为它多一次查询。
		level, denied, err := e.grantLevel(ctx, subject, resource)
		if err != nil {
			return Access{}, err
		}
		// deny 压过 allow，但不作用于创建者（上面已返回）与部门管理员（下面）。
		if denied {
			level = ""
		}
		if level != "" {
			operations := resource.TenantOperations
			if operations == nil {
				operations = resource.OwnerOperations
			}
			// 只读授权只放行「看 + 检索」，编辑/删除/再授权都不放行。
			if level == "read" {
				operations = readOnlyOperations(operations)
			}
			return resourceAccessWithOperations(resource, AccessSourceShared, operations), nil
		}
		// 部门管理员看得到本部门（含子部门）成员创建的内容，即使它仍是
		// `permission=me`。资源表没有部门列，只能按创建者的部门归属判断：
		// 不这样做，「部门管理员」的角色名就和实际可见范围对不上 —— 部门成员
		// 各建各的私有内容，管理员一条也看不到。
		//
		// 只给「看 + 用」：能看到、能在检索与对话里引用，但改/删/再授权仍归
		// 创建者和租户管理员。需求是"可以看到本部门建的所有内容"，不是代管。
		if covered, err := e.departmentAdminCovers(ctx, subject, resource); err != nil {
			return Access{}, err
		} else if covered {
			operations := resource.TenantOperations
			if operations == nil {
				operations = resource.OwnerOperations
			}
			return resourceAccessWithOperations(resource, AccessSourceShared, readOnlyOperations(operations)), nil
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
		// 共享资源同样接受逐人 / 逐部门授权：文件这类资源没法把"给某个成员
		// 单独开权限"写进共享名单，只能落在 resource_grant 上。
		level, denied, err := e.grantLevel(ctx, subject, resource)
		if err != nil {
			return Access{}, err
		}
		if denied {
			level = ""
		}
		if level != "" {
			operations := resource.TenantOperations
			if operations == nil {
				operations = resource.OwnerOperations
			}
			if level == "read" {
				operations = readOnlyOperations(operations)
			}
			return resourceAccessWithOperations(resource, AccessSourceShared, operations), nil
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
