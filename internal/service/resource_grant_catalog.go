package service

import (
	"errors"
	"fmt"
	"strings"

	"ragflow/internal/entity"
)

// grantKindSpec 描述"资源授权"页里的一类可授权资源：从哪张表取名字、所有者、
// 可见性列，以及怎样确认一行属于当前租户。
//
// 这张表是资源授权覆盖"全部资源类型"的唯一事实来源：新增一类资源只需要在
// grantKindCatalog 里加一行，控制台的 Tab、列表、可见性写入、租户归属校验
// 都跟着走。表名与列名全部来自这里的常量，**不接受任何外部拼装**。
type grantKindSpec struct {
	// Kind 是 resource_kind 的取值，必须与 permission.ResourceKind 一致。
	Kind  string
	Label string
	Table string
	// NameExpr 是展示名的 SQL 表达式（列名或 COALESCE 表达式）。
	NameExpr string
	// OwnerExpr 是所有者的 SQL 表达式。表里没有 created_by 的资源用租户 id
	// 兜底，页面会把它显示成租户 owner。
	OwnerExpr string
	// VisibilityColumn 是三级可见性列；空串表示这类资源不参与三档
	// （仍可逐人 / 逐部门授权）。
	VisibilityColumn string
	// TenantWhere 返回"这一行属于该租户"的 SQL 条件。
	TenantWhere func(tenantID string) (string, []any)
	// ExtraWhere 是额外的固定条件（例如只看文件夹）。
	ExtraWhere string
}

// tenantByColumn 是绝大多数资源的租户条件：表里有 tenant_id。
func tenantByColumn(column string) func(string) (string, []any) {
	return func(tenantID string) (string, []any) {
		return column + " = ?", []any{tenantID}
	}
}

// grantKindCatalog 是资源授权页支持的全部资源类型。
//
// 顺序即控制台 Tab 的顺序：先业务资产（知识库 / 知识问答 / 知识搜索 /
// 智能体 / 记忆中心），再文件与集成类资源。
var grantKindCatalog = []*grantKindSpec{
	{
		Kind: "dataset", Label: "知识库", Table: "knowledgebase",
		NameExpr: "knowledgebase.name", OwnerExpr: "knowledgebase.created_by",
		VisibilityColumn: "knowledgebase.permission",
		TenantWhere:      tenantByColumn("knowledgebase.tenant_id"),
	},
	{
		Kind: "chat", Label: "知识问答", Table: "dialog",
		NameExpr: "COALESCE(dialog.name, '')", OwnerExpr: "dialog.created_by",
		VisibilityColumn: "dialog.permission",
		TenantWhere:      tenantByColumn("dialog.tenant_id"),
	},
	{
		Kind: "search_app", Label: "知识搜索", Table: "search",
		NameExpr: "search.name", OwnerExpr: "search.created_by",
		VisibilityColumn: "search.permission",
		TenantWhere:      tenantByColumn("search.tenant_id"),
	},
	{
		Kind: "canvas", Label: "智能体", Table: "user_canvas",
		NameExpr: "COALESCE(user_canvas.title, '')", OwnerExpr: "user_canvas.user_id",
		VisibilityColumn: "user_canvas.permission",
		// tenant_id 是后加的列，老数据为空时 user_id 就代表租户。
		TenantWhere: func(tenantID string) (string, []any) {
			return "(user_canvas.tenant_id = ? OR ((user_canvas.tenant_id IS NULL OR user_canvas.tenant_id = '') AND user_canvas.user_id = ?))",
				[]any{tenantID, tenantID}
		},
	},
	{
		Kind: "memory", Label: "记忆中心", Table: "memory",
		NameExpr: "memory.name", OwnerExpr: "memory.created_by",
		VisibilityColumn: "memory.permissions",
		TenantWhere:      tenantByColumn("memory.tenant_id"),
	},
	{
		Kind: "file", Label: "文件", Table: "file",
		NameExpr: "file.name", OwnerExpr: "file.created_by",
		TenantWhere: tenantByColumn("file.tenant_id"),
		ExtraWhere:  "file.type <> 'folder'",
	},
	{
		Kind: "folder", Label: "文件夹", Table: "file",
		NameExpr: "file.name", OwnerExpr: "file.created_by",
		TenantWhere: tenantByColumn("file.tenant_id"),
		ExtraWhere:  "file.type = 'folder'",
	},
	{
		Kind: "mcp_server", Label: "MCP 服务", Table: "mcp_server",
		NameExpr: "mcp_server.name", OwnerExpr: "mcp_server.tenant_id",
		TenantWhere: tenantByColumn("mcp_server.tenant_id"),
	},
	{
		Kind: "connector", Label: "数据源", Table: "connector",
		NameExpr: "connector.name", OwnerExpr: "connector.tenant_id",
		TenantWhere: tenantByColumn("connector.tenant_id"),
	},
	{
		Kind: "skill_space", Label: "技能空间", Table: "skill_spaces",
		NameExpr: "skill_spaces.name", OwnerExpr: "skill_spaces.tenant_id",
		TenantWhere: tenantByColumn("skill_spaces.tenant_id"),
	},
}

// grantKindSpecs 是按 kind 索引的注册表，含文件级（document）子资源。
var grantKindSpecs = func() map[string]*grantKindSpec {
	out := make(map[string]*grantKindSpec, len(grantKindCatalog)+1)
	for _, spec := range grantKindCatalog {
		out[spec.Kind] = spec
	}
	// document 是 dataset 的子资源：名称/归属都从 document 表取，租户归属由
	// 父库决定（见 assertDocumentInDataset），所以这里不登记 TenantWhere。
	out[GrantKindDocument] = &grantKindSpec{
		Kind: GrantKindDocument, Label: "文件（知识库内）", Table: "document",
		NameExpr: "document.name", OwnerExpr: "document.created_by",
	}
	return out
}()

// grantKindSpecFor 解析外部传入的 kind；未登记的一律拒绝。
func grantKindSpecFor(kind string) (*grantKindSpec, error) {
	spec, ok := grantKindSpecs[strings.TrimSpace(kind)]
	if !ok || spec == nil {
		return nil, errors.New("不支持的资源类型")
	}
	return spec, nil
}

// GrantKindOption 是控制台渲染 Tab 用的一项（顺序即展示顺序）。
type GrantKindOption struct {
	Kind             string `json:"kind"`
	Label            string `json:"label"`
	SupportsVisibility bool `json:"supports_visibility"`
}

// GrantKindOptions 返回资源授权页支持的全部资源类型。
func GrantKindOptions() []GrantKindOption {
	out := make([]GrantKindOption, 0, len(grantKindCatalog))
	for _, spec := range grantKindCatalog {
		out = append(out, GrantKindOption{
			Kind:               spec.Kind,
			Label:              spec.Label,
			SupportsVisibility: spec.VisibilityColumn != "",
		})
	}
	return out
}

// visibilityLabel 把存储值翻成页面文案，供错误信息与日志使用。
func visibilityLabel(value string) string {
	switch entity.NormalizeResourceVisibility(value) {
	case entity.ResourceVisibilityTenantOwner:
		return "租户管理层可见"
	case entity.ResourceVisibilityPlatform:
		return "平台可见"
	}
	return "仅资源所有者可见"
}

// checkVisibility 校验外部传入的可见性取值。
func checkVisibility(value string) (string, error) {
	normalized := entity.NormalizeResourceVisibility(value)
	if !entity.IsResourceVisibility(normalized) {
		return "", fmt.Errorf("不支持的可见范围 %q", value)
	}
	return normalized, nil
}
