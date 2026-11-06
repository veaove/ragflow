package service

import (
	"testing"

	"ragflow/internal/entity"
)

func findGraphResource(graph *GrantGraphResult, kind, id string) *GrantGraphResource {
	for i := range graph.Resources {
		if graph.Resources[i].Kind == kind && graph.Resources[i].ID == id {
			return &graph.Resources[i]
		}
	}
	return nil
}

// TestGrantGraphHidesDocumentsCallerCannotRead 锁定「文件级规则是名单制」：
// 被排除的成员在图上既看不到那个文件的节点，也不能从库节点的例外数推算出它存在。
//
// 图谱是从资源表出发画的，很容易只按知识库收窄就以为收完了 —— 那样被排除的人
// 会看到文件名和「谁被排除」，文件本身却读不到。授权树 / 子项例外 / 按成员
// 三个信息面都有这条用例，图谱曾经漏了。
func TestGrantGraphHidesDocumentsCallerCannotRead(t *testing.T) {
	db := setupGrantTreeTestDB(t)
	seedMemberReadableKB(t, db, "u-member")
	// 名单制：d2 只给了 u-other，u-member 不在名单里 → 读不到 d2。
	seedGrant(t, db, GrantKindDocument, "d2", entity.GrantSubjectUser, "u-other", "read", entity.GrantEffectAllow)

	svc := NewResourceGrantService()

	member, err := svc.GrantGraph(t.Context(), "t1", "u-member")
	if err != nil {
		t.Fatalf("GrantGraph(member): %v", err)
	}
	if res := findGraphResource(member, GrantKindDocument, "d2"); res != nil {
		t.Fatalf("d2 读不到，却出现在成员图谱：%+v", res)
	}
	for _, res := range member.Resources {
		if res.Kind != GrantKindDocument {
			continue
		}
		if res.ID == "d2" || (!res.Unconfigured && res.Name == "光大银行内部通知.pdf") {
			t.Fatalf("读不到的文件以任何身份都不该出现：%+v", res)
		}
	}

	kb := findGraphResource(member, grantGraphKindDataset, "kb1")
	if kb == nil {
		t.Fatal("kb1 对成员可读，图上应该有库节点")
	}
	if kb.ExceptionCount != 0 {
		t.Errorf("成员看不到 d2，kb1 的例外数应为 0，实际 %d", kb.ExceptionCount)
	}
	// 1 个可读库 + 3 个可读文件（d2 被排除）；四类平铺资源在本 fixture 里为空。
	if member.Stats.Visible != 4 {
		t.Errorf("成员可见资源数 = %d, want 4（不含读不到的 d2）", member.Stats.Visible)
	}
	// 4 个可见资源里只有 kb1 自己有规则，其余 3 个文件都是继承库级可见范围。
	if member.Stats.Unconfigured != 3 {
		t.Errorf("成员未单独授权数 = %d, want 3（kb1 有规则，3 个可读文件都没有自己的规则）",
			member.Stats.Unconfigured)
	}

	// 管理层视角不受影响：文件与规则一起在。
	owner, err := svc.GrantGraph(t.Context(), "t1", "u-owner")
	if err != nil {
		t.Fatalf("GrantGraph(owner): %v", err)
	}
	ownerDoc := findGraphResource(owner, GrantKindDocument, "d2")
	if ownerDoc == nil {
		t.Fatal("owner 能读 d2，图上应该有它")
	}
	if len(ownerDoc.Grants) != 1 {
		t.Errorf("d2 的规则数 = %d, want 1", len(ownerDoc.Grants))
	}
	ownerKB := findGraphResource(owner, grantGraphKindDataset, "kb1")
	if ownerKB == nil || ownerKB.ExceptionCount != 1 {
		t.Errorf("owner 看到的 kb1 例外数应为 1，实际 %+v", ownerKB)
	}
	if owner.Stats.Visible != 6 {
		t.Errorf("owner 可见资源数 = %d, want 6（2 个库 + 4 个文件）", owner.Stats.Visible)
	}
}

// TestGrantGraphReturnsDocumentOnceGranted 反证上一条：过滤的是读权限，不是
// 「有规则就藏」。名单里加上他之后，文件节点、规则与例外数一起回来。
func TestGrantGraphReturnsDocumentOnceGranted(t *testing.T) {
	db := setupGrantTreeTestDB(t)
	seedMemberReadableKB(t, db, "u-member")
	seedGrant(t, db, GrantKindDocument, "d2", entity.GrantSubjectUser, "u-other", "read", entity.GrantEffectAllow)

	svc := NewResourceGrantService()
	if res := findGraphResource(mustGraph(t, svc, "u-member"), GrantKindDocument, "d2"); res != nil {
		t.Fatalf("前置条件失败：d2 此时不该可见，实际 %+v", res)
	}

	seedGrant(t, db, GrantKindDocument, "d2", entity.GrantSubjectUser, "u-member", "read", entity.GrantEffectAllow)

	member := mustGraph(t, svc, "u-member")
	doc := findGraphResource(member, GrantKindDocument, "d2")
	if doc == nil {
		t.Fatal("名单里加上了成员，d2 应回到图上")
	}
	if len(doc.Grants) != 2 {
		t.Errorf("d2 的规则数 = %d, want 2（u-other 与 u-member）", len(doc.Grants))
	}
	kb := findGraphResource(member, grantGraphKindDataset, "kb1")
	if kb == nil || kb.ExceptionCount != 1 {
		t.Errorf("成员现在读得到 d2，kb1 例外数应为 1，实际 %+v", kb)
	}
	if member.Stats.Visible != 5 {
		t.Errorf("成员可见资源数 = %d, want 5（4 个可读文件 + kb1）", member.Stats.Visible)
	}
}

func mustGraph(t *testing.T, svc *ResourceGrantService, userID string) *GrantGraphResult {
	t.Helper()
	graph, err := svc.GrantGraph(t.Context(), "t1", userID)
	if err != nil {
		t.Fatalf("GrantGraph(%s): %v", userID, err)
	}
	return graph
}
