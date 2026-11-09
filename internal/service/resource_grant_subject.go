package service

import (
	"context"
	"errors"
	"sort"
	"strings"

	"ragflow/internal/dao"
	"ragflow/internal/entity"
	"ragflow/internal/permission"
)

// ─── 按成员视角 ────────────────────────────────────────────────────────────
//
// 资源视角回答「这个库给了谁」，成员视角回答「他为什么能看到」。后者是审计
// 现场真正会问的问题：同一个资源可能经由直接授权、部门、全团队三条路到达
// 同一个人，混成一行就再也解释不清来源。

const (
	// GrantViaDirect 直接授予这个主体。
	GrantViaDirect = "direct"
	// GrantViaDepartment 经由主体所在部门。
	GrantViaDepartment = "department"
	// GrantViaTeam 经由「全团队」。
	GrantViaTeam = "team"
)

// GrantSubjectRow 是成员视角里的一行。
type GrantSubjectRow struct {
	ResourceKind string `json:"resource_kind"`
	ResourceID   string `json:"resource_id"`
	ResourceName string `json:"resource_name"`
	// ParentName 是文件级规则所属的知识库 / 上级文件夹名，列表里显示成
	//「库 / 文件」的形式。
	ParentName string `json:"parent_name,omitempty"`
	Permission string `json:"permission"`
	Effect     string `json:"effect"`
	Via        string `json:"via"`
	ViaName    string `json:"via_name,omitempty"`
}

// GrantBySubjectResult 是某个主体的全部可见来源。
type GrantBySubjectResult struct {
	SubjectKind string             `json:"subject_kind"`
	SubjectID   string             `json:"subject_id"`
	SubjectName string             `json:"subject_name"`
	Rows        []*GrantSubjectRow `json:"rows"`
	// 三类来源的条数，页头直接用，省得前端再分组统计。
	Direct     int `json:"direct"`
	Department int `json:"department"`
	Team       int `json:"team"`
}

