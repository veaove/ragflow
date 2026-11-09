package service

import (
	"testing"

	"ragflow/internal/entity"
)

// TestGrantsBySubjectDropsRulesOnDeletedResources 锁定「孤儿规则不展示」。
//
// 删资源（知识库 / 文件）不会级联删 resource_grant，库里会留下指向已不存在资源
// 的行。线上实际出现过：5 个已删库 + 3 个已删文件，在「按成员」视角里表现成
// 资源名为空的一行 —— 既解释不了来源，也点不进去，还把页头的授权条数抬高。
func TestGrantsBySubjectDropsRulesOnDeletedResources(t *testing.T) {
	db := setupGrantTreeTestDB(t)

	// 一条正常规则（kb1 存在）。
	seedGrant(t, db, "dataset", "kb1", entity.GrantSubjectUser, "u-owner", "edit", entity.GrantEffectAllow)
	// 孤儿：库已删。
	seedGrant(t, db, "dataset", "kb-deleted", entity.GrantSubjectUser, "u-owner", "edit", entity.GrantEffectAllow)
	// 孤儿：库已删，而且走的是「全团队」这条路。
	seedGrant(t, db, "dataset", "kb-deleted-team", entity.GrantSubjectTeam, "", "edit", entity.GrantEffectAllow)
	// 孤儿：文件已删。文件这一路先过「读不到就丢掉」，但查无此文件时拿不到库，
	// 旧逻辑会把它当成可读留下 —— 所以这条要由「资源不存在」兜住。
	seedGrant(t, db, GrantKindDocument, "d-deleted", entity.GrantSubjectUser, "u-owner", "read", entity.GrantEffectAllow)

	svc := NewResourceGrantService()
	result, err := svc.GrantsBySubject(t.Context(), "t1", entity.GrantSubjectUser, "u-owner", "u-owner")
	if err != nil {
		t.Fatalf("GrantsBySubject: %v", err)
	}

	if len(result.Rows) != 1 {
		t.Fatalf("只该剩下 kb1 一条规则，实际 %d 条：%+v", len(result.Rows), result.Rows)
	}
	row := result.Rows[0]
	if row.ResourceID != "kb1" {
		t.Errorf("剩下的应当是指向 kb1 的规则，实际 %s/%s", row.ResourceKind, row.ResourceID)
	}
	if row.ResourceName != "07-帮助中心" {
		t.Errorf("资源名 = %q, want 07-帮助中心", row.ResourceName)
	}
	// 页头条数按组统计，孤儿规则不能计进去，否则「直接 3 条」点开只有 1 行。
	if result.Direct != 1 || result.Team != 0 || result.Department != 0 {
		t.Errorf("来源计数 direct/department/team = %d/%d/%d, want 1/0/0",
			result.Direct, result.Department, result.Team)
	}
	for _, item := range result.Rows {
		if item.ResourceName == "" {
			t.Errorf("出现了空白资源名的行：%+v", item)
		}
	}
}

// TestGrantsBySubjectKeepsRulesOnLiveResources 反证：过滤的是「资源不存在」，
// 不是「名字查不到就删」。同一批数据里存在的那条必须原样留下。
func TestGrantsBySubjectKeepsRulesOnLiveResources(t *testing.T) {
	db := setupGrantTreeTestDB(t)

	seedGrant(t, db, "dataset", "kb1", entity.GrantSubjectUser, "u-owner", "read", entity.GrantEffectAllow)
	seedGrant(t, db, "dataset", "kb2", entity.GrantSubjectUser, "u-owner", "edit", entity.GrantEffectAllow)
	seedGrant(t, db, GrantKindDocument, "d1", entity.GrantSubjectUser, "u-owner", "read", entity.GrantEffectAllow)

	svc := NewResourceGrantService()
	result, err := svc.GrantsBySubject(t.Context(), "t1", entity.GrantSubjectUser, "u-owner", "u-owner")
	if err != nil {
		t.Fatalf("GrantsBySubject: %v", err)
	}
	if len(result.Rows) != 3 {
		t.Fatalf("三条规则都指向存在的资源，应全部保留，实际 %d 条：%+v", len(result.Rows), result.Rows)
	}
	byKind := map[string]string{}
	for _, row := range result.Rows {
		byKind[row.ResourceKind+"/"+row.ResourceID] = row.ResourceName
	}
	if byKind["dataset/kb2"] != "08-空库" {
		t.Errorf("kb2 名字 = %q, want 08-空库", byKind["dataset/kb2"])
	}
	if byKind["document/d1"] != "招商银行对账单.pdf" {
		t.Errorf("d1 名字 = %q, want 招商银行对账单.pdf", byKind["document/d1"])
	}
}
