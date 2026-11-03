package service

import (
	"testing"

	"gorm.io/gorm"

	"ragflow/internal/entity"
)

// setupGrantTreeTestDB 建一棵「租户 → 知识库 → 文件夹 → 文件」的最小样本。
//
//	kb1  07-帮助中心          4 个文件（1 个在库根，1 个在一级目录，2 个在二级目录）
//	└ f1 银行资料              d1、d2、d3
//	  └ f2 内部资料            d2、d3
//
//	kb2  08-空库              没有任何文件
func setupGrantTreeTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db := setupServiceTestDB(t)
	if err := db.AutoMigrate(&entity.DocumentFolder{}, &entity.Department{}); err != nil {
		t.Fatalf("failed to migrate grant tree tables: %v", err)
	}
	pushServiceDB(t, db)

	status := string(entity.StatusValid)
	if err := db.Create(&entity.User{
		ID: "u-owner", Nickname: "张伟", Email: "zhangwei@example.com", DepartmentID: "dep1",
	}).Error; err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if err := db.Create(&entity.Department{ID: "dep1", TenantID: "t1", Name: "研发部"}).Error; err != nil {
		t.Fatalf("seed department: %v", err)
	}
	if err := db.Create(&entity.UserTenant{
		ID: "ut-1", UserID: "u-owner", TenantID: "t1", Role: "normal", Status: &status,
	}).Error; err != nil {
		t.Fatalf("seed membership: %v", err)
	}

	// status 必须给：授权树按调用者的读权限收窄，Active=false 的库在权限包里
	// 等于「已停用」，任何调用者都读不到。
	if err := db.Create(&entity.Knowledgebase{
		ID: "kb1", TenantID: "t1", Name: "07-帮助中心", EmbdID: "embd-1",
		CreatedBy: "u-owner", Permission: string(entity.TenantPermissionTeam), Status: &status,
	}).Error; err != nil {
		t.Fatalf("seed kb: %v", err)
	}
	if err := db.Create(&entity.Knowledgebase{
		ID: "kb2", TenantID: "t1", Name: "08-空库", EmbdID: "embd-1",
		CreatedBy: "u-owner", Permission: string(entity.TenantPermissionMe), Status: &status,
	}).Error; err != nil {
		t.Fatalf("seed kb2: %v", err)
	}

	for _, folder := range []*entity.DocumentFolder{
		{ID: "f1", DatasetID: "kb1", Name: "银行资料", CreatedBy: "u-owner"},
		{ID: "f2", DatasetID: "kb1", ParentID: "f1", Name: "内部资料", CreatedBy: "u-owner"},
	} {
		if err := db.Create(folder).Error; err != nil {
			t.Fatalf("seed folder %s: %v", folder.ID, err)
		}
	}

	seedDoc := func(id, name, folderID string) {
		folder := folderID
		doc := &entity.Document{
			ID: id, KbID: "kb1", ParserID: string(entity.ParserTypeNaive),
			ParserConfig: entity.JSONMap{}, SourceType: string(entity.FileSourceLocal),
			Type: "pdf", Suffix: ".pdf", CreatedBy: "u-owner",
			Name: &name, Size: 1024,
		}
		if folder != "" {
			doc.FolderID = &folder
		}
		if err := db.Create(doc).Error; err != nil {
			t.Fatalf("seed doc %s: %v", id, err)
		}
	}
	seedDoc("d1", "招商银行对账单.pdf", "f1")
	seedDoc("d2", "光大银行内部通知.pdf", "f2")
	seedDoc("d3", "浦发银行流水.pdf", "f2")
	seedDoc("d4", "目录说明.pdf", "")

	return db
}

func seedGrant(t *testing.T, db *gorm.DB, kind, resourceID, subjectKind, subjectID, permission, effect string) {
	t.Helper()

	grant := &entity.ResourceGrant{
		ID:           kind + "-" + resourceID + "-" + subjectKind + "-" + subjectID,
		TenantID:     "t1",
		ResourceKind: kind,
		ResourceID:   resourceID,
		SubjectKind:  subjectKind,
		SubjectID:    subjectID,
		Permission:   permission,
		Effect:       effect,
	}
	if err := db.Create(grant).Error; err != nil {
		t.Fatalf("seed grant %s/%s: %v", kind, resourceID, err)
	}
}

