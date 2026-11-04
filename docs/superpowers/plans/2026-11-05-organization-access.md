# Organization access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付可操作的组织管理和显式权限网页，并提供同一业务服务承接的项目、领域、主题 API 与可发现操作。

**Architecture:** 复用 PersonalService、原受限 PostgreSQL repository、owner MFA、独立 key issuer、ReUI/Radix。增加明列 organization scope、窄 scope 修改函数和组织适配器；统一受影响记录的锁序，保留原命令锁与单条回执。此片是 PersonalAgent 的工具和权限层，不新增模型循环、worker 或 MCP server。

**Tech Stack:** Node `>=24.18.0 <25`、Next16.4.1、React19.3、TypeScript6.0.2、PostgreSQL17、现有 pg/Better Auth/Zod、固定 ReUI/Radix；本片不新增依赖。版本声明不等于目标环境已验证。

**Spec:** [PersonalAgent 总设计](../specs/2026-11-05-personal-agent-design.md)；[整体实施计划](2026-11-05-personal-agent-foundation.md)；[唯一执行清单](../../../openspec/changes/personal-agent-foundation/tasks.md)。本计划细化 canonical `1.1–1.4`（稳定别名 `A1.1–A1.4`）的操作步骤；完成状态只维护在该 OpenSpec 清单。

## Global Constraints

- 原需求 `LO-AGENT-001`/#35、`LO-PROJECT-001`/#7、`LO-TASK-001`/#5、`LO-AUTH-001/002`、`LO-SEC-001`、`LO-PRIVACY-001`/#3 保持原 ID、来源和未完成验收。
- 原 `unified-business-ui` 五项及继承 2/5 不变；本片不关闭其性能、渲染、发布或本人体验门禁，不复制旧 key-management/operation 清单状态。
- 已入池的普通实现自主推进，必要技术评审后继续，不等待逐项方案确认。真实 SQL/角色授权、现 key 扩权、私有运行配置和真实记录写入，须固定包匹配具体授权。
- 只使用 synthetic fixture 验证，不读凭据或真实记录，不把合成网页展示冒充本人实际数据验收。
- 单 npm lock，模块默认关闭，不安装或开启 LangGraph/worker/MCP，不触发模型出站。
- scope 是明列模块权限，不是通配全权；write 依赖同域 read；同 key 的所有持有方共享新增权限，网页必须明示。
- 原业务事务保持 `owner maintenance → command advisory → producer grant fence → ordered records → history/receipt`，不新增 pre-command hook、不重写全平台事务。
- 公共 CI 保持 `contents: read`、无生产 authority。本人体验、运行启用和工程资格分别报告；skip 不作通过。

## Review Focus

- 旧 v1 catalog 的六项操作全集及原 scope 保留，按旧scope过滤：todo reader四项、writer六项；organization-only grant 通过真实 v2 catalog 发现操作，不能借伪造旧 scope 获权。
- scope 修改与撤销、过期、MFA 失效和业务写入并发时，结果按同一 grant 行锁串行；正常 usage 更新不制造 CAS 冲突。
- 项目更新与待办引用可能反向锁住同一批 inbox 行；A1 必须消除实际锁环，不能只让未来 batch 排序。
- bounded list 不证明完整目录；全量适配器缺失、跨 owner 污染或超过 10000 条必须失败且不泄露部分正文。
- 网页取消、409 或未知结果不能自动再授权、换 key、延长期限或把未确认请求丢掉。

## 公共接口与文件边界

| 文件 | 职责 |
| --- | --- |
| `src/agent-api/scopes.ts` | 四个 scope 的严格编码/解码与固定顺序 |
| `src/agent-api/capabilities.ts` | 单一 operation registry；v1 legacy 与 v2 catalog 投影 |
| `src/agent-api/organization.ts` | 组织 projection 和薄 HTTP adapter，不复制 writer |
| `src/agent-authority/{contracts,service}.ts` | 总架构统一 TrustedActor 的 owner/agent resolver；本片不签发 run 委托 |
| `src/personal-candidate/personal-record-locks.ts` | 受影响 todo/inbox 行集合的统一排序与锁定 |
| `db/0011_business_agent_grants.proposed.sql` | proposed scope CAS、secret-free audit、通用业务 fence；编号实施前核空位 |
| `src/personal-candidate/account-api-keys.tsx` | 现网页权限选择、确认、读回与 unknown 保护 |

