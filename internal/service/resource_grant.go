package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"

	"ragflow/internal/dao"
	"ragflow/internal/entity"
)

// ResourceGrantService backs the console's "resource authorization" page.
//
// It is deliberately resource-family agnostic: the console sends a `kind`
// (dataset / canvas / memory) and this service resolves the right table. All
// three families expose the same two facts to the page — a name, an owner, and
// the legacy binary default — so the UI stays one component.
type ResourceGrantService struct{}

func NewResourceGrantService() *ResourceGrantService {
	return &ResourceGrantService{}
}

// GrantSubject is one "who" of a visibility rule.
type GrantSubject struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
	Name string `json:"name"`
}

// GrantResourceView is one resource row of the authorization page.
type GrantResourceView struct {
	ResourceID   string `json:"resource_id"`
	ResourceName string `json:"resource_name"`
	OwnerID      string `json:"owner_id"`
	OwnerName    string `json:"owner_name"`
	// DefaultScope is the legacy column: private (仅自己) / team (全团队).
	DefaultScope string         `json:"default_scope"`
	Grants       []GrantSubject `json:"grants"`
	UpdateTime   int64          `json:"update_time"`
}

// supportedKinds guards the console-supplied kind before it reaches a table name.
var supportedKinds = map[string]bool{
	"dataset": true,
	"canvas":  true,
	"memory":  true,
}

// ListResources returns a page of resources of one kind with their grants.
func (s *ResourceGrantService) ListResources(ctx context.Context, tenantID, kind, keywords string, limit, offset int) ([]*GrantResourceView, int64, error) {
	if !supportedKinds[kind] {
		return nil, 0, errors.New("不支持的资源类型")
	}
	if limit <= 0 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}

	var (
		rows  []*GrantResourceView
		total int64
		err   error
	)
	switch kind {
	case "dataset":
		rows, total, err = s.listDatasets(ctx, tenantID, keywords, limit, offset)
	case "canvas":
		rows, total, err = s.listCanvases(ctx, tenantID, keywords, limit, offset)
	case "memory":
		rows, total, err = s.listMemories(ctx, tenantID, keywords, limit, offset)
	}
	if err != nil {
		return nil, 0, err
	}

	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ResourceID)
	}
	grantMap, err := dao.NewResourceGrantDAO().ListByResources(ctx, dao.DB, tenantID, kind, ids)
	if err != nil {
		return nil, 0, err
	}
	for _, row := range rows {
		row.Grants = s.describeGrants(ctx, tenantID, grantMap[row.ResourceID])
	}
	return rows, total, nil
}

