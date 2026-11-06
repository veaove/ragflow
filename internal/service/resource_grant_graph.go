package service

import (
	"context"
	"errors"
	"sort"
	"strings"

	"ragflow/internal/dao"
	"ragflow/internal/entity"
)

// 授权图谱：把「谁 −(允许/拒绝)→ 哪个资源」摊平在一张图上。
//
// 列表视角一次只能看一个主体（按资源）或一个人（按成员），查「这个库里谁被挡
// 在外面」「这个人到底能进哪些」都要来回切。图谱是第三个视角，回答的是
// 「谁和谁有关系」。
//
// 数据与列表页**同源**：五类平铺资源走 ListResources（同一份可见性收窄与
// 授权描述），库内文件走与「子项例外」相同的 resource_grant + 可见文件集合。
// 不另写一套查询，否则图上会画出列表里看不到的资源。

const (
	// grantGraphKindLimit 是单类资源最多取多少行。图谱画的是「有授权记录的
	// 资源」，几百条就已经糊成一团；超出部分靠统计数字表达。
	grantGraphKindLimit = 500
	// grantGraphMemberLimit 是图上最多画多少成员。「成员」列本来就有上限，
	// 成员多的时候应该先按团队看。
	grantGraphMemberLimit = 60
	// grantGraphBareSamples 是刻意补在资源列末尾的「从未配置」样例数量。
	//
	// 只画有授权的资源会让人以为「这些就是全部」，而实际上绝大多数资源从没
	// 配过权限（默认仅所有者可见）：它们不出现在图上、也不挡任何人。留两个
	// 样例让这个状态在图上可见，剩下的靠统计里的「未配置」表达。
	grantGraphBareSamples = 2
)

// GrantGraphResource 是图上资源列的一个节点。
type GrantGraphResource struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
	Name string `json:"name"`
	// OwnerName 是资源所有者，聚焦时用来解释「为什么他有权限」。
	OwnerName string `json:"owner_name"`
	// ExceptionCount 是该资源下带独立规则的子项数（目前只有知识库有层级）。
	ExceptionCount int `json:"exception_count"`
	// Unconfigured 标记「从未配置授权」的样例节点：这类资源没有任何规则，
	// 默认仅所有者可见，画出来是为了让管理员看到这个状态长什么样。
	Unconfigured bool `json:"unconfigured"`
	// Grants 是该资源的规则明细，图上的边由它展开。
	Grants []GrantSubject `json:"grants"`
}

// GrantGraphMember 是成员列的一个人。
type GrantGraphMember struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Email          string `json:"email"`
	DepartmentID   string `json:"department_id"`
	DepartmentName string `json:"department_name"`
}

// GrantGraphTeam 是中间列的团队：部门，以及一条特殊的「全团队」。
type GrantGraphTeam struct {
	// Kind 取 department（部门）或 team（全团队），与授权主体的 subject_kind 一致。
	Kind string `json:"kind"`
	ID   string `json:"id"`
	Name string `json:"name"`
}

// GrantGraphStats 是底部统计。Visible 与 Configured 的差就是「从未配置」。
type GrantGraphStats struct {
	// Visible 是调用者可读的 6 类资源总数（不是全租户：泄露别人的资源量没有意义）。
	Visible int64 `json:"visible"`
	// Configured 是其中有授权记录、因而画在图上（不含样例）的资源数。
	Configured int64 `json:"configured"`
	// Unconfigured 是从未配置授权的资源数 = Visible - Configured - 样例。
	Unconfigured int64 `json:"unconfigured"`
	// Truncated 标记某类资源超过取数上限，图与 Configured 都不是全量。
	Truncated bool `json:"truncated"`
}

// GrantGraphResult 是整张图的数据。
type GrantGraphResult struct {
	Members   []GrantGraphMember   `json:"members"`
	Teams     []GrantGraphTeam     `json:"teams"`
	Resources []GrantGraphResource `json:"resources"`
	Stats     GrantGraphStats      `json:"stats"`
}

