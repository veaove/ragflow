//
// Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package permission

import (
	"context"
	"strings"

	"gorm.io/gorm"

	"ragflow/internal/entity"
)

// 文件级授权与库级授权的判定规则（列表、单文件、检索三处共用同一份）：
//
//   - 库级判定是前提：进不了库的人，文件级规则不会把他放进来。
//   - 文件没有任何显式规则 → 完全继承库级可见范围。这是默认，也是绝大多数
//     文件的状态。
//   - 文件一旦有显式规则 → 该文件的可见性由文件级规则接管：
//   - 命中 deny  → 不可见。deny 压过任何 allow（含库级的 allow 与同一文件上
//     的 allow），否则"把某个人排除掉"会被部门 / 全团队的 allow 覆盖回去；
//   - 命中 allow → 可见，可执行的操作由 permission（read/edit）再收一层；
//   - 都没命中   → 不可见。显式规则就是一份名单，不在名单内的主体不再继承
//     库级可见范围 —— 否则"文件级授权"对本来就看得见库的人毫无意义。
//   - 库主人 / 创建者 / 租户管理员不受文件级规则影响。库里必须始终有人能看
//     见全部文件，否则一条 deny 就能把文件锁到没人能取消它。
//
// 三处入口：
//   - DocumentVisibility：库内文件列表（SQL 谓词，和分页/计数同一口径）
//   - CheckDocumentAccess：单文件内容（切片、预览、下载、详情）
//   - HiddenDocumentIDs：检索链路（把被拒绝的文件从命中集合里摘掉）

// documentRuleClause 返回「该主体在这个库的文件上不受文件级规则限制」的 SQL
// 谓词；调用方查询的表必须是 document（谓词按 document.id 关联规则）。
//
// ok=false 表示不需要过滤：库主人 / 创建者 / 租户管理员，或判定不出库级访问
// （此时沿用调用方已经做过的库级结论）。
func documentRuleClause(ctx context.Context, db *gorm.DB, subject Subject, datasetID string) (string, []any, bool) {
	if db == nil || strings.TrimSpace(subject.UserID) == "" || strings.TrimSpace(datasetID) == "" {
		return "", nil, false
	}

	access, err := NewDatabaseChecker(db).ResolveAccess(ctx, subject, ResourceRef{
		Kind: ResourceKindDataset,
		ID:   datasetID,
	})
	if err != nil {
		// 判定不出来时不做额外限制：库级检查已经先跑过，这里再 fail closed
		// 会让一次偶发查询失败变成"整个库的文件全消失"。与 grantLevel 同一
		// 条取舍：授权是额外收敛，不是全站的单点依赖。
		return "", nil, false
	}
	if access.Source == AccessSourceOwner {
		return "", nil, false
	}

	subjectWhere, subjectArgs := grantSubjectCondition(
		db, subject.UserID, lookupDepartmentID(ctx, db, subject.UserID),
	)
	// 只针对当前这一行 document 的规则子查询。三条共用同一个形态，只有
	// subject / effect 条件不同。
	//
	// 不带 tenant_id 条件：document 表没有租户列（租户在 knowledgebase 上），
	// 而调用方本来就按单库查询，文件 id 又是全局唯一的 UUID。
	ruleQuery := func() *gorm.DB {
		return db.Model(&entity.ResourceGrant{}).
			Select("1").
			Where("resource_grant.resource_kind = ?", string(ResourceKindDocument)).
			Where("resource_grant.resource_id = document.id")
	}
	hasRules := ruleQuery()
	denied := ruleQuery().
		Where("resource_grant.effect = ?", entity.GrantEffectDeny).
		Where(subjectWhere, subjectArgs...)
	// 空 effect 按 allow 处理：这列出现之前的存量行语义就是"授予"。
	allowed := ruleQuery().
		Where("COALESCE(NULLIF(resource_grant.effect, ''), ?) = ?",
			entity.GrantEffectAllow, entity.GrantEffectAllow).
		Where(subjectWhere, subjectArgs...)

	clause := "NOT EXISTS (?) AND (NOT EXISTS (?) OR EXISTS (?))"
	return clause, []any{denied, hasRules, allowed}, true
}

// DocumentVisibility returns the predicate that hides the documents of one
// dataset from the subject. 返回"无限制"的 scope 时调用方无需过滤。
func DocumentVisibility(ctx context.Context, db *gorm.DB, subject Subject, datasetID string) QueryScope {
	unrestricted := QueryScope{apply: func(query *gorm.DB) *gorm.DB { return query }}
	clause, args, ok := documentRuleClause(ctx, db, subject, datasetID)
	if !ok {
		return unrestricted
	}
	return QueryScope{apply: func(query *gorm.DB) *gorm.DB {
		return query.Where(clause, args...)
	}}
}

// documentReadOperation 报告一次操作是否属于"只看"。
//
// 与 readOnlyOperations 同一口径：read/run/use 是"看内容、拿它去检索/问答"，
// create/update/delete/delete_content/share 都会改到内容或再授权出去。
func documentReadOperation(operation Operation) bool {
	switch operation {
	case OperationRead, OperationRun, OperationUse:
		return true
	}
	return false
}

