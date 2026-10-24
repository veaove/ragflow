// Package dao — schema registration guard.
//
// A table is only created when its entity is listed in one of the two
// AutoMigrate sets in database.go. Nothing enforces that at compile time, so an
// entity can be queried by a service long before anyone adds it to a migration
// set. That is exactly how skill_spaces stayed missing in production: the whole
// /api/v1/skills/spaces surface answered "500 Permission check failed" because
// the permission resolver ran a query against a non-existent table.
//
// This test closes the gap by reading the source: it collects every entity used
// through Model(&entity.X{}) in the layers that own SQL, and requires each one
// to appear in dataModels or goRuntimeModels.
package dao

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// migrationSets returns the entity type names listed in the two AutoMigrate
// composite literals inside database.go.
func migrationSets(t *testing.T) map[string]string {
	t.Helper()
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "database.go", nil, 0)
	if err != nil {
		t.Fatalf("parse database.go: %v", err)
	}

	sets := map[string]string{}
	want := map[string]bool{"dataModels": true, "goRuntimeModels": true}
	ast.Inspect(file, func(n ast.Node) bool {
		as, ok := n.(*ast.AssignStmt)
		if !ok || len(as.Lhs) != 1 || len(as.Rhs) != 1 {
			return true
		}
		ident, ok := as.Lhs[0].(*ast.Ident)
		if !ok || !want[ident.Name] {
			return true
		}
		lit, ok := as.Rhs[0].(*ast.CompositeLit)
		if !ok {
			return true
		}
		for _, elt := range lit.Elts {
			unary, ok := elt.(*ast.UnaryExpr)
			if !ok {
				continue
			}
			outer, ok := unary.X.(*ast.CompositeLit)
			if !ok {
				continue
			}
			sel, ok := outer.Type.(*ast.SelectorExpr)
			if !ok {
				continue
			}
			sets[sel.Sel.Name] = ident.Name
		}
		return true
	})

	for _, name := range []string{"dataModels", "goRuntimeModels"} {
		found := false
		for _, owner := range sets {
			if owner == name {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("could not read the %s entity list from database.go; "+
				"this guard is blind until the parsing is fixed", name)
		}
	}
	return sets
}

// queriedEntities walks the SQL-owning packages and returns every entity name
// passed to Model(&entity.X{}).
func queriedEntities(t *testing.T) map[string]string {
	t.Helper()
	// Relative to internal/dao. Kept to the layers that own queries: adding the
	// whole tree would flag test helpers and migration code that legitimately
	// touches unregistered models.
	dirs := []string{".", "../admin", "../permission", "../service", "../ingestion/task", "../ingestion/knowledge_compile"}
	found := map[string]string{}
	fset := token.NewFileSet()

	for _, dir := range dirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			t.Fatalf("read dir %s: %v", dir, err)
		}
		for _, entry := range entries {
			name := entry.Name()
			if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
				continue
			}
			path := filepath.Join(dir, name)
			file, err := parser.ParseFile(fset, path, nil, 0)
			if err != nil {
				t.Fatalf("parse %s: %v", path, err)
			}
			ast.Inspect(file, func(n ast.Node) bool {
				call, ok := n.(*ast.CallExpr)
				if !ok || len(call.Args) != 1 {
					return true
				}
				sel, ok := call.Fun.(*ast.SelectorExpr)
				if !ok || sel.Sel.Name != "Model" {
					return true
				}
				unary, ok := call.Args[0].(*ast.UnaryExpr)
				if !ok {
					return true
				}
				lit, ok := unary.X.(*ast.CompositeLit)
				if !ok {
					return true
				}
				typeSel, ok := lit.Type.(*ast.SelectorExpr)
				if !ok {
					return true
				}
				pkg, ok := typeSel.X.(*ast.Ident)
				if !ok || pkg.Name != "entity" {
					return true
				}
				found[typeSel.Sel.Name] = path
				return true
			})
		}
	}
	return found
}

// TestEveryQueriedEntityIsRegisteredForMigration fails when a service can issue
// SQL against a table that no migration set creates.
func TestEveryQueriedEntityIsRegisteredForMigration(t *testing.T) {
	registered := migrationSets(t)
	used := queriedEntities(t)

	if len(used) == 0 {
		t.Fatal("no Model(&entity.X{}) calls found; the query scan is broken")
	}

	var missing []string
	for name, where := range used {
		if _, ok := registered[name]; !ok {
			missing = append(missing, name+" (used in "+filepath.ToSlash(where)+")")
		}
	}
	sort.Strings(missing)
	if len(missing) > 0 {
		t.Fatalf("these entities are queried but never migrated, so their tables "+
			"do not exist and every request fails at runtime:\n  %s\n"+
			"add them to dataModels or goRuntimeModels in database.go",
			strings.Join(missing, "\n  "))
	}
}

// TestSkillSpaceIsMigrated pins the specific regression: without this table the
// Skills page cannot list, create or open a space.
func TestSkillSpaceIsMigrated(t *testing.T) {
	registered := migrationSets(t)
	owner, ok := registered["SkillSpace"]
	if !ok {
		t.Fatal("entity.SkillSpace is not in any migration set, so skill_spaces " +
			"is never created and /api/v1/skills/spaces fails")
	}
	if owner != "goRuntimeModels" {
		t.Fatalf("entity.SkillSpace belongs in goRuntimeModels (Go-only runtime "+
			"table, created on both startup paths) but is registered in %s", owner)
	}
}
