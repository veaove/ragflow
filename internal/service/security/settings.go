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

// Package security owns the platform-wide security policy: which login methods
// are allowed, how strong a password must be, how long a session lives, and how
// many failed logins lock an account out.
//
// The policy lives in system_settings as flat "security.<group>.<key>" rows
// rather than its own table. That keeps it migration-free and lets the existing
// SystemSettingsDAO (GetByNamePrefix / SaveOrCreate) do the storage work, while
// the strongly typed Settings struct below is the only shape the rest of the
// code sees.
package security

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"unicode"

	"gorm.io/gorm"

	"ragflow/internal/dao"
)

const (
	settingPrefix = "security."
	settingSource = "security"
	settingType   = "string"
)

// Settings is the whole security policy as the admin UI reads and writes it.
type Settings struct {
	Login    LoginSettings    `json:"login"`
	Password PasswordSettings `json:"password"`
	Session  SessionSettings  `json:"session"`
}

// LoginSettings covers the login-method switches and the brute-force lockout.
//
// MethodSSO and MethodLDAP are persisted but not enforced: both need an external
// identity provider that this deployment does not have. Storing them keeps the
// admin UI honest about what has been configured versus what is active.
type LoginSettings struct {
	MethodPassword bool `json:"method_password"`
	MethodSSO      bool `json:"method_sso"`
	MethodLDAP     bool `json:"method_ldap"`
	LockEnabled    bool `json:"lock_enabled"`
	LockThreshold  int  `json:"lock_threshold"`
	LockMinutes    int  `json:"lock_minutes"`
}

// PasswordSettings is the password strength policy applied when a password is
// created or changed. It never retroactively invalidates existing passwords.
type PasswordSettings struct {
	MinLength  int  `json:"min_length"`
	Complexity bool `json:"complexity"`
	ExpireDays int  `json:"expire_days"`
}

// SessionSettings controls how long an access token stays valid.
type SessionSettings struct {
	TimeoutMinutes int `json:"timeout_minutes"`
}

// Defaults mirrors what the admin UI shows before anyone saves the form.
func Defaults() Settings {
	return Settings{
		Login: LoginSettings{
			MethodPassword: true,
			MethodSSO:      false,
			MethodLDAP:     false,
			LockEnabled:    true,
			LockThreshold:  5,
			LockMinutes:    30,
		},
		Password: PasswordSettings{
			MinLength:  8,
			Complexity: true,
			ExpireDays: 90,
		},
		Session: SessionSettings{
			TimeoutMinutes: 30,
		},
	}
}

// Load reads the stored policy and fills anything absent with the defaults.
// A malformed row keeps its default instead of failing the call: a broken
// setting must never be able to lock the admin UI out.
func Load(ctx context.Context, db *gorm.DB) (Settings, error) {
	settings := Defaults()
	rows, err := dao.NewSystemSettingsDAO().GetByNamePrefix(ctx, db, settingPrefix)
	if err != nil {
		return settings, fmt.Errorf("load security settings: %w", err)
	}
	for _, row := range rows {
		settings.apply(strings.TrimPrefix(row.Name, settingPrefix), row.Value)
	}
	return settings, nil
}

// apply sets a single flat key onto the struct. Unknown keys are ignored so a
// newer build writing a field this build does not know about cannot break it.
func (s *Settings) apply(key, value string) {
	v := strings.TrimSpace(value)
	switch key {
	case "login.method_password":
		s.Login.MethodPassword = parseBool(v, s.Login.MethodPassword)
	case "login.method_sso":
		s.Login.MethodSSO = parseBool(v, s.Login.MethodSSO)
	case "login.method_ldap":
		s.Login.MethodLDAP = parseBool(v, s.Login.MethodLDAP)
	case "login.lock_enabled":
		s.Login.LockEnabled = parseBool(v, s.Login.LockEnabled)
	case "login.lock_threshold":
		s.Login.LockThreshold = parseInt(v, s.Login.LockThreshold)
	case "login.lock_minutes":
		s.Login.LockMinutes = parseInt(v, s.Login.LockMinutes)
	case "password.min_length":
		s.Password.MinLength = parseInt(v, s.Password.MinLength)
	case "password.complexity":
		s.Password.Complexity = parseBool(v, s.Password.Complexity)
	case "password.expire_days":
		s.Password.ExpireDays = parseInt(v, s.Password.ExpireDays)
	case "session.timeout_minutes":
		s.Session.TimeoutMinutes = parseInt(v, s.Session.TimeoutMinutes)
	}
}

// Save writes every field. It is a full replace rather than a patch: the admin
// form always submits the whole policy, and a partial write would let two admins
// silently clobber each other's edits.
func (s Settings) Save(ctx context.Context, db *gorm.DB) error {
	if err := s.Validate(); err != nil {
		return err
	}
	s.setDefaultsForZero()
	d := dao.NewSystemSettingsDAO()
	for _, kv := range s.flatten() {
		if err := d.SaveOrCreate(ctx, db, settingPrefix+kv[0], kv[1], settingSource, settingType); err != nil {
			return fmt.Errorf("save security setting %s: %w", kv[0], err)
		}
	}
	return nil
}

