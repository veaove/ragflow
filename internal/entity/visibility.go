package entity

import "strings"

// 资源可见性三档。三档是**收窄**语义：普通成员（normal）不在任何一档里，
// 想看到别人的资源必须通过 resource_grant 逐人 / 逐部门显式授权。
//
//	owner        仅资源 owner（创建者）与平台超级管理员
//	tenant_owner 资源 owner + 本租户 owner / 租户管理员 + 平台超级管理员
//	platform     资源 owner + 本租户 owner / 租户管理员 + 平台超级管理员
//	             （三档里最外一层，供平台侧跨租户视图与运维审计使用）
//
// 三档都包含「资源 owner 自己」，所以创建者永远打不开自己建的东西这种事不会
// 发生；差别只在「上一层管理角色是否可见」。
const (
	ResourceVisibilityOwner       = "owner"
	ResourceVisibilityTenantOwner = "tenant_owner"
	ResourceVisibilityPlatform    = "platform"
)

// 旧值：这列出现之前只有 me / team 两个取值（knowledgebase.permission、
// user_canvas.permission、memory.permissions）。
const (
	legacyVisibilityMe   = "me"
	legacyVisibilityTeam = "team"
)

// NormalizeResourceVisibility 把任意历史值收敛成三档之一。
//
// me → owner：语义本来就是「只有自己」。
// team → tenant_owner：原来表示「全团队可见」，现在收窄成「租户管理层可见」，
// 普通成员改为逐人授权。这是本次权限改版里唯一一处**破坏性收窄**，历史行
// 不迁移数据，靠读取时归一化，避免一次性改写线上库。
func NormalizeResourceVisibility(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case ResourceVisibilityTenantOwner, legacyVisibilityTeam, "tenant":
		return ResourceVisibilityTenantOwner
	case ResourceVisibilityPlatform, "public", "platform_admin":
		return ResourceVisibilityPlatform
	case ResourceVisibilityOwner, legacyVisibilityMe, "private", "":
		return ResourceVisibilityOwner
	}
	// 认不出来的值按最严档处理：收紧比放开安全。
	return ResourceVisibilityOwner
}

// IsResourceVisibility 报告 value（归一化后）是否是合法的三档之一。
func IsResourceVisibility(value string) bool {
	switch NormalizeResourceVisibility(value) {
	case ResourceVisibilityOwner, ResourceVisibilityTenantOwner, ResourceVisibilityPlatform:
		return true
	}
	return false
}
