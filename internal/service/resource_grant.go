package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"

	"ragflow/internal/dao"
	"ragflow/internal/entity"
	"ragflow/internal/permission"
)

// ResourceGrantService backs the console's "resource authorization" page.
//
// 它按 grantKindCatalog 里登记的 kind 分发，因此对资源类型没有硬编码的
// 白名单：新增一类可授权资源只加一行注册表，列表、可见性写入、租户归属校验
// 全部跟着生效。
type ResourceGrantService struct{}

func NewResourceGrantService() *ResourceGrantService {
	return &ResourceGrantService{}
}

// GrantSubject is one "who" of a visibility rule.
type GrantSubject struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
	Name string `json:"name"`
	// Permission 是这次授予的操作级别："read" 只能看，"edit" 可编辑删除。
	// 空值按 "edit" 处理：老前端不传这个字段，保持它原来的行为（授权即编辑）。
	Permission string `json:"permission,omitempty"`
	// Effect 是这条规则的取向："allow"（授予）或 "deny"（排除）。
	// 只有文件级授权支持 deny，空值按 allow 处理。
	Effect string `json:"effect,omitempty"`
}

// 授权级别白名单。不接受任意字符串，避免写进库里之后没人认得出是什么。
const (
	GrantPermissionRead = "read"
	GrantPermissionEdit = "edit"
)

// GrantKindDocument 是文件级授权的 resource_kind。文件永远挂在某个知识库下，
// 库级是前提，文件级只做细化。
const GrantKindDocument = "document"

// grantDenyKinds 是允许写「排除」规则的类型。
//
// 只开放知识库与库内文件：这两类的判定（单条 + 列表 SQL + 检索）都有对应的
// 排除谓词。其余类型先拒绝写入 —— 写入成功但判定不认，会变成「配置里排除了、
// 实际照样能看」，比不支持更糟。
var grantDenyKinds = map[string]bool{
	GrantKindDocument: true,
	"dataset":         true,
}

// grantSubjectKey 是「同一主体」的键：部门/用户带 id，全团队不带。
func grantSubjectKey(kind, id string) string {
	return kind + "\x00" + id
}

// validateGrantDenySupport 在写库之前否掉「排除了但判定不认」的组合。
//
// 两条规则：类型必须已经接入排除谓词（见 grantDenyKinds）；「全团队」不能作为
// 排除对象 —— 那等价于清空授权，同一结果两个入口只会让人误用。
func validateGrantDenySupport(spec *grantKindSpec, subjects []GrantSubject) error {
	for _, sub := range subjects {
		if sub.Kind != entity.GrantSubjectTeam &&
			sub.Kind != entity.GrantSubjectDepartment &&
			sub.Kind != entity.GrantSubjectUser {
			continue
		}
		if sub.Kind != entity.GrantSubjectTeam && strings.TrimSpace(sub.ID) == "" {
			continue
		}
		if normalizeGrantEffect(sub.Effect) != entity.GrantEffectDeny {
			continue
		}
		if !grantDenyKinds[spec.Kind] {
			return fmt.Errorf("%s 暂不支持「排除」：收回权限请改用可见范围或移除授权", spec.Label)
		}
		if sub.Kind == entity.GrantSubjectTeam {
			return errors.New("不能把「全团队」设为排除：收回全部请直接移除规则")
		}
	}
	return nil
}

// normalizeGrantEffect 把外部输入收敛成合法取向，空值按 allow 处理。
func normalizeGrantEffect(v string) string {
	if strings.EqualFold(strings.TrimSpace(v), entity.GrantEffectDeny) {
		return entity.GrantEffectDeny
	}
	return entity.GrantEffectAllow
}

// strongerGrantPermission 返回两个级别里更强的那个（edit > read）。
// 用于合并同一主体的多行历史授权，避免"部门只读 + 个人可编辑"被读成只读。
func strongerGrantPermission(a, b string) string {
	if normalizeGrantPermission(a) == GrantPermissionEdit ||
		normalizeGrantPermission(b) == GrantPermissionEdit {
		return GrantPermissionEdit
	}
	return GrantPermissionRead
}

// normalizeGrantPermission 把外部输入收敛成合法级别，空值按 edit 处理。
func normalizeGrantPermission(v string) string {
	if strings.EqualFold(strings.TrimSpace(v), GrantPermissionRead) {
		return GrantPermissionRead
	}
	return GrantPermissionEdit
}

