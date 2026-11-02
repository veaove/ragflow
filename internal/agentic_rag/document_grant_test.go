//
//  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
//
//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.
//

package agentic_rag

import (
	"context"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"ragflow/internal/agent/runtime"
	"ragflow/internal/dao"
	"ragflow/internal/entity"
	"ragflow/internal/permission"
	"ragflow/internal/service/nav"
)

const (
	grantTenantID    = "tenant-grant"
	grantKbID        = "kb-grant"
	grantOwnerID     = "owner-grant"
	grantMemberID    = "member-grant"
	grantDeniedDoc   = "doc-denied"
	grantReadableDoc = "doc-readable"
)

// installGrantDB builds the file-level-grant fixture: a team-visible knowledge
// base holding two compiled documents, one of them explicitly denied to the
// member. It also swaps dao.DB for the in-memory database.
func installGrantDB(t *testing.T) {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{TranslateError: true})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err = db.AutoMigrate(
		&entity.Tenant{}, &entity.User{}, &entity.UserTenant{},
		&entity.Knowledgebase{}, &entity.Document{}, &entity.ResourceGrant{},
		&entity.Department{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	valid := string(entity.StatusValid)
	enabled := true
	tenantName := "t"
	if err := db.Create(&entity.Tenant{ID: grantTenantID, Name: &tenantName, Enabled: &enabled}).Error; err != nil {
		t.Fatalf("seed tenant: %v", err)
	}
	for _, uid := range []string{grantOwnerID, grantMemberID} {
		if err := db.Create(&entity.User{ID: uid, Email: uid + "@example.com"}).Error; err != nil {
			t.Fatalf("seed user %s: %v", uid, err)
		}
	}
	members := []struct{ id, user, role string }{
		{"ut-owner", grantOwnerID, string(permission.RoleOwner)},
		{"ut-member", grantMemberID, string(permission.RoleNormal)},
	}
	for _, m := range members {
		if err := db.Create(&entity.UserTenant{
			ID: m.id, UserID: m.user, TenantID: grantTenantID, Role: m.role, Status: &valid,
		}).Error; err != nil {
			t.Fatalf("seed membership %s: %v", m.id, err)
		}
	}
	// permission=team: the member already sees the whole dataset, so only a
	// file-level rule can tighten anything.
	if err := db.Create(&entity.Knowledgebase{
		ID: grantKbID, TenantID: grantTenantID, Name: "kb", CreatedBy: grantOwnerID,
		Permission: string(entity.TenantPermissionTeam), Status: &valid,
	}).Error; err != nil {
		t.Fatalf("seed kb: %v", err)
	}
	for _, id := range []string{grantDeniedDoc, grantReadableDoc} {
		name := id + ".txt"
		if err := db.Create(&entity.Document{
			ID: id, KbID: grantKbID, ParserID: "naive", ParserConfig: entity.JSONMap{},
			Type: "pdf", CreatedBy: grantOwnerID, Name: &name, Suffix: "txt",
		}).Error; err != nil {
			t.Fatalf("seed document %s: %v", id, err)
		}
	}
	if err := db.Create(&entity.ResourceGrant{
		ID: "g-deny", TenantID: grantTenantID,
		ResourceKind: string(permission.ResourceKindDocument), ResourceID: grantDeniedDoc,
		SubjectKind: entity.GrantSubjectUser, SubjectID: grantMemberID,
		Permission: "read", Effect: entity.GrantEffectDeny,
	}).Error; err != nil {
		t.Fatalf("seed grant: %v", err)
	}

	prev := dao.DB
	dao.DB = db
	t.Cleanup(func() { dao.DB = prev })
}

// ctxWithCaller carries the caller identity the chat pipeline attaches to the
// run's canvas state.
func ctxWithCaller(userID string) context.Context {
	state := runtime.NewCanvasState("", "chat-grant")
	state.Sys["user_id"] = userID
	return runtime.WithState(context.Background(), state)
}

// TestDeniedDocumentsFollowsRunCaller pins the resolution: the denied set comes
// from the run's caller, and a run without an identity is not tightened.
func TestDeniedDocumentsFollowsRunCaller(t *testing.T) {
	installGrantDB(t)

	ctx := ctxWithCaller(grantMemberID)
	if got := callerUserID(ctx); got != grantMemberID {
		t.Fatalf("callerUserID = %q, want %q", got, grantMemberID)
	}
	denied := deniedDocuments(ctx, callerUserID(ctx), []string{grantKbID})
	if !denied[grantDeniedDoc] {
		t.Error("the document denied to the caller must be in the denied set")
	}
	if denied[grantReadableDoc] {
		t.Error("a document with no explicit rule must stay readable")
	}

	anonymous := context.Background()
	if got := deniedDocuments(anonymous, callerUserID(anonymous), []string{grantKbID}); len(got) != 0 {
		t.Errorf("no caller means no tightening, got %v", got)
	}
}

// TestNavigateTreeDropsDeniedDocuments: a routed document the caller may not
// see must not surface in the nav tree result.
func TestNavigateTreeDropsDeniedDocuments(t *testing.T) {
	installGrantDB(t)
	installFakeNavService(t, fakeNavService{search: func(_ context.Context, _, _, _ string, _ []float32, _ []string, _ int) ([]nav.NavHit, error) {
		return []nav.NavHit{
			{Type: nav.TypeNavDoc, DocID: grantDeniedDoc, Name: "Hidden Summary"},
			{Type: nav.TypeNavDoc, DocID: grantReadableDoc, Name: "Readable Summary"},
		}, nil
	}})

	tool := NewNavigateTreeTool(grantTenantID, []string{grantKbID})
	out, err := tool.InvokableRun(ctxWithCaller(grantMemberID), `{"query":"anything"}`)
	if err != nil {
		t.Fatalf("InvokableRun: %v", err)
	}
	if strings.Contains(out, grantDeniedDoc) || strings.Contains(out, "Hidden Summary") {
		t.Errorf("denied document must not be routed, got:\n%s", out)
	}
	if !strings.Contains(out, `count="1"`) || !strings.Contains(out, grantReadableDoc) {
		t.Errorf("the readable document must still route, got:\n%s", out)
	}
}

// recordingStructureReader records which documents the drill actually read.
type recordingStructureReader struct {
	read []string
}

func (r *recordingStructureReader) ReadStructure(_ context.Context, _, _, docID string) ([]StructureRow, error) {
	r.read = append(r.read, docID)
	return nil, nil
}

// TestNavigateStructureSkipsDeniedDocument: the drill reads compiled rows by
// doc_id, so a denied document must be dropped before the reader is touched.
func TestNavigateStructureSkipsDeniedDocument(t *testing.T) {
	installGrantDB(t)
	reader := &recordingStructureReader{}
	installFakeStructureReader(t, reader)

	tool := NewNavigateStructureTool(grantTenantID, []string{grantKbID})
	out, err := tool.InvokableRun(ctxWithCaller(grantMemberID),
		`{"query":"q","doc_ids":["`+grantDeniedDoc+`"]}`)
	if err != nil {
		t.Fatalf("InvokableRun: %v", err)
	}
	if len(reader.read) != 0 {
		t.Errorf("denied document must not be read, read %v", reader.read)
	}
	if strings.Contains(out, grantDeniedDoc) {
		t.Errorf("denied document id must not be echoed, got:\n%s", out)
	}
}
