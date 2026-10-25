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

package entity

// LoginAttempt tracks consecutive failed sign-ins so the platform can lock an
// account out after N failures.
//
// Keyed by email rather than user id on purpose: an attacker probing addresses
// that do not exist has to hit the same lockout path, otherwise the distinct
// "email not registered" response would leak which accounts are real.
//
// LockedUntil and LastFailAt are epoch milliseconds. Zero means "never locked"
// and "never failed" respectively, so neither field carries a GORM default tag:
// a default would make an explicit zero un-writable and leave a stale lock in
// place after an administrator unlocks the account.
type LoginAttempt struct {
	ID          uint   `gorm:"column:id;primaryKey;autoIncrement" json:"id"`
	Email       string `gorm:"column:email;size:255;not null;uniqueIndex:uni_login_attempt_email" json:"email"`
	IP          string `gorm:"column:ip;size:64" json:"ip"`
	FailCount   int    `gorm:"column:fail_count;not null" json:"fail_count"`
	LockedUntil int64  `gorm:"column:locked_until;index" json:"locked_until"`
	LastFailAt  int64  `gorm:"column:last_fail_at;not null" json:"last_fail_at"`
	BaseModel
}

// TableName specifies the table name.
func (LoginAttempt) TableName() string {
	return "login_attempt"
}