```ts
type AgentScope = 'todo:read'|'todo:write'|'organization:read'|'organization:write';
type AgentPermissions = Partial<Record<'todo'|'organization', ('read'|'write')[]>>;
type AgentModules = Readonly<{organization:boolean;classification:boolean}>;
type OrganizationType = Extract<PersonalObject['type'],'project'|'domain'|'topic'>; // shared business.ts alias
type OrganizationEntry = Readonly<{
 type:OrganizationType;id:string;sourceId:string;revision:number;fields:ObjectFields;
}>;
type OrganizationSnapshot = Readonly<{
 scope:'full-current-organization-snapshot';items:readonly OrganizationEntry[];
 total:number;truncated:false;observedAt:string;
}>;
type OrganizationMutation = Readonly<{entry:OrganizationEntry;duplicate:boolean}>;
type SetScopesInput = Readonly<{
 id:string;expectedGrantDigest:string;scopes:readonly AgentScope[];
}>;
```

### Task 1: [A1.1] 明列 scope、可信 actor 接线和精确 catalog 兼容

**Files:** Create `src/agent-api/scopes.ts`、`test/agent-scopes.test.ts`；按母计划共享 `src/agent-authority/contracts.ts`、`service.ts`，不另建 authority；Modify `src/agent-api/{capabilities,config,http,runtime}.ts`、`test/{agent-api,agent-runtime-config}.test.ts`。

**Interfaces:** `normalizeAgentScopes(value:unknown):readonly AgentScope[]`、`encodeAgentPermissions(scopes:readonly AgentScope[]):AgentPermissions`、`decodeAgentPermissions(value:unknown):readonly AgentScope[]|null`。`readAgentBusinessModules(env,personal):AgentModules` 读 `LIFEOS_AGENT_ORGANIZATION=organization-v1` 与 `LIFEOS_AGENT_CLASSIFICATION=todo-classification-v1`，未配置 false，错误值或 classification 无 organization 拒绝。

母 `AuthorityService(deps)` 在本片接 `resolveOwnerActor(headers:Headers):Promise<TrustedOwnerActor|null>`、`resolveAgentActor(key:string):Promise<TrustedAgentActor|null>`，以及 `assertCurrentAuthority(actor:TrustedActor,operationId:string,sourceRefs?:readonly AuthoritySourceRef[]):Promise<void>`；后续 run 片才实现 `resolveRunActor(runId:string,capabilityRef:string):Promise<TrustedRunActor|null>`。sourceRefs 仅受控来源 identity/revision，不是正文或文件路径。owner/agent resolver 使用既有 verified boundaries，不新增认证系统。

单 registry 的每项有 `id/method/path/module/requiredScopes`；原六项保留 `scope` 字段及值，v1 投影的 `requiredScopes` 等于该原 scope 要求。新增 `discoverV2`，`GET /v2/capabilities` 返回 `apiVersion:'2'` 和数组权限合同，当前有效 owner/space grant 可调用；可见操作为 `implemented ∩ enabled ∩ readiness ∩ requiredScopes`。`GET /v1/capabilities` 保持 todo:read 及原六项的按scope过滤全集（reader四项/writer六项），组织业务仍明列 `/v1/organization/...`，不虚构 `/v2/todos`。v2 是 catalog 合同版本，不迁移已有业务路径。

- [ ] **Step 1: 写行为 RED。** `scope codec rejects unknown duplicate and write-only` 覆盖空/重复/未知scope、unknown permission key/action、write 无 read；`organization-only discovery uses v2 without legacy todo permission` 覆盖 org-only v2=200、v1=403、todo=403；`legacy v1 catalog preserves six scopes` 逐项保留原顺序/字段。断言示例：

  ```ts
  assert.deepEqual(normalizeAgentScopes(['organization:write','organization:read']),
    ['organization:read','organization:write']);
  assert.equal(orgReaderV2.status, 200);
  assert.equal(orgReaderV1.status, 403);
  assert.deepEqual(v1Writer.operations.map(x=>[x.id,x.scope]), legacySix);
  assert.deepEqual(v1Reader.operations.map(x=>[x.id,x.scope]), legacySix.filter(x=>x[1]==='todo:read'));
  assert.equal(v2.apiVersion, '2');
  ```

