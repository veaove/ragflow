package service

import (
	"context"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"ragflow/internal/dao"
	"ragflow/internal/entity"
)

func setupGrantDescribeDB(t *testing.T) {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{TranslateError: true})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err = db.AutoMigrate(&entity.User{}, &entity.Department{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	orig := dao.DB
	dao.DB = db
	t.Cleanup(func() { dao.DB = orig })

	if err = db.Create(&entity.User{
		ID: "u1", Email: "hejun@example.com", Nickname: "和君测试",
	}).Error; err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if err = db.Create(&entity.Department{
		ID: "d1", TenantID: "t1", Name: "技术部",
	}).Error; err != nil {
		t.Fatalf("seed department: %v", err)
	}
}

func grantRow(kind, id string) []*entity.ResourceGrant {
	return []*entity.ResourceGrant{{
		TenantID:     "t1",
		ResourceKind: GrantKindDocument,
		ResourceID:   "doc-" + id,
		SubjectKind:  kind,
		SubjectID:    id,
		Permission:   "read",
		Effect:       entity.GrantEffectDeny,
	}}
}

func allowRow(kind, id, permission string) []*entity.ResourceGrant {
	return []*entity.ResourceGrant{{
		TenantID:     "t1",
		ResourceKind: GrantKindDocument,
		ResourceID:   "doc-" + id,
		SubjectKind:  kind,
		SubjectID:    id,
		Permission:   permission,
		Effect:       entity.GrantEffectAllow,
	}}
}

// 同一批里多个文件共享同一个排除主体时，每一条都要带出 grants。
//
// 名字缓存命中后不再回库是对的，但「待查名字的 id」不能同时当作输出列表：
// 那样第二行起就会返回空数组，页面上「子项例外」只有第一行有标签、其余整格
// 留白（线上 07-帮助中心 就是这个表现）。
func TestDescribeGrantsCachedRepeatsSharedUserSubject(t *testing.T) {
	setupGrantDescribeDB(t)
	svc := NewResourceGrantService()
	cache := newGrantNameCache()

	for i := 1; i <= 3; i++ {
		got := svc.describeGrantsCached(context.Background(), "t1",
			grantRow(entity.GrantSubjectUser, "u1"), cache)
		if len(got) != 1 {
			t.Fatalf("第 %d 条：subjects = %d，want 1（缓存命中也要输出主体）", i, len(got))
		}
		if got[0].Name != "和君测试" {
			t.Fatalf("第 %d 条：name = %q，want 和君测试", i, got[0].Name)
		}
		if got[0].Effect != entity.GrantEffectDeny {
			t.Fatalf("第 %d 条：effect = %q，want deny", i, got[0].Effect)
		}
	}
}

func TestDescribeGrantsCachedRepeatsSharedDepartmentSubject(t *testing.T) {
	setupGrantDescribeDB(t)
	svc := NewResourceGrantService()
	cache := newGrantNameCache()

	for i := 1; i <= 2; i++ {
		got := svc.describeGrantsCached(context.Background(), "t1",
			grantRow(entity.GrantSubjectDepartment, "d1"), cache)
		if len(got) != 1 || got[0].Name != "技术部" {
			t.Fatalf("第 %d 条：%+v，want 一条 name=技术部", i, got)
		}
	}
}

// 单条「可查看」必须原样显示成 read。
//
// 聚合器的零值 permission 是空串，而空串在 normalizeGrantPermission 里等价于
// edit（历史行没有级别列）。把零值喂进合并，任何一条 read 规则都会被聚合成
// edit —— 线上表现为「给的是可查看，列表里显示可编辑」。
func TestDescribeGrantsKeepsReadPermission(t *testing.T) {
	setupGrantDescribeDB(t)
	svc := NewResourceGrantService()

	got := svc.describeGrantsCached(context.Background(), "t1",
		allowRow(entity.GrantSubjectUser, "u1", GrantPermissionRead), newGrantNameCache())
	if len(got) != 1 || got[0].Permission != GrantPermissionRead {
		t.Fatalf("%+v，want 一条 permission=read", got)
	}
}

// 同一主体多条规则取更强的那条，级别不能因为合并而丢失。
func TestDescribeGrantsMergesToStrongerPermission(t *testing.T) {
	setupGrantDescribeDB(t)
	svc := NewResourceGrantService()

	rows := append(
		allowRow(entity.GrantSubjectUser, "u1", GrantPermissionRead),
		allowRow(entity.GrantSubjectUser, "u1", GrantPermissionEdit)...,
	)
	got := svc.describeGrantsCached(context.Background(), "t1", rows, newGrantNameCache())
	if len(got) != 1 || got[0].Permission != GrantPermissionEdit {
		t.Fatalf("%+v，want 一条 permission=edit", got)
	}
}

// 级别列出现之前的存量行（permission 为空）仍然按 edit 展示，与判定侧一致。
func TestDescribeGrantsTreatsEmptyPermissionAsEdit(t *testing.T) {
	setupGrantDescribeDB(t)
	svc := NewResourceGrantService()

	got := svc.describeGrantsCached(context.Background(), "t1",
		allowRow(entity.GrantSubjectUser, "u1", ""), newGrantNameCache())
	if len(got) != 1 || got[0].Permission != GrantPermissionEdit {
		t.Fatalf("%+v，want 一条 permission=edit（历史行）", got)
	}
}

// 主体已经解析不出名字（成员被移出租户）时回落到 id，不能整条丢掉。
func TestDescribeGrantsCachedFallsBackToIDForUnknownSubject(t *testing.T) {
	setupGrantDescribeDB(t)
	svc := NewResourceGrantService()

	got := svc.describeGrantsCached(context.Background(), "t1",
		grantRow(entity.GrantSubjectUser, "ghost"), newGrantNameCache())
	if len(got) != 1 || got[0].Name != "ghost" {
		t.Fatalf("%+v，want 一条 name=ghost", got)
	}
}
