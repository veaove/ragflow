package service

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"ragflow/internal/dao"
	"ragflow/internal/entity"
)

// ─── 资源树 ────────────────────────────────────────────────────────────────
//
// 资源授权页的主体不再是「所有资源逐个设置」，而是「授权」：谁被授权了、
// 哪些子项偏离了继承。于是树只画层级骨架（知识库 → 文件夹 → …），文件不进
// 树，只在「子项例外」里出现 —— 一个库 44 个文件，树仍然是十几行。
//
// 树必须一次返回全部摘要：分页会让前端退化成「点一层查一次」，比原来的平铺
// 列表更难用。

const (
	// GrantNodeDataset / GrantNodeFolder / GrantNodeFile 是树上的节点类型。
	GrantNodeDataset = "dataset"
	GrantNodeFolder  = "folder"
	GrantNodeFile    = "file"
)

// 摘要色调。前端只按色调取色，不自己判断业务含义。
const (
	// GrantToneOwner 灰：仅所有者可见。
	GrantToneOwner = "owner"
	// GrantToneVisible 绿：有明确的可见范围或明确的授权主体。
	GrantToneVisible = "visible"
	// GrantToneException 橙：子项里有例外 —— 只有例外才需要人管。
	GrantToneException = "exception"
	// GrantToneInherit 灰：本层没有自己的设置。
	GrantToneInherit = "inherit"
)

// GrantNodeSummary 是树节点右侧的徽章。
type GrantNodeSummary struct {
	Tone  string `json:"tone"`
	Label string `json:"label"`
}

// GrantTreeNode 是资源树上的一行。
type GrantTreeNode struct {
	ID string `json:"id"`
	// Name 是展示名。
	Name string `json:"name"`
	// NodeKind 是树上的展示类型：dataset / folder / file。
	NodeKind string `json:"node_kind"`
	// GrantKind 是该节点可授权的 resource_kind。空串表示这一层不单独授权
	//（知识库内的文件夹就是这种：规则只落在库与文件上）。
	GrantKind string `json:"grant_kind,omitempty"`
	// ParentID 是树上的父节点 id；ParentGrantID 是写文件级规则时要带上的
	// 所属知识库 id（只有文件才有）。
	ParentID      string `json:"parent_id,omitempty"`
	ParentGrantID string `json:"parent_grant_id,omitempty"`
	OwnerName     string `json:"owner_name,omitempty"`
	// Visibility 是三级可见性；空串表示这类节点不参与三档。
	Visibility         string `json:"visibility,omitempty"`
	SupportsVisibility bool   `json:"supports_visibility"`
	// FileCount 是本层及全部子孙里的文件数。
	FileCount int64 `json:"file_count"`
	// ExceptionCount 是有独立规则的子孙数量。
	ExceptionCount int              `json:"exception_count"`
	Summary        GrantNodeSummary `json:"summary"`
	// Grants 是本层自己的规则（已合并、已翻成名字）。
	Grants   []GrantSubject   `json:"grants"`
	Children []*GrantTreeNode `json:"children,omitempty"`
}

// GrantTreeResult 是整棵资源树。
type GrantTreeResult struct {
	Kind  string           `json:"kind"`
	Label string           `json:"label"`
	Nodes []*GrantTreeNode `json:"nodes"`
	// Total 是顶层节点数（页头「资源（N 个库）」）。
	Total int `json:"total"`
	// FileTotal / ExceptionTotal 是全树合计，页头与空态文案用。
	FileTotal      int64 `json:"file_total"`
	ExceptionTotal int   `json:"exception_total"`
}

// GrantTree 返回某一类资源的授权树。
//
// 只有存在层级的资源才走树：知识库（库 → 文件夹）与文件管理（文件夹 → 文件）。
// 其余类型（知识问答、智能体…）没有父子关系，前端继续用平铺列表。
func (s *ResourceGrantService) GrantTree(ctx context.Context, tenantID, kind, keywords string) (*GrantTreeResult, error) {
	switch strings.TrimSpace(kind) {
	case "dataset":
		return s.datasetGrantTree(ctx, tenantID, keywords)
	case "file":
		return s.fileGrantTree(ctx, tenantID, keywords)
	}
	return nil, errors.New("该类资源没有层级结构")
}

