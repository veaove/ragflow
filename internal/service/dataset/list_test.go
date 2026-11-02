package dataset

import (
	"encoding/json"
	"math"
	"slices"
	"sort"
	"testing"
	"time"

	"ragflow/internal/common"
	"ragflow/internal/dao"
	"ragflow/internal/entity"
)

func testDatasetListService(t *testing.T) *DatasetService {
	t.Helper()

	return &DatasetService{
		kbDAO:       dao.NewKnowledgebaseDAO(),
		documentDAO: dao.NewDocumentDAO(),
		tenantDAO:   dao.NewTenantDAO(),
	}
}

func TestDatasetServiceListDatasetsFiltersByIDs(t *testing.T) {
	db := setupDatasetUpdateTestDB(t)
	pushServiceDB(t, db)
	insertDatasetUpdateKB(t, "kb-1", "tenant-1", "Alpha")
	insertDatasetUpdateKB(t, "kb-2", "tenant-1", "Beta")

	ctx := t.Context()
	data, total, code, err := testDatasetListService(t).ListDatasets(ctx,
		"", "", 1, 30, []dao.OrderTerm{{Column: "create_time", Desc: true}},
		"", nil, "", "tenant-1", []string{"kb-1"}, "",
		dao.DatasetListFilter{},
	)
	if err != nil {
		t.Fatalf("ListDatasets failed: %v", err)
	}
	if code != common.CodeSuccess {
		t.Fatalf("expected success code, got %d", code)
	}
	if total != 1 || len(data) != 1 {
		t.Fatalf("expected exactly one dataset, got total=%d len=%d", total, len(data))
	}
	if data[0]["id"] != "kb-1" {
		t.Fatalf("expected kb-1, got %#v", data[0]["id"])
	}
	if got, ok := data[0]["keywords_similarity_weight"].(float64); !ok || math.Abs(got-0.7) > 1e-9 {
		t.Fatalf("keywords_similarity_weight = %#v, want 0.7", data[0]["keywords_similarity_weight"])
	}
	if _, exists := data[0]["vector_similarity_weight"]; exists {
		t.Fatal("response must not include vector_similarity_weight")
	}
}

func TestDatasetServiceListDatasetsIDsAccessibleViaTeamTenant(t *testing.T) {
	db := setupDatasetUpdateTestDB(t)
	pushServiceDB(t, db)
	insertDatasetUpdateKB(t, "kb-team", "owner-1", "Shared")
	if err := dao.DB.Create(&entity.Tenant{ID: "owner-1", Name: sptr("owner"), Status: sptr("1")}).Error; err != nil {
		t.Fatalf("insert owner tenant: %v", err)
	}
	insertDatasetUpdateTeamMember(t, "user-1", "owner-1")
	if err := dao.DB.Model(&entity.Knowledgebase{}).
		Where("id = ?", "kb-team").
		Update("permission", string(entity.TenantPermissionTeam)).Error; err != nil {
		t.Fatalf("update kb permission: %v", err)
	}

	ctx := t.Context()
	data, total, code, err := testDatasetListService(t).ListDatasets(ctx,
		"", "", 1, 30, []dao.OrderTerm{{Column: "create_time", Desc: true}},
		"", nil, "", "user-1", []string{"kb-team"}, "",
		dao.DatasetListFilter{},
	)
	if err != nil {
		t.Fatalf("ListDatasets failed: %v", err)
	}
	if code != common.CodeSuccess {
		t.Fatalf("expected success code, got %d", code)
	}
	if total != 1 || len(data) != 1 || data[0]["id"] != "kb-team" {
		t.Fatalf("expected the shared dataset, got total=%d data=%#v", total, data)
	}
}

