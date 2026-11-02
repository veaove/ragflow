package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"ragflow/internal/common"
	"ragflow/internal/dao"
	"ragflow/internal/entity"
	dataset "ragflow/internal/service/dataset"
)

const (
	listDatasetsTestKBID       = "123e4567e89b12d3a456426614174000"
	listDatasetsTestKBIDDashed = "123e4567-e89b-12d3-a456-426614174000"
	listDatasetsMissingKBID    = "223e4567e89b12d3a456426614174000"
)

func setupListDatasetsTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open("file:"+url.QueryEscape(t.Name())+"?mode=memory&cache=shared"), &gorm.Config{
		TranslateError: true,
	})
	if err != nil {
		t.Fatalf("failed to open sqlite: %v", err)
	}

	// ResourceGrant 也要建：知识库列表的权限过滤 SQL 里有一层
	// resource_grant 子查询，缺表会让整个列表查询报 no such table。
	if err := db.AutoMigrate(&entity.Knowledgebase{}, &entity.User{}, &entity.UserTenant{}, &entity.Tenant{}, &entity.ResourceGrant{}); err != nil {
		t.Fatalf("failed to migrate test schema: %v", err)
	}

	origDB := dao.DB
	dao.DB = db
	t.Cleanup(func() { dao.DB = origDB })

	return db
}

func insertListDatasetsTestKB(t *testing.T, id, tenantID, name string) {
	t.Helper()

	status := string(entity.StatusValid)
	if err := dao.DB.Where("user_id = ? AND tenant_id = ?", tenantID, tenantID).FirstOrCreate(&entity.UserTenant{
		ID:       "ut-" + tenantID,
		UserID:   tenantID,
		TenantID: tenantID,
		Role:     "owner",
		Status:   &status,
	}).Error; err != nil {
		t.Fatalf("insert tenant owner: %v", err)
	}
	kb := &entity.Knowledgebase{
		ID:           id,
		TenantID:     tenantID,
		Name:         name,
		EmbdID:       "BAAI/bge-large-zh-v1.5@Builtin",
		CreatedBy:    tenantID,
		Permission:   string(entity.TenantPermissionMe),
		ParserID:     string(entity.ParserTypeNaive),
		ParserConfig: entity.JSONMap{"chunk_token_num": float64(128)},
		Status:       &status,
	}
	if err := dao.DB.Create(kb).Error; err != nil {
		t.Fatalf("insert test kb: %v", err)
	}
}

func newListDatasetsTestRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	h := NewDatasetsHandler(dataset.NewDatasetService(), nil)
	r := gin.New()
	r.GET("/api/v1/datasets", func(c *gin.Context) {
		c.Set("user", &entity.User{ID: "user-1"})
		h.ListDatasets(c)
	})
	return r
}

type listDatasetsTestResponse struct {
	Code          int                      `json:"code"`
	Data          []map[string]interface{} `json:"data"`
	Message       string                   `json:"message"`
	TotalDatasets int64                    `json:"total_datasets"`
}

func getListDatasets(t *testing.T, r *gin.Engine, rawQuery string) listDatasetsTestResponse {
	t.Helper()

	resp := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/datasets?"+rawQuery, nil)
	r.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", resp.Code, resp.Body.String())
	}

	var body listDatasetsTestResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal response: %v body=%s", err, resp.Body.String())
	}
	return body
}

func TestDatasetsHandlerListDatasetsFiltersByIDs(t *testing.T) {
	setupListDatasetsTestDB(t)
	insertListDatasetsTestKB(t, listDatasetsTestKBID, "user-1", "Alpha")

	body := getListDatasets(t, newListDatasetsTestRouter(),
		fmt.Sprintf("ids=%s&page_size=1", listDatasetsTestKBIDDashed))

	if body.Code != int(common.CodeSuccess) {
		t.Fatalf("code=%d message=%q", body.Code, body.Message)
	}
	if body.TotalDatasets != 1 || len(body.Data) != 1 {
		t.Fatalf("expected exactly one dataset, got total=%d len=%d", body.TotalDatasets, len(body.Data))
	}
	if body.Data[0]["id"] != listDatasetsTestKBID {
		t.Fatalf("expected dataset id %q, got %#v", listDatasetsTestKBID, body.Data[0]["id"])
	}
}