func (s *ResourceGrantService) listDatasets(ctx context.Context, tenantID, keywords string, limit, offset int) ([]*GrantResourceView, int64, error) {
	q := dao.DB.WithContext(ctx).Model(&entity.Knowledgebase{}).
		Where("knowledgebase.tenant_id = ?", tenantID).
		Where("knowledgebase.status = ?", string(entity.StatusValid))
	if kw := strings.TrimSpace(keywords); kw != "" {
		q = q.Where("knowledgebase.name LIKE ?", "%"+kw+"%")
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	type row struct {
		ID         string    `gorm:"column:id"`
		Name       string    `gorm:"column:name"`
		OwnerID    string    `gorm:"column:owner_id"`
		Permission string    `gorm:"column:permission"`
		UpdateDate time.Time `gorm:"column:update_date"`
	}
	raw := make([]row, 0)
	err := q.Select("knowledgebase.id, knowledgebase.name, knowledgebase.created_by AS owner_id, knowledgebase.permission, knowledgebase.update_date").
		Order("knowledgebase.update_date DESC").
		Limit(limit).Offset(offset).
		Scan(&raw).Error
	if err != nil {
		return nil, 0, err
	}

	out := make([]*GrantResourceView, 0, len(raw))
	ownerIDs := make([]string, 0, len(raw))
	for _, r := range raw {
		out = append(out, &GrantResourceView{
			ResourceID:   r.ID,
			ResourceName: r.Name,
			OwnerID:      r.OwnerID,
			DefaultScope: r.Permission,
			UpdateTime:   r.UpdateDate.UnixMilli(),
		})
		ownerIDs = append(ownerIDs, r.OwnerID)
	}
	names := s.ownerNames(ctx, ownerIDs)
	for _, row := range out {
		row.OwnerName = names[row.OwnerID]
	}
	return out, total, nil
}

func (s *ResourceGrantService) listCanvases(ctx context.Context, tenantID, keywords string, limit, offset int) ([]*GrantResourceView, int64, error) {
	// user_canvas has no tenant_id: a canvas belongs to its owning user, and the
	// tenant id IS that user's id (same convention as dao/analytics.go).
	q := dao.DB.WithContext(ctx).Model(&entity.UserCanvas{}).
		Where("user_canvas.user_id = ?", tenantID)
	if kw := strings.TrimSpace(keywords); kw != "" {
		q = q.Where("user_canvas.title LIKE ?", "%"+kw+"%")
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	type row struct {
		ID         string    `gorm:"column:id"`
		Title      string    `gorm:"column:title"`
		OwnerID    string    `gorm:"column:user_id"`
		Permission string    `gorm:"column:permission"`
		UpdateDate time.Time `gorm:"column:update_date"`
	}
	raw := make([]row, 0)
	err := q.Select("user_canvas.id, COALESCE(user_canvas.title, '') AS title, user_canvas.user_id, user_canvas.permission, user_canvas.update_date").
		Order("user_canvas.update_date DESC").
		Limit(limit).Offset(offset).
		Scan(&raw).Error
	if err != nil {
		return nil, 0, err
	}

	out := make([]*GrantResourceView, 0, len(raw))
	ownerIDs := make([]string, 0, len(raw))
	for _, r := range raw {
		out = append(out, &GrantResourceView{
			ResourceID:   r.ID,
			ResourceName: r.Title,
			OwnerID:      r.OwnerID,
			DefaultScope: r.Permission,
			UpdateTime:   r.UpdateDate.UnixMilli(),
		})
		ownerIDs = append(ownerIDs, r.OwnerID)
	}
	names := s.ownerNames(ctx, ownerIDs)
	for _, row := range out {
		row.OwnerName = names[row.OwnerID]
	}
	return out, total, nil
}

func (s *ResourceGrantService) listMemories(ctx context.Context, tenantID, keywords string, limit, offset int) ([]*GrantResourceView, int64, error) {
	q := dao.DB.WithContext(ctx).Model(&entity.Memory{}).
		Where("memory.tenant_id = ?", tenantID)
	if kw := strings.TrimSpace(keywords); kw != "" {
		q = q.Where("memory.name LIKE ?", "%"+kw+"%")
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// memory.permissions is the legacy column (plural), unlike the other two.
	type row struct {
		ID         string    `gorm:"column:id"`
		Name       string    `gorm:"column:name"`
		OwnerID    string    `gorm:"column:tenant_id"`
		Permission string    `gorm:"column:permissions"`
		UpdateDate time.Time `gorm:"column:update_date"`
	}
	raw := make([]row, 0)
	err := q.Select("memory.id, memory.name, memory.tenant_id, memory.permissions, memory.update_date").
		Order("memory.update_date DESC").
		Limit(limit).Offset(offset).
		Scan(&raw).Error
	if err != nil {
		return nil, 0, err
	}

	out := make([]*GrantResourceView, 0, len(raw))
	ownerIDs := make([]string, 0, len(raw))
	for _, r := range raw {
		out = append(out, &GrantResourceView{
			ResourceID:   r.ID,
			ResourceName: r.Name,
			OwnerID:      r.OwnerID,
			DefaultScope: r.Permission,
			UpdateTime:   r.UpdateDate.UnixMilli(),
		})
		ownerIDs = append(ownerIDs, r.OwnerID)
	}
	names := s.ownerNames(ctx, ownerIDs)
	for _, row := range out {
		row.OwnerName = names[row.OwnerID]
	}
	return out, total, nil
}

// ownerNames resolves display names for a batch of owner ids in one query.
func (s *ResourceGrantService) ownerNames(ctx context.Context, ids []string) map[string]string {
	out := make(map[string]string, len(ids))
	unique := make([]string, 0, len(ids))
	seen := make(map[string]bool, len(ids))
	for _, id := range ids {
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		unique = append(unique, id)
	}
	if len(unique) == 0 {
		return out
	}

	type row struct {
		ID       string `gorm:"column:id"`
		Nickname string `gorm:"column:nickname"`
		Email    string `gorm:"column:email"`
	}
	rows := make([]row, 0)
	if err := dao.DB.WithContext(ctx).Model(&entity.User{}).
		Select("id, nickname, email").
		Where("id IN ?", unique).
		Find(&rows).Error; err != nil {
		return out
	}
	for _, r := range rows {
		if r.Nickname != "" {
			out[r.ID] = r.Nickname
		} else {
			out[r.ID] = r.Email
		}
	}
	return out
}

// describeGrants turns stored rows into display subjects (resolving names).
func (s *ResourceGrantService) describeGrants(ctx context.Context, tenantID string, rows []*entity.ResourceGrant) []GrantSubject {
	out := make([]GrantSubject, 0, len(rows))
	if len(rows) == 0 {
		return out
	}

	deptIDs := make([]string, 0)
	userIDs := make([]string, 0)
	teamHit := false
	for _, r := range rows {
		switch r.SubjectKind {
		case entity.GrantSubjectTeam:
			teamHit = true
		case entity.GrantSubjectDepartment:
			deptIDs = append(deptIDs, r.SubjectID)
		case entity.GrantSubjectUser:
			userIDs = append(userIDs, r.SubjectID)
		}
	}

	deptNames := make(map[string]string, len(deptIDs))
	if len(deptIDs) > 0 {
		type row struct {
			ID   string `gorm:"column:id"`
			Name string `gorm:"column:name"`
		}
		list := make([]row, 0)
		if err := dao.DB.WithContext(ctx).Model(&entity.Department{}).
			Select("id, name").
			Where("tenant_id = ?", tenantID).
			Where("id IN ?", deptIDs).
			Find(&list).Error; err == nil {
			for _, r := range list {
				deptNames[r.ID] = r.Name
			}
		}
	}

	userNames := s.ownerNames(ctx, userIDs)

	if teamHit {
		out = append(out, GrantSubject{Kind: entity.GrantSubjectTeam, Name: "全团队"})
	}
	for _, id := range deptIDs {
		name := deptNames[id]
		if name == "" {
			name = "已删除部门"
		}
		out = append(out, GrantSubject{Kind: entity.GrantSubjectDepartment, ID: id, Name: name})
	}
	for _, id := range userIDs {
		name := userNames[id]
		if name == "" {
			name = id
		}
		out = append(out, GrantSubject{Kind: entity.GrantSubjectUser, ID: id, Name: name})
	}
	return out
}

// SetGrants replaces the visibility rule set of one resource.
//
// The resource is verified to belong to the tenant first — otherwise the console
// would be a way to grant access to someone else's knowledge base.
func (s *ResourceGrantService) SetGrants(ctx context.Context, tenantID, kind, resourceID string, subjects []GrantSubject) error {
	if !supportedKinds[kind] {
		return errors.New("不支持的资源类型")
	}
	if err := s.assertResourceInTenant(ctx, tenantID, kind, resourceID); err != nil {
		return err
	}

	rows := make([]*entity.ResourceGrant, 0, len(subjects))
	now := time.Now().UnixMilli()
	for _, sub := range subjects {
		if sub.Kind != entity.GrantSubjectTeam && sub.Kind != entity.GrantSubjectDepartment && sub.Kind != entity.GrantSubjectUser {
			continue
		}
		// A team rule needs no subject id; the other two demand one.
		if sub.Kind != entity.GrantSubjectTeam && strings.TrimSpace(sub.ID) == "" {
			continue
		}
		rows = append(rows, &entity.ResourceGrant{
			TenantID:     tenantID,
			ResourceKind: kind,
			ResourceID:   resourceID,
			SubjectKind:  sub.Kind,
			SubjectID:    sub.ID,
			BaseModel:    entity.BaseModel{CreateTime: &now, UpdateTime: &now},
		})
	}
	return dao.NewResourceGrantDAO().Replace(ctx, dao.DB, tenantID, kind, resourceID, rows)
}

// assertResourceInTenant confirms the resource is owned by this tenant.
func (s *ResourceGrantService) assertResourceInTenant(ctx context.Context, tenantID, kind, resourceID string) error {
	var count int64
	var err error
	switch kind {
	case "dataset":
		err = dao.DB.WithContext(ctx).Model(&entity.Knowledgebase{}).
			Where("id = ? AND tenant_id = ?", resourceID, tenantID).
			Count(&count).Error
	case "canvas":
		err = dao.DB.WithContext(ctx).Model(&entity.UserCanvas{}).
			Where("id = ? AND user_id = ?", resourceID, tenantID).
			Count(&count).Error
	case "memory":
		err = dao.DB.WithContext(ctx).Model(&entity.Memory{}).
			Where("id = ? AND tenant_id = ?", resourceID, tenantID).
			Count(&count).Error
	}
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errors.New("资源不存在")
		}
		return err
	}
	if count == 0 {
		return errors.New("资源不存在或不属于该租户")
	}
	return nil
}
