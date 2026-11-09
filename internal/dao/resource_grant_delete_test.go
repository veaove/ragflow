package dao

import (
	"context"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func newResourceGrantDeleteDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.Exec(`CREATE TABLE resource_grant (
		id            varchar(32) PRIMARY KEY,
		tenant_id     varchar(32),
		resource_kind varchar(16),
		resource_id   varchar(32),
		subject_kind  varchar(16),
		subject_id    varchar(32),
		permission    varchar(16),
		effect        varchar(8))`).Error; err != nil {
		t.Fatalf("create resource_grant: %v", err)
	}
	mustExec(t, db, `INSERT INTO resource_grant (id, tenant_id, resource_kind, resource_id, subject_kind, subject_id, permission, effect) VALUES
		('g-1', 't-1', 'dataset',  'kb-a',  'team', '',     'edit', 'allow'),
		('g-2', 't-1', 'dataset',  'kb-b',  'team', '',     'edit', 'allow'),
		('g-3', 't-1', 'document', 'doc-a', 'user', 'u-1',  'read', 'deny')`)
	return db
}

func grantIDs(t *testing.T, db *gorm.DB) []string {
	t.Helper()

	var ids []string
	if err := db.Raw(`SELECT id FROM resource_grant ORDER BY id`).Scan(&ids).Error; err != nil {
		t.Fatalf("read grant ids: %v", err)
	}
	return ids
}

func TestDeleteByResourcesDropsOnlyTheGivenKind(t *testing.T) {
	db := newResourceGrantDeleteDB(t)
	grants := NewResourceGrantDAO()

	if err := grants.DeleteByResources(context.Background(), db, "dataset", []string{"kb-a"}); err != nil {
		t.Fatalf("DeleteByResources: %v", err)
	}

	got := grantIDs(t, db)
	want := []string{"g-2", "g-3"}
	if len(got) != len(want) {
		t.Fatalf("remaining grants = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("remaining grants = %v, want %v", got, want)
		}
	}
}

// A delete handed an empty id list must not fall through to a table-wide wipe.
func TestDeleteByResourcesIgnoresEmptyList(t *testing.T) {
	db := newResourceGrantDeleteDB(t)
	grants := NewResourceGrantDAO()

	if err := grants.DeleteByResources(context.Background(), db, "dataset", nil); err != nil {
		t.Fatalf("DeleteByResources: %v", err)
	}
	if err := grants.DeleteByResources(context.Background(), db, "dataset", []string{}); err != nil {
		t.Fatalf("DeleteByResources: %v", err)
	}

	if got := grantIDs(t, db); len(got) != 3 {
		t.Fatalf("remaining grants = %v, want all 3 untouched", got)
	}
}