// GrantResourceView is one resource row of the authorization page.
type GrantResourceView struct {
	ResourceID   string `json:"resource_id"`
	ResourceName string `json:"resource_name"`
	OwnerID      string `json:"owner_id"`
	OwnerName    string `json:"owner_name"`
	// Visibility 是三级可见性（owner / tenant_owner / platform）。空串表示这类
	// 资源不参与三档，只能逐人 / 逐部门授权。
	Visibility string `json:"visibility,omitempty"`
	// DefaultScope 是历史的二值可见性（me / team / private / team），保留给
	// 还没升级的前端读；新前端读 Visibility。
	DefaultScope string `json:"default_scope"`
	// SupportsDeny 表示这类资源能否写「排除」规则。由后端注册表决定，前端不要
	// 自己按 kind 猜：猜错的表现是"保存成功但判定不认"。
	SupportsDeny bool           `json:"supports_deny"`
	Grants       []GrantSubject `json:"grants"`
	UpdateTime   int64          `json:"update_time"`
}

// grantResourceRow 是通用列表查询的扫描目标。
type grantResourceRow struct {
	ResourceID   string    `gorm:"column:resource_id"`
	ResourceName string    `gorm:"column:resource_name"`
	OwnerID      string    `gorm:"column:owner_id"`
	Visibility   string    `gorm:"column:visibility"`
	UpdateDate   time.Time `gorm:"column:update_date"`
}

