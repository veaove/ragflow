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
	"fmt"
	"time"

	"go.uber.org/zap"

	"ragflow/internal/common"
	"ragflow/internal/dao"
	"ragflow/internal/entity"
	"ragflow/internal/service/security"
)

// loginGuard enforces the platform's brute-force lockout policy.
//
// The policy is read on every call rather than cached. Sign-in is a
// low-frequency path, and a cached copy would keep an administrator's change
// invisible until the next restart — the one place where a stale cache is
// actively dangerous.
//
// A storage failure never blocks a legitimate sign-in: every read error falls
// through to "allow", and every write error is logged and ignored. The lockout
// is a defence-in-depth measure, not an authorization gate.
type loginGuard struct {
	attempts *dao.LoginAttemptDAO
}

func newLoginGuard() *loginGuard {
	return &loginGuard{attempts: dao.NewLoginAttemptDAO()}
}

// currentSettings loads the policy, falling back to the built-in defaults when
// the database is unavailable.
func (g *loginGuard) currentSettings(ctx context.Context) security.Settings {
	if dao.DB == nil {
		return security.Defaults()
	}
	s, err := security.Load(ctx, dao.DB)
	if err != nil {
		common.Info("load security settings failed, using defaults", zap.Error(err))
		return security.Defaults()
	}
	return s
}

// checkLocked returns the current policy plus an error when the account is still
// inside its lockout window.
func (g *loginGuard) checkLocked(ctx context.Context, email string) (security.Settings, error) {
	s := g.currentSettings(ctx)
	if !s.Login.LockEnabled || dao.DB == nil || email == "" {
		return s, nil
	}
	attempt, err := g.attempts.Get(ctx, dao.DB, email)
	if err != nil {
		common.Info("read login attempt failed", zap.Error(err))
		return s, nil
	}
	if attempt == nil || attempt.LockedUntil == 0 {
		return s, nil
	}
	now := time.Now().UnixMilli()
	if now >= attempt.LockedUntil {
		return s, nil
	}
	remain := time.Duration(attempt.LockedUntil-now) * time.Millisecond
	return s, fmt.Errorf("account is locked due to repeated failed sign-ins, try again in %s",
		remain.Round(time.Second))
}

// recordFailure increments the failure counter and locks the account once the
// configured threshold is reached.
func (g *loginGuard) recordFailure(ctx context.Context, email, ip string, s security.Settings) {
	if !s.Login.LockEnabled || dao.DB == nil || email == "" {
		return
	}
	attempt, err := g.attempts.Get(ctx, dao.DB, email)
	if err != nil {
		common.Info("read login attempt failed", zap.Error(err))
		return
	}
	now := time.Now().UnixMilli()
	if attempt == nil {
		attempt = &entity.LoginAttempt{Email: email}
	}
	attempt.FailCount++
	attempt.LastFailAt = now
	attempt.IP = ip
	if s.Login.LockThreshold > 0 && attempt.FailCount >= s.Login.LockThreshold {
		attempt.LockedUntil = now + int64(s.Login.LockMinutes)*60*1000
		common.Info("account locked after repeated failed sign-ins",
			zap.String("email", email),
			zap.Int("fail_count", attempt.FailCount),
			zap.Int("lock_minutes", s.Login.LockMinutes))
	}
	if err := g.attempts.Save(ctx, dao.DB, attempt); err != nil {
		common.Info("save login attempt failed", zap.Error(err))
	}
}

// clearFailures resets the counter after a successful sign-in.
func (g *loginGuard) clearFailures(ctx context.Context, email string) {
	if dao.DB == nil || email == "" {
		return
	}
	if err := g.attempts.Delete(ctx, dao.DB, email); err != nil {
		common.Info("clear login attempt failed", zap.Error(err))
	}
}

// checkPasswordPolicy applies the configured strength rules to a plaintext
// password. Called from registration and password change, never on login: an
// existing password must never become invalid because an administrator raised
// the bar after it was set.
func (g *loginGuard) checkPasswordPolicy(ctx context.Context, password string) error {
	return g.currentSettings(ctx).CheckPassword(password)
}

// unlock removes a lockout immediately, used by the admin unlock action.
func (g *loginGuard) unlock(ctx context.Context, email string) error {
	if dao.DB == nil {
		return fmt.Errorf("database is not ready")
	}
	return g.attempts.Delete(ctx, dao.DB, email)
}

// passwordExpired reports whether the password has outlived the configured
// rotation window. An expiry of zero disables the check.
func (g *loginGuard) passwordExpired(s security.Settings, updatedAt *time.Time) bool {
	if s.Password.ExpireDays <= 0 || updatedAt == nil {
		return false
	}
	deadline := updatedAt.AddDate(0, 0, s.Password.ExpireDays)
	return time.Now().After(deadline)
}
