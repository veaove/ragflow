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
// the dataset list switch and the dataset overview "apps" tab, both of which
// render one label per kind.
const (
	DatasetReferenceKindChat       = "chat"
	DatasetReferenceKindSearch     = "search"
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

// chatReferenceRow / searchReferenceRow / canvasReferenceRow /
// evaluationReferenceRow read the raw JSON columns instead of the typed
// entities: kb_ids, search_config and dsl are longtext columns written by both
// the Go and the legacy Python side, and scanning them through JSONMap would
// fail the whole lookup when one row holds a shape the typed decoder does not
// expect. The raw string is enough for an exact membership check.
type chatReferenceRow struct {
	ID    string  `gorm:"column:id"`
	Name  *string `gorm:"column:name"`
	KBIDs *string `gorm:"column:kb_ids"`
}

// searchReferenceRow keeps the bound dataset ids inside search_config.kb_ids.
// Older rows hold `{}`, so the column is nullable here and only inspected after
// the LIKE scan narrowed the set.
type searchReferenceRow struct {
	ID           string  `gorm:"column:id"`
	Name         *string `gorm:"column:name"`
	SearchConfig *string `gorm:"column:search_config"`
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
// Read access is enough: the list backs both the "cannot disable, unbind first"
// dialog on the dataset list and the "apps" tab of the dataset overview, so a
// reader who can open the dataset must be able to see which apps use it. The
// disable guard itself is enforced by UpdateDataset, which requires update
// permission on its own, so relaxing this lookup does not weaken it.
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
		permission.OperationRead,
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

	// Scope every lookup to the tenant that owns the dataset. Rows written by
	// the legacy Python side can carry the creator's *user id* in tenant_id
	// instead of the tenant id (this deployment has tenant_id != user_id), so
	// matching on the tenant id alone silently misses those apps — a search app
	// bound to the dataset would then neither show up in the "apps" tab nor
	// block a disable. Member ids cover both shapes: a user id is globally
	// unique, so an app stamped with one belongs to a member of exactly this
	// tenant.
	memberUsers := db.WithContext(ctx).
		Model(&entity.UserTenant{}).
		Select("user_id").
		Where("tenant_id = ? AND (status = ? OR status IS NULL)", kb.TenantID, string(entity.StatusValid))

	var chats []chatReferenceRow
	if err := db.WithContext(ctx).
		Table("dialog").
		Select("id, name, kb_ids").
		Where("(tenant_id = ? OR tenant_id IN (?)) AND (status = ? OR status IS NULL) AND kb_ids LIKE ?",
			kb.TenantID, memberUsers, string(entity.StatusValid), like).
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

	// Knowledge-search apps keep their bound datasets inside search_config, a
	// JSON object shaped `{"kb_ids":[...], ...}`. Anything that does not carry
	// this dataset in kb_ids is filtered out below, so a row whose config also
	// mentions the id elsewhere (e.g. a chat_id) is not reported.
	var searches []searchReferenceRow
	if err := db.WithContext(ctx).
		Table("search").
		Select("id, name, search_config").
		Where("(tenant_id = ? OR tenant_id IN (?)) AND (status = ? OR status IS NULL) AND search_config LIKE ?",
			kb.TenantID, memberUsers, string(entity.StatusValid), like).
		Scan(&searches).Error; err != nil {
		return nil, errors.New("failed to look up search references")
	}
	for _, search := range searches {
		if search.SearchConfig == nil || !jsonColumnContains(*search.SearchConfig, needle) {
			continue
		}
		refs = append(refs, DatasetReference{
			Kind: DatasetReferenceKindSearch,
			ID:   search.ID,
			Name: stringOrEmpty(search.Name),
		})
	}

	// user_canvas has no reliable tenant column (old rows leave it empty and
	// fall back to user_id), so it is scoped through membership alone.
	var canvases []canvasReferenceRow
	if err := db.WithContext(ctx).
		Table("user_canvas").
		Select("id, title, dsl, canvas_category").
		Where("user_id IN (?)", memberUsers).
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
		Where("(tenant_id = ? OR tenant_id IN (?)) AND kb_ids LIKE ?", kb.TenantID, memberUsers, like).
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
