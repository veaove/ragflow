package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"ragflow/internal/common"
	"ragflow/internal/dao"
	"ragflow/internal/entity"
)

const (
	artifactTestTenant      = "tenant-artifacts"
	artifactTestOwnerUser   = "user-owner"
	artifactTestMemberUser  = "user-member"
	artifactTestPrivateKBID = "kb-private"
	artifactTestTeamKBID    = "kb-team"
)

// setupArtifactTestDB builds the minimal schema ListArtifacts reads: the
// knowledge base rows themselves, the compile scheduling rows that decide
// whether a base has artifacts, the tenant's template kinds, and the
// membership/grant tables the read-permission predicate consults.
func setupArtifactTestDB(t *testing.T) {
	t.Helper()

	db, err := gorm.Open(sqlite.Open("file:"+url.QueryEscape(t.Name())+"?mode=memory&cache=shared"), &gorm.Config{
		TranslateError: true,
	})
	if err != nil {
		t.Fatalf("failed to open sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&entity.Knowledgebase{},
		&entity.User{},
		&entity.UserTenant{},
		&entity.Tenant{},
		&entity.ResourceGrant{},
		&entity.CompilationTemplate{},
		&entity.KnowledgeCompileDataset{},
	); err != nil {
		t.Fatalf("failed to migrate test schema: %v", err)
	}

	origDB := dao.DB
	dao.DB = db
	t.Cleanup(func() { dao.DB = origDB })

	status := string(entity.StatusValid)
	for _, member := range []struct {
		userID string
		role   string
	}{
		{artifactTestOwnerUser, "owner"},
		{artifactTestMemberUser, "normal"},
	} {
		if err = dao.DB.Create(&entity.UserTenant{
			ID:       "ut-" + member.userID,
			UserID:   member.userID,
			TenantID: artifactTestTenant,
			Role:     member.role,
			Status:   &status,
		}).Error; err != nil {
			t.Fatalf("insert membership: %v", err)
		}
	}

	if err = dao.DB.Create(&entity.CompilationTemplate{
		ID:       "tpl-wiki",
		TenantID: artifactTestStrPtr(artifactTestTenant),
		Name:     "wiki",
		Kind:     "wiki",
		Config:   entity.JSONMap{},
	}).Error; err != nil {
		t.Fatalf("insert template: %v", err)
	}

	// Both bases are compiled; only their visibility differs.
	for _, kb := range []struct {
		id         string
		name       string
		permission string
	}{
		{artifactTestPrivateKBID, "Private KB", string(entity.TenantPermissionMe)},
		{artifactTestTeamKBID, "Team KB", string(entity.TenantPermissionTeam)},
	} {
		if err = dao.DB.Create(&entity.Knowledgebase{
			ID:           kb.id,
			TenantID:     artifactTestTenant,
			Name:         kb.name,
			EmbdID:       "BAAI/bge-large-zh-v1.5@Builtin",
			CreatedBy:    artifactTestOwnerUser,
			Permission:   kb.permission,
			ParserID:     string(entity.ParserTypeNaive),
			ParserConfig: entity.JSONMap{},
			Status:       &status,
		}).Error; err != nil {
			t.Fatalf("insert kb: %v", err)
		}
		if err = dao.DB.Create(&entity.KnowledgeCompileDataset{
			DatasetID:      kb.id,
			TenantID:       artifactTestTenant,
			BacklogDocIDs:  "[]",
			InflightDocIDs: "[]",
			State:          entity.DatasetStateCompleted,
		}).Error; err != nil {
			t.Fatalf("insert compile row: %v", err)
		}
	}
}

func artifactTestStrPtr(s string) *string { return &s }

type artifactListResponse struct {
	Code int `json:"code"`
	Data struct {
		Artifacts []struct {
			Name            string `json:"name"`
			KnowledgeBaseID string `json:"knowledge_base_id"`
			Type            string `json:"type"`
		} `json:"artifacts"`
		Total int `json:"total"`
	} `json:"data"`
}

func listArtifactsAs(t *testing.T, userID string) artifactListResponse {
	t.Helper()

	return listArtifactsWith(t, NewArtifactHandler(), userID)
}

func listArtifactsWith(t *testing.T, handler *ArtifactHandler, userID string) artifactListResponse {
	t.Helper()

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/v1/overview/artifacts", func(c *gin.Context) {
		c.Set("user", &entity.User{ID: userID})
		c.Request.Header.Set(TenantHeader, artifactTestTenant)
		handler.ListArtifacts(c)
	})

	resp := httptest.NewRecorder()
	r.ServeHTTP(resp, httptest.NewRequest(http.MethodGet, "/api/v1/overview/artifacts", nil))
	if resp.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", resp.Code, resp.Body.String())
	}

	var body artifactListResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v body=%s", err, resp.Body.String())
	}
	if body.Code != int(common.CodeSuccess) {
		t.Fatalf("code=%d body=%s", body.Code, resp.Body.String())
	}
	return body
}

