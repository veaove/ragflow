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

package dao

import (
	"context"
	"errors"

	"gorm.io/gorm"

	"ragflow/internal/entity"
)

// LoginAttemptDAO persists failed sign-in counters used by the lockout policy.
type LoginAttemptDAO struct{}

// NewLoginAttemptDAO creates a LoginAttemptDAO.
func NewLoginAttemptDAO() *LoginAttemptDAO {
	return &LoginAttemptDAO{}
}

// Get returns the counter row for an email, or nil when the address has never
// failed to sign in. A missing row is normal, not an error.
func (d *LoginAttemptDAO) Get(ctx context.Context, db *gorm.DB, email string) (*entity.LoginAttempt, error) {
	var attempt entity.LoginAttempt
	err := db.WithContext(ctx).Where("email = ?", email).Take(&attempt).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &attempt, nil
}

// Save upserts the counter row.
//
// Select is explicit because FailCount and LockedUntil drop to zero on a
// successful login, and GORM skips zero values on a struct update by default —
// without the Select those resets would silently no-op and the account would
// stay locked forever.
func (d *LoginAttemptDAO) Save(ctx context.Context, db *gorm.DB, attempt *entity.LoginAttempt) error {
	return db.WithContext(ctx).
		Select("email", "ip", "fail_count", "locked_until", "last_fail_at").
		Save(attempt).Error
}

// Delete removes the counter row for an email, used by the admin unlock action
// so the next failure starts counting from one again.
func (d *LoginAttemptDAO) Delete(ctx context.Context, db *gorm.DB, email string) error {
	return db.WithContext(ctx).Where("email = ?", email).Delete(&entity.LoginAttempt{}).Error
}

// DeleteExpired prunes rows whose lock has expired and whose last failure is
// older than cutoffMillis. Called opportunistically on login so the table stays
// small without a background job.
func (d *LoginAttemptDAO) DeleteExpired(ctx context.Context, db *gorm.DB, cutoffMillis int64) (int64, error) {
	res := db.WithContext(ctx).
		Where("locked_until > 0 AND locked_until < ?", cutoffMillis).
		Or("locked_until = 0 AND last_fail_at < ?", cutoffMillis).
		Delete(&entity.LoginAttempt{})
	return res.RowsAffected, res.Error
}