func (s *ResourceGrantService) datasetGrantTree(ctx context.Context, tenantID, keywords string) (*GrantTreeResult, error) {
	db := dao.DB.WithContext(ctx)

	type kbRow struct {
		ID         string `gorm:"column:id"`
		Name       string `gorm:"column:name"`
		CreatedBy  string `gorm:"column:created_by"`
		Permission string `gorm:"column:permission"`
	}
	kbs := make([]kbRow, 0)
	if err := db.Model(&entity.Knowledgebase{}).
		Select("id, name, created_by, COALESCE(permission, '') AS permission").
		Where("tenant_id = ?", tenantID).
		Scan(&kbs).Error; err != nil {
		return nil, err
	}
	result := &GrantTreeResult{Kind: "dataset", Label: "知识库", Nodes: []*GrantTreeNode{}}
	if len(kbs) == 0 {
		return result, nil
	}
	sort.Slice(kbs, func(i, j int) bool { return kbs[i].Name < kbs[j].Name })

	kbIDs := make([]string, 0, len(kbs))
	kbNames := make(map[string]string, len(kbs))
	creatorIDs := make([]string, 0, len(kbs))
	for _, kb := range kbs {
		kbIDs = append(kbIDs, kb.ID)
		kbNames[kb.ID] = kb.Name
		creatorIDs = append(creatorIDs, kb.CreatedBy)
	}

	folders := make([]entity.DocumentFolder, 0)
	if err := db.Model(&entity.DocumentFolder{}).
		Select("id, dataset_id, parent_id, name, created_by").
		Where("dataset_id IN ?", kbIDs).
		Scan(&folders).Error; err != nil {
		return nil, err
	}

	// 每个文件夹 / 库根下自己的文件数（子层最后逐层累加）。
	type countRow struct {
		KbID     string  `gorm:"column:kb_id"`
		FolderID *string `gorm:"column:folder_id"`
		Total    int64   `gorm:"column:total"`
	}
	docCounts := make([]countRow, 0)
	if err := db.Model(&entity.Document{}).
		Select("kb_id, folder_id, COUNT(*) AS total").
		Where("kb_id IN ?", kbIDs).
		Group("kb_id, folder_id").
		Scan(&docCounts).Error; err != nil {
		return nil, err
	}

	// 例外只来自「有规则的文件」：规则表本来就只存例外，整租户取回后归并比
	// 逐节点查询省得多。
	grants, err := dao.NewResourceGrantDAO().ListByTenant(ctx, dao.DB, tenantID)
	if err != nil {
		return nil, err
	}
	cache := newGrantNameCache()
	kbGrants := make(map[string][]*entity.ResourceGrant, len(kbs))
	docGrants := make(map[string][]*entity.ResourceGrant)
	for _, g := range grants {
		switch g.ResourceKind {
		case "dataset":
			kbGrants[g.ResourceID] = append(kbGrants[g.ResourceID], g)
		case GrantKindDocument:
			docGrants[g.ResourceID] = append(docGrants[g.ResourceID], g)
		}
	}

	// 有规则的文件落在哪个库 / 哪个文件夹。
	docFolder := make(map[string]string, len(docGrants))
	docKB := make(map[string]string, len(docGrants))
	docIDs := make([]string, 0, len(docGrants))
	for id := range docGrants {
		docIDs = append(docIDs, id)
	}
	if len(docIDs) > 0 {
		type docRow struct {
			ID       string  `gorm:"column:id"`
			KbID     string  `gorm:"column:kb_id"`
			FolderID *string `gorm:"column:folder_id"`
		}
		rows := make([]docRow, 0, len(docIDs))
		if err := db.Model(&entity.Document{}).
			Select("id, kb_id, folder_id").
			Where("id IN ?", docIDs).
			Scan(&rows).Error; err != nil {
			return nil, err
		}
		for _, r := range rows {
			docKB[r.ID] = r.KbID
			folder := ""
			if r.FolderID != nil {
				folder = *r.FolderID
			}
			docFolder[r.ID] = folder
		}
	}

	ownDocs := make(map[string]int64, len(docCounts))
	kbRootDocs := make(map[string]int64, len(docCounts))
	for _, c := range docCounts {
		if c.FolderID == nil || *c.FolderID == "" {
			kbRootDocs[c.KbID] = c.Total
			continue
		}
		ownDocs[*c.FolderID] = c.Total
	}
	ownExceptions := make(map[string]int, len(docGrants))
	kbRootExceptions := make(map[string]int)
	for docID := range docGrants {
		folder := docFolder[docID]
		if folder == "" {
			kbRootExceptions[docKB[docID]]++
			continue
		}
		ownExceptions[folder]++
	}

	childrenOf := make(map[string][]*entity.DocumentFolder, len(folders))
	for i := range folders {
		folder := &folders[i]
		childrenOf[folder.DatasetID+"\x00"+folder.ParentID] = append(
			childrenOf[folder.DatasetID+"\x00"+folder.ParentID], folder)
	}
	for key := range childrenOf {
		sort.Slice(childrenOf[key], func(i, j int) bool {
			return childrenOf[key][i].Name < childrenOf[key][j].Name
		})
	}

	creatorNames := s.ownerNames(ctx, creatorIDs)

	var buildFolder func(folder *entity.DocumentFolder) *GrantTreeNode
	buildFolder = func(folder *entity.DocumentFolder) *GrantTreeNode {
		node := &GrantTreeNode{
			ID:             folder.ID,
			Name:           folder.Name,
			NodeKind:       GrantNodeFolder,
			ParentID:       folder.ParentID,
			ParentGrantID:  folder.DatasetID,
			OwnerName:      creatorNames[folder.CreatedBy],
			FileCount:      ownDocs[folder.ID],
			ExceptionCount: ownExceptions[folder.ID],
			Grants:         []GrantSubject{},
		}
		for _, child := range childrenOf[folder.DatasetID+"\x00"+folder.ID] {
			childNode := buildFolder(child)
			node.FileCount += childNode.FileCount
			node.ExceptionCount += childNode.ExceptionCount
			node.Children = append(node.Children, childNode)
		}
		node.Summary = summarizeGrantNode(node)
		return node
	}

	lowerKeywords := strings.ToLower(strings.TrimSpace(keywords))
	for _, kb := range kbs {
		node := &GrantTreeNode{
			ID:                 kb.ID,
			Name:               kb.Name,
			NodeKind:           GrantNodeDataset,
			GrantKind:          "dataset",
			OwnerName:          creatorNames[kb.CreatedBy],
			Visibility:         entity.NormalizeResourceVisibility(kb.Permission),
			SupportsVisibility: true,
			FileCount:          kbRootDocs[kb.ID],
			ExceptionCount:     kbRootExceptions[kb.ID],
			Grants:             s.describeGrantsCached(ctx, tenantID, kbGrants[kb.ID], cache),
		}
		for _, folder := range childrenOf[kb.ID+"\x00"] {
			childNode := buildFolder(folder)
			node.FileCount += childNode.FileCount
			node.ExceptionCount += childNode.ExceptionCount
			node.Children = append(node.Children, childNode)
		}
		node.Summary = summarizeGrantNode(node)

		if lowerKeywords != "" && !strings.Contains(strings.ToLower(node.Name), lowerKeywords) &&
			!treeHasMatchingName(node, lowerKeywords) {
			continue
		}
		result.Nodes = append(result.Nodes, node)
		result.FileTotal += node.FileCount
		result.ExceptionTotal += node.ExceptionCount
	}
	result.Total = len(result.Nodes)
	return result, nil
}