// TestGrantTreeDatasetSummaries 锁定树的核心契约：一次返回每层的文件数、例外数
// 与摘要色，前端不点进去就能看出「谁能看」。
func TestGrantTreeDatasetSummaries(t *testing.T) {
	db := setupGrantTreeTestDB(t)
	seedGrant(t, db, "dataset", "kb1", entity.GrantSubjectUser, "u-owner", "edit", entity.GrantEffectAllow)
	seedGrant(t, db, GrantKindDocument, "d2", entity.GrantSubjectUser, "u-owner", "read", entity.GrantEffectDeny)

	tree, err := NewResourceGrantService().GrantTree(t.Context(), "t1", "dataset", "", "u-owner")
	if err != nil {
		t.Fatalf("GrantTree: %v", err)
	}
	if tree.Total != 2 {
		t.Fatalf("total = %d, want 2", tree.Total)
	}
	if tree.FileTotal != 4 || tree.ExceptionTotal != 1 {
		t.Fatalf("file_total=%d exception_total=%d, want 4/1", tree.FileTotal, tree.ExceptionTotal)
	}

	root := findTreeNode(t, tree.Nodes, "kb1")
	if root.NodeKind != GrantNodeDataset || root.GrantKind != "dataset" || !root.SupportsVisibility {
		t.Fatalf("kb node shape = %+v", root)
	}
	if root.FileCount != 4 {
		t.Errorf("kb file_count = %d, want 4", root.FileCount)
	}
	if root.ExceptionCount != 1 {
		t.Errorf("kb exception_count = %d, want 1", root.ExceptionCount)
	}
	if root.Summary.Tone != GrantToneException || root.Summary.Label != "1 项例外" {
		t.Errorf("kb summary = %+v, want exception 1 项例外", root.Summary)
	}
	if len(root.Grants) != 1 || root.Grants[0].Name != "张伟" {
		t.Errorf("kb grants = %+v, want 张伟", root.Grants)
	}

	folder := findTreeNode(t, root.Children, "f1")
	if folder.FileCount != 3 || folder.ExceptionCount != 1 {
		t.Errorf("f1 file_count=%d exception_count=%d, want 3/1", folder.FileCount, folder.ExceptionCount)
	}
	// 知识库里的文件夹不单独授权：规则只落在库与文件上，这一层只做汇总。
	if folder.GrantKind != "" {
		t.Errorf("f1 grant_kind = %q, want empty (folders are not authorizable)", folder.GrantKind)
	}
	if folder.ParentGrantID != "kb1" {
		t.Errorf("f1 parent_grant_id = %q, want kb1", folder.ParentGrantID)
	}

	nested := findTreeNode(t, folder.Children, "f2")
	if nested.FileCount != 2 || nested.ExceptionCount != 1 {
		t.Errorf("f2 file_count=%d exception_count=%d, want 2/1", nested.FileCount, nested.ExceptionCount)
	}

	empty := findTreeNode(t, tree.Nodes, "kb2")
	if empty.Summary.Tone != GrantToneOwner || empty.Summary.Label != "仅所有者" {
		t.Errorf("kb2 summary = %+v, want owner 仅所有者", empty.Summary)
	}
}

// TestGrantTreeDatasetKeywords 保证搜索按「库名或子项名」过滤，且不丢整棵子树。
func TestGrantTreeDatasetKeywords(t *testing.T) {
	db := setupGrantTreeTestDB(t)
	seedGrant(t, db, "dataset", "kb1", entity.GrantSubjectTeam, "", "read", entity.GrantEffectAllow)

	tree, err := NewResourceGrantService().GrantTree(t.Context(), "t1", "dataset", "内部资料", "u-owner")
	if err != nil {
		t.Fatalf("GrantTree: %v", err)
	}
	if tree.Total != 1 || tree.Nodes[0].ID != "kb1" {
		t.Fatalf("keyword should keep kb1 only, got %+v", tree.Nodes)
	}

	tree, err = NewResourceGrantService().GrantTree(t.Context(), "t1", "dataset", "空库", "u-owner")
	if err != nil {
		t.Fatalf("GrantTree: %v", err)
	}
	if tree.Total != 1 || tree.Nodes[0].Summary.Tone != GrantToneOwner {
		t.Fatalf("kb2 should stay owner-only, got %+v", tree.Nodes)
	}
}

