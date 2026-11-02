# 可见范围三级模型与角色边界

这份文档定义本次权限改版后的**唯一**可见性语义与角色边界。实现落点：
`internal/entity/visibility.go`、`internal/permission/policy_ce.go`、
`internal/service/resource_grant_catalog.go`、`web/src/pages/console/grants.tsx`。

## 一、三级可见性（收窄语义）

每个可授权资源都有一个可见范围，取值只有三档：

| 档位 | 谁能看到 | 说明 |
|---|---|---|
| `owner`（默认） | 资源创建者 / 所有者、平台超级管理员 | 新建资源的默认值 |
| `tenant_owner` | 上述人员 + 本租户 owner / 租户管理员 | 租户管理层可见，普通成员仍不可见 |
| `platform` | 上述人员 + 平台侧跨租户视图与审计 | 目前租户内规则与 `tenant_owner` 相同 |

**普通成员（normal）不在任何一档里。** 要让某个成员看到别人的资源，必须在
「资源授权」页里逐人 / 逐部门授予 `read` 或 `edit`；授权是唯一的口子。

历史值按以下方式归一化，不迁移数据、读取时收敛：

- `me` → `owner`（语义本来就是「只有自己」）
- `team` → `tenant_owner`（**破坏性收窄**：原来是全租户成员可见，现在只到管理层；
  普通成员改为逐人授权）
- 空值 / 未知值 → `owner`（认不出来就按最严处理）

## 二、判定顺序

单资源判定（`CheckResource` / `ResolveAccess`）：

1. 资源存在且属于调用租户，否则 `ErrResourceNotFound` / 拒绝。
2. 平台超级管理员（`user.is_superuser`）→ 通过，来源记 `platform_admin`。
3. 资源所有者（`OwnerUserID`）→ 通过，来源 `owner`。
4. 按可见范围：
   - `owner`：跳过租户管理员，进第 5 步。
   - `tenant_owner` / `platform`：租户 owner / 租户管理员 → 通过，来源 `tenant`；否则进第 5 步。
5. 显式授权（`resource_grant`）：`edit` 给全量操作，`read` 只给「看 + 检索 + 使用」。
6. 部门管理员：创建者在本部门（含子部门）时只读放行，来源 `tenant`。
7. 其余一律拒绝。

列表判定（`Scope` / `QueryScope`）走同一套判定，因此「列表里能看到」与
「点进去能打开」不会分叉。

## 三、角色 × 资源边界

| 角色 | 自己的资源 | `owner` 档他人资源 | `tenant_owner` 档 | 被授权的资源 | 跨租户资源 |
|---|---|---|---|---|---|
| 资源所有者 | 全量操作 | — | — | — | 拒绝 |
| 租户 owner | 全量操作 | 拒绝 | 全量操作 | 按授权 | 拒绝 |
| 租户管理员 | 全量操作 | 拒绝 | 全量操作 | 按授权 | 拒绝 |
| 部门管理员 | 全量操作 | 只读 | 只读（本部门） | 按授权 | 拒绝 |
| 普通成员 | 全量操作 | 拒绝 | 拒绝 | `read` / `edit` | 拒绝 |
| 平台超级管理员 | 全量操作 | 全量操作 | 全量操作 | 全量操作 | 全量操作（只用于运维审计） |

要点：

- 「自己的资源」永远可用：创建者不受可见范围限制，避免「设成仅自己后自己也打不开」。
- 租户管理员进不了 `owner` 档：这一档就是「只有我和超管」。
- 部门管理员对他人资源只有只读，改 / 删 / 再授权仍归创建者与租户管理层。
- 跨租户一律拒绝，授权不跨租户生效。

## 四、模块访问边界

模块级权限（`role_permission`，25 个模块）与资源级权限是两条正交的线：模块决定
「能不能进这个页面」，资源决定「进去之后能看见哪些行」。

| 模块 | 关键动作 | 模块权限之外还需要的资源条件 |
|---|---|---|
| 知识库 `dataset` | 列表 / 详情 / 检索 | 资源可见范围或逐人授权 |
| 知识问答 `chat` | 新建 / 对话 / 配置 | 默认仅自己；共享靠授权 |
| 知识搜索 `search` | 检索 / 配置 | 默认仅自己；共享靠授权 |
| 智能体 `canvas` | 编排 / 运行 | 默认仅自己；`team` 收窄为管理层 |
| 记忆中心 `memory` | 记忆读写 / 遗忘策略 | 默认仅自己；`team` 收窄为管理层 |
| 资源授权 `grant` | 查看列表 / 改可见范围 / 改授权 | 改配置需要租户 owner 或管理员 |
| 组织架构 `organization` | 部门树 | 仅用于授权选人，无权限时下拉留空 |
| 用户管理 `member` | 成员列表 | 同上 |

## 五、资源授权覆盖范围

「资源授权」页的 Tab 由后端注册表给出（`GET /tenants/:id/grant-kinds`），
新增一类资源只需要在 `grantKindCatalog` 里加一行：

| kind | 表 | 名称列 | 所有者 | 支持三档可见性 |
|---|---|---|---|---|
| `dataset` | `knowledgebase` | `name` | `created_by` | 是 |
| `chat` | `dialog` | `name` | `created_by` | 是 |
| `search_app` | `search` | `name` | `created_by` | 是 |
| `canvas` | `user_canvas` | `title` | `user_id` | 是 |
| `memory` | `memory` | `name` | `created_by` | 是 |
| `file` | `file` | `name` | `created_by` | 否（逐人授权） |
| `folder` | `file`（`type='folder'`） | `name` | `created_by` | 否 |
| `mcp_server` | `mcp_server` | `name` | 租户 owner | 否 |
| `connector` | `connector` | `name` | 租户 owner | 否 |
| `skill_space` | `skill_spaces` | `name` | 租户 owner | 否 |
| `document` | `document` | `name` | `created_by` | 子资源，继承所属知识库 |

文件级（`document`）规则只做细化：库不可见时文件一律不可见；库可见时，
文件自己有条目就以条目为准（`allow` / `deny`），没有则继承库。

## 六、接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/tenants/:tenant_id/grants?kind=` | 某类资源的列表 + 规则 |
| GET | `/tenants/:tenant_id/grant-kinds` | Tab 清单（kind / label / supports_visibility） |
| PUT | `/tenants/:tenant_id/grants/:kind/:resource_id` | 覆盖某资源的授权集合 |
| PUT | `/tenants/:tenant_id/grants/:kind/:resource_id/visibility` | 改三级可见范围 |
| GET | `/tenants/:tenant_id/grants/dataset/:id/documents` | 展开库内文件及规则 |

约束：

- 写操作需要租户 owner 或租户管理员（`requireTenantAccess(..., true)`）。
- 资源级授权不支持 `deny`：收回权限用「改可见范围」或「移除授权」，避免两套
  拒绝语义争优先级；`deny` 只用于文件级。
- 授权集合是**整体覆盖**语义：提交空数组即清空，回到可见范围的默认行为。