func (s *ResourceGrantService) fileGrantTree(ctx context.Context, tenantID, keywords string) (*GrantTreeResult, error) {
	db := dao.DB.WithContext(ctx)

	type fileRow struct {
		ID        string `gorm:"column:id"`
		ParentID  string `gorm:"column:parent_id"`
		Name      string `gorm:"column:name"`
		Type      string `gorm:"column:type"`
		CreatedBy string `gorm:"column:created_by"`
	}
	rows := make([]fileRow, 0)
	if err := db.Model(&entity.File{}).
		Select("id, parent_id, name, type, created_by").
		Where("tenant_id = ?", tenantID).
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	result := &GrantTreeResult{Kind: "file", Label: "文件", Nodes: []*GrantTreeNode{}}
	if len(rows) == 0 {
		return result, nil
	}

	grants, err := dao.NewResourceGrantDAO().ListByTenant(ctx, dao.DB, tenantID)
	if err != nil {
		return nil, err
	}
	cache := newGrantNameCache()
	nodeGrants := make(map[string][]*entity.ResourceGrant)
	for _, g := range grants {
		if g.ResourceKind != "file" && g.ResourceKind != "folder" {
			continue
		}
		nodeGrants[g.ResourceKind+"\x00"+g.ResourceID] = append(
			nodeGrants[g.ResourceKind+"\x00"+g.ResourceID], g)
	}

	childrenOf := make(map[string][]*fileRow, len(rows))
	creatorIDs := make([]string, 0, len(rows))
	for i := range rows {
		row := &rows[i]
		childrenOf[row.ParentID] = append(childrenOf[row.ParentID], row)
		creatorIDs = append(creatorIDs, row.CreatedBy)
	}
	for key := range childrenOf {
		sort.Slice(childrenOf[key], func(i, j int) bool {
			left, right := childrenOf[key][i], childrenOf[key][j]
			leftFolder := left.Type == "folder"
			rightFolder := right.Type == "folder"
			if leftFolder != rightFolder {
				return leftFolder
			}
			return left.Name < right.Name
		})
	}
	creatorNames := s.ownerNames(ctx, creatorIDs)

	var buildFile func(row *fileRow) *GrantTreeNode
	buildFile = func(row *fileRow) *GrantTreeNode {
		nodeKind := GrantNodeFile
		grantKind := "file"
		if row.Type == "folder" {
			nodeKind = GrantNodeFolder
			grantKind = "folder"
		}
		node := &GrantTreeNode{
			ID:            row.ID,
			Name:          row.Name,
			NodeKind:      nodeKind,
			GrantKind:     grantKind,
			ParentID:      row.ParentID,
			ParentGrantID: row.ParentID,
			OwnerName:     creatorNames[row.CreatedBy],
			Grants:        s.describeGrantsCached(ctx, tenantID, nodeGrants[grantKind+"\x00"+row.ID], cache),
		}
		if nodeKind == GrantNodeFile {
			node.FileCount = 1
		}
		if len(node.Grants) > 0 {
			// 自己的规则是自己的事，不算「子项例外」；但父层的徽章要数上。
			node.ExceptionCount = 0
		}
		for _, child := range childrenOf[row.ID] {
			childNode := buildFile(child)
			node.FileCount += childNode.FileCount
			node.ExceptionCount += childNode.ExceptionCount
			if len(childNode.Grants) > 0 {
				node.ExceptionCount++
			}
			node.Children = append(node.Children, childNode)
		}
		node.Summary = summarizeGrantNode(node)
		return node
	}

	lowerKeywords := strings.ToLower(strings.TrimSpace(keywords))
	var walkRoot func(parentID string) []*GrantTreeNode
	walkRoot = func(parentID string) []*GrantTreeNode {
		out := make([]*GrantTreeNode, 0, len(childrenOf[parentID]))
		for _, row := range childrenOf[parentID] {
			node := buildFile(row)
			if lowerKeywords != "" && !strings.Contains(strings.ToLower(node.Name), lowerKeywords) &&
				!treeHasMatchingName(node, lowerKeywords) {
				continue
			}
			out = append(out, node)
		}
		return out
	}

	result.Nodes = walkRoot("")
	for _, node := range result.Nodes {
		result.FileTotal += node.FileCount
		result.ExceptionTotal += node.ExceptionCount
		if len(node.Grants) > 0 {
			result.ExceptionTotal++
		}
	}
	result.Total = len(result.Nodes)
	return result, nil
}

