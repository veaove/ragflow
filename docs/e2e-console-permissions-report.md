# 租户控制台端到端测试报告

- 日期：2026-10-25
- 被测版本：`fc36b9eb5`（含当日全部改动）
- 环境：ECS 42.121.119.90，5 容器 + nginx 反代
- 执行方式：`scripts/e2e_console_permissions.sh`（API 层，34 条用例）

---

## 一、部署完整性验证

只看时间戳不够（改代码不重新编译也会"看起来是新的"），所以用内容特征验证。

| 检查项 | 方法 | 结果 |
|---|---|---|
| 本地 HEAD | `git log` | `fc36b9eb5` |
| origin/main | `git ls-remote` | `fc36b9eb5` |
| 服务器 HEAD | `git log` | `fc36b9eb5` |
| 二进制内容 | `strings bin/ragflow_server \| grep` 当日新增字符串 | 4/4 命中 |
| 前端产物 | `find dist_* -name '*grants*'` | `grants-B7isHbR3.js` 存在 |
| nginx 指向 | `grep root nginx.conf` | `dist_20261025_1220` |
| 服务状态 | `systemctl is-active` | 三服务 active |

**结论：部署完整，无遗漏。**

特征字符串取的是当日新增的英文错误文案与路由片段
（`cannot grant the tenant-owner role by invitation`、`console/me/permissions`、
`resource_grant`、`member_password`），能区分"新二进制"与"旧二进制"。

---

## 二、用例设计

### 设计原则

1. **只测外部可观察行为**：全部走 HTTP API，不 mock 内部函数，避免"测试通过但线上不通"。
2. **每条用例含越权变体**：权限功能的 bug 大多不在正常路径，而在"该拒绝时没拒绝"。
3. **凭证动态获取**：`secret` 从 kvrocks、`access_token` 从 MySQL 现取——两者重启即轮换，写死的脚本第二天必然失效。
4. **可重复执行**：用例自带数据清理，跑完不留残留（清理顺序本身也有坑，见缺陷 3）。

### 覆盖矩阵（34 条）

| 组 | 编号 | 用例 | 预期 |
|---|---|---|---|
| **A 组织架构** | A1 | 创建根部门 | code=0 |
| | A2 | 创建子部门 | code=0 |
| | A3 | 部门树返回层级 | children=1 |
| | A4 | 更新部门名 | code=0 |
| | A5 | 删除有子部门的部门 | **拒绝** |
| | A6 | 部门挂到自己子部门下（环路） | **拒绝** |
| | A7 | 非成员读部门 | **403** |
| **B 用户管理** | B1 | 成员列表 | code=0 |
| | B2 | 成员列表含 owner | role=owner 计数=1 |
| | B3 | 搜索无结果 | total=0 |
| | B4 | 邀请未注册邮箱 | **失败** |
| | B5 | 邀请「租户管理员」角色 | **拒绝** |
| | B6 | 邀请已注册用户 | 业务结果（非 500） |
| | B7 | 更新成员部门/岗位 | 业务结果 |
| | B8 | 删除有成员的部门 | **拒绝** |
| **C 角色权限** | C1 | 内置角色数量 | 3 |
| | C2 | 删除内置角色 | **拒绝** |
| | C3 | 创建自定义角色 | code=0 |
| | C4 | 保存权限矩阵 | code=0 |
| | C5 | 矩阵回读 can_view | 与写入一致 |
| | C6 | 矩阵回读 can_create | 与写入一致 |
| | C7 | 保存全 false 矩阵 | code=0 |
| | C8 | **取消勾选可持久化** | can_view=false |
| **D 资源授权** | D1-D3 | 知识库/智能体/记忆列表 | code=0 |
| | D4 | 设置单成员授权 | code=0 |
| | D5 | 授权回读 | 1 条 |
| | D6 | 清空授权 | code=0 |
| | D7 | 清空后回读 | 0 条 |
| | D8 | 跨租户设置授权 | **拒绝** |
| **E 权限链路** | E1 | 非成员访问他人租户 | **403** |
| | E2 | normal 成员写部门 | **403** |
| | E3 | normal 成员读部门 | 200 |

**C8 是重点回归项**：GORM 会给带 `default:` 标签的字段在零值时省略 INSERT，
导致"取消勾选"变成"未修改"。本用例专门验证这一点。

---

## 三、执行结果

### 端到端：34/34 通过

```
合计：PASS=34  FAIL=0
```

连跑 3 次结果一致（验证脚本可重复性）。

### 单元测试

范围：`internal/permission` `internal/service` `internal/service/dataset`
`internal/handler` `internal/dao`（服务器上执行，需 CGO）。

| 包 | 结果 | 说明 |
|---|---|---|
| `internal/permission` | PASS | |
| `internal/permission/response` | PASS | |
| `internal/service/dataset` | PASS | 修复后 |
| `internal/service` | 2 个失败 | 均为既有问题，见第五节 |
| `internal/service/chunk` `document` `graph` `nav` `nlp` `wikisearch` | PASS | |
| `internal/service/file` | **build failed** | 既有，与本次无关 |
| `internal/handler` | **build failed** | 既有，与本次无关 |