// CheckDocumentAccess 判定 subject 能否对单个文件执行 operation。
//
// 库级判定由调用方先做（CheckDatasetAccess），这里只负责文件级收紧，因此：
//   - 文件没有显式规则 → 放行（继承库级结论）；
//   - 命中 deny → 拒绝；
//   - 命中 allow 且级别为 read → 只放行看/检索/解析，写操作拒绝；
//   - 命中 allow 且级别为 edit → 放行；
//   - 有规则但没命中 → 拒绝。
//
// datasetID 只是"文件所属库"的入参兜底：文件能查到时一律以文件自己的 kb_id
// 为准，避免调用方传错库导致文件级规则被库主人的身份绕过。
func CheckDocumentAccess(ctx context.Context, db *gorm.DB, subject Subject, datasetID, documentID string, operation Operation) error {
	if db == nil || strings.TrimSpace(subject.UserID) == "" || strings.TrimSpace(documentID) == "" {
		return nil
	}

	var doc struct {
		KbID string `gorm:"column:kb_id"`
	}
	if err := db.WithContext(ctx).Model(&entity.Document{}).
		Select("kb_id").Where("id = ?", documentID).Take(&doc).Error; err == nil && doc.KbID != "" {
		datasetID = doc.KbID
	}
	if strings.TrimSpace(datasetID) == "" {
		// 定位不到库时没有可继承的库级结论，交给调用方的库级检查。
		return nil
	}

	access, err := NewDatabaseChecker(db).ResolveAccess(ctx, subject, ResourceRef{
		Kind: ResourceKindDataset,
		ID:   datasetID,
	})
	if err != nil {
		if errorsIsPermissionDenial(err) {
			// 库级已经被明确拒绝：文件级没有理由比库级更宽松。
			return ErrPermissionDenied
		}
		// 定位不到库 / 判定不出来（授权表缺失、库刚被删除）不额外放大结论：
		// 库级已由调用方判定过，这里只做收紧。
		return nil
	}
	if access.Source == AccessSourceOwner {
		return nil
	}

	var ruleTotal int64
	if err := db.WithContext(ctx).Model(&entity.ResourceGrant{}).
		Where("resource_kind = ? AND resource_id = ?", string(ResourceKindDocument), documentID).
		Count(&ruleTotal).Error; err != nil || ruleTotal == 0 {
		// 缺表 / 无规则都按继承处理。
		return nil
	}

	subjectWhere, subjectArgs := grantSubjectCondition(
		db.WithContext(ctx), subject.UserID, lookupDepartmentID(ctx, db, subject.UserID),
	)
	var matched struct {
		Matched int64 `gorm:"column:matched"`
		Denied  int64 `gorm:"column:denied"`
		Edits   int64 `gorm:"column:edits"`
	}
	err = db.WithContext(ctx).Model(&entity.ResourceGrant{}).
		Select("COUNT(*) AS matched, "+
			"COALESCE(SUM(CASE WHEN resource_grant.effect = ? THEN 1 ELSE 0 END), 0) AS denied, "+
			"COALESCE(SUM(CASE WHEN COALESCE(NULLIF(resource_grant.permission, ''), ?) = ? THEN 1 ELSE 0 END), 0) AS edits",
			entity.GrantEffectDeny, "edit", "edit").
		Where("resource_kind = ? AND resource_id = ?", string(ResourceKindDocument), documentID).
		Where(subjectWhere, subjectArgs...).
		Scan(&matched).Error
	if err != nil {
		return nil
	}
	if matched.Matched == 0 || matched.Denied > 0 {
		return ErrPermissionDenied
	}
	if matched.Edits == 0 && !documentReadOperation(operation) {
		return ErrPermissionDenied
	}
	return nil
}

// HiddenDocumentIDs returns the documents in datasetIDs that the subject may not
// see because of file-level rules, keyed by knowledge base. 检索链路据此把整份
// 文件从命中集合里摘掉。
//
// 只有真正存在文件级规则的库才会被逐库判定：绝大多数库一个规则都没有，
// 一条查询就能提前返回，不给每次检索都叠上"逐库解析访问来源"的开销。
func HiddenDocumentIDs(ctx context.Context, db *gorm.DB, subject Subject, datasetIDs []string) (map[string][]string, error) {
	if db == nil || strings.TrimSpace(subject.UserID) == "" || len(datasetIDs) == 0 {
		return nil, nil
	}

	restrictedKBIDs := make([]string, 0)
	err := db.WithContext(ctx).Model(&entity.Document{}).
		Distinct("document.kb_id").
		Where("document.kb_id IN ?", datasetIDs).
		Where("EXISTS (?)", db.Model(&entity.ResourceGrant{}).
			Select("1").
			Where("resource_grant.resource_kind = ?", string(ResourceKindDocument)).
			Where("resource_grant.resource_id = document.id")).
		Pluck("document.kb_id", &restrictedKBIDs).Error
	if err != nil {
		return nil, err
	}
	if len(restrictedKBIDs) == 0 {
		return nil, nil
	}

	hidden := make(map[string][]string, len(restrictedKBIDs))
	for _, kbID := range restrictedKBIDs {
		clause, args, ok := documentRuleClause(ctx, db, subject, kbID)
		if !ok {
			continue
		}
		var ids []string
		if err := db.WithContext(ctx).Table("document").
			Where("document.kb_id = ?", kbID).
			Where("NOT ("+clause+")", args...).
			Pluck("document.id", &ids).Error; err != nil {
			return nil, err
		}
		if len(ids) > 0 {
			hidden[kbID] = ids
		}
	}
	return hidden, nil
}