// flatten renders the struct as the flat key/value pairs that get persisted.
func (s Settings) flatten() [][2]string {
	return [][2]string{
		{"login.method_password", strconv.FormatBool(s.Login.MethodPassword)},
		{"login.method_sso", strconv.FormatBool(s.Login.MethodSSO)},
		{"login.method_ldap", strconv.FormatBool(s.Login.MethodLDAP)},
		{"login.lock_enabled", strconv.FormatBool(s.Login.LockEnabled)},
		{"login.lock_threshold", strconv.Itoa(s.Login.LockThreshold)},
		{"login.lock_minutes", strconv.Itoa(s.Login.LockMinutes)},
		{"password.min_length", strconv.Itoa(s.Password.MinLength)},
		{"password.complexity", strconv.FormatBool(s.Password.Complexity)},
		{"password.expire_days", strconv.Itoa(s.Password.ExpireDays)},
		{"session.timeout_minutes", strconv.Itoa(s.Session.TimeoutMinutes)},
	}
}

// Validate enforces the ranges advertised by the admin UI. Rejecting bad input
// here keeps nonsense out of the database and gives the handler a message it can
// return verbatim.
func (s Settings) Validate() error {
	if !s.Login.MethodPassword && !s.Login.MethodSSO && !s.Login.MethodLDAP {
		return fmt.Errorf("at least one login method must stay enabled")
	}
	if s.Login.LockEnabled {
		if s.Login.LockThreshold < 1 || s.Login.LockThreshold > 100 {
			return fmt.Errorf("lock threshold must be between 1 and 100")
		}
		if s.Login.LockMinutes < 1 || s.Login.LockMinutes > 1440 {
			return fmt.Errorf("lock duration must be between 1 and 1440 minutes")
		}
	}
	if s.Password.MinLength < 6 || s.Password.MinLength > 128 {
		return fmt.Errorf("password minimum length must be between 6 and 128")
	}
	if s.Password.ExpireDays < 0 || s.Password.ExpireDays > 3650 {
		return fmt.Errorf("password expiry must be between 0 and 3650 days (0 disables expiry)")
	}
	if s.Session.TimeoutMinutes < 5 || s.Session.TimeoutMinutes > 43200 {
		return fmt.Errorf("session timeout must be between 5 and 43200 minutes")
	}
	return nil
}

// setDefaultsForZero replaces zero values that would otherwise be persisted as
// "disabled". A threshold of 0 with lockout enabled is not a meaningful policy,
// it is a form that was submitted with an empty input.
func (s *Settings) setDefaultsForZero() {
	d := Defaults()
	if s.Login.LockEnabled {
		if s.Login.LockThreshold <= 0 {
			s.Login.LockThreshold = d.Login.LockThreshold
		}
		if s.Login.LockMinutes <= 0 {
			s.Login.LockMinutes = d.Login.LockMinutes
		}
	}
	if s.Password.MinLength <= 0 {
		s.Password.MinLength = d.Password.MinLength
	}
	if s.Session.TimeoutMinutes <= 0 {
		s.Session.TimeoutMinutes = d.Session.TimeoutMinutes
	}
}

// CheckPassword applies the strength policy to a plaintext password.
// Expiry is intentionally not covered here: it depends on when the password was
// last changed, which only the caller knows.
func (s Settings) CheckPassword(password string) error {
	if password == "" {
		return fmt.Errorf("password must not be empty")
	}
	// Count runes, not bytes: a Chinese password of 8 characters is 24 bytes and
	// must not be accepted as a 24-character password.
	length := len([]rune(password))
	if length < s.Password.MinLength {
		return fmt.Errorf("password must be at least %d characters", s.Password.MinLength)
	}
	if !s.Password.Complexity {
		return nil
	}
	var hasUpper, hasLower, hasDigit, hasSymbol bool
	for _, r := range password {
		switch {
		case unicode.IsUpper(r):
			hasUpper = true
		case unicode.IsLower(r):
			hasLower = true
		case unicode.IsDigit(r):
			hasDigit = true
		case unicode.IsPunct(r) || unicode.IsSymbol(r):
			hasSymbol = true
		}
	}
	if !hasUpper || !hasLower || !hasDigit {
		return fmt.Errorf("password must contain uppercase letters, lowercase letters and digits")
	}
	_ = hasSymbol // symbols are encouraged by the UI copy but not required
	return nil
}

// TimeoutSeconds is the session lifetime in the unit the token signer wants.
func (s Settings) TimeoutSeconds() int64 {
	minutes := s.Session.TimeoutMinutes
	if minutes <= 0 {
		minutes = Defaults().Session.TimeoutMinutes
	}
	return int64(minutes) * 60
}

func parseBool(value string, fallback bool) bool {
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func parseInt(value string, fallback int) int {
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}
