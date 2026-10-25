// Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package admin

import (
	"context"
	"testing"

	"ragflow/internal/entity"
	"ragflow/internal/ingestion/testutil"
)

// 真实形态的 id：32 位小写十六进制，和 entity 里 uuid 生成的一致。
const (
	auditTenantID   = "aa002404815e48d19e85f9055b239630" // user 与 tenant 同名，昵称为空
	auditNamedUser  = "bb002404815e48d19e85f9055b239631" // 有昵称的账号
	auditOrphanID   = "cc002404815e48d19e85f9055b239632" // 账号已删，任何表都查不到
	auditTenantOnly = "dd002404815e48d19e85f9055b239633" // 只有 tenant 行，没有 user 行
)

func setupAuditDB(t *testing.T) {
	t.Helper()
	db := testutil.SetupTestDB(t,
		&entity.Tenant{},
		&entity.User{},
		&entity.AuditLog{},
	)
	t.Cleanup(testutil.ReplaceDBForTest(t, db))

	statusValid := string(entity.StatusValid)
	tenantName := "'s Kingdom"
	onlyTenantName := "富国基金"
	tenants := []entity.Tenant{
		{ID: auditTenantID, Name: &tenantName, Status: &statusValid},
		{ID: auditTenantOnly, Name: &onlyTenantName, Status: &statusValid},
	}
	for i := range tenants {
		if err := db.Create(&tenants[i]).Error; err != nil {
			t.Fatalf("create tenant: %v", err)
		}
	}

	users := []entity.User{
		// 与线上一致：昵称为空，只有邮箱，所以展示时要回落到邮箱。
		{ID: auditTenantID, Nickname: "", Email: "qa.e2e@example.com", IsAuthenticated: "1", IsActive: "1"},
		{ID: auditNamedUser, Nickname: "张三", Email: "zhangsan@example.com", IsAuthenticated: "1", IsActive: "1"},
	}
	for i := range users {
		if err := db.Create(&users[i]).Error; err != nil {
			t.Fatalf("create user: %v", err)
		}
	}
}

// TestDecorateAuditActorsResolvesNames pins the read-time resolution.
//
// audit_log has two writers that disagree on the actor columns: the admin
// middleware stores the operator's e-mail, the agent service stores a raw user
// id and no tenant_name snapshot. The console rendered those id rows as two
// identical columns of hex, so the fix has to resolve both shapes — and must not
// invent a name when the account is gone, because that would erase the only
// trace of who did it.
func TestDecorateAuditActorsResolvesNames(t *testing.T) {
	setupAuditDB(t)
	ctx := context.Background()

	logs := []*entity.AuditLog{
		// 智能体服务写的：两个列都是裸 id。
		{ID: "a-1", TenantID: auditTenantID, Operator: auditTenantID, Action: "restore", ObjectType: "version"},
		// 管理后台中间件写的：operator 已经是邮箱，没有租户上下文。
		{ID: "a-2", TenantID: "", Operator: "zhangsan@example.com", Action: "create", ObjectType: "user"},
		// 账号已删：解析不出来就该保持空，让前端回落到原始 id。
		{ID: "a-3", TenantID: auditOrphanID, Operator: auditOrphanID, Action: "restore", ObjectType: "version"},
		// 有昵称的账号：优先昵称。
		{ID: "a-4", TenantID: auditNamedUser, Operator: auditNamedUser, Action: "update", ObjectType: "user"},
		// 只有 tenant 行：租户名走 tenant.name。
		{ID: "a-5", TenantID: auditTenantOnly, Operator: "", Action: "update", ObjectType: "tenant"},
	}
	decorateAuditActors(ctx, logs)

	cases := []struct {
		id             string
		wantTenantName string
		wantOperator   string
	}{
		{"a-1", "'s Kingdom", "qa.e2e@example.com"},
		{"a-2", "", ""},
		{"a-3", "", ""},
		{"a-4", "张三", "张三"},
		{"a-5", "富国基金", ""},
	}
	byID := map[string]*entity.AuditLog{}
	for _, l := range logs {
		byID[l.ID] = l
	}
	for _, c := range cases {
		got := byID[c.id]
		if got == nil {
			t.Fatalf("%s missing", c.id)
		}
		if got.TenantName != c.wantTenantName {
			t.Errorf("%s tenant_name = %q, want %q", c.id, got.TenantName, c.wantTenantName)
		}
		if got.OperatorName != c.wantOperator {
			t.Errorf("%s operator_name = %q, want %q", c.id, got.OperatorName, c.wantOperator)
		}
	}

	// 原始值必须原样留着，前端 title 和导出都靠它追溯。
	if byID["a-1"].Operator != auditTenantID {
		t.Errorf("operator was overwritten: %q", byID["a-1"].Operator)
	}
}

// TestMatchActorIDsFindsIdsByName covers the search box: rows that store raw ids
// in operator can only be found by name if the keyword is resolved to ids first.
func TestMatchActorIDsFindsIdsByName(t *testing.T) {
	setupAuditDB(t)
	ctx := context.Background()

	for _, c := range []struct {
		keyword string
		want    string
	}{
		{"张三", auditNamedUser},
		{"zhangsan@", auditNamedUser},
		{"Kingdom", auditTenantID},
		{"富国", auditTenantOnly},
	} {
		ids := matchActorIDs(ctx, c.keyword)
		if len(ids) != 1 || ids[0] != c.want {
			t.Errorf("matchActorIDs(%q) = %v, want [%s]", c.keyword, ids, c.want)
		}
	}

	if ids := matchActorIDs(ctx, "   "); len(ids) != 0 {
		t.Errorf("matchActorIDs(blank) = %v, want empty", ids)
	}
	if ids := matchActorIDs(ctx, "查无此人"); len(ids) != 0 {
		t.Errorf("matchActorIDs(no match) = %v, want empty", ids)
	}
}