func TestDatasetsHandlerListDatasetsFiltersMissingIDs(t *testing.T) {
	setupListDatasetsTestDB(t)
	insertListDatasetsTestKB(t, listDatasetsTestKBID, "user-1", "Alpha")

	body := getListDatasets(t, newListDatasetsTestRouter(),
		fmt.Sprintf("ids=%s,%s&page_size=2", listDatasetsTestKBID, listDatasetsMissingKBID))

	if body.Code != int(common.CodeSuccess) {
		t.Fatalf("code=%d message=%q", body.Code, body.Message)
	}
	if body.TotalDatasets != 1 || len(body.Data) != 1 {
		t.Fatalf("expected exactly one dataset, got total=%d len=%d", body.TotalDatasets, len(body.Data))
	}
	if body.Data[0]["id"] != listDatasetsTestKBID {
		t.Fatalf("expected dataset id %q, got %#v", listDatasetsTestKBID, body.Data[0]["id"])
	}
}

func TestDatasetsHandlerListDatasetsRejectsInvalidIDInIDs(t *testing.T) {
	setupListDatasetsTestDB(t)

	body := getListDatasets(t, newListDatasetsTestRouter(), "ids=not-a-uuid")

	if body.Code != int(common.CodeArgumentError) {
		t.Fatalf("code=%d want=%d", body.Code, common.CodeArgumentError)
	}
	if body.Message != "Invalid UUID format" {
		t.Fatalf("message=%q want=%q", body.Message, "Invalid UUID format")
	}
}

func TestDatasetsHandlerListDatasetsRejectsDuplicateIDs(t *testing.T) {
	setupListDatasetsTestDB(t)

	rawQuery := fmt.Sprintf("ids=%s,%s", listDatasetsTestKBIDDashed, listDatasetsTestKBIDDashed)
	body := getListDatasets(t, newListDatasetsTestRouter(), rawQuery)

	if body.Code != int(common.CodeArgumentError) {
		t.Fatalf("code=%d want=%d", body.Code, common.CodeArgumentError)
	}
	expected := fmt.Sprintf("Duplicate ids: '%s'", listDatasetsTestKBID)
	if body.Message != expected {
		t.Fatalf("message=%q want=%q", body.Message, expected)
	}
}

// `sort` is a query key like any other on this endpoint, and the key gate runs
// before the ordering is read, so the gate has to know the name.
func TestDatasetsHandlerListDatasetsAcceptsSort(t *testing.T) {
	setupListDatasetsTestDB(t)
	insertListDatasetsTestKB(t, listDatasetsTestKBID, "user-1", "Alpha")

	body := getListDatasets(t, newListDatasetsTestRouter(), "sort=update_time:asc")

	if body.Code != int(common.CodeSuccess) {
		t.Fatalf("code=%d message=%q", body.Code, body.Message)
	}
	if body.TotalDatasets != 1 {
		t.Fatalf("expected the dataset to be listed, got total=%d", body.TotalDatasets)
	}
}

// The category and status filters are part of the querystring contract, so the
// key gate and the coercions have to agree with them before the service runs.
func TestDatasetsHandlerListDatasetsRejectsInvalidFilters(t *testing.T) {
	cases := []struct {
		name     string
		rawQuery string
		wantMsg  string
	}{
		{
			name:     "an unparseable enabled is rejected",
			rawQuery: "enabled=maybe",
			wantMsg:  "Input should be a valid boolean, unable to interpret input",
		},
		{
			name:     "an unparseable time bound is rejected",
			rawQuery: "create_time_from=2026-13-01",
			wantMsg:  `create_time_from is invalid: expected YYYY-MM-DD, YYYY-MM-DD HH:mm or YYYY-MM-DD HH:mm:ss, got "2026-13-01"`,
		},
		{
			name:     "an inverted range is rejected",
			rawQuery: "update_time_from=2026-02-01&update_time_to=2026-01-01",
			wantMsg:  "update_time_from must not be after update_time_to",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			setupListDatasetsTestDB(t)

			body := getListDatasets(t, newListDatasetsTestRouter(), tc.rawQuery)

			if body.Code != int(common.CodeArgumentError) {
				t.Fatalf("code=%d want=%d message=%q", body.Code, common.CodeArgumentError, body.Message)
			}
			if body.Message != tc.wantMsg {
				t.Fatalf("message=%q want=%q", body.Message, tc.wantMsg)
			}
		})
	}
}