// ListResources returns a page of resources of one kind with their grants.
//
// userID 是查看者：清单只包含他读得到的资源。分页与 total 都在 SQL 里收窄，
// 否则「看得见的行」和「total 说还有 16 条」会自相矛盾，也等于把全租户资源数
// 量透给普通成员（E2E D2）。
func (s *ResourceGrantService) ListResources(ctx context.Context, tenantID, kind, keywords, userID string, limit, offset int) ([]*GrantResourceView, int64, error) {
	spec, err := grantKindSpecFor(kind)
	if err != nil {
		return nil, 0, err
	}
	if spec.Kind == GrantKindDocument || spec.TenantWhere == nil {
		return nil, 0, errors.New("文件级授权请通过所属知识库展开")
	}
	if limit <= 0 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}

	q := dao.DB.WithContext(ctx).Table(spec.Table)
	if where, args := spec.TenantWhere(tenantID); where != "" {
		q = q.Where(where, args...)
	}
	if spec.ExtraWhere != "" {
		q = q.Where(spec.ExtraWhere)
	}
	if kw := strings.TrimSpace(keywords); kw != "" {
		q = q.Where(spec.NameExpr+" LIKE ?", "%"+kw+"%")
	}
	visible, scoped, err := s.visibleGrantIDs(ctx, userID, spec.Kind)
	if err != nil {
		return nil, 0, err
	}
	if scoped {
		if len(visible) == 0 {
			return []*GrantResourceView{}, 0, nil
		}
		visibleIDs := make([]string, 0, len(visible))
		for id := range visible {
			visibleIDs = append(visibleIDs, id)
		}
		q = q.Where("id IN ?", visibleIDs)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	selects := []string{
		"id AS resource_id",
		spec.NameExpr + " AS resource_name",
		spec.OwnerExpr + " AS owner_id",
		"update_date",
	}
	if spec.VisibilityColumn != "" {
		selects = append(selects, spec.VisibilityColumn+" AS visibility")
	}
	raw := make([]grantResourceRow, 0)
	if err := q.Select(strings.Join(selects, ", ")).
		Order("update_date DESC").
		Limit(limit).Offset(offset).
		Scan(&raw).Error; err != nil {
		return nil, 0, err
	}

	out := make([]*GrantResourceView, 0, len(raw))
	ownerIDs := make([]string, 0, len(raw))
	for _, r := range raw {
		row := &GrantResourceView{
			ResourceID:   r.ResourceID,
			ResourceName: r.ResourceName,
			OwnerID:      r.OwnerID,
			DefaultScope: r.Visibility,
			SupportsDeny: grantDenyKinds[spec.Kind],
			UpdateTime:   r.UpdateDate.UnixMilli(),
		}
		if spec.VisibilityColumn != "" {
			row.Visibility = entity.NormalizeResourceVisibility(r.Visibility)
		}
		out = append(out, row)
		ownerIDs = append(ownerIDs, r.OwnerID)
	}

	ids := make([]string, 0, len(out))
	for _, row := range out {
		ids = append(ids, row.ResourceID)
	}
	grantMap, err := dao.NewResourceGrantDAO().ListByResources(ctx, dao.DB, tenantID, kind, ids)
	if err != nil {
		return nil, 0, err
	}
	names := s.ownerNames(ctx, ownerIDs)
	for _, row := range out {
		if name := names[row.OwnerID]; name != "" {
			row.OwnerName = name
		} else if row.OwnerID != "" {
			// 没有 created_by 的资源（MCP 服务、数据源、技能空间）用租户 id
			// 当所有者，这里翻成租户名，避免页面上出现一串 id。
			row.OwnerName = s.tenantName(ctx, row.OwnerID)
		}
		row.Grants = s.describeGrants(ctx, tenantID, grantMap[row.ResourceID])
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

// tenantName resolves a tenant display name; unknown ids return the id itself.
func (s *ResourceGrantService) tenantName(ctx context.Context, tenantID string) string {
	if strings.TrimSpace(tenantID) == "" {
		return ""
	}
	var row struct {
		Name *string `gorm:"column:name"`
	}
	if err := dao.DB.WithContext(ctx).Model(&entity.Tenant{}).
		Select("name").Where("id = ?", tenantID).Take(&row).Error; err != nil {
		return tenantID
	}
	if row.Name != nil && strings.TrimSpace(*row.Name) != "" {
		return *row.Name
	}
	return tenantID
}

// grantAggregate 是同一个主体在一份规则集合里的最终展示状态。
type grantAggregate struct {
	permission string
	effect     string
}

// merge 收敛同一个主体的多行规则：deny 压过 allow，同级取更强的 permission。
func (a grantAggregate) merge(row *entity.ResourceGrant) grantAggregate {
	if a.effect == entity.GrantEffectDeny || normalizeGrantEffect(row.Effect) == entity.GrantEffectDeny {
		// deny 不可逆：命中过一条，这个主体就是被排除，再多的 allow 也不
		// 会把展示（和判定）拉回"允许"。
		return grantAggregate{effect: entity.GrantEffectDeny, permission: a.permission}
	}
	return grantAggregate{
		effect:     entity.GrantEffectAllow,
		permission: strongerGrantPermission(a.permission, row.Permission),
	}
}

// grantNameCache 缓存主体显示名。资源树的每个节点都要把规则翻成名字，
// 没有缓存时同一批部门 / 成员会被重复查上几十次。
type grantNameCache struct {
	deptNames map[string]string
	userNames map[string]string
}

func newGrantNameCache() *grantNameCache {
	return &grantNameCache{
		deptNames: map[string]string{},
		userNames: map[string]string{},
	}
}

// describeGrants turns stored rows into display subjects (resolving names).
func (s *ResourceGrantService) describeGrants(ctx context.Context, tenantID string, rows []*entity.ResourceGrant) []GrantSubject {
	return s.describeGrantsCached(ctx, tenantID, rows, newGrantNameCache())
}

// describeGrantsCached 与 describeGrants 相同，但复用调用方给的名字缓存。
func (s *ResourceGrantService) describeGrantsCached(ctx context.Context, tenantID string, rows []*entity.ResourceGrant, cache *grantNameCache) []GrantSubject {
	out := make([]GrantSubject, 0, len(rows))
	if len(rows) == 0 {
		return out
	}
	if cache == nil {
		cache = newGrantNameCache()
	}

	// deptIDs / userIDs 是「名字还没查过、需要回库的 id」，deptOrder / userOrder
	// 才是要输出的主体列表。两者不能合并：缓存命中时不会再入队查名字，若拿
	// deptIDs 当输出列表，同一批里第二个起共享同一主体的行就会返回空 grants
	// （子项例外里只有第一行有标签，其余留白）。
	deptIDs := make([]string, 0)
	userIDs := make([]string, 0)
	deptOrder := make([]string, 0)
	userOrder := make([]string, 0)
	teamHit := false
	teamGrant := grantAggregate{}
	deptGrants := make(map[string]grantAggregate, len(rows))
	userGrants := make(map[string]grantAggregate, len(rows))
	seenDept := make(map[string]bool, len(rows))
	seenUser := make(map[string]bool, len(rows))
	for _, r := range rows {
		switch r.SubjectKind {
		case entity.GrantSubjectTeam:
			teamHit = true
			teamGrant = teamGrant.merge(r)
		case entity.GrantSubjectDepartment:
			if !seenDept[r.SubjectID] {
				seenDept[r.SubjectID] = true
				deptOrder = append(deptOrder, r.SubjectID)
				if _, ok := cache.deptNames[r.SubjectID]; !ok {
					deptIDs = append(deptIDs, r.SubjectID)
				}
			}
			deptGrants[r.SubjectID] = deptGrants[r.SubjectID].merge(r)
		case entity.GrantSubjectUser:
			if !seenUser[r.SubjectID] {
				seenUser[r.SubjectID] = true
				userOrder = append(userOrder, r.SubjectID)
				if _, ok := cache.userNames[r.SubjectID]; !ok {
					userIDs = append(userIDs, r.SubjectID)
				}
			}
			userGrants[r.SubjectID] = userGrants[r.SubjectID].merge(r)
		}
	}

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
				cache.deptNames[r.ID] = r.Name
			}
		}
	}

	for id, name := range s.ownerNames(ctx, userIDs) {
		cache.userNames[id] = name
	}
	deptNames := cache.deptNames
	userNames := cache.userNames

	if teamHit {
		out = append(out, GrantSubject{
			Kind: entity.GrantSubjectTeam, Name: "全团队",
			Permission: teamGrant.permission, Effect: teamGrant.effect,
		})
	}
	for _, id := range deptOrder {
		name := deptNames[id]
		if name == "" {
			name = "已删除部门"
		}
		out = append(out, GrantSubject{
			Kind: entity.GrantSubjectDepartment, ID: id, Name: name,
			Permission: deptGrants[id].permission, Effect: deptGrants[id].effect,
		})
	}
	for _, id := range userOrder {
		name := userNames[id]
		if name == "" {
			name = id
		}
		out = append(out, GrantSubject{
			Kind: entity.GrantSubjectUser, ID: id, Name: name,
			Permission: userGrants[id].permission, Effect: userGrants[id].effect,
		})
	}
	return out
}

