package service

import (
	"context"
	"errors"
	"strings"

	"ragflow/internal/dao"
	"ragflow/internal/entity"
)

// GrantDocumentView is one file row under a knowledge base on the console's
// resource authorization page.
type GrantDocumentView struct {
	DocumentID    string `json:"document_id"`
	DocumentName  string `json:"document_name"`
	Suffix        string `json:"suffix"`
	Size          int64  `json:"size"`
	CreatedBy     string `json:"created_by"`
	CreatedByName string `json:"created_by_name"`
	UpdateTime    int64  `json:"update_time"`
	// Restricted 表示这个文件不再继承知识库的可见范围，而是由自己的规则接管。
	// 前端据此区分「继承自知识库」与「已单独授权 / 已排除」。
	Restricted bool           `json:"restricted"`
	Grants     []GrantSubject `json:"grants"`
}

// ListDocuments returns a page of files inside datasetID together with their
// file-level rules.
//
// 控制台的资源行按需展开，所以这里是独立的一次分页查询，而不是把整库文件
// 挂在资源列表上：一个库可能有上千个文件，展开哪个查哪个。
func (s *ResourceGrantService) ListDocuments(ctx context.Context, tenantID, datasetID, keywords string, limit, offset int) ([]*GrantDocumentView, int64, error) {
	if strings.TrimSpace(datasetID) == "" {
		return nil, 0, errors.New("缺少知识库 id")
	}
	if err := s.assertResourceInTenant(ctx, tenantID, grantKindSpecs["dataset"], datasetID); err != nil {
		return nil, 0, err
	}
	if limit <= 0 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}

	q := dao.DB.WithContext(ctx).Model(&entity.Document{}).
		Where("document.kb_id = ?", datasetID)
	if kw := strings.TrimSpace(keywords); kw != "" {
		q = q.Where("LOWER(document.name) LIKE ?", "%"+strings.ToLower(kw)+"%")
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	type row struct {
		ID         string  `gorm:"column:id"`
		Name       *string `gorm:"column:name"`
		Suffix     string  `gorm:"column:suffix"`
		Size       int64   `gorm:"column:size"`
		CreatedBy  string  `gorm:"column:created_by"`
		UpdateTime *int64  `gorm:"column:update_time"`
	}
	raw := make([]row, 0)
	if err := q.Select("document.id, document.name, document.suffix, document.size, document.created_by, document.update_time").
		Order("document.create_time DESC").
		Limit(limit).Offset(offset).
		Scan(&raw).Error; err != nil {
		return nil, 0, err
	}

	out := make([]*GrantDocumentView, 0, len(raw))
	docIDs := make([]string, 0, len(raw))
	creatorIDs := make([]string, 0, len(raw))
	for _, r := range raw {
		name := ""
		if r.Name != nil {
			name = *r.Name
		}
		updateTime := int64(0)
		if r.UpdateTime != nil {
			updateTime = *r.UpdateTime
		}
		out = append(out, &GrantDocumentView{
			DocumentID:   r.ID,
			DocumentName: name,
			Suffix:       r.Suffix,
			Size:         r.Size,
			CreatedBy:    r.CreatedBy,
			UpdateTime:   updateTime,
		})
		docIDs = append(docIDs, r.ID)
		creatorIDs = append(creatorIDs, r.CreatedBy)
	}

	grantMap, err := dao.NewResourceGrantDAO().ListByResources(ctx, dao.DB, tenantID, GrantKindDocument, docIDs)
	if err != nil {
		return nil, 0, err
	}
	names := s.ownerNames(ctx, creatorIDs)
	for _, row := range out {
		rows := grantMap[row.DocumentID]
		row.CreatedByName = names[row.CreatedBy]
		row.Grants = s.describeGrants(ctx, tenantID, rows)
		row.Restricted = len(rows) > 0
	}
	return out, total, nil
}