// 图谱覆盖的平铺资源类型。顺序即资源列的聚合顺序（同类相邻）。
const (
	grantGraphKindDataset   = "dataset"
	grantGraphKindChat      = "chat"
	grantGraphKindSearchApp = "search_app"
	grantGraphKindCanvas    = "canvas"
	grantGraphKindMemory    = "memory"
)

var graphKinds = []string{
	grantGraphKindDataset,
	grantGraphKindChat,
	grantGraphKindSearchApp,
	grantGraphKindCanvas,
	grantGraphKindMemory,
}

// GrantGraph 组装授权图谱。
//
// userID 是查看者：所有资源先按他的读权限收窄，读不到的资源连同它的授权关系
// 都不进图 —— 图谱是「授权信息展示」，泄露范围比列表更大。
func (s *ResourceGrantService) GrantGraph(ctx context.Context, tenantID, userID string) (*GrantGraphResult, error) {
	tenantID = strings.TrimSpace(tenantID)
	if tenantID == "" {
		return nil, errors.New("租户 ID 必填")
	}

	result := &GrantGraphResult{
		Members:   []GrantGraphMember{},
		Teams:     []GrantGraphTeam{},
		Resources: []GrantGraphResource{},
	}

	// ── 资源：五类平铺资源复用列表查询 ────────────────────────────────────
	for _, kind := range graphKinds {
		rows, total, err := s.ListResources(ctx, tenantID, kind, "", userID, grantGraphKindLimit, 0)
		if err != nil {
			return nil, err
		}
		if total > int64(len(rows)) {
			result.Stats.Truncated = true
		}
		result.Stats.Visible += total
		for _, row := range rows {
			if len(row.Grants) == 0 {
				continue
			}
			result.Resources = append(result.Resources, GrantGraphResource{
				ID:        row.ResourceID,
				Kind:      kind,
				Name:      row.ResourceName,
				OwnerName: row.OwnerName,
				Grants:    row.Grants,
			})
		}
	}

	// ── 资源：库内文件（document）────────────────────────────────────────
	docTotal, docErr := s.appendDocumentNodes(ctx, tenantID, userID, result)
	if docErr != nil {
		return nil, docErr
	}
	result.Stats.Visible += docTotal

	// 知识库的「N 项例外」一次性算出来：图谱上库节点要能看出子项偏离了多少。
	s.fillDatasetExceptionCounts(ctx, tenantID, result.Resources)

	// ── 成员 / 团队 ─────────────────────────────────────────────────────
	result.Members = s.grantGraphMembers(ctx, tenantID)
	result.Teams = s.grantGraphTeams(ctx, tenantID, result.Members)

	// 同一类资源里按中文名排，扫描时能一片一片看；种类顺序保持 graphKinds 的序。
	kindOrder := make(map[string]int, len(graphKinds)+1)
	for i, kind := range graphKinds {
		kindOrder[kind] = i
	}
	kindOrder[GrantKindDocument] = len(graphKinds)
	sort.SliceStable(result.Resources, func(i, j int) bool {
		a, b := result.Resources[i], result.Resources[j]
		if a.Unconfigured != b.Unconfigured {
			return !a.Unconfigured
		}
		if kindOrder[a.Kind] != kindOrder[b.Kind] {
			return kindOrder[a.Kind] < kindOrder[b.Kind]
		}
		return a.Name < b.Name
	})

	configured := int64(0)
	for _, res := range result.Resources {
		if !res.Unconfigured {
			configured++
		}
	}
	result.Stats.Configured = configured
	if rest := result.Stats.Visible - configured; rest > 0 {
		result.Stats.Unconfigured = rest
	}
	return result, nil
}

