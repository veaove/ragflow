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

package service

import (
	"context"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"ragflow/internal/dao"
	"ragflow/internal/entity"
)

// setupMemberDB 建一张只含成员编辑所需表的内存库。
func setupMemberDB(t *testing.T) {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{TranslateError: true})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err = db.AutoMigrate(&entity.User{}, &entity.UserTenant{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	orig := dao.DB
	dao.DB = db
	t.Cleanup(func() { dao.DB = orig })

	if err = db.Create(&entity.User{ID: "user-1", Email: "lisi@qq.com", Nickname: "旧名"}).Error; err != nil {
		t.Fatalf("seed user: %v", err)
	}
	valid := string(entity.StatusValid)
	if err = db.Create(&entity.UserTenant{
		ID: "ut-1", UserID: "user-1", TenantID: "tenant-1",
		Role: string(entity.StatusValid), Status: &valid,
	}).Error; err != nil {
		t.Fatalf("seed membership: %v", err)
	}
}

func loadNickname(t *testing.T) string {
	t.Helper()
	var u entity.User
	if err := dao.DB.Where("id = ?", "user-1").Take(&u).Error; err != nil {
		t.Fatalf("load user: %v", err)
	}
	return u.Nickname
}

// 编辑成员可以改姓名，落库时去掉首尾空格。
func TestUpdateMemberChangesNickname(t *testing.T) {
	setupMemberDB(t)
	svc := NewConsoleService()
	name := "  李四  "

	if err := svc.UpdateMember(context.Background(), "tenant-1", "user-1", MemberUpdate{Nickname: &name}); err != nil {
		t.Fatalf("UpdateMember: %v", err)
	}
	if got := loadNickname(t); got != "李四" {
		t.Fatalf("nickname = %q, want 李四（应 trim）", got)
	}
}

// 传空串表示清空昵称，列表会回落到邮箱显示。
func TestUpdateMemberClearsNickname(t *testing.T) {
	setupMemberDB(t)
	svc := NewConsoleService()
	empty := ""

	if err := svc.UpdateMember(context.Background(), "tenant-1", "user-1", MemberUpdate{Nickname: &empty}); err != nil {
		t.Fatalf("UpdateMember: %v", err)
	}
	if got := loadNickname(t); got != "" {
		t.Fatalf("nickname = %q, want empty", got)
	}
}

// 超长昵称必须在写库前拒绝：user.nickname 是 varchar(100)，超了会截断或报错。
func TestUpdateMemberRejectsTooLongNickname(t *testing.T) {
	setupMemberDB(t)
	svc := NewConsoleService()
	tooLong := strings.Repeat("名", 101)

	err := svc.UpdateMember(context.Background(), "tenant-1", "user-1", MemberUpdate{Nickname: &tooLong})
	if err == nil {
		t.Fatal("UpdateMember should reject 101-rune nickname")
	}
	// 原值不能被改动
	if got := loadNickname(t); got != "旧名" {
		t.Fatalf("nickname = %q, want unchanged 旧名", got)
	}
}

// 100 个汉字应当放行：按字符数判而不是字节数，否则中文名会被误拒。
func TestUpdateMemberAcceptsMaxRuneNickname(t *testing.T) {
	setupMemberDB(t)
	svc := NewConsoleService()
	maxLen := strings.Repeat("名", 100)

	if err := svc.UpdateMember(context.Background(), "tenant-1", "user-1", MemberUpdate{Nickname: &maxLen}); err != nil {
		t.Fatalf("100 runes should be accepted, got %v", err)
	}
	if got := loadNickname(t); got != maxLen {
		t.Fatalf("nickname length = %d runes, want 100", len([]rune(got)))
	}
}

// setupOwnerMemberDB 建一个「只有一个 owner」的租户，用于验证 owner 的保护。
func setupOwnerMemberDB(t *testing.T) {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{TranslateError: true})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err = db.AutoMigrate(&entity.User{}, &entity.UserTenant{}, &entity.Role{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	orig := dao.DB
	dao.DB = db
	t.Cleanup(func() { dao.DB = orig })

	if err = db.Create(&entity.User{ID: "owner-1", Email: "owner@qq.com", Nickname: "原主人"}).Error; err != nil {
		t.Fatalf("seed user: %v", err)
	}
	// UpdateMember 会先校验角色存在，再判 owner：用例里得给一个真实角色，
	// 否则会停在「角色不存在」，测不到 owner 那道闸。
	if err = db.Create(&entity.Role{ID: "role-x", TenantID: "tenant-1", Name: "质检员"}).Error; err != nil {
		t.Fatalf("seed role: %v", err)
	}
	valid := string(entity.StatusValid)
	if err = db.Create(&entity.UserTenant{
		ID: "ut-owner", UserID: "owner-1", TenantID: "tenant-1",
		Role: "owner", Status: &valid,
	}).Error; err != nil {
		t.Fatalf("seed membership: %v", err)
	}
}

// owner 的身份来自租户所有权，不是可以分配的角色：编辑成员不能给他挂角色，
// 否则「谁是 owner」会出现两套说法。
func TestUpdateMemberRejectsRoleAssignmentOnOwner(t *testing.T) {
	setupOwnerMemberDB(t)
	roleID := "role-x"

	err := NewConsoleService().UpdateMember(context.Background(), "tenant-1", "owner-1",
		MemberUpdate{RoleID: &roleID})
	if err == nil {
		t.Fatal("给 owner 分配角色应当被拒绝")
	}
	if !strings.Contains(err.Error(), "移交 Owner") {
		t.Fatalf("error = %v, want 提示改用移交 Owner", err)
	}
}

// 停用 owner 等于让整个租户没人能管。
func TestUpdateMemberRejectsDisablingOwner(t *testing.T) {
	setupOwnerMemberDB(t)
	off := "0"

	err := NewConsoleService().UpdateMember(context.Background(), "tenant-1", "owner-1",
		MemberUpdate{Status: &off})
	if err == nil {
		t.Fatal("停用 owner 应当被拒绝")
	}
	if !strings.Contains(err.Error(), "不能停用") {
		t.Fatalf("error = %v, want 不能停用", err)
	}
}

// 只是改姓名不能被误拦：前端保存时会带上空的 role_id 和 status=1，
// 若按「字段存在即拒绝」处理，给 owner 改个名字都会失败。
func TestUpdateMemberAllowsProfileEditOnOwner(t *testing.T) {
	setupOwnerMemberDB(t)
	name := "新名"
	emptyRole := ""
	on := "1"

	err := NewConsoleService().UpdateMember(context.Background(), "tenant-1", "owner-1",
		MemberUpdate{Nickname: &name, RoleID: &emptyRole, Status: &on})
	if err != nil {
		t.Fatalf("owner 只改资料不应被拒，got %v", err)
	}

	var u entity.User
	if err = dao.DB.Where("id = ?", "owner-1").Take(&u).Error; err != nil {
		t.Fatalf("load user: %v", err)
	}
	if u.Nickname != name {
		t.Fatalf("nickname = %q, want %q", u.Nickname, name)
	}
}
