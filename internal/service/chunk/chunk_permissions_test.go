package chunk

import (
	"errors"
	"testing"

	"ragflow/internal/dao"
	"ragflow/internal/entity"
	"ragflow/internal/permission"
	permissionresponse "ragflow/internal/permission/response"
	"ragflow/internal/service"
)

func TestRetrievalTestChecksDatasetUsePermission(t *testing.T) {
	db := setupChunkTestDB(t)
	pushChunkTestDB(t, db)
	insertChunkTestKB(t, "kb-1", "owner")
	if err := db.Model(&entity.Knowledgebase{}).Where("id = ?", "kb-1").
		Update("permission", string(entity.TenantPermissionMe)).Error; err != nil {
		t.Fatalf("set dataset private: %v", err)
	}

	_, err := (&ChunkService{kbDAO: dao.NewKnowledgebaseDAO()}).RetrievalTest(t.Context(), &service.RetrievalTestRequest{
		Question: "query",
		Datasets: []string{"kb-1"},
	}, "outsider")
	if !permissionresponse.IsPermissionError(err) || !errors.Is(err, permission.ErrPermissionDenied) {
		t.Fatalf("RetrievalTest() error = %v, want permission denial", err)
	}
}

func TestChunkManagementDatasetPermissions(t *testing.T) {
	for _, tt := range []struct {
		name        string
		userID      string
		permission  entity.TenantPermission
		grantMember bool
		allowed     bool
	}{
		{"owner private", "owner", entity.TenantPermissionMe, false, true},
		// permission=me 只对创建者放行，resource_grant 是它唯一的例外，所以
		// 这一档必须在不给成员授权的前提下验证。
		{"member private", "member", entity.TenantPermissionMe, false, false},
		{"member team", "member", entity.TenantPermissionTeam, true, true},
		{"unrelated team", "other", entity.TenantPermissionTeam, false, false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			db := setupChunkTestDB(t)
			pushChunkTestDB(t, db)
			insertChunkTestUserTenant(t, "member", "owner")
			insertChunkTestKBWithoutGrant(t, "kb-1", "owner")
			if tt.grantMember {
				grantChunkTestKBToUser(t, "kb-1", "owner", "member")
			}
			insertChunkTestDoc(t, "doc-1", "kb-1")
			if err := db.Model(&entity.Knowledgebase{}).Where("id = ?", "kb-1").
				Update("permission", string(tt.permission)).Error; err != nil {
				t.Fatalf("set KB permission: %v", err)
			}

			ctx := t.Context()
			for _, op := range []struct {
				name string
				run  func(*ChunkService) error
			}{
				{"get", func(s *ChunkService) error {
					s.docEngine = &getChunkTestEngine{chunk: map[string]interface{}{
						"id": "chunk-1", "doc_id": "doc-1", "content_with_weight": "body",
					}}
					_, err := s.Get(ctx, &service.GetChunkRequest{
						DatasetID: "kb-1", DocumentID: "doc-1", ChunkID: "chunk-1",
					}, tt.userID)
					return err
				}},
				{"list", func(s *ChunkService) error {
					s.docEngine = &listChunksSearchEngine{}
					_, err := s.List(ctx, &service.ListChunksRequest{DatasetID: "kb-1", DocID: "doc-1"}, tt.userID)
					return err
				}},
				{"switch", func(s *ChunkService) error {
					s.docEngine = &updateChunkTestEngine{}
					return s.SwitchChunks(ctx, tt.userID, "kb-1", "doc-1", 0, []string{"chunk-1"})
				}},
				{"update", func(s *ChunkService) error {
					s.docEngine = &updateChunkTestEngine{existingChunk: map[string]interface{}{
						"id": "chunk-1", "doc_id": "doc-1", "content_with_weight": "body",
					}}
					return s.UpdateChunk(ctx, &service.UpdateChunkRequest{
						DatasetID: "kb-1", DocumentID: "doc-1", ChunkID: "chunk-1",
					}, tt.userID)
				}},
				{"remove", func(s *ChunkService) error {
					s.docEngine = &parseTestDocEngine{}
					_, err := s.RemoveChunks(ctx, &service.RemoveChunksRequest{DatasetID: "kb-1", DocID: "doc-1", DeleteAll: true}, tt.userID)
					return err
				}},
			} {
				t.Run(op.name, func(t *testing.T) {
					svc := &ChunkService{
						kbDAO:             dao.NewKnowledgebaseDAO(),
						documentDAO:       dao.NewDocumentDAO(),
						markWikiDirtyFunc: func(string, string, string, []string) {},
					}
					err := op.run(svc)
					if tt.allowed {
						if err != nil {
							t.Fatalf("authorized operation failed: %v", err)
						}
					} else if !permissionresponse.IsPermissionError(err) {
						t.Fatalf("unauthorized operation error = %v, want access denied", err)
					}
				})
			}
		})
	}
}
