package service

import (
	"testing"

	"ragflow/internal/permission"
)

// allow_partial_kb 默认必须为 true：存量搜索应用没有这个字段，要让它们立刻
// 按可见库返回，而不是继续整体失败。
func TestSearchConfigAllowsPartialKBDefaultsToTrue(t *testing.T) {
	if !SearchConfigAllowsPartialKB(nil) {
		t.Error("SearchConfigAllowsPartialKB(nil) = false, want true")
	}
	if !SearchConfigAllowsPartialKB(map[string]interface{}{}) {
		t.Error("SearchConfigAllowsPartialKB(empty) = false, want true")
	}
	if !SearchConfigAllowsPartialKB(map[string]interface{}{"allow_partial_kb": "true"}) {
		t.Error("SearchConfigAllowsPartialKB(non-bool) = false, want the default true")
	}
	if SearchConfigAllowsPartialKB(map[string]interface{}{"allow_partial_kb": false}) {
		t.Error("SearchConfigAllowsPartialKB(explicit false) = true, want false")
	}
}

// 知识搜索与问答助手共用这段判定：有权限的库保留，无权限的丢弃，已删除的
// 既不保留也不计为拒绝。
func TestVisibleDatasetIDsSplitsByAccess(t *testing.T) {
	setupChatPermissionTestDB(t)

	allowed, denied := VisibleDatasetIDs(
		t.Context(),
		permission.Subject{UserID: "member-1"},
		[]string{"team-dataset", "private-dataset", "deleted-dataset"},
	)

	if len(allowed) != 1 || allowed[0] != "team-dataset" {
		t.Fatalf("allowed = %v, want [team-dataset]", allowed)
	}
	if len(denied) != 1 || denied[0] != "private-dataset" {
		t.Fatalf("denied = %v, want [private-dataset]", denied)
	}
}
