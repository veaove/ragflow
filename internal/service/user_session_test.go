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
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"ragflow/internal/dao"
	"ragflow/internal/entity"
)

// setupSessionDB 建一张只含会话相关表的内存库，并把 dao.DB 指过去。
func setupSessionDB(t *testing.T) {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{TranslateError: true})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err = db.AutoMigrate(
		&entity.User{},
		&entity.UserSession{},
		&entity.SystemSettings{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	orig := dao.DB
	dao.DB = db
	t.Cleanup(func() { dao.DB = orig })
}

// setAllowConcurrent 直接写设置行，绕过 Settings.Save 的校验链。
func setAllowConcurrent(t *testing.T, allow bool) {
	t.Helper()
	value := "false"
	if allow {
		value = "true"
	}
	if err := dao.DB.Create(&entity.SystemSettings{
		Name:     "security.session.allow_concurrent",
		Source:   "security",
		DataType: "string",
		Value:    value,
	}).Error; err != nil {
		t.Fatalf("seed setting: %v", err)
	}
}

func countSessions(t *testing.T, userID string) int64 {
	t.Helper()
	var n int64
	if err := dao.DB.Model(&entity.UserSession{}).
		Where("user_id = ?", userID).Count(&n).Error; err != nil {
		t.Fatalf("count sessions: %v", err)
	}
	return n
}

// 关闭并发登录时，新登录必须把该账号其它会话清掉，
// 否则旧 token 会通过 GetUserByToken 的会话表回退继续有效。
func TestRecordSessionEvictsOthersWhenConcurrentDisabled(t *testing.T) {
	setupSessionDB(t)
	setAllowConcurrent(t, false)

	svc := NewUserService()
	ctx := context.Background()

	if err := svc.recordSession(ctx, "user-1", "token-old"); err != nil {
		t.Fatalf("record first session: %v", err)
	}
	if err := svc.recordSession(ctx, "user-1", "token-new"); err != nil {
		t.Fatalf("record second session: %v", err)
	}

	if got := countSessions(t, "user-1"); got != 1 {
		t.Fatalf("sessions = %d, want 1（不允许多端时应只保留最新一条）", got)
	}
	var left entity.UserSession
	if err := dao.DB.Where("user_id = ?", "user-1").Take(&left).Error; err != nil {
		t.Fatalf("load session: %v", err)
	}
	if left.ID != "token-new" {
		t.Fatalf("kept token = %q, want token-new", left.ID)
	}
}

// 放开并发登录后，多端会话必须共存；否则「允许多端」这个开关等于没生效。
func TestRecordSessionKeepsOthersWhenConcurrentAllowed(t *testing.T) {
	setupSessionDB(t)
	setAllowConcurrent(t, true)

	svc := NewUserService()
	ctx := context.Background()

	if err := svc.recordSession(ctx, "user-1", "token-a"); err != nil {
		t.Fatalf("record a: %v", err)
	}
	if err := svc.recordSession(ctx, "user-1", "token-b"); err != nil {
		t.Fatalf("record b: %v", err)
	}

	if got := countSessions(t, "user-1"); got != 2 {
		t.Fatalf("sessions = %d, want 2（允许多端时应保留全部会话）", got)
	}
}

// 不同账号之间不能互相影响。
func TestRecordSessionIsScopedToUser(t *testing.T) {
	setupSessionDB(t)
	setAllowConcurrent(t, false)

	svc := NewUserService()
	ctx := context.Background()

	if err := svc.recordSession(ctx, "user-1", "token-1"); err != nil {
		t.Fatalf("record user-1: %v", err)
	}
	if err := svc.recordSession(ctx, "user-2", "token-2"); err != nil {
		t.Fatalf("record user-2: %v", err)
	}

	if got := countSessions(t, "user-1"); got != 1 {
		t.Fatalf("user-1 sessions = %d, want 1", got)
	}
	if got := countSessions(t, "user-2"); got != 1 {
		t.Fatalf("user-2 sessions = %d, want 1", got)
	}
}

// 登出只该注销自己那条会话，不能顺手把同账号其它设备踢下线。
func TestLogoutRemovesOnlyOwnSession(t *testing.T) {
	setupSessionDB(t)
	setAllowConcurrent(t, true)

	svc := NewUserService()
	ctx := context.Background()

	if err := svc.recordSession(ctx, "user-1", "token-a"); err != nil {
		t.Fatalf("record a: %v", err)
	}
	if err := svc.recordSession(ctx, "user-1", "token-b"); err != nil {
		t.Fatalf("record b: %v", err)
	}

	// 主 token 指向 token-b（最后一次登录），模拟从 A 端登出。
	primary := "token-b"
	user := &entity.User{ID: "user-1", AccessToken: &primary}

	if _, err := svc.Logout(ctx, user, "token-a"); err != nil {
		t.Fatalf("logout: %v", err)
	}

	var remaining []entity.UserSession
	if err := dao.DB.Where("user_id = ?", "user-1").Find(&remaining).Error; err != nil {
		t.Fatalf("list sessions: %v", err)
	}
	if len(remaining) != 1 || remaining[0].ID != "token-b" {
		t.Fatalf("remaining = %+v, want only token-b", remaining)
	}
	// 退出的不是主 token，就不该改动 access_token。
	if user.AccessToken == nil || *user.AccessToken != "token-b" {
		t.Fatalf("access_token was modified on non-primary logout: %v", user.AccessToken)
	}
}

// 退出主 token 时才把 access_token 置为无效，避免快路径继续放行。
func TestLogoutInvalidatesPrimaryToken(t *testing.T) {
	setupSessionDB(t)
	setAllowConcurrent(t, true)

	svc := NewUserService()
	ctx := context.Background()

	primary := "token-main"
	user := &entity.User{ID: "user-1", AccessToken: &primary}
	if err := dao.DB.Create(user).Error; err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if err := svc.recordSession(ctx, "user-1", "token-main"); err != nil {
		t.Fatalf("record: %v", err)
	}

	if _, err := svc.Logout(ctx, user, "token-main"); err != nil {
		t.Fatalf("logout: %v", err)
	}

	if user.AccessToken == nil || len(*user.AccessToken) < 8 || (*user.AccessToken)[:8] != "INVALID_" {
		t.Fatalf("primary token not invalidated: %v", user.AccessToken)
	}
	if got := countSessions(t, "user-1"); got != 0 {
		t.Fatalf("sessions = %d, want 0", got)
	}
}