func TestDatasetsHandlerListDatasetsFiltersByCategoryAndStatus(t *testing.T) {
	const betaKBID = "323e4567e89b12d3a456426614174000"
	setupListDatasetsTestDB(t)
	insertListDatasetsTestKB(t, listDatasetsTestKBID, "user-1", "Alpha")
	insertListDatasetsTestKB(t, betaKBID, "user-1", "Beta")
	if err := dao.DB.Model(&entity.Knowledgebase{}).
		Where("id = ?", listDatasetsTestKBID).
		Update("category", "产品资料").Error; err != nil {
		t.Fatalf("seed category: %v", err)
	}

	router := newListDatasetsTestRouter()
	body := getListDatasets(t, router, "category="+url.QueryEscape("产品资料"))
	if body.Code != int(common.CodeSuccess) {
		t.Fatalf("code=%d message=%q", body.Code, body.Message)
	}
	if body.TotalDatasets != 1 || len(body.Data) != 1 || body.Data[0]["id"] != listDatasetsTestKBID {
		t.Fatalf("category filter = %#v (total=%d), want only the categorized dataset", body.Data, body.TotalDatasets)
	}

	// Multi-select: a comma separated list behaves like repeated parameters.
	body = getListDatasets(t, router, "category="+url.QueryEscape("产品资料,合规制度"))
	if body.TotalDatasets != 1 {
		t.Fatalf("multi-category filter total=%d, want 1", body.TotalDatasets)
	}

	if err := dao.DB.Model(&entity.Knowledgebase{}).
		Where("id = ?", listDatasetsTestKBID).
		Update("enabled", false).Error; err != nil {
		t.Fatalf("disable dataset: %v", err)
	}
	body = getListDatasets(t, router, "enabled=false")
	if body.TotalDatasets != 1 || body.Data[0]["id"] != listDatasetsTestKBID {
		t.Fatalf("enabled=false = %#v (total=%d)", body.Data, body.TotalDatasets)
	}
	// Dimensions combine with AND: a disabled dataset does not match enabled=true.
	body = getListDatasets(t, router, "category="+url.QueryEscape("产品资料")+"&enabled=true")
	if body.TotalDatasets != 0 || len(body.Data) != 0 {
		t.Fatalf("category + enabled=true = %#v (total=%d), want no rows", body.Data, body.TotalDatasets)
	}
}

// A date-only upper bound covers the whole day: 2026-01-31 has to include a row
// created at 18:00 that day, otherwise range filtering silently drops today.
func TestDatasetsHandlerListDatasetsCreateTimeRangeCoversWholeDay(t *testing.T) {
	setupListDatasetsTestDB(t)
	insertListDatasetsTestKB(t, listDatasetsTestKBID, "user-1", "Alpha")
	createdAt := time.Date(2026, 1, 31, 18, 0, 0, 0, time.Local)
	if err := dao.DB.Model(&entity.Knowledgebase{}).
		Where("id = ?", listDatasetsTestKBID).
		Update("create_date", createdAt).Error; err != nil {
		t.Fatalf("seed create_date: %v", err)
	}

	router := newListDatasetsTestRouter()
	body := getListDatasets(t, router, "create_time_from=2026-01-31&create_time_to=2026-01-31")
	if body.TotalDatasets != 1 {
		t.Fatalf("same-day range total=%d, want 1", body.TotalDatasets)
	}

	body = getListDatasets(t, router, "create_time_from=2026-02-01")
	if body.TotalDatasets != 0 {
		t.Fatalf("create_time_from=2026-02-01 total=%d, want 0", body.TotalDatasets)
	}
}

// A request `sort` can order is not rejected for the spelling of an `orderby` or
// `desc` that will not be read, while the same values without `sort` still are.
func TestDatasetsHandlerListDatasetsLegacyOrderingValidation(t *testing.T) {
	cases := []struct {
		name     string
		rawQuery string
		wantCode common.ErrorCode
		wantMsg  string
	}{
		{
			name:     "an unrecognised orderby alone is rejected",
			rawQuery: "orderby=nonsense",
			wantCode: common.CodeArgumentError,
			wantMsg:  "Input should be 'create_time' or 'update_time'",
		},
		{
			name:     "an unparseable desc alone is rejected",
			rawQuery: "desc=maybe",
			wantCode: common.CodeArgumentError,
			wantMsg:  "Input should be a valid boolean, unable to interpret input",
		},
		{
			name:     "sort carries an unrecognised orderby",
			rawQuery: "sort=update_time:asc&orderby=nonsense",
			wantCode: common.CodeSuccess,
		},
		{
			name:     "sort carries an unparseable desc",
			rawQuery: "sort=update_time:asc&desc=maybe",
			wantCode: common.CodeSuccess,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			setupListDatasetsTestDB(t)
			insertListDatasetsTestKB(t, listDatasetsTestKBID, "user-1", "Alpha")

			body := getListDatasets(t, newListDatasetsTestRouter(), tc.rawQuery)

			if body.Code != int(tc.wantCode) {
				t.Fatalf("code=%d want=%d message=%q", body.Code, tc.wantCode, body.Message)
			}
			if tc.wantMsg != "" && body.Message != tc.wantMsg {
				t.Fatalf("message=%q want=%q", body.Message, tc.wantMsg)
			}
		})
	}
}