func TestDatasetServiceListDatasetsAndFiltersUseAuthorizedScope(t *testing.T) {
	db := setupDatasetUpdateTestDB(t)
	pushServiceDB(t, db)
	insertDatasetUpdateKB(t, "kb-own", "user-1", "Own")
	insertDatasetUpdateKB(t, "kb-team", "owner-1", "Team")
	insertDatasetUpdateKB(t, "kb-private", "owner-1", "Private")
	insertDatasetUpdateTeamMember(t, "user-1", "owner-1")
	if err := dao.DB.Model(&entity.Knowledgebase{}).
		Where("id = ?", "kb-team").
		Update("permission", string(entity.TenantPermissionTeam)).Error; err != nil {
		t.Fatalf("share team dataset: %v", err)
	}

	ctx := t.Context()
	data, total, code, err := testDatasetListService(t).ListDatasets(ctx,
		"", "", 1, 30, []dao.OrderTerm{{Column: "create_time", Desc: true}},
		"", []string{"owner-1"}, "", "user-1", nil, "",
		dao.DatasetListFilter{},
	)
	if err != nil || code != common.CodeSuccess {
		t.Fatalf("ListDatasets = (%#v, %d, %v), want success", data, code, err)
	}
	if total != 1 || len(data) != 1 || data[0]["id"] != "kb-team" {
		t.Fatalf("ListDatasets returned %#v (total=%d), want only the shared dataset", data, total)
	}

	filters, code, err := testDatasetListService(t).ListDatasetFilters(ctx, "user-1", "")
	if err != nil || code != common.CodeSuccess {
		t.Fatalf("ListDatasetFilters = (%#v, %v, %v), want success", filters, code, err)
	}
	if filters["total"] != int64(2) {
		t.Fatalf("ListDatasetFilters total = %#v, want 2 visible datasets", filters["total"])
	}
	owners, ok := filters["filter"].(map[string]interface{})["owner"].([]*entity.DatasetOwnerFilter)
	if !ok || len(owners) != 2 {
		t.Fatalf("ListDatasetFilters owners = %#v, want own and shared tenant groups", filters["filter"])
	}
}

func TestDatasetServiceListDatasetsForCanvasUsesCallerOwnerIntersection(t *testing.T) {
	db := setupDatasetUpdateTestDB(t)
	pushServiceDB(t, db)
	insertDatasetUpdateKB(t, "kb-caller-only", "user-1", "Caller only")
	insertDatasetUpdateKB(t, "kb-shared", "owner-1", "Shared")
	insertDatasetUpdateKB(t, "kb-owner-only", "owner-1", "Owner only")
	insertDatasetUpdateTeamMember(t, "user-1", "owner-1")
	if err := dao.DB.Model(&entity.Knowledgebase{}).
		Where("id = ?", "kb-shared").
		Update("permission", string(entity.TenantPermissionTeam)).Error; err != nil {
		t.Fatalf("share dataset with tenant: %v", err)
	}
	canvas := entity.UserCanvas{
		ID:         "canvas-shared",
		UserID:     "owner-1",
		Permission: string(entity.TenantPermissionTeam),
		DSL:        entity.JSONMap{},
	}
	if err := dao.DB.Create(&canvas).Error; err != nil {
		t.Fatalf("create shared canvas: %v", err)
	}

	service := testDatasetListService(t)
	data, total, code, err := service.ListDatasets(t.Context(), "", "", 1, 30,
		[]dao.OrderTerm{{Column: "create_time", Desc: true}}, "", nil, "", "user-1", nil, "canvas-shared", dao.DatasetListFilter{})
	if err != nil || code != common.CodeSuccess {
		t.Fatalf("ListDatasets(canvas) = (%#v, %d, %v), want success", data, code, err)
	}
	if total != 1 || len(data) != 1 || data[0]["id"] != "kb-shared" {
		t.Fatalf("canvas dataset list = %#v (total=%d), want only kb-shared", data, total)
	}

	data, total, code, err = service.ListDatasets(t.Context(), "", "", 1, 30,
		[]dao.OrderTerm{{Column: "create_time", Desc: true}}, "", nil, "", "user-1",
		[]string{"kb-caller-only", "kb-shared", "kb-owner-only"}, "canvas-shared", dao.DatasetListFilter{})
	if err != nil || code != common.CodeSuccess {
		t.Fatalf("ListDatasets(canvas, ids) = (%#v, %d, %v), want success", data, code, err)
	}
	if total != 1 || len(data) != 1 || data[0]["id"] != "kb-shared" {
		t.Fatalf("canvas dataset lookup = %#v (total=%d), want only kb-shared", data, total)
	}
}