// GrantsBySubject 列出某个主体持有的全部规则，按来源分组。
func (s *ResourceGrantService) GrantsBySubject(ctx context.Context, tenantID, subjectKind, subjectID, viewerID string) (*GrantBySubjectResult, error) {
	tenantID = strings.TrimSpace(tenantID)
	subjectID = strings.TrimSpace(subjectID)
	subjectKind = strings.TrimSpace(subjectKind)
	if subjectKind == "" {
		subjectKind = entity.GrantSubjectUser
	}
	if tenantID == "" || subjectID == "" {
		return nil, errors.New("缺少租户或主体")
	}
	switch subjectKind {
	case entity.GrantSubjectUser, entity.GrantSubjectDepartment, entity.GrantSubjectTeam:
	default:
		return nil, errors.New("不支持的授权主体类型")
	}

	result := &GrantBySubjectResult{
		SubjectKind: subjectKind,
		SubjectID:   subjectID,
		Rows:        []*GrantSubjectRow{},
	}
	grantDAO := dao.NewResourceGrantDAO()

	type viaGroup struct {
		via     string
		viaName string
		rows    []*entity.ResourceGrant
	}
	groups := make([]viaGroup, 0, 3)

	direct, err := grantDAO.ListBySubject(ctx, dao.DB, tenantID, subjectKind, subjectID)
	if err != nil {
		return nil, err
	}
	groups = append(groups, viaGroup{via: GrantViaDirect, rows: direct})

	deptID := ""
	if subjectKind == entity.GrantSubjectUser {
		result.SubjectName = s.userDisplayName(ctx, subjectID)
		deptID = s.userDepartmentID(ctx, tenantID, subjectID)
		if deptID != "" {
			deptRows, err := grantDAO.ListBySubject(ctx, dao.DB, tenantID, entity.GrantSubjectDepartment, deptID)
			if err != nil {
				return nil, err
			}
			groups = append(groups, viaGroup{
				via: GrantViaDepartment, viaName: s.departmentName(ctx, tenantID, deptID), rows: deptRows,
			})
		}
		// 全团队成员资格才谈得上「经团队获得」；非成员看到这组只会误导。
		if s.isTenantMember(ctx, tenantID, subjectID) {
			teamRows, err := grantDAO.ListBySubject(ctx, dao.DB, tenantID, entity.GrantSubjectTeam, "")
			if err != nil {
				return nil, err
			}
			groups = append(groups, viaGroup{via: GrantViaTeam, viaName: "全团队", rows: teamRows})
		}
	} else if subjectKind == entity.GrantSubjectDepartment {
		result.SubjectName = s.departmentName(ctx, tenantID, subjectID)
	} else {
		result.SubjectName = "全团队"
	}

	// 文件级规则同样按调用者的读权限收窄：被文件级 deny 排除的人既看不到文件，
	// 也不该在这里看到它的名字与规则。
	for i := range groups {
		kept, filterErr := s.dropUnreadableDocumentGrants(ctx, tenantID, viewerID, groups[i].rows)
		if filterErr != nil {
			return nil, filterErr
		}
		groups[i].rows = kept
	}

	all := make([]*entity.ResourceGrant, 0)
	for _, group := range groups {
		all = append(all, group.rows...)
	}
	names, parents, missing, err := s.grantResourceLabels(ctx, tenantID, all)
	if err != nil {
		return nil, err
	}

	// 删资源不会级联删规则：库里会留着指向已删库/已删文件的孤儿行。这些行取不
	// 到名字，展示出来是一行空白 —— 既解释不了来源，也点不进去，还让「授权数」
	// 比实际能管的资源多。不列它们，比列一行空白诚实。
	for i := range groups {
		kept := make([]*entity.ResourceGrant, 0, len(groups[i].rows))
		for _, row := range groups[i].rows {
			if missing[row.ResourceKind+"\x00"+row.ResourceID] {
				continue
			}
			kept = append(kept, row)
		}
		groups[i].rows = kept
	}

	for _, group := range groups {
		// 同一资源在同一来源里可能有多行（读 / 写各一条），合并成一行。
		order := make([]string, 0, len(group.rows))
		aggs := make(map[string]grantAggregate, len(group.rows))
		resourceOf := make(map[string]*entity.ResourceGrant, len(group.rows))
		for _, row := range group.rows {
			key := row.ResourceKind + "\x00" + row.ResourceID
			if _, ok := aggs[key]; !ok {
				order = append(order, key)
				resourceOf[key] = row
			}
			aggs[key] = aggs[key].merge(row)
		}
		for _, key := range order {
			row := resourceOf[key]
			agg := aggs[key]
			result.Rows = append(result.Rows, &GrantSubjectRow{
				ResourceKind: row.ResourceKind,
				ResourceID:   row.ResourceID,
				ResourceName: names[key],
				ParentName:   parents[key],
				Permission:   agg.permission,
				Effect:       agg.effect,
				Via:          group.via,
				ViaName:      group.viaName,
			})
			switch group.via {
			case GrantViaDirect:
				result.Direct++
			case GrantViaDepartment:
				result.Department++
			case GrantViaTeam:
				result.Team++
			}
		}
	}

	// 直接授权永远排最前面：那才是管理员亲手做的动作。
	rank := map[string]int{GrantViaDirect: 0, GrantViaDepartment: 1, GrantViaTeam: 2}
	sort.SliceStable(result.Rows, func(i, j int) bool {
		if rank[result.Rows[i].Via] != rank[result.Rows[j].Via] {
			return rank[result.Rows[i].Via] < rank[result.Rows[j].Via]
		}
		return result.Rows[i].ResourceName < result.Rows[j].ResourceName
	})
	return result, nil
}

