package dataset

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"ragflow/internal/common"
	"ragflow/internal/dao"
	"ragflow/internal/entity"
	"ragflow/internal/permission"
	permissionresponse "ragflow/internal/permission/response"

	"gorm.io/gorm"
)

// Dataset reference kinds. The values are part of the API contract consumed by
// the dataset list switch, which renders one label per kind.
const (
	DatasetReferenceKindChat       = "chat"
	DatasetReferenceKindAgent      = "agent"
	DatasetReferenceKindEvaluation = "evaluation"
)

// DatasetReference is one place that binds a dataset. A dataset that still has
// references cannot be disabled: disabling it would silently break retrieval in
// that app, so the caller must unbind it first.
type DatasetReference struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
	Name string `json:"name"`
	// Category narrows the app kind for agent canvases (agent / chatflow /
	// workflow) so the UI can show a precise label instead of guessing.
	Category string `json:"category,omitempty"`
}

// chatReferenceRow / canvasReferenceRow / evaluationReferenceRow read the raw
// JSON columns instead of the typed entities: kb_ids and dsl are longtext
// columns written by both the Go and the legacy Python side, and scanning them
// through JSONMap would fail the whole lookup when one row holds a shape the
// typed decoder does not expect. The raw string is enough for an exact
// membership check.
type chatReferenceRow struct {
	ID    string  `gorm:"column:id"`
	Name  *string `gorm:"column:name"`
	KBIDs *string `gorm:"column:kb_ids"`
}

type canvasReferenceRow struct {
	ID    string  `gorm:"column:id"`
	Title *string `gorm:"column:title"`
	// DSL is nullable in the shared schema; a plain string would make the scan
	// fail for any canvas that never stored a DSL.
	DSL      *string `gorm:"column:dsl"`
	Category string  `gorm:"column:canvas_category"`
}

type evaluationReferenceRow struct {
	ID    string  `gorm:"column:id"`
	Name  *string `gorm:"column:name"`
	KBIDs *string `gorm:"column:kb_ids"`
}

// ListDatasetReferences returns every app that currently binds datasetID.
//
// Only datasets the caller is allowed to update are inspected, mirroring
// UpdateDataset: the list is used to explain why a disable was rejected, so it
// must not leak app names to users who could not disable the dataset anyway.
func (d *DatasetService) ListDatasetReferences(ctx context.Context, datasetID, userID string) ([]DatasetReference, common.ErrorCode, error) {
	datasetID = strings.TrimSpace(datasetID)
	userID = strings.TrimSpace(userID)
	if datasetID == "" {
		return nil, common.CodeArgumentError, errors.New("dataset id is required")
	}

	kb, err := d.kbDAO.GetByID(ctx, dao.DB, datasetID)
	if err != nil {
		if dao.IsNotFoundErr(err) {
			code, permissionErr := permissionresponse.NormalizeHidden(permission.ErrResourceNotFound)
			return nil, code, permissionErr
		}
		return nil, common.CodeServerError, errors.New("database operation failed")
	}

	if err = permission.NewDatabaseChecker(dao.DB).CheckResource(
		ctx,
		permission.Subject{UserID: userID},
		permission.ResourceRef{Kind: permission.ResourceKindDataset, ID: datasetID},
		permission.OperationUpdate,
	); err != nil {
		code, permissionErr := permissionresponse.NormalizeHidden(err)
		return nil, code, permissionErr
	}

	refs, err := findDatasetReferences(ctx, dao.DB, kb)
	if err != nil {
		return nil, common.CodeServerError, err
	}
	return refs, common.CodeSuccess, nil
}