// treeHasMatchingName 报告子孙里是否有名字命中关键字的节点。
func treeHasMatchingName(node *GrantTreeNode, keywords string) bool {
	for _, child := range node.Children {
		if strings.Contains(strings.ToLower(child.Name), keywords) ||
			treeHasMatchingName(child, keywords) {
			return true
		}
	}
	return false
}

// summarizeGrantNode 把节点算成右侧徽章。
//
// 优先级与原型一致：例外 > 明确主体 > 可见范围 > 未单独设置。橙色只留给例外，
// 因为「有人需要处理」的只有例外。
func summarizeGrantNode(node *GrantTreeNode) GrantNodeSummary {
	if node.ExceptionCount > 0 {
		return GrantNodeSummary{Tone: GrantToneException, Label: fmt.Sprintf("%d 项例外", node.ExceptionCount)}
	}
	if len(node.Grants) > 0 {
		if len(node.Grants) == 1 {
			return GrantNodeSummary{Tone: GrantToneVisible, Label: node.Grants[0].Name}
		}
		return GrantNodeSummary{Tone: GrantToneVisible, Label: fmt.Sprintf("%d 个主体", len(node.Grants))}
	}
	if node.GrantKind == "" {
		return GrantNodeSummary{Tone: GrantToneInherit, Label: "继承上级"}
	}
	switch node.Visibility {
	case entity.ResourceVisibilityPlatform:
		return GrantNodeSummary{Tone: GrantToneVisible, Label: "平台可见"}
	case entity.ResourceVisibilityTenantOwner:
		return GrantNodeSummary{Tone: GrantToneVisible, Label: "租户管理层"}
	}
	if node.SupportsVisibility {
		return GrantNodeSummary{Tone: GrantToneOwner, Label: "仅所有者"}
	}
	return GrantNodeSummary{Tone: GrantToneInherit, Label: "未单独授权"}
}