// dropUnreadableDocumentGrants 去掉「调用者读不到的文件」上的规则行。
//
// 文件级规则是名单制：文件一旦有规则，不在名单内的主体就看不到它（见 permission
// 包里 DocumentRuleClause 的注释）。过去这里只按租户取行，于是被排除的人能在
// 「按成员」视角里看到那个文件的名字、上级库名和「已排除」规则 —— 文件本身读不
// 到，存在性和授权关系却照样公开。
//
// 管理视角查别人时调用者是管理层，本来就能读全部文件，这里的过滤对他们是空操作。
func (s *ResourceGrantService) dropUnreadableDocumentGrants(
	ctx context.Context, tenantID, viewerID string, rows []*entity.ResourceGrant,
) ([]*entity.ResourceGrant, error) {
	if strings.TrimSpace(viewerID) == "" || len(rows) == 0 {
		return rows, nil
	}
	docIDs := make([]string, 0, len(rows))
	for _, row := range rows {
		if row.ResourceKind == GrantKindDocument {
			docIDs = append(docIDs, row.ResourceID)
		}
	}
	if len(docIDs) == 0 {
		return rows, nil
	}

	type docRow struct {
		ID   string `gorm:"column:id"`
		KbID string `gorm:"column:kb_id"`
	}
	docs := make([]docRow, 0, len(docIDs))
	if err := dao.DB.WithContext(ctx).Table("document").
		Select("document.id AS id, document.kb_id AS kb_id").
		Joins("JOIN knowledgebase ON knowledgebase.id = document.kb_id").
		Where("knowledgebase.tenant_id = ?", tenantID).
		Where("document.id IN ?", docIDs).
		Scan(&docs).Error; err != nil {
		return nil, err
	}
	kbOf := make(map[string]string, len(docs))
	for _, doc := range docs {
		kbOf[doc.ID] = doc.KbID
	}

	subject := permission.Subject{UserID: viewerID}
	unreadable := make(map[string]struct{}, len(kbOf))
	for id, kbID := range kbOf {
		if err := permission.CheckDocumentAccess(ctx, dao.DB, subject, kbID, id, permission.OperationRead); err != nil {
			unreadable[id] = struct{}{}
		}
	}
	if len(unreadable) == 0 {
		return rows, nil
	}
	kept := make([]*entity.ResourceGrant, 0, len(rows))
	for _, row := range rows {
		if row.ResourceKind == GrantKindDocument {
			if _, hidden := unreadable[row.ResourceID]; hidden {
				continue
			}
		}
		kept = append(kept, row)
	}
	return kept, nil
}

// grantResourceLabels 把 (kind, id) 翻成展示名与上级名，并报告哪些资源已经不存在。
//
// missing 只装「确定查无此资源」的键：查得到就叫名字，查不到才进 missing。没有
// 独立租户列的 kind 不参与判断（宁可留一行空白，也不误删一条真规则）。
func (s *ResourceGrantService) grantResourceLabels(
	ctx context.Context, tenantID string, rows []*entity.ResourceGrant,
) (names map[string]string, parents map[string]string, missing map[string]bool, err error) {
	names = make(map[string]string, len(rows))
	parents = make(map[string]string, len(rows))
	missing = make(map[string]bool)
	idsByKind := make(map[string][]string, 4)
	for _, row := range rows {
		key := row.ResourceKind + "\x00" + row.ResourceID
		if _, ok := names[key]; ok {
			continue
		}
		names[key] = ""
		idsByKind[row.ResourceKind] = append(idsByKind[row.ResourceKind], row.ResourceID)
	}
	if len(idsByKind) == 0 {
		return names, parents, missing, nil
	}

	db := dao.DB.WithContext(ctx)
	type labelRow struct {
		ResourceID   string `gorm:"column:resource_id"`
		ResourceName string `gorm:"column:resource_name"`
	}
	for kind, ids := range idsByKind {
		labelKey := func(id string) string { return kind + "\x00" + id }
		found := make(map[string]bool, len(ids))

		if kind == GrantKindDocument {
			// 文件级规则要显示「库 / 文件」，并受所属库的租户约束。
			type docLabelRow struct {
				ResourceID   string `gorm:"column:resource_id"`
				ResourceName string `gorm:"column:resource_name"`
				ParentID     string `gorm:"column:parent_id"`
			}
			list := make([]docLabelRow, 0, len(ids))
			if qErr := db.Table("document").
				Select("document.id AS resource_id, COALESCE(document.name, '') AS resource_name, document.kb_id AS parent_id").
				Joins("JOIN knowledgebase ON knowledgebase.id = document.kb_id").
				Where("knowledgebase.tenant_id = ?", tenantID).
				Where("document.id IN ?", ids).
				Scan(&list).Error; qErr != nil {
				return names, parents, missing, qErr
			}
			kbIDs := make([]string, 0, len(list))
			for _, row := range list {
				names[labelKey(row.ResourceID)] = row.ResourceName
				found[row.ResourceID] = true
				kbIDs = append(kbIDs, row.ParentID)
			}
			kbNames := s.ownerKBNames(ctx, tenantID, kbIDs)
			for _, row := range list {
				// 上级名记在文件自己的 key 上，「库 / 文件」才拼得出来。
				parents[labelKey(row.ResourceID)] = kbNames[row.ParentID]
			}
			markMissing(ids, found, labelKey, missing)
			continue
		}

		spec, specErr := grantKindSpecFor(kind)
		if specErr != nil {
			return names, parents, missing, specErr
		}
		if spec.TenantWhere == nil {
			// 这类资源没有独立的租户列（文件级规则已在上面单独处理），
			// 名字留空比猜一个租户条件安全。
			continue
		}
		where, args := spec.TenantWhere(tenantID)
		list := make([]labelRow, 0, len(ids))
		// 必须一次 Select 写完两列：GORM 的 Select(string) 是覆盖而不是追加，
		// 拆成两次调用会把前面的别名丢掉。
		q := db.Table(spec.Table).
			Select("id AS resource_id, " + spec.NameExpr + " AS resource_name")
		if where != "" {
			q = q.Where(where, args...)
		}
		if qErr := q.Where("id IN ?", ids).Scan(&list).Error; qErr != nil {
			return names, parents, missing, qErr
		}
		for _, row := range list {
			names[labelKey(row.ResourceID)] = row.ResourceName
			found[row.ResourceID] = true
		}
		markMissing(ids, found, labelKey, missing)
	}
	return names, parents, missing, nil
}

