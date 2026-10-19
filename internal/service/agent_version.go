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
	"errors"
	"fmt"
	"time"

	"ragflow/internal/common"
	"ragflow/internal/dao"
	"ragflow/internal/entity"
	"ragflow/internal/permission"

	"gorm.io/gorm"
)

// ErrVersionNotFound is returned when a version is absent or belongs to a
// different canvas; the two cases are indistinguishable to callers.
var ErrVersionNotFound = errors.New("version not found")

// RestoreVersion writes a historical version's DSL (and its environment
// snapshot) back to the canvas draft WITHOUT changing release. The online
// version stays put until the user publishes the restored draft (FR-06-04).
func (s *AgentService) RestoreVersion(ctx context.Context, userID, canvasID, versionID string) (*entity.UserCanvas, error) {
	canvasInstance, err := s.loadCanvasForUser(ctx, userID, canvasID, permission.OperationUpdate)
	if err != nil {
		return nil, err
	}
	version, err := s.versionDAO.GetByID(ctx, dao.DB, versionID)
	if err != nil {
		if errors.Is(err, dao.ErrUserCanvasVersionNotFound) {
			return nil, ErrVersionNotFound
		}
		return nil, err
	}
	if version.UserCanvasID != canvasID {
		return nil, ErrVersionNotFound
	}

	canvasInstance.DSL = version.DSL

	err = dao.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Write the DSL back to the draft; release stays unchanged.
		if err := s.canvasDAO.UpdateTx(ctx, tx, canvasInstance); err != nil {
			return fmt.Errorf("restore version %s: update draft: %w", versionID, err)
		}
		// Restore the environment snapshot (if any) back to draft variables so
		// the graph and its secrets do not drift apart (P0-2).
		if len(version.EnvSnapshot) > 0 {
			for name, raw := range version.EnvSnapshot {
				value, valueType := "", "text"
				switch v := raw.(type) {
				case string:
					value = v
				case map[string]any:
					if s, ok := v["value"].(string); ok {
						value = s
					}
					if t, ok := v["value_type"].(string); ok {
						valueType = t
					}
				default:
					value = fmt.Sprintf("%v", v)
				}
				if err := s.environmentVariableDAO.Upsert(ctx, tx, canvasID, name, value, valueType); err != nil {
					return fmt.Errorf("restore env %q: %w", name, err)
				}
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	// Audit the restore (best-effort; a failed audit write must not block the
	// restore itself).
	s.writeAudit(ctx, userID, canvasInstance.UserID, canvasID, "restore", "version", versionID, map[string]any{"from_version_id": versionID})
	return canvasInstance, nil
}

// ArchiveAgent marks a canvas archived (FR-01-05). Archived apps cannot run
// but keep their history; un-archive is a separate path in the handler.
func (s *AgentService) ArchiveAgent(ctx context.Context, userID, canvasID string) error {
	canvasInstance, err := s.loadCanvasForUser(ctx, userID, canvasID, permission.OperationUpdate)
	if err != nil {
		return err
	}
	now := time.Now()
	canvasInstance.ArchivedAt = &now
	if err := s.canvasDAO.Update(ctx, dao.DB, canvasInstance); err != nil {
		return fmt.Errorf("archive agent %s: %w", canvasID, err)
	}
	s.writeAudit(ctx, userID, canvasInstance.UserID, canvasID, "archive", "canvas", canvasID, nil)
	return nil
}

// writeAudit appends an audit entry. It is a no-op safe for any caller: audit
// failures are logged, not propagated, so high-risk actions are not blocked by
// audit-store outages.
func (s *AgentService) writeAudit(ctx context.Context, operator, tenantID, canvasID, action, objectType, objectID string, after map[string]any) {
	_ = dao.NewAuditLogDAO().Create(ctx, dao.DB, &entity.AuditLog{
		ID:         common.GenerateUUID(),
		TenantID:   tenantID,
		CanvasID:   canvasID,
		Action:     action,
		ObjectType: objectType,
		ObjectID:   objectID,
		After:      after,
		Operator:   operator,
		CreateTime: time.Now().UnixMilli(),
	})
}