// SetGrants replaces the visibility rule set of one resource.
//
// The resource is verified to belong to the tenant first — otherwise the console
// would be a way to grant access to someone else's knowledge base.
//
// parentID 只对文件级（kind=document）有意义，是文件所在的知识库 id：文件
// 永远挂在库下，库级是前提，所以保存文件级规则时必须同时校验这层归属。
func (s *ResourceGrantService) SetGrants(ctx context.Context, tenantID, kind, resourceID, parentID string, subjects []GrantSubject) error {
	spec, err := grantKindSpecFor(kind)
	if err != nil {
		return err
	}
	// 「这类资源支不支持排除」是静态能力问题，不需要知道资源是否存在：放在
	// 资源校验之前，配置错误先暴露，也避免为了报这个错去读业务表。
	if err := validateGrantDenySupport(spec, subjects); err != nil {
		return err
	}
	if spec.Kind == GrantKindDocument {
		if err := s.assertDocumentInDataset(ctx, tenantID, parentID, resourceID); err != nil {
			return err
		}
	} else if err := s.assertResourceInTenant(ctx, tenantID, spec, resourceID); err != nil {
		return err
	}

	rows := make([]*entity.ResourceGrant, 0, len(subjects))
	now := time.Now().UnixMilli()
	// 已有规则用来兜住「调用方没表达取向」的情况（老前端不认 effect 字段，
	// 整表替换时会把「已排除」写成 allow —— 那是悄悄放开权限）。
	existing, err := dao.NewResourceGrantDAO().ListByResource(ctx, dao.DB, tenantID, kind, resourceID)
	if err != nil {
		return err
	}
	deniedSubjects := make(map[string]bool, len(existing))
	for _, row := range existing {
		if normalizeGrantEffect(row.Effect) == entity.GrantEffectDeny {
			deniedSubjects[grantSubjectKey(row.SubjectKind, row.SubjectID)] = true
		}
	}
	for _, sub := range subjects {
		if sub.Kind != entity.GrantSubjectTeam && sub.Kind != entity.GrantSubjectDepartment && sub.Kind != entity.GrantSubjectUser {
			continue
		}
		// A team rule needs no subject id; the other two demand one.
		if sub.Kind != entity.GrantSubjectTeam && strings.TrimSpace(sub.ID) == "" {
			continue
		}
		effect := normalizeGrantEffect(sub.Effect)
		if strings.TrimSpace(sub.Effect) == "" && deniedSubjects[grantSubjectKey(sub.Kind, sub.ID)] {
			// 空 effect = "没表达取向"，沿用库里的排除；要真的放开必须显式
			// 提交 effect="allow"。
			effect = entity.GrantEffectDeny
		}
		if effect == entity.GrantEffectDeny && sub.Kind == entity.GrantSubjectUser {
			// 静态校验已经在入口做过（类型是否支持、是否为 team），这里只剩
			// 「排除对象在判定链里根本不受排除影响」这一类。
			if err := s.assertDenyTarget(ctx, tenantID, spec, resourceID, sub.ID); err != nil {
				return err
			}
		}
		rows = append(rows, &entity.ResourceGrant{
			TenantID:     tenantID,
			ResourceKind: kind,
			ResourceID:   resourceID,
			SubjectKind:  sub.Kind,
			SubjectID:    sub.ID,
			Permission:   normalizeGrantPermission(sub.Permission),
			Effect:       effect,
			BaseModel:    entity.BaseModel{CreateTime: &now, UpdateTime: &now},
		})
	}
	return dao.NewResourceGrantDAO().Replace(ctx, dao.DB, tenantID, kind, resourceID, rows)
}