// findDatasetReferences is the shared lookup used by both the references API
// and the disable guard in UpdateDataset.
func findDatasetReferences(ctx context.Context, db *gorm.DB, kb *entity.Knowledgebase) ([]DatasetReference, error) {
	if kb == nil {
		return nil, nil
	}
	like := "%\"" + kb.ID + "\"%"
	needle := "\"" + kb.ID + "\""
	refs := make([]DatasetReference, 0, 4)

	var chats []chatReferenceRow
	if err := db.WithContext(ctx).
		Table("dialog").
		Select("id, name, kb_ids").
		Where("tenant_id = ? AND (status = ? OR status IS NULL) AND kb_ids LIKE ?", kb.TenantID, string(entity.StatusValid), like).
		Scan(&chats).Error; err != nil {
		return nil, errors.New("failed to look up chat references")
	}
	for _, chat := range chats {
		if chat.KBIDs == nil || !jsonColumnContains(*chat.KBIDs, needle) {
			continue
		}
		refs = append(refs, DatasetReference{
			Kind: DatasetReferenceKindChat,
			ID:   chat.ID,
			Name: stringOrEmpty(chat.Name),
		})
	}

	// user_canvas has no tenant column; scope it through user_tenant so a
	// same-shaped id in another tenant's canvas can never block this dataset.
	tenantUsers := db.WithContext(ctx).
		Model(&entity.UserTenant{}).
		Select("user_id").
		Where("tenant_id = ? AND (status = ? OR status IS NULL)", kb.TenantID, string(entity.StatusValid))

	var canvases []canvasReferenceRow
	if err := db.WithContext(ctx).
		Table("user_canvas").
		Select("id, title, dsl, canvas_category").
		Where("user_id IN (?)", tenantUsers).
		Where("dsl LIKE ?", like).
		Scan(&canvases).Error; err != nil {
		return nil, errors.New("failed to look up agent references")
	}
	for _, canvas := range canvases {
		if canvas.DSL == nil || !jsonColumnContains(*canvas.DSL, needle) {
			continue
		}
		refs = append(refs, DatasetReference{
			Kind:     DatasetReferenceKindAgent,
			ID:       canvas.ID,
			Name:     stringOrEmpty(canvas.Title),
			Category: canvas.Category,
		})
	}

	var evaluations []evaluationReferenceRow
	if err := db.WithContext(ctx).
		Table("evaluation_datasets").
		Select("id, name, kb_ids").
		Where("tenant_id = ? AND kb_ids LIKE ?", kb.TenantID, like).
		Scan(&evaluations).Error; err != nil {
		return nil, errors.New("failed to look up evaluation references")
	}
	for _, evaluation := range evaluations {
		if evaluation.KBIDs == nil || !jsonColumnContains(*evaluation.KBIDs, needle) {
			continue
		}
		refs = append(refs, DatasetReference{
			Kind: DatasetReferenceKindEvaluation,
			ID:   evaluation.ID,
			Name: stringOrEmpty(evaluation.Name),
		})
	}

	return refs, nil
}

// jsonColumnContains reports whether the raw JSON column value carries needle
// as a real value. The LIKE pre-filter is deliberately loose so it also matches
// ids embedded in nested DSL structures; this check is what keeps a substring
// collision from being reported as a reference.
func jsonColumnContains(raw, needle string) bool {
	if raw == "" || needle == "" {
		return false
	}
	if strings.Contains(raw, needle) {
		return true
	}
	// Normalise escaped payloads (double-encoded JSON columns written by the
	// legacy Python side) before giving up.
	var decoded string
	if err := json.Unmarshal([]byte(raw), &decoded); err == nil {
		return strings.Contains(decoded, needle)
	}
	return false
}

func stringOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

// DatasetReferencedError is returned when a dataset cannot be disabled because
// something still binds it. It carries the references so the HTTP layer can put
// them in the response body, not just in a message the UI would have to parse.
type DatasetReferencedError struct {
	References []DatasetReference
}

func (e *DatasetReferencedError) Error() string {
	names := make([]string, 0, len(e.References))
	for _, ref := range e.References {
		name := ref.Name
		if name == "" {
			name = ref.ID
		}
		names = append(names, name)
	}
	return "dataset is still referenced by " + strings.Join(names, ", ") +
		"; unbind it before disabling the dataset"
}