// GET /api/v1/datasets is the only source the knowledge-base table, the card
// view and the edit dialog read from. The update endpoint persisted `category`
// and the detail endpoint returned it, but the list select/map dropped it, so a
// saved category came back as "--" in the table and as an empty input when the
// dialog was reopened — the write looked like a no-op.
func TestDatasetServiceListDatasetsReturnsCategory(t *testing.T) {
	db := setupDatasetUpdateTestDB(t)
	pushServiceDB(t, db)
	insertDatasetUpdateKB(t, "kb-categorized", "tenant-1", "Categorized")
	insertDatasetUpdateKB(t, "kb-plain", "tenant-1", "Plain")
	if err := dao.DB.Model(&entity.Knowledgebase{}).
		Where("id = ?", "kb-categorized").
		Update("category", "产品资料").Error; err != nil {
		t.Fatalf("seed category: %v", err)
	}

	ctx := t.Context()
	data, _, code, err := testDatasetListService(t).ListDatasets(ctx,
		"", "", 1, 30, []dao.OrderTerm{{Column: "create_time", Desc: true}},
		"", nil, "", "tenant-1", []string{"kb-categorized", "kb-plain"}, "",
		dao.DatasetListFilter{},
	)
	if err != nil || code != common.CodeSuccess {
		t.Fatalf("ListDatasets = (%#v, %d, %v), want success", data, code, err)
	}

	byID := make(map[string]map[string]interface{}, len(data))
	for _, item := range data {
		id, _ := item["id"].(string)
		byID[id] = item
	}
	if got := byID["kb-categorized"]["category"]; got != "产品资料" {
		t.Fatalf("category = %#v, want 产品资料", got)
	}
	// 未设置的分类必须"有键无值"（nil 或 ""），不能整个键缺失：前端按列取值，
	// 缺键与空值都会渲染成 "--"，但缺键说明后端根本没在列表里返回这一列。
	if got, ok := byID["kb-plain"]["category"]; !ok || (got != nil && got != "") {
		t.Fatalf("empty category = %#v (present=%v), want nil or \"\"", got, ok)
	}
}

func TestDatasetServiceListDatasetsPaginatesInsidePermissionScope(t *testing.T) {
	db := setupDatasetUpdateTestDB(t)
	pushServiceDB(t, db)
	insertDatasetUpdateKB(t, "kb-own", "user-1", "Own")
	insertDatasetUpdateKB(t, "kb-team", "owner-1", "Shared")
	insertDatasetUpdateKB(t, "kb-private", "owner-1", "Private")
	insertDatasetUpdateKB(t, "kb-outside", "other-owner", "Outside")
	insertDatasetUpdateTeamMember(t, "user-1", "owner-1")
	if err := dao.DB.Model(&entity.Knowledgebase{}).
		Where("id = ?", "kb-team").
		Update("permission", string(entity.TenantPermissionTeam)).Error; err != nil {
		t.Fatalf("share team dataset: %v", err)
	}

	service := testDatasetListService(t)
	terms := []dao.OrderTerm{{Column: "name"}}
	pageOne, total, code, err := service.ListDatasets(t.Context(), "", "", 1, 1, terms, "", nil, "", "user-1", nil, "", dao.DatasetListFilter{})
	if err != nil || code != common.CodeSuccess {
		t.Fatalf("ListDatasets(page 1) = (%#v, %d, %v), want success", pageOne, code, err)
	}
	if total != 2 || len(pageOne) != 1 || pageOne[0]["id"] != "kb-own" {
		t.Fatalf("page 1 = %#v (total=%d), want kb-own and two accessible datasets", pageOne, total)
	}

	pageTwo, secondTotal, code, err := service.ListDatasets(t.Context(), "", "", 2, 1, terms, "", nil, "", "user-1", nil, "", dao.DatasetListFilter{})
	if err != nil || code != common.CodeSuccess {
		t.Fatalf("ListDatasets(page 2) = (%#v, %d, %v), want success", pageTwo, code, err)
	}
	if secondTotal != 2 || len(pageTwo) != 1 || pageTwo[0]["id"] != "kb-team" {
		t.Fatalf("page 2 = %#v (total=%d), want kb-team and two accessible datasets", pageTwo, secondTotal)
	}
}