// TestGrantTreeScopesToCallerReadableDatasets 覆盖 E2E D2：授权页对普通成员只能
// 列出他读得到的库。别人 permission=me 的私库连名字都不该出现 —— 这正是「成员
// 能读到整棵授权树（18 个库）」那条缺陷的核心。
func TestGrantTreeScopesToCallerReadableDatasets(t *testing.T) {
	db := setupGrantTreeTestDB(t)

	status := string(entity.StatusValid)
	if err := db.Create(&entity.Knowledgebase{
		ID: "kb-other-private", TenantID: "t1", Name: "09-别人的私库", EmbdID: "embd-1",
		CreatedBy: "u-other", Permission: string(entity.TenantPermissionMe), Status: &status,
	}).Error; err != nil {
		t.Fatalf("seed other private kb: %v", err)
	}

	// u-owner 是 kb1（team + 创建者）与 kb2（创建者）的可见者，看不到别人建在
	// 同租户的私库。
	tree, err := NewResourceGrantService().GrantTree(t.Context(), "t1", "dataset", "", "u-owner")
	if err != nil {
		t.Fatalf("GrantTree: %v", err)
	}
	if tree.Total != 2 {
		t.Fatalf("total = %d, want 2 (%v)", tree.Total, treeNodeIDs(tree.Nodes))
	}
	for _, node := range tree.Nodes {
		if node.ID == "kb-other-private" {
			t.Fatal("别人 permission=me 的私库不应出现在授权树里")
		}
	}

	// 与该租户无关的人看到空树，而不是整租户清单。
	stranger, err := NewResourceGrantService().GrantTree(t.Context(), "t1", "dataset", "", "u-stranger")
	if err != nil {
		t.Fatalf("GrantTree(stranger): %v", err)
	}
	if stranger.Total != 0 || len(stranger.Nodes) != 0 {
		t.Fatalf("stranger tree = %v, want empty", treeNodeIDs(stranger.Nodes))
	}

	// 按 id 展开子项同样要拦：否则「树上看不见、换个 id 就能读」。
	if _, err := NewResourceGrantService().ListGrantExceptions(
		t.Context(), "t1", "dataset", "kb-other-private", "", "", "u-owner", false, 20, 0,
	); err == nil {
		t.Fatal("读不到的库的子项应返回错误，而不是内容")
	}
}

// TestGrantTreeFileHierarchy 覆盖文件管理：文件夹可授权（grant_kind=folder），
// 例外沿层级向上累加。
func TestGrantTreeFileHierarchy(t *testing.T) {
	db := setupGrantTreeTestDB(t)

	for _, file := range []*entity.File{
		{ID: "fd1", TenantID: "t1", Name: "合同", Type: "folder"},
		{ID: "fd2", TenantID: "t1", ParentID: "fd1", Name: "2026", Type: "folder"},
		{ID: "fl1", TenantID: "t1", ParentID: "fd2", Name: "a.pdf", Type: "pdf", Size: 10},
		{ID: "fl2", TenantID: "t1", ParentID: "fd1", Name: "b.pdf", Type: "pdf", Size: 20},
	} {
		if err := db.Create(file).Error; err != nil {
			t.Fatalf("seed file %s: %v", file.ID, err)
		}
	}
	seedGrant(t, db, "file", "fl1", entity.GrantSubjectUser, "u-owner", "read", entity.GrantEffectDeny)

	tree, err := NewResourceGrantService().GrantTree(t.Context(), "t1", "file", "", "u-owner")
	if err != nil {
		t.Fatalf("GrantTree: %v", err)
	}
	if tree.Kind != "file" || tree.Total != 1 {
		t.Fatalf("tree = %+v, want one root folder", tree)
	}
	root := findTreeNode(t, tree.Nodes, "fd1")
	if root.GrantKind != "folder" {
		t.Errorf("fd1 grant_kind = %q, want folder", root.GrantKind)
	}
	if root.FileCount != 2 || root.ExceptionCount != 1 || root.Summary.Tone != GrantToneException {
		t.Errorf("fd1 file=%d exception=%d summary=%+v", root.FileCount, root.ExceptionCount, root.Summary)
	}
	nested := findTreeNode(t, root.Children, "fd2")
	if nested.ExceptionCount != 1 {
		t.Errorf("fd2 exception_count = %d, want 1", nested.ExceptionCount)
	}
	leaf := findTreeNode(t, nested.Children, "fl1")
	if leaf.NodeKind != GrantNodeFile || leaf.GrantKind != "file" {
		t.Errorf("fl1 node = %+v", leaf)
	}
	if len(leaf.Grants) != 1 || leaf.Grants[0].Effect != entity.GrantEffectDeny {
		t.Errorf("fl1 grants = %+v, want one deny", leaf.Grants)
	}
}