- [ ] **Step 2: 运行 RED。** `node --test test/agent-scopes.test.ts test/agent-runtime-config.test.ts test/agent-api.test.ts`；预期新导出/新 catalog 行为失败，保留既有 owner/Origin/todo 负向测试。
- [ ] **Step 3: 最小实现。** scope 固定顺序为 todo read/write、organization read/write；permissions 仅两个 key，每项仅 `['read']` 或 `['read','write']`。authority resolver 复用当前 owner/MFA/session 和 bearer verifier，由服务端产生 branded TrustedActor，body 不接受 actor/owner/scope。新模块未资格前 false，不开 pool、不宣告操作。v1/v2 从同 registry 投影，禁止两套手工操作池。
- [ ] **Step 4: 运行 GREEN。** 同 Step2 加 `npm run typecheck`，零失败；检查匿名 v2=401、错 owner/space=403、无 flag 的组织路由404且新 SQL/pool 调用为0。旧 todo 不依赖新数据库迁移。
- [ ] **Step 5: 独立 review 后提交。** 精确添加本任务文件，`git commit -m 'feat: define scoped Agent catalog compatibility'`。此处没有真实扩权或运行启用。

### Task 2: [A1.2] narrow scope 修改、SQL fence 与授权串行

**Files:** Create `db/0011_business_agent_grants.proposed.sql`、`test/organization-agent-postgres.integration.test.ts`、`test/helpers/organization-stage-pg.ts`；Modify `src/agent-api/{key-issuer,key-issuer-server,key-web,grant-fence,runtime}.ts`、`src/platform/{contracts,postgres}.ts`、原 issuer/web/PostgreSQL tests。

**Interfaces:** `KeyOperation='list'|'create'|'revoke'|'setScopes'`；`KeySummary.grantDigest?:string`；list 增 `availableScopes?:readonly AgentScope[]`；issuer 私有配置增 `businessScopes?:'organization-v1'`，缺省仍 todo-only。Web `PATCH /api/platform/account/api-keys/{id}/scopes` body 仅 `{expectedGrantDigest,scopes}`；socket `POST /v1/keys/setScopes` 收 `SetScopesInput`，200 仅 `{grant:KeySummary}`。

`AgentGrantBinding=Readonly<{grantId:string;ownerId:string;spaceId:string}>`；`Transaction.lockAgentGrant?(grant:AgentGrantBinding,requiredScopes:readonly AgentScope[]):Promise<boolean>` 和 `assertAgentGrant(tx:Transaction,grant:AgentGrantBinding,requiredScopes:readonly AgentScope[]):Promise<void>` 使用业务事务同连接，允许明确的非空 read-only scope 集；只在 requiredScopes 含 write 时要求对应 read 齐备。旧 `assertAgentTodoWriteGrant` 有 legacy fallback；组织/分类绝不 fallback，也不为只读候选伪造 write 要求。Postgres repository 前三构造参数不变，第四可选 `businessFeatures?:AgentModules` 缺省关闭新能力。

