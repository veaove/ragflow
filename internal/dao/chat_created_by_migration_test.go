package dao

import (
	"context"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

// newChatCreatedByMigrationDB builds only the tables the chat backfill reads or
// writes. The DDL is spelled out so the test does not depend on the full dialog
// schema: created_by is the only column the backfill selects or updates.
func newChatCreatedByMigrationDB(t *testing.T) *gorm.DB {
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
		`CREATE TABLE dialog (
			id         varchar(32) PRIMARY KEY,
			tenant_id  varchar(32),
			created_by varchar(32),
			name       varchar(255))`,
	} {
		if err := db.Exec(ddl).Error; err != nil {
			t.Fatalf("create table: %v", err)
		}
	}
	return db
}

// dialogCreatedBy reads back created_by, treating NULL and the empty string alike.
func dialogCreatedBy(t *testing.T, db *gorm.DB, id string) string {
	t.Helper()
	var row struct{ CreatedBy *string }
	if err := db.Raw(`SELECT created_by FROM dialog WHERE id = ?`, id).Scan(&row).Error; err != nil {
		t.Fatalf("read created_by of %q: %v", id, err)
	}
	if row.CreatedBy == nil {
		return ""
	}
	return *row.CreatedBy
}

func TestMigrateChatCreatedByAttributesLegacyAndTenantRows(t *testing.T) {
	db := newChatCreatedByMigrationDB(t)

	mustExec(t, db, `INSERT INTO user (id) VALUES ('user-1'), ('user-2')`)
	// The member is inserted before the owner, so ordering has to come from
	// role/create_time rather than from row order.
	mustExec(t, db, `INSERT INTO user_tenant (id, user_id, tenant_id, role, status, create_time) VALUES
		('ut-member', 'user-2', 'tenant-1', 'normal', '1', 200),
		('ut-owner',  'user-1', 'tenant-1', 'owner',  '1', 100)`)
	mustExec(t, db, `INSERT INTO dialog (id, tenant_id, created_by, name) VALUES
		('legacy',       'user-1',   NULL,      'old chat'),
		('tenant-owned', 'tenant-1', NULL,      'team chat'),
		('already-set',  'tenant-1', 'user-2',  'named chat'),
		('orphan',       'tenant-9', NULL,      'orphan chat')`)

	if err := migrateChatCreatedBy(context.Background(), db); err != nil {
		t.Fatalf("migrateChatCreatedBy: %v", err)
	}

	cases := []struct{ id, want, why string }{
		{"legacy", "user-1", "tenant_id still holds the creator's user id"},
		{"tenant-owned", "user-1", "a tenant row is credited to the owner, not to the first member"},
		{"already-set", "user-2", "an existing created_by is never overwritten"},
		{"orphan", "", "a tenant with no owner membership stays empty so readers fall back"},
	}
	for _, tc := range cases {
		if got := dialogCreatedBy(t, db, tc.id); got != tc.want {
			t.Errorf("%s: created_by = %q, want %q (%s)", tc.id, got, tc.want, tc.why)
		}
	}

	// A second start must be a no-op: the backfill is registered on every boot.
	if err := migrateChatCreatedBy(context.Background(), db); err != nil {
		t.Fatalf("second migrateChatCreatedBy: %v", err)
	}
	for _, tc := range cases {
		if got := dialogCreatedBy(t, db, tc.id); got != tc.want {
			t.Errorf("second pass %s: created_by = %q, want %q", tc.id, got, tc.want)
		}
	}

	// tenant_id names the owning tenant and scopes the chat, so it must survive.
	var tenantID string
	if err := db.Raw(`SELECT tenant_id FROM dialog WHERE id = 'tenant-owned'`).Scan(&tenantID).Error; err != nil {
		t.Fatalf("read tenant_id: %v", err)
	}
	if tenantID != "tenant-1" {
		t.Errorf("tenant_id = %q, want tenant-1: the migration must not rewrite it", tenantID)
	}
}