// ─── 子项例外 ──────────────────────────────────────────────────────────────

// GrantExceptionItem 是「子项例外」表里的一行。
//
// Restricted=false 表示这一项仍在继承本层设置 —— 只有点「查看全部」时才会
// 出现，用于逐项确认；默认列表里只有 Restricted=true 的行。
type GrantExceptionItem struct {
	ResourceID   string `json:"resource_id"`
	ResourceName string `json:"resource_name"`
	GrantKind    string `json:"grant_kind"`
	NodeKind     string `json:"node_kind"`
	// ParentGrantID 是写文件级规则时要带上的所属知识库（知识库内文件）。
	ParentGrantID string         `json:"parent_grant_id,omitempty"`
	Path          string         `json:"path,omitempty"`
	Suffix        string         `json:"suffix,omitempty"`
	Size          int64          `json:"size,omitempty"`
	Restricted    bool           `json:"restricted"`
	Grants        []GrantSubject `json:"grants"`
}

// GrantExceptionResult 是「子项例外」一页。
type GrantExceptionResult struct {
	Items []*GrantExceptionItem `json:"items"`
	Total int64                 `json:"total"`
	// FileTotal 是本层全部文件数，ExceptionTotal 是有独立规则的子项数。
	// 「其余 N 个继承」由前端用两者相减，不让后端再算一遍。
	FileTotal      int64 `json:"file_total"`
	ExceptionTotal int64 `json:"exception_total"`
}