// SetVisibility writes the three-level visibility of one resource.
//
// 可见性写在资源自己的列上（不做影子表）：列表、检索、详情读的是同一列，
// 因此不会出现"控制台改了、实际判定没变"。不参与三档的资源直接报错，而不是
// 静默丢弃 —— 静默丢弃会让运维以为已经收窄了。
func (s *ResourceGrantService) SetVisibility(ctx context.Context, tenantID, kind, resourceID, visibility string) (string, error) {
	spec, err := grantKindSpecFor(kind)
	if err != nil {
		return "", err
	}
	if spec.VisibilityColumn == "" || spec.TenantWhere == nil {
		return "", fmt.Errorf("%s 不支持可见范围设置", spec.Label)
	}
	normalized, err := checkVisibility(visibility)
	if err != nil {
		return "", err
	}
	if err := s.assertResourceInTenant(ctx, tenantID, spec, resourceID); err != nil {
		return "", err
	}

	// 可见性列的历史值域只有 me / team，但列宽 16 足够容纳 owner /
	// tenant_owner / platform，不需要改表结构。
	column := strings.TrimPrefix(spec.VisibilityColumn, spec.Table+".")
	q := dao.DB.WithContext(ctx).Table(spec.Table).Where("id = ?", resourceID)
	if where, args := spec.TenantWhere(tenantID); where != "" {
		q = q.Where(where, args...)
	}
	if err := q.Update(column, normalized).Error; err != nil {
		return "", err
	}
	return normalized, nil
}

// assertDocumentInDataset confirms the document exists and sits in datasetID,
// and that datasetID itself belongs to the tenant.
func (s *ResourceGrantService) assertDocumentInDataset(ctx context.Context, tenantID, datasetID, documentID string) error {
	if strings.TrimSpace(datasetID) == "" {
		return errors.New("缺少文件所属的知识库")
	}
	if err := s.assertResourceInTenant(ctx, tenantID, grantKindSpecs["dataset"], datasetID); err != nil {
		return err
	}
	var count int64
	if err := dao.DB.WithContext(ctx).Model(&entity.Document{}).
		Where("id = ? AND kb_id = ?", documentID, datasetID).
		Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return fmt.Errorf("文件不存在或不属于该知识库")
	}
	return nil
}

// assertResourceInTenant confirms the resource is owned by this tenant.
// assertDenyTarget 拦掉「把不会被排除的人写进排除名单」。
//
// 判定链里创建者与租户 owner 在授权表之前就返回了，所以对他们写 deny 是一条
// 永远不生效的规则：管理员会以为已经排除，实际照旧可见。宁可保存时报错。
func (s *ResourceGrantService) assertDenyTarget(ctx context.Context, tenantID string, spec *grantKindSpec, resourceID, userID string) error {
	if spec == nil || userID == "" {
		return nil
	}
	if spec.TenantWhere != nil {
		q := dao.DB.WithContext(ctx).Table(spec.Table).
			Select(spec.OwnerExpr+" AS owner").Where("id = ?", resourceID)
		if where, args := spec.TenantWhere(tenantID); where != "" {
			q = q.Where(where, args...)
		}
		var row struct {
			Owner string `gorm:"column:owner"`
		}
		if err := q.Take(&row).Error; err == nil && row.Owner == userID {
			return errors.New("不能排除资源创建者：排除对创建者不生效")
		}
	}
	var ownerCount int64
	if err := dao.DB.WithContext(ctx).Model(&entity.UserTenant{}).
		Where("tenant_id = ? AND user_id = ? AND role = ?", tenantID, userID, string(permission.RoleOwner)).
		Count(&ownerCount).Error; err == nil && ownerCount > 0 {
		return errors.New("不能排除租户所有者：排除对租户管理层不生效")
	}
	return nil
}

func (s *ResourceGrantService) assertResourceInTenant(ctx context.Context, tenantID string, spec *grantKindSpec, resourceID string) error {
	if spec == nil || spec.TenantWhere == nil {
		return errors.New("不支持的资源类型")
	}
	q := dao.DB.WithContext(ctx).Table(spec.Table).Where("id = ?", resourceID)
	if where, args := spec.TenantWhere(tenantID); where != "" {
		q = q.Where(where, args...)
	}
	var count int64
	if err := q.Count(&count).Error; err != nil {
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
