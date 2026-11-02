package dataset

import (
	"fmt"
	"strings"

	"ragflow/internal/entity"
)

// normalizeDatasetVisibility 校验并归一化知识库的可见范围。
//
// 三档是 owner / tenant_owner / platform（见 entity/visibility.go）。历史客户端
// 仍会传 me / team，这里一并接受并归一化（me→owner、team→tenant_owner），避免
// 旧前端一升级就 400。其它取值直接报错，不做静默兜底 —— 悄悄改成 owner 会让
// 调用方以为「已经共享给管理层」。
func normalizeDatasetVisibility(raw string) (string, error) {
	value := strings.ToLower(strings.TrimSpace(raw))
	switch value {
	case entity.ResourceVisibilityOwner,
		entity.ResourceVisibilityTenantOwner,
		entity.ResourceVisibilityPlatform,
		"me",
		"team":
		return entity.NormalizeResourceVisibility(value), nil
	}
	return "", fmt.Errorf("permission must be one of %q, %q, %q",
		entity.ResourceVisibilityOwner, entity.ResourceVisibilityTenantOwner, entity.ResourceVisibilityPlatform)
}
