package service

import (
	"context"
	"errors"

	"ragflow/internal/dao"
	"ragflow/internal/permission"
)

// CheckDatasetAccess checks a dataset operation using the active edition's permission policy.
func CheckDatasetAccess(ctx context.Context, subject permission.Subject, datasetID string, operation permission.Operation) error {
	return permission.NewDatabaseChecker(dao.DB).CheckResource(
		ctx,
		subject,
		permission.ResourceRef{Kind: permission.ResourceKindDataset, ID: datasetID},
		operation,
	)
}

// VisibleDatasetIDs splits datasetIDs into the ones the subject may use and the
// ones it may not. An id that no longer resolves (deleted or disabled) lands in
// neither list: it holds no content to leak, and callers already drop such
// bindings elsewhere.
//
// Callers that answer questions from a fixed corpus use this to narrow to what
// the caller can actually read, instead of refusing the whole turn when one
// binding is out of reach. Callers that need the strict "every binding or
// nothing" policy keep looping over CheckDatasetAccess themselves.
func VisibleDatasetIDs(ctx context.Context, subject permission.Subject, datasetIDs []string) (allowed []string, denied []string) {
	for _, datasetID := range datasetIDs {
		if datasetID == "" {
			continue
		}
		err := CheckDatasetAccess(ctx, subject, datasetID, permission.OperationUse)
		if err == nil {
			allowed = append(allowed, datasetID)
			continue
		}
		if errors.Is(err, permission.ErrResourceNotFound) {
			continue
		}
		denied = append(denied, datasetID)
	}
	return allowed, denied
}