// A member must not learn that a private knowledge base exists: neither its
// name nor its artifact count may leak through the cross-base overview list.
func TestListArtifactsHidesKnowledgeBasesTheUserCannotRead(t *testing.T) {
	setupArtifactTestDB(t)

	body := listArtifactsAs(t, artifactTestMemberUser)

	if body.Data.Total != 1 || len(body.Data.Artifacts) != 1 {
		t.Fatalf("member should only see the team base, got total=%d items=%d", body.Data.Total, len(body.Data.Artifacts))
	}
	if got := body.Data.Artifacts[0].KnowledgeBaseID; got != artifactTestTeamKBID {
		t.Fatalf("member saw %q, want %q", got, artifactTestTeamKBID)
	}
	for _, item := range body.Data.Artifacts {
		if item.Name == "Private KB" {
			t.Fatalf("private base name leaked to a member: %#v", item)
		}
	}
}

// The tenant owner keeps the full view, so the filter must not be a blanket
// denial: the same request returns both bases.
func TestListArtifactsKeepsEveryKnowledgeBaseForTheTenantOwner(t *testing.T) {
	setupArtifactTestDB(t)

	body := listArtifactsAs(t, artifactTestOwnerUser)

	if body.Data.Total != 2 {
		t.Fatalf("owner should see both bases, got total=%d items=%#v", body.Data.Total, body.Data.Artifacts)
	}
	seen := map[string]bool{}
	for _, item := range body.Data.Artifacts {
		seen[item.KnowledgeBaseID] = true
	}
	for _, want := range []string{artifactTestPrivateKBID, artifactTestTeamKBID} {
		if !seen[want] {
			t.Fatalf("owner is missing %q in %#v", want, seen)
		}
	}
}

// fakeArtifactPresence answers the per-(dataset, type) existence probe without a
// document engine.
type fakeArtifactPresence struct {
	present map[string]bool
	err     error
}

func (f fakeArtifactPresence) HasArtifact(_ context.Context, _ string, datasetID, artifactType string) (bool, error) {
	if f.err != nil {
		return false, f.err
	}
	return f.present[datasetID+":"+artifactType], nil
}

// seedArtifactTestTemplateKinds makes the tenant look like a deployment that
// configured every compilation template kind.
func seedArtifactTestTemplateKinds(t *testing.T) {
	t.Helper()
	for i, kind := range []string{"tree", "page_index", "graph", "mind_map", "timeline"} {
		if err := dao.DB.Create(&entity.CompilationTemplate{
			ID:       fmt.Sprintf("tpl-%d", i),
			TenantID: artifactTestStrPtr(artifactTestTenant),
			Name:     kind,
			Kind:     kind,
			Config:   entity.JSONMap{},
		}).Error; err != nil {
			t.Fatalf("insert %s template: %v", kind, err)
		}
	}
}

// A base compiled only as a graph must not advertise wiki / tree / mindmap /
// timeline cards: those views open empty because nothing was ever produced for
// them. The list is per (dataset, kind), not per dataset.
func TestListArtifactsDropsArtifactTypesTheDatasetNeverProduced(t *testing.T) {
	setupArtifactTestDB(t)
	seedArtifactTestTemplateKinds(t)

	handler := &ArtifactHandler{presence: fakeArtifactPresence{present: map[string]bool{
		artifactTestTeamKBID + ":graph": true,
	}}}
	body := listArtifactsWith(t, handler, artifactTestOwnerUser)

	if body.Data.Total != 1 || len(body.Data.Artifacts) != 1 {
		t.Fatalf("want only the produced graph artifact, got total=%d items=%#v", body.Data.Total, body.Data.Artifacts)
	}
	item := body.Data.Artifacts[0]
	if item.KnowledgeBaseID != artifactTestTeamKBID || item.Type != "graph" {
		t.Fatalf("unexpected artifact %#v", item)
	}
}

// A probe failure must degrade to the previous behaviour (list what the tenant
// configured) instead of blanking the overview.
func TestListArtifactsKeepsConfiguredTypesWhenTheProbeFails(t *testing.T) {
	setupArtifactTestDB(t)
	seedArtifactTestTemplateKinds(t)

	handler := &ArtifactHandler{presence: fakeArtifactPresence{err: fmt.Errorf("document engine is not initialized")}}
	body := listArtifactsWith(t, handler, artifactTestOwnerUser)

	// wiki, tree (tree+page_index collapse), graph, mindmap, timeline for 2 bases.
	if body.Data.Total != 10 {
		t.Fatalf("probe failure should keep every configured type, got total=%d", body.Data.Total)
	}
}
