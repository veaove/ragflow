# 五类资源可见范围与授权一致性 · 测试方案

租户：**华夏基金** `8d5c79460d6c46efb58353c68d8bf729`
被测版本：`d6c9393a6` 及之后（含「可见范围扩展到知识问答/搜索/智能体/记忆」的提交）
被测对象：资源可见范围三档（仅所有者 / 租户管理层 / 平台管理员）、逐主体授权、`不可见（排除）`、租户停用

---

## 1. 测试范围

| 维度 | 覆盖内容 |
|---|---|
| 资源 | 知识库、知识问答、知识搜索、智能体、记忆、会话质检 |
| 角色 | 租户所有者（owner）、内置租户管理员（admin）、内置部门管理员（dept，技术部）、内置普通成员（plain，培训部）、自定义角色成员（member，「技术员」） |
| 操作 | 可见（列表）／可读（详情）／可写（更新、运行）／可管理（授权、删除） |
| 授权 | 三档可见范围读写、逐人/逐部门/全团队授权、`不可见（排除）` |
| 越权 | 跨角色写、跨范围读、不存在 id 与别人的 id 的响应一致性 |

不在本方案内：平台管理员（需平台侧账号）、跨租户访问（需第二租户）、检索命中集（需真实问答链路）。

---

## 2. 权限语义（判定口径）

| 层 | 判定 | 表现 |
|---|---|---|
| 可见 | `创建者 ∪ 租户管理层 ∪ 显式授权 − 排除` | 出现在列表；不可见即列表里没有 |
| 可读 | 同上 + 写档位要求 | 详情 `code=0`；不可见时统一 `Resource not found`，不泄露存在性 |
| 可写 | 需 `edit` 级授权或管理层 | 更新/运行成功；只读授权写操作 403 |
| 可管理 | 授权、删除仅管理层 | `PUT /grants`、`DELETE` 成功；其他人 403 |
| 「不可见（排除）」 | `resource_grant.effect='deny'` | 被排除主体在列表、详情、检索里都看不到；不作用于创建者、租户 owner、租户管理员；「全团队」不可设为排除 |

**本轮统一的两条**（原仅知识库具备）：

1. 租户管理员对 **owner（仅所有者可见）档**同样可见（`resolveResource` 把管理层判定提到三档之前）。
2. `不可见（排除）` 放开到五类资源（`grantKindSpec.SupportsDeny`），文件管理 / MCP 服务 / 数据源 / 技能空间仍不支持。

---

## 3. 场景清单与用例矩阵

### 3.1 用例矩阵（角色 × 资源 × 操作）

`✓` 应放行，`✗` 应拒绝，`⊆` 只做子集断言（该身份可见样本不足）。

| 编号 | 角色 | 资源 | 操作 | 预期 | 覆盖 |
|---|---|---|---|---|---|
| V1 | admin | 五类 | 可见 | 集合 **等于** owner | `97` |
| V2 | dept | 五类 | 可见 | ⊆ owner | `90` |
| V3 | plain | 五类 | 可见 | ⊆ owner（样本极少） | `90` |
| V4 | member | 五类 | 可见 | ⊆ owner | `90` |
| R1 | admin/dept/plain | 五类 | 可读 | 任一可见条目详情 `code=0` | `90` |
| D1 | plain | 五类 | 可读 | owner 有、plain 无 → 拒绝 + 统一文案 | `90`、`95` |
| A1 | owner | 五类 + 文件类 | 声明 | `supports_deny`：五类 `true`，文件/MCP/数据源/技能空间 `false` | `97` |
| A2 | admin | 五类 | 授权 UI | 弹窗出现「不可见（排除）」选项 | `97` |
| A3 | owner | 知识库 | 授权 | 子项例外每行都带 `(已排除)` 标签 | `90`、`87` |
| W1 | plain | 五类 | 可管理 | 越权写授权 403（打不存在 id，权限先拦） | `40`、`95` |
| W2 | plain | 五类 | 可写 | 更新/运行 403 | `40` |
| Q1 | admin/dept/plain | 会话质检 | 可见 | 规则集合 ⊆ owner | `90` |
| Q2 | plain | 会话质检 | 可写 | 新建/改规则 403 | `40` |

### 3.2 会话质检

质检规则没有三档可见性（`VisibilityColumn` 为空），只做「子集 + 不可见即不可读」两条只读断言；写操作走越权矩阵（W2/Q2）。

### 3.3 「不可见」的落库与生效（写用例，需 `E2E_ALLOW_WRITE=1`）

| 编号 | 场景 | 步骤 | 预期 |
|---|---|---|---|
| X1 | 知识库文件排除 | 自建临时库 → 传 2 文件 → 授权全团队 → 排除其一 | member 列表剩 1 个，owner 仍 2 个；`afterAll` 删库 |
| X2 | 子项例外标签 | 同上，查看「子项例外」 | 每行都带 `(已排除)`，主体解析失败时不留白 |
| X3 | 四类资源排除 | 建临时资源 → 授权 → 排除 → 断言列表消失 | **未自动化**：知识问答需要 LLM 配置、知识搜索需要 `search_config`、智能体需要 DSL。当前用接口声明（A1）+ 判定单测覆盖 |

