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