// TestListGrantExceptionsScopes 锁定「子项例外」的三件事：默认只给例外、
// 「查看全部」给全量并标出是否受限、按文件夹收窄时只算子树。
func TestListGrantExceptionsScopes(t *testing.T) {
	db := setupGrantTreeTestDB(t)
	seedGrant(t, db, GrantKindDocument, "d2", entity.GrantSubjectUser, "u-owner", "read", entity.GrantEffectDeny)

	svc := NewResourceGrantService()

	page, err := svc.ListGrantExceptions(t.Context(), "t1", "dataset", "kb1", "", "", "u-owner", false, 20, 0)
	if err != nil {
		t.Fatalf("ListGrantExceptions: %v", err)
	}
	if len(page.Items) != 1 || page.Items[0].ResourceID != "d2" || !page.Items[0].Restricted {
		t.Fatalf("default page = %+v, want only d2", page.Items)
	}
	if page.Items[0].Path != "银行资料 / 内部资料" {
		t.Errorf("path = %q, want 银行资料 / 内部资料", page.Items[0].Path)
	}
	if page.Items[0].ParentGrantID != "kb1" {
		t.Errorf("parent_grant_id = %q, want kb1", page.Items[0].ParentGrantID)
	}
	if page.FileTotal != 4 || page.ExceptionTotal != 1 {
		t.Errorf("file_total=%d exception_total=%d, want 4/1", page.FileTotal, page.ExceptionTotal)
	}

	all, err := svc.ListGrantExceptions(t.Context(), "t1", "dataset", "kb1", "", "", "u-owner", true, 20, 0)
	if err != nil {
		t.Fatalf("ListGrantExceptions(all): %v", err)
	}
	if all.Total != 4 || len(all.Items) != 4 {
		t.Fatalf("all page total=%d items=%d, want 4/4", all.Total, len(all.Items))
	}
	restricted := 0
	for _, item := range all.Items {
		if item.Restricted {
			restricted++
		}
	}
	if restricted != 1 {
		t.Errorf("restricted = %d, want 1", restricted)
	}

	scoped, err := svc.ListGrantExceptions(t.Context(), "t1", "dataset", "kb1", "f2", "", "u-owner", true, 20, 0)
	if err != nil {
		t.Fatalf("ListGrantExceptions(folder): %v", err)
	}
	if scoped.Total != 2 || scoped.FileTotal != 2 || scoped.ExceptionTotal != 1 {
		t.Errorf("folder scope total=%d file_total=%d exception_total=%d, want 2/2/1",
			scoped.Total, scoped.FileTotal, scoped.ExceptionTotal)
	}

	searched, err := svc.ListGrantExceptions(t.Context(), "t1", "dataset", "kb1", "", "光大", "u-owner", true, 20, 0)
	if err != nil {
		t.Fatalf("ListGrantExceptions(keywords): %v", err)
	}
	if len(searched.Items) != 1 || searched.Items[0].ResourceID != "d2" {
		t.Fatalf("keyword page = %+v, want d2", searched.Items)
	}
}

