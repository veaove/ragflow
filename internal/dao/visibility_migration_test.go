package dao

import (
	"context"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

// newLegacyVisibilityDB builds the five tables that carry a visibility column.
// Only id + the visibility column are declared: the migration touches nothing
// else, so the test does not need the full schema of any of them.
func newLegacyVisibilityDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	for _, ddl := range []string{
		`CREATE TABLE knowledgebase (id varchar(32) PRIMARY KEY, permission varchar(16))`,
		`CREATE TABLE user_canvas (id varchar(32) PRIMARY KEY, permission varchar(16))`,
		`CREATE TABLE dialog (id varchar(32) PRIMARY KEY, permission varchar(16))`,
		`CREATE TABLE search (id varchar(32) PRIMARY KEY, permission varchar(16))`,
		`CREATE TABLE memory (id varchar(32) PRIMARY KEY, permissions varchar(16))`,
	} {
		if err := db.Exec(ddl).Error; err != nil {
			t.Fatalf("create table: %v", err)
		}
	}
	return db
}

func legacyVisibility(t *testing.T, db *gorm.DB, table, column, id string) string {
	t.Helper()

	var value string
	if err := db.Raw(`SELECT `+column+` FROM `+table+` WHERE id = ?`, id).Scan(&value).Error; err != nil {
		t.Fatalf("read %s.%s of %q: %v", table, column, id, err)
	}
	return value
}

func TestMigrateLegacyVisibilityValuesNormalizesEveryTable(t *testing.T) {
	db := newLegacyVisibilityDB(t)

	mustExec(t, db, `INSERT INTO knowledgebase (id, permission) VALUES
		('kb-me', 'me'), ('kb-team', 'team'), ('kb-owner', 'owner'),
		('kb-tenant-owner', 'tenant_owner'), ('kb-private', 'PRIVATE ')`)
	mustExec(t, db, `INSERT INTO user_canvas (id, permission) VALUES ('canvas-me', 'me')`)
	mustExec(t, db, `INSERT INTO dialog (id, permission) VALUES ('chat-team', 'team')`)
	mustExec(t, db, `INSERT INTO search (id, permission) VALUES ('search-empty', '')`)
	mustExec(t, db, `INSERT INTO memory (id, permissions) VALUES ('memory-team', 'team')`)

	if err := migrateLegacyVisibilityValues(context.Background(), db); err != nil {
		t.Fatalf("migrateLegacyVisibilityValues: %v", err)
	}

	cases := []struct{ table, column, id, want string }{
		{"knowledgebase", "permission", "kb-me", "owner"},
		{"knowledgebase", "permission", "kb-team", "tenant_owner"},
		{"knowledgebase", "permission", "kb-owner", "owner"},
		{"knowledgebase", "permission", "kb-tenant-owner", "tenant_owner"},
		{"knowledgebase", "permission", "kb-private", "owner"},
		{"user_canvas", "permission", "canvas-me", "owner"},
		{"dialog", "permission", "chat-team", "tenant_owner"},
		{"search", "permission", "search-empty", "owner"},
		{"memory", "permissions", "memory-team", "tenant_owner"},
	}
	for _, tc := range cases {
		if got := legacyVisibility(t, db, tc.table, tc.column, tc.id); got != tc.want {
			t.Errorf("%s.%s %q = %q, want %q", tc.table, tc.column, tc.id, got, tc.want)
		}
	}

	// The migration runs on every start, so a second pass must not rewrite rows.
	if err := migrateLegacyVisibilityValues(context.Background(), db); err != nil {
		t.Fatalf("second migrateLegacyVisibilityValues: %v", err)
	}
	for _, tc := range cases {
		if got := legacyVisibility(t, db, tc.table, tc.column, tc.id); got != tc.want {
			t.Errorf("second pass %s.%s %q = %q, want %q", tc.table, tc.column, tc.id, got, tc.want)
		}
	}
}

// A missing table must not fail the boot path: unit tests and partial schemas
// call the same function through autoMigrateRuntimeModels.
func TestMigrateLegacyVisibilityValuesSkipsMissingTables(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := migrateLegacyVisibilityValues(context.Background(), db); err != nil {
		t.Fatalf("migrateLegacyVisibilityValues on empty schema: %v", err)
	}
}
