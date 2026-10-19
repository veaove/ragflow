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
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	"ragflow/internal/common"
	"ragflow/internal/dao"
	"ragflow/internal/entity"

	"gorm.io/gorm"
)

const appKeyPrefix = "wf-sk"

// ErrAppKeyForbidden is returned when a key is inactive or bound to another
// canvas. Reported identically to a missing key so the endpoint cannot be used
// to probe another app's keys.
var ErrAppKeyForbidden = errors.New("api key invalid or disabled")

// AppKeyService issues, rotates and validates per-app API keys.
type AppKeyService struct {
	keyDAO *dao.AppAPIKeyDAO
}

func NewAppKeyService() *AppKeyService {
	return &AppKeyService{keyDAO: dao.NewAppAPIKeyDAO()}
}

// CreateKey issues a new key for a canvas. Only the SHA-256 hash is stored;
// the plaintext is returned exactly once.
func (s *AppKeyService) CreateKey(ctx context.Context, canvasID, ownerUserID, createdBy string) (plaintext string, key *entity.AppAPIKey, err error) {
	secret := randomSecret()
	plaintext = appKeyPrefix + "-" + secret
	key = &entity.AppAPIKey{
		ID:               common.GenerateUUID(),
		CanvasID:         canvasID,
		OwnerUserID:      ownerUserID,
		KeyPrefix:        appKeyPrefix,
		KeyHash:          hashKey(plaintext),
		Status:           "active",
		RPMLimit:         60,
		ConcurrencyLimit: 5,
		BurstLimit:       10,
		CreatedBy:        createdBy,
		CreateTime:       time.Now().UnixMilli(),
	}
	if err := s.keyDAO.Create(ctx, dao.DB, key); err != nil {
		return "", nil, err
	}
	return plaintext, key, nil
}

// ResolveKey validates a bearer key and returns the row if it is active and
// bound to the given canvas. A wrong canvas or disabled key maps to the same
// forbidden error.
func (s *AppKeyService) ResolveKey(ctx context.Context, plaintext, canvasID string) (*entity.AppAPIKey, error) {
	key, err := s.keyDAO.GetByHash(ctx, dao.DB, hashKey(plaintext))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrAppKeyForbidden
		}
		return nil, err
	}
	if key.Status != "active" || key.CanvasID != canvasID {
		return nil, ErrAppKeyForbidden
	}
	return key, nil
}

// ListKeys returns the canvas's keys with the hash zeroed out.
func (s *AppKeyService) ListKeys(ctx context.Context, canvasID string) ([]*entity.AppAPIKey, error) {
	keys, err := s.keyDAO.ListByCanvas(ctx, dao.DB, canvasID)
	if err != nil {
		return nil, err
	}
	for _, k := range keys {
		k.KeyHash = ""
	}
	return keys, nil
}

// DisableKey deactivates a key.
func (s *AppKeyService) DisableKey(ctx context.Context, canvasID, keyID string) error {
	return s.keyDAO.Disable(ctx, dao.DB, canvasID, keyID)
}

// TouchLastUsed updates last_used_at (best-effort).
func (s *AppKeyService) TouchLastUsed(ctx context.Context, keyID string) {
	_ = dao.DB.WithContext(ctx).Model(&entity.AppAPIKey{}).
		Where("id = ?", keyID).
		Update("last_used_at", time.Now().UnixMilli()).Error
}

// randomSecret returns a 32-byte random token hex string.
func randomSecret() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// hashKey returns the SHA-256 hex of a plaintext key (the only stored form).
func hashKey(plaintext string) string {
	sum := sha256.Sum256([]byte(plaintext))
	return hex.EncodeToString(sum[:])
}