---

## 4. 前置条件

1. **已发版到含本次改动的 commit**（`d6c9393a6`+）。未发版时 V1 必然失败：线上仍跑旧二进制，admin 在四类是 0 条。
   发版前先看线上实际跑的版本：`ssh root@172.30.20.51 'cat /root/ragflow/.deployed_sha'`，比对是否 ≥ `d1d54f3bd`（可见范围统一）。已在 `3a7b04942` 上实测过未发版形态：三条全红且逐条对应待发版差异，见 `docs/e2e-permission-report.md` §2.5。
2. 三个 E2E 账号存在且口令在 `.auth/accounts.local.json`：
   - `admin` e2e-admin@hjzd.com（内置租户管理员，无部门）
   - `dept` e2e-dept@hjzd.com（内置部门管理员，技术部）
   - `plain` e2e-plain@hjzd.com（内置普通成员，培训部，无资源授权）
   缺失时 `cd e2e && npm run seed`，随后 `npm run auth`。
3. 租户内已有样本资源（知识库 18 / 问答 7 / 搜索 2 / 智能体 27 / 记忆 1 / 质检 9），否则 V1 的对照基准为空。
4. 写用例（X1/X2）额外需要 `E2E_ALLOW_WRITE=1`；它们自建自删，跑完租户知识库数应回到 18。

---

## 5. 执行步骤

```bash
# 0. 账号与登录态（换环境或账号被删时）
cd e2e && npm run seed && npm run auth

# 1. 后端单测（必须走 build.sh，需要 CGO 与 native 静态库）
ssh root@172.30.20.51
cd /root/rf-verify && export PATH=/usr/local/go/bin:$PATH
bash build.sh --test ./internal/permission/ ./internal/service/ ./internal/handler/

# 2. 前端单测
cd web && npx jest src/pages/console/__tests__ --no-cache

# 3. 只读 E2E（发版后）
cd e2e && npx playwright test --reporter=line

# 4. 写用例（可选，会自建自删临时资源）
E2E_ALLOW_WRITE=1 npx playwright test specs/85-exclude-flow.spec.ts specs/87-file-deny.spec.ts
```

发版：`/root/deploy.sh --dry-run` 确认会重编前后端 → `/root/deploy.sh` → 校验 version / healthz / nginx 与三方一致。

---

## 6. 预期结果

- **V1**：admin 在五类的资源 ID 集合与 owner **逐项相同**（修复前知识问答 0 vs 7、智能体 0 vs 27）。
- **V2–V4**：三个受限身份的集合都是 owner 的子集，无「凭空多出」的 id。
- **R1**：任一受限身份可见的条目，详情都返回 `code=0`（列表与详情同一口径）。
- **D1**：plain 读 owner 独有资源返回非 0，且与「不存在 id」的响应逐字一致。
- **A1**：`supports_deny` 声明与注册表一致（五类 true，其余 false）。
- **A2**：五个 Tab 的授权弹窗都能选「不可见（排除）」。
- **W1/W2**：越权写全部拒绝；用不存在 id 时错误必须是「权限不足」而不是「资源不存在」（证明权限先于存在性）。
- **X1**：文件级排除生效，member 与 owner 的可见文件数出现 1 个差值，跑完无残留。

---

## 7. 验收标准

| 编号 | 标准 | 判定 |
|---|---|---|
| A1 | Go 单测 `internal/permission`、`internal/service`、`internal/handler` 全绿 | `ok` 三行，无 `--- FAIL` |
| A2 | 前端 `grant-chip` / `grant-views` 用例全绿 | 12 passed |
| A3 | 只读 E2E 0 failed；新增 `97-visibility-parity` 全绿 | 无 failed |
| A4 | admin 五类可见集合 = owner（严格相等） | `toEqual` 通过 |
| A5 | `supports_deny` 声明与 §3.1 A1 一致 | 逐行断言通过 |
| A6 | 五个 Tab 弹窗均含「不可见（排除）」 | 断言通过 |
| A7 | 越权写 100% 拒绝且文案不泄露存在性 | 断言通过 |
| A8 | 写用例跑完租户知识库数回到 18，无残留 | 数量校验通过 |

任一条不满足即阻塞发版；A4 未通过但其余通过时，先确认线上是否已包含本次提交（`cat /root/ragflow/.deployed_sha`）。

---

## 8. 已知限制

- **四类资源的排除写入未做端到端**：知识问答需要可用 LLM 配置、知识搜索需要 `search_config`、智能体需要合法 DSL，构造成本高于收益；当前由「后端声明 + 判定单测」覆盖，风险点是「前端能选、后端不认」，已由 A2 与单测 `TestSetGrantsAcceptsDenyForEveryVisibilityKind` 兜住。
- **租户停用只在单测覆盖**：线上停用会屏蔽整个租户，不能纳入 E2E（`TestDisabledTenantHidesEveryKind`）。
- 会话质检没有三档可见性，只验证「不可见即不可读」与越权写。