// TestGrantsBySubjectSeparatesSources 保证同一资源经不同路径到达同一个人时分行，
// 这是「我没给过他，他为什么能看」唯一能查清的方式。
func TestGrantsBySubjectSeparatesSources(t *testing.T) {
	db := setupGrantTreeTestDB(t)
	seedGrant(t, db, "dataset", "kb1", entity.GrantSubjectUser, "u-owner", "edit", entity.GrantEffectAllow)
	seedGrant(t, db, "dataset", "kb1", entity.GrantSubjectDepartment, "dep1", "read", entity.GrantEffectAllow)
	seedGrant(t, db, "dataset", "kb1", entity.GrantSubjectTeam, "", "read", entity.GrantEffectAllow)
	seedGrant(t, db, GrantKindDocument, "d1", entity.GrantSubjectUser, "u-owner", "read", entity.GrantEffectDeny)

	result, err := NewResourceGrantService().GrantsBySubject(t.Context(), "t1", entity.GrantSubjectUser, "u-owner")
	if err != nil {
		t.Fatalf("GrantsBySubject: %v", err)
	}
	if result.SubjectName != "张伟" {
		t.Errorf("subject_name = %q, want 张伟", result.SubjectName)
	}
	if result.Direct != 2 || result.Department != 1 || result.Team != 1 {
		t.Fatalf("direct=%d department=%d team=%d, want 2/1/1", result.Direct, result.Department, result.Team)
	}
	if len(result.Rows) != 4 {
		t.Fatalf("rows = %d, want 4", len(result.Rows))
	}

	// 直接授权排最前：那才是管理员亲手做的动作。
	for _, row := range result.Rows[:2] {
		if row.Via != GrantViaDirect {
			t.Fatalf("first rows should be direct, got %+v", result.Rows)
		}
	}
	var docRow *GrantSubjectRow
	for _, row := range result.Rows {
		if row.ResourceKind == GrantKindDocument {
			docRow = row
		}
	}
	if docRow == nil {
		t.Fatalf("missing document row in %+v", result.Rows)
	}
	if docRow.ParentName != "07-帮助中心" || docRow.ResourceName != "招商银行对账单.pdf" {
		t.Errorf("document row = %+v, want 招商银行对账单.pdf under 07-帮助中心", docRow)
	}
	if docRow.Effect != entity.GrantEffectDeny {
		t.Errorf("document row effect = %q, want deny", docRow.Effect)
	}

	var teamRow *GrantSubjectRow
	for _, row := range result.Rows {
		if row.Via == GrantViaTeam {
			teamRow = row
		}
	}
	if teamRow == nil || teamRow.ResourceName != "07-帮助中心" {
		t.Fatalf("team row = %+v, want kb1 07-帮助中心", teamRow)
	}
	if teamRow.ViaName != "全团队" {
		t.Errorf("team via_name = %q, want 全团队", teamRow.ViaName)
	}
}

// TestGrantTreeRejectsFlatKinds 明确：没有层级的资源不走树，前端继续用平铺列表。
func TestGrantTreeRejectsFlatKinds(t *testing.T) {
	setupGrantTreeTestDB(t)

	if _, err := NewResourceGrantService().GrantTree(t.Context(), "t1", "chat", "", "u-owner"); err == nil {
		t.Fatal("expected error for flat kind")
	}
	if _, err := NewResourceGrantService().ListGrantExceptions(
		t.Context(), "t1", "chat", "", "", "", "u-owner", false, 20, 0,
	); err == nil {
		t.Fatal("expected error for flat kind")
	}
}

func findTreeNode(t *testing.T, nodes []*GrantTreeNode, id string) *GrantTreeNode {
	t.Helper()

	for _, node := range nodes {
		if node.ID == id {
			return node
		}
	}
	t.Fatalf("node %s not found in %v", id, treeNodeIDs(nodes))
	return nil
}

func treeNodeIDs(nodes []*GrantTreeNode) []string {
	out := make([]string, 0, len(nodes))
	for _, node := range nodes {
		out = append(out, node.ID)
	}
	return out
}