func TestDatasetServiceListDatasetFiltersReturnsEmptyOwnerList(t *testing.T) {
	db := setupDatasetUpdateTestDB(t)
	pushServiceDB(t, db)

	filters, code, err := testDatasetListService(t).ListDatasetFilters(t.Context(), "user-without-datasets", "")
	if err != nil || code != common.CodeSuccess {
		t.Fatalf("ListDatasetFilters = (%#v, %v, %v), want success", filters, code, err)
	}

	owners, ok := filters["filter"].(map[string]interface{})["owner"].([]*entity.DatasetOwnerFilter)
	if !ok || owners == nil || len(owners) != 0 {
		t.Fatalf("ListDatasetFilters owners = %#v, want a non-nil empty slice", filters["filter"])
	}

	encoded, err := json.Marshal(filters)
	if err != nil {
		t.Fatalf("marshal filters: %v", err)
	}
	var response map[string]interface{}
	if err := json.Unmarshal(encoded, &response); err != nil {
		t.Fatalf("unmarshal filters: %v", err)
	}
	ownerJSON := response["filter"].(map[string]interface{})["owner"]
	if ownerJSON == nil {
		t.Fatal(`serialized owner is null; want []`)
	}
	if ownerList, ok := ownerJSON.([]interface{}); !ok || len(ownerList) != 0 {
		t.Fatalf("serialized owner = %#v, want []", ownerJSON)
	}
}