// appendDocumentNodes 把「有授权记录的库内文件」加进图，并返回可见文件总数。
//
// 与子项例外同一份判定：文件先按所含知识库的可见性收窄，再按文件级规则收窄
// （读不到的文件连同规则一起消失），否则图谱会成为绕过列表的泄露通道。
func (s *ResourceGrantService) appendDocumentNodes(ctx context.Context, tenantID, userID string, result *GrantGraphResult) (int64, error) {
	visibleDatasets, scoped, err := s.visibleGrantIDs(ctx, userID, grantGraphKindDataset)
	if err != nil {
		return 0, err
	}
	kbIDs := make([]string, 0, len(visibleDatasets))
	for id := range visibleDatasets {
		kbIDs = append(kbIDs, id)
	}
	if scoped && len(kbIDs) == 0 {
		return 0, nil
	}

	base := dao.DB.WithContext(ctx).Table("document")
	if scoped {
		base = base.Where("document.kb_id IN ?", kbIDs)
	}
	var docTotal int64
	if err := base.Count(&docTotal).Error; err != nil {
		return 0, err
	}

	// 租户下的文件级规则一次取全，再按可见文件集合过滤。
	docGrants := make([]*entity.ResourceGrant, 0)
	if err := dao.DB.WithContext(ctx).
		Where("tenant_id = ? AND resource_kind = ?", tenantID, GrantKindDocument).
		Find(&docGrants).Error; err != nil {
		return docTotal, err
	}
	if len(docGrants) == 0 {
		s.appendBareDocumentSamples(ctx, tenantID, kbIDs, scoped, nil, result)
		return docTotal, nil
	}

	grantedIDs := make([]string, 0, len(docGrants))
	seen := make(map[string]bool, len(docGrants))
	for _, row := range docGrants {
		if !seen[row.ResourceID] {
			seen[row.ResourceID] = true
			grantedIDs = append(grantedIDs, row.ResourceID)
		}
	}

	type docRow struct {
		ID   string `gorm:"column:id"`
		Name string `gorm:"column:name"`
	}
	docs := make([]docRow, 0, len(grantedIDs))
	docQuery := dao.DB.WithContext(ctx).Table("document").
		Select("document.id AS id, document.name AS name").
		Where("document.id IN ?", grantedIDs)
	if scoped {
		docQuery = docQuery.Where("document.kb_id IN ?", kbIDs)
	}
	if err := docQuery.Scan(&docs).Error; err != nil {
		return docTotal, err
	}

	byDoc := make(map[string][]*entity.ResourceGrant, len(grantedIDs))
	for _, row := range docGrants {
		byDoc[row.ResourceID] = append(byDoc[row.ResourceID], row)
	}
	for _, doc := range docs {
		if len(byDoc[doc.ID]) == 0 {
			continue
		}
		result.Resources = append(result.Resources, GrantGraphResource{
			ID:     doc.ID,
			Kind:   GrantKindDocument,
			Name:   doc.Name,
			Grants: s.describeGrants(ctx, tenantID, byDoc[doc.ID]),
		})
	}

	s.appendBareDocumentSamples(ctx, tenantID, kbIDs, scoped, grantedIDs, result)
	return docTotal, nil
}

// appendBareDocumentSamples 补几个「从未配置授权」的文件样例。
func (s *ResourceGrantService) appendBareDocumentSamples(ctx context.Context, _ string, kbIDs []string, scoped bool, grantedIDs []string, result *GrantGraphResult) {
	type docRow struct {
		ID   string `gorm:"column:id"`
		Name string `gorm:"column:name"`
	}
	query := dao.DB.WithContext(ctx).Table("document").
		Select("document.id AS id, document.name AS name")
	if scoped {
		query = query.Where("document.kb_id IN ?", kbIDs)
	}
	if len(grantedIDs) > 0 {
		query = query.Where("document.id NOT IN ?", grantedIDs)
	}
	samples := make([]docRow, 0, grantGraphBareSamples)
	if err := query.Order("document.update_date DESC").Limit(grantGraphBareSamples).Scan(&samples).Error; err != nil {
		return
	}
	for _, sample := range samples {
		result.Resources = append(result.Resources, GrantGraphResource{
			ID:           sample.ID,
			Kind:         GrantKindDocument,
			Name:         sample.Name,
			Unconfigured: true,
			Grants:       []GrantSubject{},
		})
	}
}