- [ ] **Step 1: 写授权 RED。** `same-key scope CAS preserves identity expiry and secret`；`usage does not alter grant digest`；`MFA expiry revoke and stale digest reject scope changes`；`business fence serializes scope reduction and writes`；`read-only producer fence permits preview without write scope`；`legacy todo fence works before new migration`。read-only fence 接受 todo:read+organization:read，拒空/unknown/不足的 scopes；额外要求 write 时 read-only grant 必须403。覆盖额外 body key/伪造 binding/Authorization/坏 Origin、manager 直接 UPDATE permissions/metadata/key/expiry 拒绝、verifier 无管理/business 访问权。断言修改只产生 secret-free audit，不改 key/owner/expiry；无变化不造 audit。
- [ ] **Step 2: 运行 RED。** `node --test test/agent-key-issuer.test.ts test/agent-key-web.test.ts test/platform-postgres.test.ts`。隔离 fixture 就绪后运行 `RUN_ORGANIZATION_POSTGRES_TESTS=1 LIFEOS_FIXTURE_FRESH=approved-isolated-fixture node --test --test-isolation=none --test-concurrency=1 test/organization-agent-postgres.integration.test.ts`；新函数/能力缺失应失败，缺环境单列 unavailable，不以 skip 作 RED。
- [ ] **Step 3: 实现 SQL/issuer/fence。** 0011 要求独立 migration owner、exact target、现 schema2/Agent/key-management/MFA prerequisites、`lifeos.agent_business_grants_approved=1`；无角色/secret 自动创建。增加 `lifeos_agent.managed_grant_digest(grant_id text) RETURNS text`，唯一投影为 `{version:1,id,ownerId,spaceId,enabled,expiresAt,permissions}`，用 PG 原生 SHA256，排除 secret、updatedAt 和 usage。`set_managed_grant_scopes(session_token text,grant_id text,expected_digest text,new_permissions jsonb)` 锁 grant 后重验 fixed binding/MFA/expiry/CAS，仅改 permissions/updatedAt，写 owner/space/grant/before/after/digest/time audit；manager 仅 EXECUTE，仍无列 UPDATE。`lifeos_agent.assert_business_grant(grant_id text,owner_id text,space_id text,required_scopes text[]) RETURNS boolean` 严格非空 allowlist，逐项核当前 grant 的 owner/space/enabled/expiry/scopes，read-only 集合合法，若要求 write 则 requiredScopes 同域 read 齐备；`FOR SHARE` 保持至事务结束并等待后再验时间。原 todo SQL wrapper 仍要求 todo read/write，旧未迁移部署用原 legacy fallback。
- [ ] **Step 4: GREEN 与真实 PG 资格。** 同 Step2；用确定 barrier 分别证明 read-only preview fence/业务写 fence 先赢和 revoke/所需scope减少先赢，后者零候选或record/history写入。read-only producer 可以持 grant SHARE 完成 preview；失去 preview read scope 后不得继续。verifier usage UPDATE 不制造 digest CAS 冲突；等锁后过期拒绝。逐项破坏函数 owner/search_path/PUBLIC EXECUTE/角色 ACL，readiness 必须503。默认 todo 只 probe 原函数。enabled 用例零 skip，不靠 mock 声称授权并发通过。
- [ ] **Step 5: 独立安全 review 后提交。** `git commit -m 'feat: add explicit Agent scope updates and business fence'`，只提交 reviewed files。SQL 仍 proposed，未针对真实目标执行。

PG fixture 复用现 CI 的 isolated recovery/Agent management 服务；helper 只接受预先声明的 loopback disposable target、synthetic 角色和 fresh marker，核版本/数据库/binding后再 apply proposed SQL。保留原 recovery/MFA/key 用例、数据和断言，不重置它们的数据库，不读取运行配置。fixture 代码可以使用明确 synthetic 值，但日志不能输出 key、cookie、session 或 credential URL。

### Task 3: [A1.3] 组织 CRUD、完整目录和受影响记录锁序

**Files:** Create `src/agent-api/organization.ts`、`src/personal-candidate/personal-record-locks.ts`、`test/{organization-agent,personal-record-locks}.test.ts`；Modify `src/personal-candidate/{business,service}.ts`、Agent registry/http/runtime；扩展 A1.2 PG test。

**Interfaces:** `OrganizationType` 是 `business.ts` 中显式限定 project/domain/topic 的 shared alias，未来 PersonalObject 新类型不自动进入该 allowlist。`organizationDetail(entry:PublicEntry,spaceId:string):OrganizationEntry`；`organizationSnapshot(service:PersonalService,ownerId:string):Promise<OrganizationSnapshot>`。GET `/v1/organization/snapshot` 与 `/{type}/{id}` 要 organization:read；POST `/{type}` 要 read+write，body `{fields:ObjectFields}`；PATCH `/{type}/{id}` 同 scopes，body `{expectedRevision,fields:ObjectFields}`，全部 mutation 有 Idempotency-Key。fields 为 title/text/occurredOn/personal，PATCH 四项齐全，不允许 delete/merge/upsert。