// ListGrantExceptions 返回某个节点下的子项。
//
// includeAll=false 时只返回有独立规则的子项（默认视图）；true 时返回全部
// 子项，供「查看全部文件」逐项确认，仍在容器内分页滚动。
func (s *ResourceGrantService) ListGrantExceptions(
	ctx context.Context,
	tenantID, kind, datasetID, folderID, keywords string,
	includeAll bool, limit, offset int,
) (*GrantExceptionResult, error) {
	if limit <= 0 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	switch strings.TrimSpace(kind) {
	case "dataset":
		return s.datasetExceptions(ctx, tenantID, datasetID, folderID, keywords, includeAll, limit, offset)
	case "file":
		return s.fileExceptions(ctx, tenantID, folderID, keywords, includeAll, limit, offset)
	}
	return nil, errors.New("该类资源没有子项")
}

func (s *ResourceGrantService) datasetExceptions(
	ctx context.Context,
	tenantID, datasetID, folderID, keywords string,
	includeAll bool, limit, offset int,
) (*GrantExceptionResult, error) {
	if strings.TrimSpace(datasetID) == "" {
		return nil, errors.New("缺少知识库 id")
	}
	if err := s.assertResourceInTenant(ctx, tenantID, grantKindSpecs["dataset"], datasetID); err != nil {
		return nil, err
	}
	db := dao.DB.WithContext(ctx)

	folders := make([]entity.DocumentFolder, 0)
	if err := db.Model(&entity.DocumentFolder{}).
		Select("id, dataset_id, parent_id, name").
		Where("dataset_id = ?", datasetID).
		Scan(&folders).Error; err != nil {
		return nil, err
	}
	folderName := make(map[string]string, len(folders))
	folderParent := make(map[string]string, len(folders))
	childrenOf := make(map[string][]string, len(folders))
	for _, folder := range folders {
		folderName[folder.ID] = folder.Name
		folderParent[folder.ID] = folder.ParentID
		childrenOf[folder.ParentID] = append(childrenOf[folder.ParentID], folder.ID)
	}
	folderPath := func(id string) string {
		names := make([]string, 0, 4)
		seen := make(map[string]bool, 4)
		for id != "" && !seen[id] {
			seen[id] = true
			names = append(names, folderName[id])
			id = folderParent[id]
		}
		for i, j := 0, len(names)-1; i < j; i, j = i+1, j-1 {
			names[i], names[j] = names[j], names[i]
		}
		return strings.Join(names, " / ")
	}

	// 作用范围：没选文件夹时是整个库；选了则只到那个文件夹的子树。
	scopeFolders := make([]string, 0, len(folders))
	if strings.TrimSpace(folderID) == "" {
		for _, folder := range folders {
			scopeFolders = append(scopeFolders, folder.ID)
		}
	} else {
		queue := []string{folderID}
		seen := map[string]bool{folderID: true}
		scopeFolders = append(scopeFolders, folderID)
		for len(queue) > 0 {
			current := queue[0]
			queue = queue[1:]
			for _, child := range childrenOf[current] {
				if seen[child] {
					continue
				}
				seen[child] = true
				scopeFolders = append(scopeFolders, child)
				queue = append(queue, child)
			}
		}
	}

	fileScope := db.Model(&entity.Document{}).Where("document.kb_id = ?", datasetID)
	if strings.TrimSpace(folderID) != "" {
		fileScope = fileScope.Where("document.folder_id IN ?", scopeFolders)
	}
	var fileTotal int64
	if err := fileScope.Count(&fileTotal).Error; err != nil {
		return nil, err
	}

	grants, err := dao.NewResourceGrantDAO().ListByTenant(ctx, dao.DB, tenantID)
	if err != nil {
		return nil, err
	}
	docGrants := make(map[string][]*entity.ResourceGrant)
	for _, g := range grants {
		if g.ResourceKind == GrantKindDocument {
			docGrants[g.ResourceID] = append(docGrants[g.ResourceID], g)
		}
	}

	query := db.Model(&entity.Document{}).Where("document.kb_id = ?", datasetID)
	if strings.TrimSpace(folderID) != "" {
		query = query.Where("document.folder_id IN ?", scopeFolders)
	}
	if kw := strings.TrimSpace(keywords); kw != "" {
		query = query.Where("LOWER(document.name) LIKE ?", "%"+strings.ToLower(kw)+"%")
	}
	if !includeAll {
		ids := make([]string, 0, len(docGrants))
		for id := range docGrants {
			ids = append(ids, id)
		}
		if len(ids) == 0 {
			return &GrantExceptionResult{Items: []*GrantExceptionItem{}, FileTotal: fileTotal}, nil
		}
		query = query.Where("document.id IN ?", ids)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, err
	}

	type docRow struct {
		ID       string  `gorm:"column:id"`
		Name     *string `gorm:"column:name"`
		Suffix   string  `gorm:"column:suffix"`
		Size     int64   `gorm:"column:size"`
		FolderID *string `gorm:"column:folder_id"`
	}
	rows := make([]docRow, 0, limit)
	if err := query.
		Select("document.id, document.name, document.suffix, document.size, document.folder_id").
		Order("document.create_time DESC").
		Limit(limit).Offset(offset).
		Scan(&rows).Error; err != nil {
		return nil, err
	}

	cache := newGrantNameCache()
	items := make([]*GrantExceptionItem, 0, len(rows))
	exceptionTotal := int64(0)
	for _, row := range rows {
		name := ""
		if row.Name != nil {
			name = *row.Name
		}
		folder := ""
		if row.FolderID != nil {
			folder = *row.FolderID
		}
		rowGrants := docGrants[row.ID]
		items = append(items, &GrantExceptionItem{
			ResourceID:    row.ID,
			ResourceName:  name,
			GrantKind:     GrantKindDocument,
			NodeKind:      GrantNodeFile,
			ParentGrantID: datasetID,
			Path:          folderPath(folder),
			Suffix:        row.Suffix,
			Size:          row.Size,
			Restricted:    len(rowGrants) > 0,
			Grants:        s.describeGrantsCached(ctx, tenantID, rowGrants, cache),
		})
	}
	exceptionQuery := db.Model(&entity.Document{}).
		Where("document.kb_id = ?", datasetID).
		Where("document.id IN ?", mapKeys(docGrants))
	if strings.TrimSpace(folderID) != "" {
		exceptionQuery = exceptionQuery.Where("document.folder_id IN ?", scopeFolders)
	}
	if err := exceptionQuery.Count(&exceptionTotal).Error; err != nil {
		// 例外总数只用于「其余 N 个继承」这句文案，查不出来不该让整页失败。
		exceptionTotal = 0
	}

	return &GrantExceptionResult{
		Items:          items,
		Total:          total,
		FileTotal:      fileTotal,
		ExceptionTotal: exceptionTotal,
	}, nil
}