func TestDatasetServiceListDatasetsRejectsIDAndIDsTogether(t *testing.T) {
	db := setupDatasetUpdateTestDB(t)
	pushServiceDB(t, db)
	insertDatasetUpdateKB(t, "kb-1", "tenant-1", "Alpha")

	ctx := t.Context()
	_, _, code, err := testDatasetListService(t).ListDatasets(ctx,
		"kb-1", "", 1, 30, []dao.OrderTerm{{Column: "create_time", Desc: true}},
		"", nil, "", "tenant-1", []string{"kb-1"}, "",
		dao.DatasetListFilter{},
	)
	if err == nil {
		t.Fatal("expected id/ids conflict error")
	}
	if code != common.CodeDataError {
		t.Fatalf("expected data error code, got %d", code)
	}
	expected := "should not provide both 'id':kb-1 and 'ids':['kb-1']"
	if err.Error() != expected {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestDatasetServiceListDatasetsFiltersInaccessibleIDs(t *testing.T) {
	db := setupDatasetUpdateTestDB(t)
	pushServiceDB(t, db)
	insertDatasetUpdateKB(t, "kb-valid", "user-1", "Valid")
	insertDatasetUpdateKB(t, "kb-private", "owner-1", "Private")

	ctx := t.Context()
	data, total, code, err := testDatasetListService(t).ListDatasets(ctx,
		"", "", 1, 30, []dao.OrderTerm{{Column: "create_time", Desc: true}},
		"", nil, "", "user-1", []string{"kb-valid", "kb-private", "kb-missing"}, "",
		dao.DatasetListFilter{},
	)
	if err != nil {
		t.Fatalf("ListDatasets failed: %v", err)
	}
	if code != common.CodeSuccess {
		t.Fatalf("expected success code, got %d", code)
	}
	if total != 1 || len(data) != 1 || data[0]["id"] != "kb-valid" {
		t.Fatalf("expected only the valid dataset, got total=%d data=%#v", total, data)
	}
}

func TestDatasetServiceListDatasetsReturnsEmptyForAllInaccessibleIDs(t *testing.T) {
	db := setupDatasetUpdateTestDB(t)
	pushServiceDB(t, db)
	insertDatasetUpdateKB(t, "kb-private", "owner-1", "Private")

	ctx := t.Context()
	data, total, code, err := testDatasetListService(t).ListDatasets(ctx,
		"", "", 1, 30, []dao.OrderTerm{{Column: "create_time", Desc: true}},
		"", nil, "", "user-1", []string{"kb-private", "kb-missing"}, "",
		dao.DatasetListFilter{},
	)
	if err != nil {
		t.Fatalf("ListDatasets failed: %v", err)
	}
	if code != common.CodeSuccess {
		t.Fatalf("expected success code, got %d", code)
	}
	if data == nil || len(data) != 0 || total != 0 {
		t.Fatalf("expected a non-nil empty result, got total=%d data=%#v", total, data)
	}
}

func boolPtr(value bool) *bool { return &value }

// testDatasetFilterDataset 造三条各自带分类/状态/时间标记的库，供筛选用例复用。
func seedDatasetFilterFixture(t *testing.T) {
	t.Helper()

	insertDatasetUpdateKB(t, "kb-product", "tenant-1", "Product")
	insertDatasetUpdateKB(t, "kb-rule", "tenant-1", "Rule")
	insertDatasetUpdateKB(t, "kb-other", "tenant-1", "Other")

	for id, category := range map[string]string{"kb-product": "产品资料", "kb-rule": "合规制度"} {
		if err := dao.DB.Model(&entity.Knowledgebase{}).
			Where("id = ?", id).
			Update("category", category).Error; err != nil {
			t.Fatalf("seed category %s: %v", id, err)
		}
	}
	if err := dao.DB.Model(&entity.Knowledgebase{}).
		Where("id = ?", "kb-rule").
		Update("enabled", false).Error; err != nil {
		t.Fatalf("disable kb-rule: %v", err)
	}

	old := time.Date(2026, 1, 5, 9, 30, 0, 0, time.Local)
	recent := time.Date(2026, 2, 10, 9, 30, 0, 0, time.Local)
	older := time.Date(2025, 12, 1, 9, 30, 0, 0, time.Local)
	// kb-other 也必须定日期：GORM 建行时把 create_date/update_date 写成"现在"，
	// 留着不管就会被任何「起于 2026-02-01」的条件命中，用例于是看到两行。
	for id, at := range map[string]time.Time{"kb-product": old, "kb-rule": recent, "kb-other": older} {
		if err := dao.DB.Model(&entity.Knowledgebase{}).
			Where("id = ?", id).
			Update("create_date", at).Error; err != nil {
			t.Fatalf("seed create_date %s: %v", id, err)
		}
		// update_date 必须最后写：GORM 的 BeforeUpdate 会把没出现在语句里的
		// update_date 刷成当前时间，先写会被覆盖。
		if err := dao.DB.Model(&entity.Knowledgebase{}).
			Where("id = ?", id).
			Update("update_date", at).Error; err != nil {
			t.Fatalf("seed update_date %s: %v", id, err)
		}
	}
}

func listDatasetIDs(t *testing.T, filter dao.DatasetListFilter) []string {
	t.Helper()

	data, _, code, err := testDatasetListService(t).ListDatasets(t.Context(),
		"", "", 1, 30, []dao.OrderTerm{{Column: "name"}},
		"", nil, "", "tenant-1", nil, "", filter,
	)
	if err != nil || code != common.CodeSuccess {
		t.Fatalf("ListDatasets(%+v) = (%#v, %d, %v), want success", filter, data, code, err)
	}
	ids := make([]string, 0, len(data))
	for _, item := range data {
		id, _ := item["id"].(string)
		ids = append(ids, id)
	}
	return ids
}

// 分类是多选：选中的分类之间是 IN，未选中的库不出现。
func TestDatasetServiceListDatasetsFiltersByCategory(t *testing.T) {
	db := setupDatasetUpdateTestDB(t)
	pushServiceDB(t, db)
	seedDatasetFilterFixture(t)

	ids := listDatasetIDs(t, dao.DatasetListFilter{Categories: []string{"产品资料"}})
	if len(ids) != 1 || ids[0] != "kb-product" {
		t.Fatalf("category=产品资料 → %v, want only kb-product", ids)
	}
	ids = listDatasetIDs(t, dao.DatasetListFilter{Categories: []string{"产品资料", "合规制度"}})
	if len(ids) != 2 {
		t.Fatalf("category IN (产品资料, 合规制度) → %v, want two datasets", ids)
	}
}

// 状态与分类是 AND 组合：停用的合规库在上面的分类条件里也要被筛掉。
func TestDatasetServiceListDatasetsCombinesStatusWithCategory(t *testing.T) {
	db := setupDatasetUpdateTestDB(t)
	pushServiceDB(t, db)
	seedDatasetFilterFixture(t)

	ids := listDatasetIDs(t, dao.DatasetListFilter{
		Categories: []string{"产品资料", "合规制度"},
		Enabled:    boolPtr(false),
	})
	if len(ids) != 1 || ids[0] != "kb-rule" {
		t.Fatalf("category IN (...) AND enabled=false → %v, want only kb-rule", ids)
	}
	ids = listDatasetIDs(t, dao.DatasetListFilter{Enabled: boolPtr(true)})
	if len(ids) != 2 {
		t.Fatalf("enabled=true → %v, want the two enabled datasets", ids)
	}
}

func TestDatasetServiceListDatasetsFiltersByCreateTimeRange(t *testing.T) {
	db := setupDatasetUpdateTestDB(t)
	pushServiceDB(t, db)
	seedDatasetFilterFixture(t)

	from := time.Date(2026, 2, 1, 0, 0, 0, 0, time.Local)
	to := time.Date(2026, 1, 31, 23, 59, 59, 0, time.Local)

	assertDatasetIDs(t, listDatasetIDs(t, dao.DatasetListFilter{CreateFrom: &from}), "kb-rule")
	// to 是闭区间上界：2026-01-31 23:59:59 之前建的库都算，包括去年 12 月那条。
	assertDatasetIDs(t, listDatasetIDs(t, dao.DatasetListFilter{CreateTo: &to}), "kb-product", "kb-other")
}

func TestDatasetServiceListDatasetsFiltersByUpdateTimeRange(t *testing.T) {
	db := setupDatasetUpdateTestDB(t)
	pushServiceDB(t, db)
	seedDatasetFilterFixture(t)

	from := time.Date(2026, 2, 1, 0, 0, 0, 0, time.Local)
	assertDatasetIDs(t, listDatasetIDs(t, dao.DatasetListFilter{UpdateFrom: &from}), "kb-rule")
}

// assertDatasetIDs 比较集合而非顺序：列表按名称排序，把断言绑在顺序上只会
// 让用例在无关的排序改动里变红。
func assertDatasetIDs(t *testing.T, got []string, want ...string) {
	t.Helper()

	sortedGot := append([]string(nil), got...)
	sortedWant := append([]string(nil), want...)
	sort.Strings(sortedGot)
	sort.Strings(sortedWant)
	if !slices.Equal(sortedGot, sortedWant) {
		t.Fatalf("dataset ids = %v, want %v", got, want)
	}
}

// 分类选项必须落在调用者能读到的库上，否则会泄露别人私有库的分类名。
func TestDatasetServiceListDatasetCategoriesIsPermissionScoped(t *testing.T) {
	db := setupDatasetUpdateTestDB(t)
	pushServiceDB(t, db)
	insertDatasetUpdateKB(t, "kb-own", "user-1", "Own")
	insertDatasetUpdateKB(t, "kb-foreign", "owner-1", "Foreign")
	for id, category := range map[string]string{"kb-own": "产品资料", "kb-foreign": "合规制度"} {
		if err := dao.DB.Model(&entity.Knowledgebase{}).
			Where("id = ?", id).
			Update("category", category).Error; err != nil {
			t.Fatalf("seed category %s: %v", id, err)
		}
	}

	categories, code, err := testDatasetListService(t).ListDatasetCategories(t.Context(), "user-1")
	if err != nil || code != common.CodeSuccess {
		t.Fatalf("ListDatasetCategories = (%v, %d, %v), want success", categories, code, err)
	}
	if len(categories) != 1 || categories[0] != "产品资料" {
		t.Fatalf("categories = %v, want only the caller's own category", categories)
	}
}