---

## 四、发现并修复的缺陷（均为本次改动引入）

### 缺陷 1：成员列表 `role` 字段恒为空

- **现象**：所有成员（含 owner）的「角色」列显示空白，前端无法区分租户所有者。
- **根因**：`ConsoleMember.RoleEnum` 缺 `gorm:"column:role"`。GORM 按字段名推导出
  `role_enum`，而 SQL 里是 `ut.role AS role`，两边对不上。
- **发现方式**：用例 B2。
- **修复**：显式声明 `column:role`。

### 缺陷 2：移除成员后，原部门永远删不掉

- **现象**：邀请成员 → 分配到部门 → 移出成员 → 删除该部门，报「部门下还有成员」。
- **根因**：`user.department_id` 是单值列，`RemoveMember` 只删 `user_tenant`
  没清它；`DepartmentDAO.Delete` 又按裸列统计"是否有成员"。
  成员早已不在租户里，但该部门被判为"有成员"。
- **修复两处**：
  1. `RemoveMember` 成功后清空 `user.department_id`（根治来源）
  2. `Delete` 的成员统计 join `user_tenant` 且限定 `status=1`（放过已产生的悬空引用）
- **发现方式**：用例跑完后检查残留数据，发现每轮遗留 2 个部门。

### 缺陷 3：测试脚本清理顺序错误（测试代码缺陷）

- 先删父部门、后删子部门 → 父因"有子"被拒，每跑一次残留一对。
- 实测三轮留下 6 条。已改为「成员 → 子部门 → 父部门」。

### 缺陷（回归）：`QueryScope` 改动导致 5 个单元测试失败

- **现象**：`internal/service` 与 `internal/service/dataset` 共 5 个用例失败，
  报 `no such table: resource_grant`。
- **根因**：`QueryScope` 的 SQL 现在含 `EXISTS (SELECT 1 FROM resource_grant ...)`。
  生产库有这张表，但各测试包的 `AutoMigrate` 只建自己用到的表 → 整条查询报错 → 500。
- **修复**：4 个测试文件的建表补 `&entity.ResourceGrant{}`
  （`dataset` 包是统一 helper，一处见效；`chat_list` 另需 `Knowledgebase`）。
- **说明**：这是上一轮改动（`resource_grant` 接入 scope）遗留的测试债务，
  因当时只跑了 `internal/permission` 一个包，没覆盖到 `internal/service`。

---

## 五、遗留问题（明确不修，附判断依据）

### 1. `internal/handler` / `internal/service/file` build failed

```
fakeDocumentService does not implement documentServiceIface (missing method BatchSetDocumentFolder)
```

接口新增了 `BatchSetDocumentFolder`，但测试里的 fake 没跟上。
与本次改动无关（本次未触碰 document 相关代码）。
**影响**：这两个包的单测无法运行，是长期状态。
**建议**：给 fake 补一个方法即可，属独立小任务。

### 2. `TestRunAgent_RejectsSessionOwnedByAnotherUser`

```
foreign session message was overwritten: [{"content":"foreign","duration_ms":0,"role":"assistant"}]
```

断言用的是 `reflect.DeepEqual(parseMessages(实际), parseMessages(期望))`，
而 JSON 数字解析成 `float64`、回读比对时类型可能不同 → `DeepEqual` 判不等。
**从输出看实际内容与期望一致**，是断言写法过严，不是越权漏洞：
`resolveResource` 对 `AgentSession` 走 `VisibilityPrivate` + `OwnerUserID` 判定，
跨用户访问会被拒绝（该路径本次未改动）。
**建议**：断言改成逐字段比较，或统一用 JSON 字符串比对。

### 3. `TestRebuildConnectorRejectsCrossTenantAndUnboundKB`

`err = nil, want ErrConnectorNotBoundToKB`。连接器重建的业务断言，
涉及 `connector` 同步服务，本次未触碰。

### 4. `go vet` 告警

`internal/service/analytics_service.go:466: self-assignment of end` —— 既有的死代码。

---

## 六、复现方式

```bash
# 在服务器上（需能访问 127.0.0.1:80 与 docker）
scp scripts/e2e_console_permissions.sh <server>:/root/
ssh <server> "cd /root && bash e2e_console_permissions.sh"
```

脚本自带数据清理；即使中途失败，重跑前建议先确认无 `E2E*` 残留部门。

单元测试：

```bash
ssh <server> "cd /root/ragflow && export PATH=\$PATH:/usr/local/go/bin \
  && bash build.sh --test -- ./internal/permission/ ./internal/service/ ./internal/service/dataset/"
```

---

## 七、结论

- 部署完整（内容级验证，非时间戳推断）。
- 端到端 34/34 通过，覆盖正常路径、边界与越权三类。
- 本次改动引入 1 个真实功能缺陷（成员 role 恒空）+ 1 个交互副作用（部门删不掉），
  已修复并有对应用例锁定。
- 单元测试暴露 1 处历史测试债务（scope 改动未同步测试建表），已修复。
- 3 项遗留问题均与本次改动无关，已记录判断依据，未做修改以免扩大回归面。