`PersonalRecordLock={kind:'todo'|'inbox';id:string}`；`personalRecordLockOrder(values:readonly PersonalRecordLock[]):PersonalRecordLock[]` 以 todo=0、inbox=1、UUID 字节序排序，按 `(kind,id)` 去重；`lockPersonalRecords(tx:Transaction,values:readonly PersonalRecordLock[]):Promise<ReadonlyMap<string,StoredEntry|null>>` 的 key=`JSON.stringify([kind,id])`。

- [ ] **Step 1: 写行为 RED。** 完整目录创建55合成组织与其它类型/owner，total=55、truncated=false、有真实 sourceId、无 ownerId/source.original；缺 snapshot adapter 或10001条503且无部分正文。CRUD 覆盖三 type、完整 PATCH、CAS、改 body 同 key409、引用 type/source/revision、同名独立创建。锁测试用固定 A/Z UUID，旧 project PATCH 锁自身 Z→domain A，todo PATCH 锁 domain A→project Z；必须统一集合后再取锁。错类型/同物理 ID 不制造另一锁序。
- [ ] **Step 2: 运行 RED。** `node --test test/organization-agent.test.ts test/personal-record-locks.test.ts test/agent-api.test.ts test/ab-personal-business.test.ts`；新路由/helper或旧锁次序失败，不删除既有业务断言。
- [ ] **Step 3: 实现薄适配。** 复用 `PersonalService.get/currentSnapshot/mutate` 和原 ObjectFields validator，owner/space/confirmed 由验证 actor 注入；不接受客户端 source 或 owner。先从已验证 fields 算自身/全部引用的物理锁集合，顺序 `tx.get` 入 Map，再执行原 CAS/引用检查；create 只锁 targets。原 digest/source/history/receipt 语义不变，finance/import/维护路径不重构。所有组织 Agent 写使用 A1.2 fence。完整目录不通过 bounded list 过滤代替。
- [ ] **Step 4: GREEN 与锁环证明。** 同 Step2；扩展真实 PG 的确定 barrier，证明 todo/project 交叉请求没有 deadlock 或部分写，错误/过期引用拒绝。保持 legacy todo sourceId 合同、单条 receipt、现网页组织 writer；不把性能和本人体验从 unit 推导为通过。
- [ ] **Step 5: 独立 review 后提交。** `git commit -m 'feat: expose scoped organization operations with ordered locks'`，仅精确本任务文件。

### Task 4: [A1.4] 显式权限网页、Skill 与默认关闭候选交付

**Files:** Modify `src/personal-candidate/account-api-keys.tsx` 与有限 CSS、现 category-grid/组织入口必要适配、`scripts/agent-skill-reference.ts`、`skills/lifeos-agent/{SKILL.md,references/operations.md,references/credential-runtime.md}`、generated artifact、现 Agent Skill/key/browser tests、`.github/workflows/ci.yml`；原追踪只补本片证据，不改旧任务状态。

**Interfaces:** 现 `AccountApiKeys({embedded?,closeGuard?})` 不变；availableScopes 缺失则保持旧 todo-only UI，无 digest 不显示 scope 编辑。现 owner 组织网页继续同 PersonalService writer。registry 驱动 API/catalog/Skill 和未来 MCP 投影；MCP server 尚未实现，本片不得宣告其可用。