func (s *ResourceGrantService) fileExceptions(
	ctx context.Context,
	tenantID, folderID, keywords string,
	includeAll bool, limit, offset int,
) (*GrantExceptionResult, error) {
	db := dao.DB.WithContext(ctx)
	type fileRow struct {
		ID       string `gorm:"column:id"`
		ParentID string `gorm:"column:parent_id"`
		Name     string `gorm:"column:name"`
		Type     string `gorm:"column:type"`
		Size     int64  `gorm:"column:size"`
	}
	rows := make([]fileRow, 0)
	if err := db.Model(&entity.File{}).
		Select("id, parent_id, name, type, size").
		Where("tenant_id = ?", tenantID).
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	childrenOf := make(map[string][]*fileRow, len(rows))
	nameOf := make(map[string]string, len(rows))
	parentOf := make(map[string]string, len(rows))
	for i := range rows {
		row := &rows[i]
		childrenOf[row.ParentID] = append(childrenOf[row.ParentID], row)
		nameOf[row.ID] = row.Name
		parentOf[row.ID] = row.ParentID
	}
	pathOf := func(id string) string {
		names := make([]string, 0, 4)
		seen := make(map[string]bool, 4)
		for id != "" && !seen[id] {
			seen[id] = true
			names = append(names, nameOf[id])
			id = parentOf[id]
		}
		for i, j := 0, len(names)-1; i < j; i, j = i+1, j-1 {
			names[i], names[j] = names[j], names[i]
		}
		return strings.Join(names, " / ")
	}

	// 只统计子树：文件夹用后缀遍历，文件就是自己。
	subtree := make([]*fileRow, 0, len(rows))
	if folderID == "" {
		for i := range rows {
			subtree = append(subtree, &rows[i])
		}
	} else {
		queue := []string{folderID}
		seen := map[string]bool{}
		for len(queue) > 0 {
			current := queue[0]
			queue = queue[1:]
			for _, child := range childrenOf[current] {
				if seen[child.ID] {
					continue
				}
				seen[child.ID] = true
				subtree = append(subtree, child)
				if child.Type == "folder" {
					queue = append(queue, child.ID)
				}
			}
		}
	}

	grants, err := dao.NewResourceGrantDAO().ListByTenant(ctx, dao.DB, tenantID)
	if err != nil {
		return nil, err
	}
	nodeGrants := make(map[string][]*entity.ResourceGrant)
	for _, g := range grants {
		if g.ResourceKind != "file" && g.ResourceKind != "folder" {
			continue
		}
		nodeGrants[g.ResourceKind+"\x00"+g.ResourceID] = append(
			nodeGrants[g.ResourceKind+"\x00"+g.ResourceID], g)
	}

	kw := strings.ToLower(strings.TrimSpace(keywords))
	cache := newGrantNameCache()
	matched := make([]*GrantExceptionItem, 0, len(subtree))
	fileTotal := int64(0)
	exceptionTotal := int64(0)
	for _, row := range subtree {
		grantKind := "file"
		nodeKind := GrantNodeFile
		if row.Type == "folder" {
			grantKind = "folder"
			nodeKind = GrantNodeFolder
		} else {
			fileTotal++
		}
		rowGrants := nodeGrants[grantKind+"\x00"+row.ID]
		if len(rowGrants) > 0 {
			exceptionTotal++
		}
		if kw != "" && !strings.Contains(strings.ToLower(row.Name), kw) {
			continue
		}
		if !includeAll && len(rowGrants) == 0 {
			continue
		}
		matched = append(matched, &GrantExceptionItem{
			ResourceID:    row.ID,
			ResourceName:  row.Name,
			GrantKind:     grantKind,
			NodeKind:      nodeKind,
			ParentGrantID: row.ParentID,
			Path:          pathOf(row.ParentID),
			Size:          row.Size,
			Restricted:    len(rowGrants) > 0,
			Grants:        s.describeGrantsCached(ctx, tenantID, rowGrants, cache),
		})
	}
	sort.SliceStable(matched, func(i, j int) bool {
		if matched[i].Restricted != matched[j].Restricted {
			return matched[i].Restricted
		}
		return matched[i].ResourceName < matched[j].ResourceName
	})

	total := int64(len(matched))
	if offset >= len(matched) {
		matched = nil
	} else {
		matched = matched[offset:]
		if limit < len(matched) {
			matched = matched[:limit]
		}
	}
	return &GrantExceptionResult{
		Items:          matched,
		Total:          total,
		FileTotal:      fileTotal,
		ExceptionTotal: exceptionTotal,
	}, nil
}

func mapKeys(m map[string][]*entity.ResourceGrant) []string {
	out := make([]string, 0, len(m))
	for key := range m {
		out = append(out, key)
	}
	return out
}
