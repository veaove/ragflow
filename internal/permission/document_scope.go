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

// DocumentVisibility returns the predicate that hides the documents of one
// dataset from the subject.
//
// 文件级授权与库级授权的层级关系：
//   - 库级判定是前提：进不了库的人，文件级规则不会把他放进来（库不可见时
//     列表接口在进入这里之前就已经 403）。
//   - 文件没有任何显式规则 → 完全继承库级可见范围，谓词放行。这是默认，
//     也是绝大多数文件的状态。
//   - 文件一旦有显式规则 → 该文件的可见性由文件级规则接管：
//   - 命中 deny     → 不可见。deny 压过任何 allow（含库级的 allow，
//     以及同一文件上的 allow），否则"把某个人排除掉"会被部门 / 全团队的
//     allow 覆盖回去，等于没写；
//   - 命中 allow    → 可见，可执行的操作由该条授权的 permission（read/edit）
//     决定；
//   - 都没命中      → 不可见。显式规则就是一份名单，不在名单内的主体不再
//     继承库级可见范围 —— 否则"文件级授权"对本来就看得见库的人毫无意义。
//   - 库的主人 / 创建者 / 租户管理员不受文件级规则影响。库里必须始终有人
//     能看见全部文件，否则一条 deny 就能把文件锁到没人能取消它。
//
// 返回"无限制"的 scope 时调用方无需过滤。
func DocumentVisibility(ctx context.Context, db *gorm.DB, subject Subject, datasetID string) QueryScope {
	unrestricted := QueryScope{apply: func(query *gorm.DB) *gorm.DB { return query }}
	if db == nil || strings.TrimSpace(subject.UserID) == "" || strings.TrimSpace(datasetID) == "" {
		return unrestricted
	}

	access, err := NewDatabaseChecker(db).ResolveAccess(ctx, subject, ResourceRef{
		Kind: ResourceKindDataset,
		ID:   datasetID,
	})
	if err != nil {
		// 判定不出来时不做额外限制：库级检查已经先跑过，这里再 fail closed
		// 会让一次偶发查询失败变成"整个库的文件全消失"。与 grantLevel 同一
		// 条取舍：授权是额外收敛，不是全站的单点依赖。
		return unrestricted
	}
	if access.Source == AccessSourceOwner {
		return unrestricted
	}

	subjectWhere, subjectArgs := grantSubjectCondition(
		db, subject.UserID, lookupDepartmentID(ctx, db, subject.UserID),
	)
	// 只针对当前这一行 document 的规则子查询。三条共用同一个形态，只有
	// subject / effect 条件不同。
	//
	// 不带 tenant_id 条件：document 表没有租户列（租户在 knowledgebase 上），
	// 而调用方本来就按单库查询，文件 id 又是全局唯一的 UUID。硬塞一条
	// knowledgebase 子查询只会给每一行多加一次查询。
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

	return QueryScope{apply: func(query *gorm.DB) *gorm.DB {
		return query.Where(
			"NOT EXISTS (?) AND (NOT EXISTS (?) OR EXISTS (?))",
			denied, hasRules, allowed,
		)
	}}
}