- [ ] **Step 1: 写浏览器与 artifact RED。** scope 控件按模块 read/write，write 自动要求同域 read，create 默认 todo:read；修改现 key 显示名称、到期、当前→拟改 scope，并明确“所有持有该密钥的客户端也会获得这些权限”。取消零 PATCH，确认一次 PATCH；409 保留拟改值并刷新 current；unknown 冻结原 body/digest，先 list 读回，不自动重签/重发/延长。实际组织网页创建/修改/刷新读回可操作。Skill 新版优先 v2；只有404可 fallback 已知 v1 todo 合同，不因401/403 fallback 绕授权。
- [ ] **Step 2: 运行 RED。** `RUN_AGENT_KEY_BROWSER_TESTS=1 node --test --test-concurrency=1 test/agent-key-management-browser.integration.test.ts`；使用现已安装 Chrome 的实际路径（可由 `LIFEOS_TEST_CHROMIUM_PATH` 提供），不顺手安装。运行 `node --test test/agent-skill-sync.test.ts test/agent-skill-download.test.ts`；缺新 UI/合同应失败。
- [ ] **Step 3: 组合现组件并生成文档。** 复用 Radix Dialog/Input/Button，保护 busy/unknown、焦点、Escape/关闭及原 one-time key reveal。组织/权限网页有真实数据路径，未启用显示明确不可用。生成 `node scripts/agent-skill-reference.ts` 和 `node scripts/agent-skill-artifact.ts`；包只含现 allowlist 通用文件，无账号/配置/secret。新操作精确描述 requiredScopes、catalog 版本和业务 `/v1` 路径，Skill 不能管理 key、使用 cookie/SQL 旁路或下载即获权。
- [ ] **Step 4: 验证并独立评审。** 四个360/1365px×明暗组合的真实 Chrome lifecycle，通过取消/unknown/CAS/readback；真实 native MFA/PG 资格与 UI mock 分开。执行下方共同门禁和固定源码 SHA 全部 CI，保留原 recovery/TLS/browser、权限负向和性能门禁；CI 排队不是通过。独立审 scope SQL/readiness、实际图片/交互、privacy/license。
- [ ] **Step 5: 提交并交付可审候选。** `git commit -m 'feat: add explicit organization access in account settings'`；按现 PR/review/CI 流程继续常规合并与既有发布读回。新增真实 SQL/GRANT、issuer 配置、现 key scope 和实际目录写清单进入固定包后再按对应授权执行，工程工作不因等待该包而停止。本人在实际 HTTPS 页面验收，未接通真实数据时明确该项端到端未完成。

## A1 共同验证与交付 GO

顺序执行 `npm test`、`npm run typecheck`，再 `LIFEOS_PLATFORM_CANDIDATE=0 LIFEOS_REVIEW_GIT_SHA=$(git rev-parse HEAD) npm run build -- --webpack`；对同一 build 输出执行 `LIFEOS_PLATFORM_CANDIDATE=0 node scripts/check-built-platform.mjs`。运行 `OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1 CI=1 openspec validate personal-agent-foundation --strict`，CLI 必须1.16.0；保留原 UI change 的独立门禁。`git diff --check` 和 `git diff --exit-code -- package.json package-lock.json` 不应产生无关变动。

PG/Chrome 必须 explicitly enabled、零失败/错误/skip；缺工具列 unavailable。独立 reviewer 通过且固定 SHA CI 完整通过才满足源码候选 GO。真实启用包列源码/制品、SQL 全文摘要与 hash、目标 owner/space/database、角色 ACL、非秘密 grantId/current scopes/expiry/digest、备份/独立恢复/回滚、精确目录写入及逐项 readback；缺任何授权只暂停相应实际动作。关闭 flag 不会撤销已改 scope，镜像回滚不会恢复数据库，须受控逆向/CAS。此计划本身不宣称任何产品测试、运行资格或本人验收通过。

## 自审映射

scope/catalog 兼容→A1.1；same-key/MFA/fence/ACL→A1.2；组织 CRUD/完整覆盖/最小锁序修正→A1.3；可用网页/API/Skill 同片及交付→A1.4。五项 Review Focus 分别有上述对应 behavior/PG/Chrome 测试。A2 在此片已审合同上继续；真正编排、worker、模型出站及 MCP transport 属总计划其它阶段，本片不提前安装或宣告。

官方技术依据沿用 [PG17 Explicit Locking](https://www.postgresql.org/docs/17/explicit-locking.html)、[PG17 Row Security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html) 和 [PG17 原生 SHA256](https://www.postgresql.org/docs/17/functions-binarystring.html)。应用身份/ACL/owner例外仍由真实资格验证，官方机制说明不能代替实际通过结论。