// fillDatasetExceptionCounts 给知识库节点补上「N 项例外」。
//
// 与授权树同一个口径：只数调用者读得到的、带独立规则的文件。
func (s *ResourceGrantService) fillDatasetExceptionCounts(ctx context.Context, tenantID string, resources []GrantGraphResource) {
	kbIDs := make([]string, 0)
	for _, res := range resources {
		if res.Kind == grantGraphKindDataset {
			kbIDs = append(kbIDs, res.ID)
		}
	}
	if len(kbIDs) == 0 {
		return
	}
	type countRow struct {
		KbID  string `gorm:"column:kb_id"`
		Total int    `gorm:"column:total"`
	}
	counts := make([]countRow, 0)
	if err := dao.DB.WithContext(ctx).Table("resource_grant").
		Select("document.kb_id AS kb_id, COUNT(*) AS total").
		Joins("JOIN document ON document.id = resource_grant.resource_id").
		Where("resource_grant.tenant_id = ? AND resource_grant.resource_kind = ?", tenantID, GrantKindDocument).
		Where("document.kb_id IN ?", kbIDs).
		Group("document.kb_id").
		Scan(&counts).Error; err != nil {
		return
	}
	byKB := make(map[string]int, len(counts))
	for _, row := range counts {
		byKB[row.KbID] = row.Total
	}
	for i := range resources {
		if resources[i].Kind != grantGraphKindDataset {
			continue
		}
		resources[i].ExceptionCount = byKB[resources[i].ID]
	}
}

// grantGraphMembers 取租户成员（含所属部门），最多 grantGraphMemberLimit 个。
func (s *ResourceGrantService) grantGraphMembers(ctx context.Context, tenantID string) []GrantGraphMember {
	type row struct {
		ID             string `gorm:"column:id"`
		Name           string `gorm:"column:name"`
		Email          string `gorm:"column:email"`
		DepartmentID   string `gorm:"column:department_id"`
		DepartmentName string `gorm:"column:department_name"`
	}
	rows := make([]row, 0)
	err := dao.DB.WithContext(ctx).Table("user_tenant").
		Select(`user.id AS id,
			COALESCE(NULLIF(user.nickname, ''), user.email) AS name,
			user.email AS email,
			IFNULL(user.department_id, '') AS department_id,
			IFNULL(department.name, '') AS department_name`).
		Joins("JOIN user ON user.id = user_tenant.user_id").
		Joins("LEFT JOIN department ON department.id = user.department_id").
		Where("user_tenant.tenant_id = ? AND user_tenant.status = ? AND user_tenant.role <> ?",
			tenantID, string(entity.StatusValid), TenantRoleInvite).
		Order("name").
		Limit(grantGraphMemberLimit).
		Scan(&rows).Error
	if err != nil {
		return []GrantGraphMember{}
	}
	out := make([]GrantGraphMember, 0, len(rows))
	for _, r := range rows {
		out = append(out, GrantGraphMember{
			ID:             r.ID,
			Name:           r.Name,
			Email:          r.Email,
			DepartmentID:   r.DepartmentID,
			DepartmentName: r.DepartmentName,
		})
	}
	return out
}

// grantGraphTeams 取部门 + 「全团队」。
//
// 「全团队」是 subject_kind=team 的那条特殊授权，没有 id；放在中间列而不是
// 混进部门，是因为它表达的粒度完全不同：一个团队，而是整个租户。
func (s *ResourceGrantService) grantGraphTeams(ctx context.Context, tenantID string, members []GrantGraphMember) []GrantGraphTeam {
	type row struct {
		ID   string `gorm:"column:id"`
		Name string `gorm:"column:name"`
	}
	rows := make([]row, 0)
	_ = dao.DB.WithContext(ctx).Table("department").
		Select("id, name").
		Where("tenant_id = ?", tenantID).
		Order("name").
		Scan(&rows).Error

	// 只画有成员的部门：空部门画出来只有一个孤立点，没有解释力。
	hasMember := make(map[string]bool, len(members))
	for _, m := range members {
		if m.DepartmentID != "" {
			hasMember[m.DepartmentID] = true
		}
	}

	out := make([]GrantGraphTeam, 0, len(rows)+1)
	out = append(out, GrantGraphTeam{Kind: entity.GrantSubjectTeam, Name: "全团队"})
	for _, r := range rows {
		if !hasMember[r.ID] {
			continue
		}
		out = append(out, GrantGraphTeam{Kind: entity.GrantSubjectDepartment, ID: r.ID, Name: r.Name})
	}
	return out
}
