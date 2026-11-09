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

// Package testdb builds the in-memory SQLite fixtures shared by handler,
// service, and permission tests. It only gets linked into test binaries, so it
// may import the sqlite driver without pulling it into the server build.
package testdb

import (
	"net/url"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"ragflow/internal/dao"
	"ragflow/internal/entity"
)

// permissionModels are migrated for every fixture. Any code path that calls
// CheckDatasetAccess / CheckResource reads resource_grant, so a fixture without
// it fails with "no such table: resource_grant" instead of exercising the
// behaviour under test. Keeping the list here makes that omission impossible:
// callers list their own tables and inherit the permission ones.
var permissionModels = []interface{}{&entity.ResourceGrant{}}

// New opens a test-private in-memory SQLite database, migrates models plus the
// permission tables, and points dao.DB at it for the rest of the test.
//
// The pool is pinned to a single connection: with ":memory:" every pooled
// connection is its own empty database, so DDL running on one connection is
// invisible to the next one and queries fail intermittently with
// "no such table".
func New(t *testing.T, models ...interface{}) *gorm.DB {
	t.Helper()

	db := open(t, ":memory:", true)
	migrate(t, db, models)
	install(t, db)
	return db
}

// NewShared is New with a named shared-cache in-memory database. Use it when
// the fixture has to survive more than one connection, or when a test reopens
// the same DSN. The name must be unique per test, e.g. t.Name().
func NewShared(t *testing.T, name string, models ...interface{}) *gorm.DB {
	t.Helper()

	db := open(t, "file:"+url.QueryEscape(name)+"?mode=memory&cache=shared", false)
	migrate(t, db, models)
	install(t, db)
	return db
}

func open(t *testing.T, dsn string, pinSingleConn bool) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{TranslateError: true})
	if err != nil {
		t.Fatalf("testdb: open sqlite: %v", err)
	}
	if pinSingleConn {
		sqlDB, err := db.DB()
		if err != nil {
			t.Fatalf("testdb: get sql.DB: %v", err)
		}
		sqlDB.SetMaxOpenConns(1)
		sqlDB.SetMaxIdleConns(1)
	}
	return db
}

func migrate(t *testing.T, db *gorm.DB, models []interface{}) {
	t.Helper()

	all := make([]interface{}, 0, len(permissionModels)+len(models))
	all = append(all, permissionModels...)
	all = append(all, models...)
	if err := db.AutoMigrate(all...); err != nil {
		t.Fatalf("testdb: migrate: %v", err)
	}
}

func install(t *testing.T, db *gorm.DB) {
	t.Helper()

	orig := dao.DB
	dao.DB = db
	t.Cleanup(func() { dao.DB = orig })
}