// markMissing 把「查不到」的 id 记进 missing。
func markMissing(ids []string, found map[string]bool, labelKey func(string) string, missing map[string]bool) {
	for _, id := range ids {
		if !found[id] {
			missing[labelKey(id)] = true
		}
	}
}

func (s *ResourceGrantService) ownerKBNames(ctx context.Context, tenantID string, ids []string) map[string]string {
	out := map[string]string{}
	if len(ids) == 0 {
		return out
	}
	type row struct {
		ID   string `gorm:"column:id"`
		Name string `gorm:"column:name"`
	}
	list := make([]row, 0, len(ids))
	if err := dao.DB.WithContext(ctx).Model(&entity.Knowledgebase{}).
		Select("id, name").
		Where("tenant_id = ?", tenantID).
		Where("id IN ?", ids).
		Scan(&list).Error; err != nil {
		return out
	}
	for _, r := range list {
		out[r.ID] = r.Name
	}
	return out
}

func (s *ResourceGrantService) userDisplayName(ctx context.Context, userID string) string {
	if names := s.ownerNames(ctx, []string{userID}); names[userID] != "" {
		return names[userID]
	}
	return userID
}

func (s *ResourceGrantService) departmentName(ctx context.Context, tenantID, departmentID string) string {
	var row struct {
		Name string `gorm:"column:name"`
	}
	if err := dao.DB.WithContext(ctx).Model(&entity.Department{}).
		Select("name").
		Where("tenant_id = ?", tenantID).
		Where("id = ?", departmentID).
		Scan(&row).Error; err != nil || strings.TrimSpace(row.Name) == "" {
		return departmentID
	}
	return row.Name
}

func (s *ResourceGrantService) userDepartmentID(ctx context.Context, tenantID, userID string) string {
	var row struct {
		DepartmentID *string `gorm:"column:department_id"`
	}
	if err := dao.DB.WithContext(ctx).Model(&entity.User{}).
		Select("department_id").
		Where("id = ?", userID).
		Scan(&row).Error; err != nil || row.DepartmentID == nil {
		return ""
	}
	return strings.TrimSpace(*row.DepartmentID)
}

// isTenantMember 判断用户是不是该租户的正式成员（已接受邀请、状态有效）。
func (s *ResourceGrantService) isTenantMember(ctx context.Context, tenantID, userID string) bool {
	var count int64
	if err := dao.DB.WithContext(ctx).Model(&entity.UserTenant{}).
		Where("tenant_id = ? AND user_id = ?", tenantID, userID).
		Where("status = ?", string(entity.StatusValid)).
		Count(&count).Error; err != nil {
		return false
	}
	return count > 0
}
