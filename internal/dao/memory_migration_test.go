package dao

import (
	"context"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

// newMemoryMigrationDB builds the three tables the memory migrations touch.
// The DDL is spelled out instead of taken from AutoMigrate so the test stays
// readable: only the columns the backfills actually read or write exist.
func newMemoryMigrationDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	for _, ddl := range []string{
		`CREATE TABLE user (id varchar(32) PRIMARY KEY)`,
		`CREATE TABLE user_tenant (
			id          varchar(32) PRIMARY KEY,
			user_id     varchar(32),
			tenant_id   varchar(32),
			role        varchar(32),
			status      varchar(1),
			create_time bigint)`,
		`CREATE TABLE memory (
			id          varchar(32) PRIMARY KEY,
			tenant_id   varchar(32),
			created_by  varchar(32),
			memory_type bigint)`,
	} {
		if err := db.Exec(ddl).Error; err != nil {
			t.Fatalf("create table: %v", err)
		}
	}
	return db
}

func mustExec(t *testing.T, db *gorm.DB, sql string) {
	t.Helper()
	if err := db.Exec(sql).Error; err != nil {
		t.Fatalf("exec %q: %v", sql, err)
	}
}

// memoryCreatedBy reads back created_by, treating NULL and the empty string alike.
func memoryCreatedBy(t *testing.T, db *gorm.DB, id string) string {
	t.Helper()
	var row struct{ CreatedBy *string }
	if err := db.Raw(`SELECT created_by FROM memory WHERE id = ?`, id).Scan(&row).Error; err != nil {
		t.Fatalf("read created_by of %q: %v", id, err)
	}
	if row.CreatedBy == nil {
		return ""
	}
	return *row.CreatedBy
}

func TestMigrateMemoryCreatedByAttributesLegacyAndTenantRows(t *testing.T) {
	db := newMemoryMigrationDB(t)

	mustExec(t, db, `INSERT INTO user (id) VALUES ('user-1')`)
	// tenant-1 is a real tenant with a normal member added after the owner, so
	// the ordering rule matters: the owner must win regardless of insert order.
	mustExec(t, db, `INSERT INTO user_tenant (id, user_id, tenant_id, role, status, create_time) VALUES
		('ut-member', 'user-2', 'tenant-1', 'normal', '1', 200),
		('ut-owner',  'user-1', 'tenant-1', 'owner',  '1', 100)`)
	mustExec(t, db, `INSERT INTO memory (id, tenant_id, created_by, memory_type) VALUES
		('legacy',       'user-1',   NULL,     1),
		('tenant-owned', 'tenant-1', NULL,     1),
		('already-set',  'tenant-1', 'user-2', 1),
		('orphan',       'tenant-9', NULL,     1)`)

	if err := migrateMemoryCreatedBy(context.Background(), db); err != nil {
		t.Fatalf("migrateMemoryCreatedBy: %v", err)
	}

	cases := []struct{ id, want, why string }{
		{"legacy", "user-1", "tenant_id still holds the creator's user id"},
		{"tenant-owned", "user-1", "tenant row is credited to the tenant owner, not the first member"},
		{"already-set", "user-2", "an existing created_by is never overwritten"},
		{"orphan", "", "a tenant with no owner membership stays empty so readers fall back"},
	}
	for _, tc := range cases {
		if got := memoryCreatedBy(t, db, tc.id); got != tc.want {
			t.Errorf("%s: created_by = %q, want %q (%s)", tc.id, got, tc.want, tc.why)
		}
	}

	// tenant_id decides the vector index and model scope, so it must survive.
	var tenantID string
	if err := db.Raw(`SELECT tenant_id FROM memory WHERE id = 'tenant-owned'`).Scan(&tenantID).Error; err != nil {
		t.Fatalf("read tenant_id: %v", err)
	}
	if tenantID != "tenant-1" {
		t.Errorf("tenant_id = %q, want tenant-1: the migration must not move the index", tenantID)
	}
}

func TestMigrateMemoryRawTypeAddsRawBit(t *testing.T) {
	db := newMemoryMigrationDB(t)

	mustExec(t, db, `INSERT INTO memory (id, tenant_id, created_by, memory_type) VALUES
		('semantic-only', 't', 'u', 14),
		('has-raw',       't', 'u', 15),
		('zero',          't', 'u', 0)`)

	for pass := 1; pass <= 2; pass++ {
		if err := migrateMemoryRawType(context.Background(), db); err != nil {
			t.Fatalf("pass %d: migrateMemoryRawType: %v", pass, err)
		}
		cases := []struct {
			id   string
			want int64
		}{
			{"semantic-only", 15},
			{"has-raw", 15},
			{"zero", 1},
		}
		for _, tc := range cases {
			var got int64
			if err := db.Raw(`SELECT memory_type FROM memory WHERE id = ?`, tc.id).Scan(&got).Error; err != nil {
				t.Fatalf("read memory_type of %q: %v", tc.id, err)
			}
			if got != tc.want {
				t.Errorf("pass %d: %s memory_type = %d, want %d", pass, tc.id, got, tc.want)
			}
		}
	}
}
