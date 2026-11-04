# Atomic todo classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 网页呈现固定分类差异，由当前 owner 审核后，以一个事务提交整批待办关系并逐条读回。

**Architecture:** 在 A1 的组织能力、可信 actor 和统一记录锁序上，复用原 record/history writer，新增 immutable plan、owner approval 和独立 batch receipt。网页、Agent API 与未来 MCP 使用同一 ClassificationService；run-capability 只可读/preview，后台 worker 没有 approve/commit 权限。模型输出与 `confirmed:true` 不能代替服务端审批回执。

**Tech Stack:** 现有 Node24/Next16/React19/TypeScript6/PostgreSQL17、pg、Zod、固定 ReUI/Radix；无新依赖，无第二套编排器、数据库 writer 或 MCP server。声明兼容性须经实际 build/PG/Chrome 资格验证。

**Spec:** [PersonalAgent 总设计](../specs/2026-11-05-personal-agent-design.md)；[整体计划](2026-11-05-personal-agent-foundation.md)；[A1 前置计划](2026-11-05-organization-access.md)；[唯一执行清单](../../../openspec/changes/personal-agent-foundation/tasks.md)。本计划细化 canonical `2.1–2.3`（稳定别名 `A2.1–A2.3`）；完成状态只维护在该 OpenSpec 清单。

## Global Constraints

- 保留原 `LO-TASK-001`/#5、`LO-PROJECT-001`/#7、`LO-AGENT-001`/#35 和 identity/privacy 原需求；不改原 UI 五任务/2/5 或冒充其未完成验收已关闭。
- A1 已提供完整组织 snapshot、明列 scopes、原 v1/v2 catalog 合同和 `(kind,id)` 记录锁 helper；直接复用，不重复实现 todo sourceId 或重开 scope 设计。
- 已入池范围内普通编码、迭代设计和工程交付自主推进；真实 SQL/角色、现 key 写 scope、私有配置、真实分类清单及数据迁移须具体固定包授权，只暂停受影响动作。
- 分类只改 `personal` 关系，不改 title/notes/status/dueOn/source/createdAt，不删/合并/自动裁决重复，不上游回写。
- 单批 1..100 条、30分钟、128KiB body、topics≤20；100 是条数上限，不豁免字节上限。任一记录/引用/授权/审批冲突，全批 record/history/receipt 零写入。
- background run 只读/preview；owner-only approve 来自当前 owner/MFA 同源会话。owner 审批不增加 scope、不绕 producer 撤销，Agent API commit 必须已有该 plan/digest 的服务端审批。
- preview 仅需 todo:read+organization:read，私有候选不等于业务写入。Agent API commit 才需 todo:read+todo:write+organization:read；owner 网页 commit 用本人写权，producer grant 只需原 preview/read 权限仍有效且未撤销，不把 write scope 添给只读 producer。
- 同一事务锁序保持 `owner maintenance → command advisory → producer grant fence → plan advisory → ordered records → history/receipt`；不把多次单条 `mutate` 循环当原子 batch。
- 模块默认关闭；flag 开但 schema/ACL/authority/readiness 不合格503且不宣告能力。A2 关闭不影响已资格 A1 或旧 todo。
- synthetic 仅内部验证，真实站点/数据读回和本人体验分开；公共 CI 不获得生产权限，不恢复明确暂停的维护链路。

## Review Focus

- 全部 no-op 的同 plan 不同 command 并发也只能成功一次，不能依靠 revision 碰巧冲突或把 unique 异常变503。
- 已提交应答丢失、计划过期、记录后来编辑、跨网页/API恢复时，都只能重放原 receipt，不能再写一版。
- owner、agent-grant、run-capability 不可相互强转；producer 撤销或丢失 preview read 权、当前提交 actor 丢失其写权、会话/policy失效必须阻止未提交动作。
- 错类型/重复物理行/错 sourceId/跨 owner/space/最后一条冲突，不能改变锁序或出现前几条已经写入。
- 网页选中项或编辑差异会产生新 plan/digest/审批；未知结果必须保留原 command，不自动换 key、改版本或覆盖后续修改。

## 文件与精确合同

| 新文件 | 职责 |
| --- | --- |
| `src/personal-candidate/classification-contracts.ts` | strict typed DTO、plan/approval/receipt 与安全解码 |
| `src/personal-candidate/classification-service.ts` | preview/review/owner approval/atomic commit；authority 重验 |
| `src/personal-candidate/classification-postgres.ts` | 同事务 feature queries、plan advisory、DB readiness |
| `src/personal-candidate/classification-http.ts` | 现 owner 与 Agent 边界后的薄适配器 |
| `src/personal-candidate/classification-review.tsx`、`.module.css` | 只读 diff、审核/提交、冲突与 unknown 恢复 |
| `db/0012_todo_classification.proposed.sql` | immutable plan、owner approval、独立 batch command 的 proposed migration；实施前核序号 |
| `test/classification-{contracts,service,http}.test.ts`、`test/classification-postgres.integration.test.ts`、`test/classification-review-browser.integration.test.ts` | 合同、原子性、权限/并发、实际网页验证 |
| `test/helpers/classification-memory.ts` | 仅合成事务 port，支持 rollback，不能替代实际 PG 并发资格 |

修改仅涉及 `src/platform/{contracts,postgres}.ts` 的同 client 事务组合、Agent registry/http/runtime、`src/personal-candidate/runtime-http.ts`、`src/platform/runtime.ts`、原 workspace 的明确 plan 入口，以及 generic Skill/CI。复用 A1 `personal-record-locks.ts`，不再次修改该锁协议。

```ts
type ClassificationChange = Readonly<{
 todo:Readonly<{id:string;sourceId:string;expectedRevision:number}>;
 before:PersonalRelations|null;after:PersonalRelations;
}>;
type ClassificationPreview = Readonly<{
 planId:string;digest:string;expiresAt:string;
 changes:readonly ClassificationChange[];unchangedIds:readonly string[];
}>;
type ClassificationEntry = Readonly<{
 id:string;sourceId:string;revision:number;personal:PersonalRelations|null;
}>;
type ClassificationResult = Readonly<{
 planId:string;digest:string;duplicate:boolean;
 entries:readonly ClassificationEntry[];unchangedIds:readonly string[];
}>;
type ClassificationPlan = Readonly<{
 schemaVersion:1;proposalRevision:1;ownerId:string;spaceId:string;
 grantId:string|null;producerAuthorizationRevision:string|null;policyRevision:string;
 runProvenance?:Readonly<{runId:string;capabilityRef:string}>;
 createdAt:string;preview:ClassificationPreview;
}>;
type ClassificationApproval = Readonly<{
 planId:string;proposalRevision:1;digest:string;
 operationIds:readonly ['commitTodoClassification'];bindingsDigest:string;
 producerAuthorizationRevision:string|null;policyRevision:string;
 approvedAt:string;expiresAt:string;
}>;
type ClassificationReceipt = Readonly<{
 requestDigest:string;planId:string;result:ClassificationResult;
}>;
type ClassificationReview = Readonly<{
 preview:ClassificationPreview;approval:ClassificationApproval|null;
 committed:boolean;stale:boolean;
 labels:Readonly<{
  todos:readonly Readonly<{id:string;sourceId:string;revision:number;title:string}>[];
  organization:readonly Readonly<{type:OrganizationType;id:string;sourceId:string;revision:number;title:string}>[];
 }>;
}>;
```

authority 只引用母设计的 `src/agent-authority/contracts.ts`：server-branded `TrustedActor=TrustedOwnerActor|TrustedAgentActor|TrustedRunActor`，不另建 ClassificationActor。owner 带非秘密 sessionRef，agent 带 grantId/scopes，run 只带 runId/capabilityRef；RunAuthorityProof 中的 producer、授权 revision、允许操作/sourceRefs、policy/expiry 由 authority service 重验，不在浏览器 body 或 checkpoint 信任它们。A1 先实现 owner/agent resolver；运行阶段才 mint/resolve run 委托。本片不伪造 run 能力。

```ts
interface ClassificationTransaction extends Transaction {
 getClassificationPlan(planId:string):Promise<ClassificationPlan|null>;
 lockClassificationPlan(planId:string):Promise<void>;
 saveClassificationPlan(plan:ClassificationPlan):Promise<void>;
 classificationApproval(planId:string):Promise<ClassificationApproval|null>;
 saveClassificationApproval(approval:ClassificationApproval):Promise<void>;
 classificationReceipt():Promise<ClassificationReceipt|null>;
 classificationPlanCommitted(planId:string):Promise<boolean>;
 saveClassificationReceipt(receipt:ClassificationReceipt):Promise<void>;
}
interface ClassificationRepository extends PlatformRepository {
 classificationTransaction<T>(owner:string,spaceId:string,key:string,
  fn:(tx:ClassificationTransaction)=>Promise<T>):Promise<T>;
}
declare class ClassificationService {
 constructor(repository:ClassificationRepository,config:PersonalConfig,
  authority:AuthorityService,clock?:()=>number); // default Date.now
 preview(actor:TrustedActor,input:unknown,guard:PersonalGuard):Promise<ClassificationPreview>;
 review(actor:TrustedActor,planId:string,guard:PersonalGuard):Promise<ClassificationReview>;
 approve(actor:TrustedOwnerActor,input:unknown,guard:PersonalGuard):Promise<ClassificationApproval>;
 commit(actor:TrustedActor,input:unknown,key:string,guard:PersonalGuard):Promise<ClassificationResult>;
}
```

approve 和 commit 均在运行时再次判别 actor，类型约束不是鉴权。run 对 approve/commit 一律403，包括 receipt replay；read/preview 必须经过当前 RunAuthorityProof，run 子片未启用时不接受该 actor。owner 的 Agent-origin plan 审核/commit 以 `assertAgentGrant(tx,producer,['todo:read','organization:read'])` 保持 producer 锁与原 read 授权，不要求其 write；owner 当前写权单独重验。API commit 要当前 actor 等于 producer grant，要求 todo read/write+organization read，并有同plan固定owner approval；因此只读 Agent 能建议而不能自行提交。owner-origin plan 的 grantId=null，但不能让 Agent 使用。run-origin plan 保留 provenance 并通过 authority 重验原 producer/授权/policy；run 不被 cast 成 grant 或 owner。

### Task 1: [A2.1] strict plan/approval/receipt 与最小事务组合

**Files:** Create classification-contracts.ts/postgres.ts、0012 SQL、contracts test、memory helper；Modify `src/platform/{contracts,postgres}.ts`、`test/platform-postgres.test.ts`。

**Interfaces:** 上述 DTO 与八个 feature method；contracts 导出 `decodeChanges(value:unknown):readonly ClassificationChange[]`、`decodePlan(value:unknown):ClassificationPlan`、`classificationNoOp(before:PersonalRelations|null,after:PersonalRelations):boolean`，测试使用这些实际名称。`PostgresPlatformRepository.classificationTransaction(owner,spaceId,key,fn)` 与原 `transaction` 共用 private `transactionImpl` 的同连接、owner gate、command lock、get/write，不复制 record write SQL。旧 `Receipt/MutationResult` 不变，不把 batch 数组强转单条。

- [ ] **Step 1: 写 strict schema RED。** 0/101条、重复 todo、21 topics、duplicate topic、错UUID/source/revision、缺 before 字段/额外 title/notes、response unknown key 均拒；null before与完整空 after有明确 no-op 语义。plan/proposal/policy/producer/approval bindings 任何一项不符拒绝。原 transaction 不提供未启用 feature，classification 关闭立即503。例：

  ```ts
  assert.throws(()=>decodeChanges([]));
  assert.throws(()=>decodeChanges([...oneHundred, another]));
  assert.throws(()=>decodeChanges([{...valid, before:{project:null}}]));
  assert.throws(()=>decodePlan({...plan, title:'not an operation field'}));
  assert.equal(classificationNoOp(null,{project:null,domain:null,topics:[]}), true);
  ```

- [ ] **Step 2: 运行 RED。** `node --test test/classification-contracts.test.ts test/personal-record-locks.test.ts test/platform-postgres.test.ts test/ab-personal-business.test.ts`；新 decoder/storage 能力缺失失败，原 A1/helper 行为保留。
- [ ] **Step 3: 实现 schema/storage。** 0012 要求独立 migration owner、exact `lifeos.agent_expected_database`、`lifeos.todo_classification_approved=1`、已资格0011及原 schema2 prerequisites。三表 `platform_classification_plan/approval/command` 都以 owner/space 复合边界、FORCE RLS、owner FK、PUBLIC 撤权，runtime 仅 SELECT/INSERT，无 UPDATE/DELETE/TRUNCATE；manager/verifier 无业务表权限。plan immutable，30分钟；approval 复合 FK 到 owner/space/plan/digest/revision，唯一每 plan；command 唯一消费每 plan。producer grant 仅在 plan，不使用 nullable 复合 FK 假装约束；run provenance 仅受控引用。CHECK/helper 严格 v1、条数/UUID/revision/relations/明列字段，JSON 只容操作结构，不放任意业务正文。独立 receipt namespace=`[owner,'todo-classification-v1',space,key]`，跨当前 owner/API 传输共享同 command；新三表另验 readiness，不改原四表/schema2 restricted 检查。
- [ ] **Step 4: 运行 GREEN 和隔离 SQL 负向。** 同 Step2；PG 资格先证无批准/错target/运行角色执行迁移拒绝，runtime 跨owner读空/写拒、UPDATE/DELETE/TRUNCATE拒，manager/verifier无表权，bad stored JSON读出也拒绝。不为 plan 行锁增加 UPDATE 权，`lockClassificationPlan` 用 xact advisory。原单条写/receipt/history 完全通过；feature关时不查询新表。
- [ ] **Step 5: 独立存储/安全 review 后提交。** `git commit -m 'feat: add immutable classification plans approvals and receipts'`；proposed SQL 不执行到真实目标，新的 schema 不因代码合并自动启用。

### Task 2: [A2.2] 共享原子 service、owner 审批与 API commit

**Files:** Create classification-service.ts/http.ts、service/http tests、PG integration test；Modify Agent registry/http/runtime、personal runtime-http、platform runtime 的窄连接；与母 authority service 共用，不复制 actor resolver。

**Interfaces:** Agent `POST /v1/todo-classifications/preview` body `{changes}`，operation ID `previewTodoClassification`，requiredScopes 仅 todo:read+organization:read；`POST /v1/todo-classifications/commit` body `{planId,digest,confirmed:true}`+Idempotency-Key，ID `commitTodoClassification`，requiredScopes 才是 todo:read+todo:write+organization:read。不要求 organization:write。Owner `GET /api/platform/personal/todo-classifications/{planId}` review；POST `/{planId}/approve` body `{digest,confirmed:true}`；POST `/{planId}/commit` 同 body+Idempotency-Key，路由注入 planId。owner-only approve 永不进入 Agent/MCP operation 投影，owner commit 使用本人写权并锁验 producer read scopes，无需 producer write。

`createClassificationAdapter(service)` 接现 Agent handler 的验证 actor；`handleOwnerClassificationRequest(request,actor,service,guards):Promise<Response|null>` 只在现 owner/MFA 同源边界后运行，拒 Bearer、伪造 actor/owner/source/scope 和任意 query/path。

- [ ] **Step 1: 写原子性/authority RED。** `read-only agent previews without business write permission`；`owner commits a read-only producer plan without widening that grant`；`read-only producer cannot call API commit even after owner approval`；`preview writes only an immutable plan`；`last change conflict rolls back every record history and receipt`；`agent cannot self-approve`；`owner approval cannot bypass producer revocation or lost read scopes`；`run actor cannot commit even an approved plan`；`receipt replay after expiry remains historical and authorized`。覆盖100/101、body>128KiB、30分钟+1ms过期、wrong grant/owner/space、source/ref type/revision、revision2147483647、policy/producer revision改变、approval绑定错、全部no-op、unknown同command。断言 preview 在业务写关闭但候选模块已资格时仍可用；owner 自身写权关闭则 commit 拒绝；非关系 fields/source/createdAt逐项不变。
- [ ] **Step 2: 运行 RED。** `node --test test/classification-service.test.ts test/classification-http.test.ts`；新 methods/routes 应失败，不 stub 掉 guard/fence 或删除原负向测试。
- [ ] **Step 3: 实现确定性算法。** validate actor/body/key→current authority/operation-specific guard→同事务。preview/review 的 guard 核身份/read scopes/candidate readiness，不套业务 write permit；Agent/run-origin preview 用 A1 `assertAgentGrant` 锁验 producer 的 todo:read+organization:read，owner-origin用当前 owner read authority。全记录锁和 source/revision/before/targets 核对后生成 immutable UUID plan，digest 绑定 version/owner/space/producer/proposal+policy revisions/expiry/changes/unchangedIds，写 plan 不写业务。canonical JSON 与既有 PersonalService 一致：object keys 固定排序、数组保序、SHA256 hex64；禁止把 actor 原文/token放digest。relations 三项须齐；topic 数组保序，before null保持null，after全空且原null保留原表示且no-op。新差异/部分选择创建新 plan/digest，不编辑原 plan。approve 只接受 current owner actor，同 plan/digest/producer/policy/全部 source-target bindings 的独立 receipt；审批不扩权。

  commit 先拒 run actor；owner 当前身份/MFA/自身业务写权，与 API 当前 producer grant 的 todo read/write+organization read 分别独立校验。事务内可先非锁读 receipt 仅供定位，planId=`receipt?.planId ?? input.planId`；非锁读 immutable plan，**任何响应/业务写前**重验 current actor并以 `assertAgentGrant` 持 producer row SHARE：owner 只要求该 producer 的 preview read scopes 仍在，API 要同 producer 且全部 commit scopes；owner-origin无producer grant。不修改原grant权限。有效授权后，同 key 同 requestDigest 返回 duplicate（不再检查 plan expiry/current revisions）；同 key 改 body 即使新 plan 不存在也409，wrong grant先403而非泄露receipt。无 receipt才取 plan advisory=`[owner,'classification-plan-v1',space,planId]`，查一次消费、有效期、producer/policy revision、固定 approval，锁全部 todo/target并全量验证，末尾才写所有 changed records/history和batch receipt。全部 no-op也写一条receipt、零history。每次写前再次核当前提交actor所需guard；异常整批 rollback。

- [ ] **Step 4: GREEN 与真实 PG 并发/恢复资格。** 跑 Step2，及 `RUN_CLASSIFICATION_POSTGRES_TESTS=1 LIFEOS_FIXTURE_FRESH=approved-isolated-fixture node --test --test-isolation=none --test-concurrency=1 test/classification-postgres.integration.test.ts`。fixture 在 A1 已隔离服务上显式 apply0012，不读真实配置。read-only grant preview→owner批准/commit成功且grant字节/scopes/expiry未变；该grant的APIcommit403；撤销/失去producer read scope先赢时ownercommit403零写，preview read fence先赢可先完成。另验证API提交者丢write拒绝，但owner不因producer本来无write被拒。固定 A/Z barrier 覆盖交叉 batch、project PATCH、todo PATCH；不同 key 同 plan 全no-op一200一409；同 key同body一提交一duplicate、改body409；最后一条冲突零写；maintenance排他等待；commit先持grant SHARE则可先完成而撤销等待。producer撤销/丢read后新commit及receipt恢复拒绝，不能声称中断已授权锁事务。断连后同payload/key恢复、后续编辑/过期后历史receipt恢复、当前仍具所需权限的API与owner网页同key恢复，都没有第二次record/history写入。enabled零skip。
- [ ] **Step 5: 独立代码/安全 review 后提交。** `git commit -m 'feat: atomically commit owner-reviewed todo relations'`。原 single writer、授权边界及 publicCI 只读保持；module/readiness不合格不宣告preview/commit。普通实现继续到网页，不停在只有API的候选。

### Task 3: [A2.3] 可见 diff 审核、unknown 恢复和同片交付

**Files:** Create classification-review.tsx/.module.css 与 browser test；Modify 原 workspace 的 finite plan 入口、generic Skill、reference/artifact generator、CI和既有 requirements/Issue映射。

**Interfaces:** `ClassificationReview({planId,onClose}:{planId:string;onClose:()=>void})` 只接 UUID planId，不接 key/actor/外部URL。review 返回当前可见 labels及stale/approval/committed；当前标题不是历史快照，source/revision变更使stale=true并禁止提交，commit锁后仍最终裁决。没有 plan 列表或后台执行器；owner 原生操作及 Agent 返回的 plan 可打开同一网页审核入口。

- [ ] **Step 1: 写真实浏览器 RED。** 在360/1365px双主题显示 todo/目标名称、ID/版本、before→after、条数/no-op/到期和影响；非关系字段只读。取消零approve/commit；“确认这批关系并提交”串行approve→commit各一次；审批失败不commit。unknown 冻结原command/body/key，刷新后读receipt与实际记录；409保留差异并要求新preview，不能自动追新revision提交。编辑或选部分条目生成新plan并撤销旧UI批准；expired/revoked/stale/MFA丢失真实不可用。busy/unknown、Escape、焦点、导航guard及刷新恢复不丢请求。
- [ ] **Step 2: 运行 RED。** `RUN_CLASSIFICATION_BROWSER_TESTS=1 node --test --test-concurrency=1 test/classification-review-browser.integration.test.ts`，使用现有实际 Chrome（可由 `LIFEOS_TEST_CHROMIUM_PATH` 提供）；缺新UI/flow应失败。现 synthetic Next browser fixture 可以证明UI，但不能替 A2.2 的 native MFA/真实PG身份与事务验收。
- [ ] **Step 3: 实现现组件组合与 Skill。** 用 Radix Dialog+固定ReUI只读diff、同一 entity/detail链接和原导航保护，不造另一 writer。Skill顺序固定：完整 todo/组织读取→目录建议→具体授权后建目录并读回→真实ID preview→owner网页审核receipt→精确commit→逐条GET核source/revision/关系。后续编辑只报告，不补写覆盖。新Skill遵 A1 v2 catalog，unknown只重试同body/key，未经支持的merge/delete停在候选。生成 operations/artifact；未实现 MCPtransport不宣告工具可用，未来MCP复用同registry/service，不取得approve。
- [ ] **Step 4: 验证、独立 review 和固定 SHA CI。** A2.1/2焦点、实际PG、四组真实Chrome以及下方共同门禁全部执行；独立审实际 diff/交互、authority/receipt/锁序/隐私/许可，保留原 TLS/recovery/Auth 与 UI performance 门禁。记录fail/skip/unavailable，不以截图或HTTP200当业务读回。CI完整通过后依已有流程继续常规集成/已授权发布读回。
- [ ] **Step 5: 提交并准备具体启用包。** `git commit -m 'feat: add owner classification review and recovery'`。固定包列源码/制品、0011/0012 SQLhash与全文摘要、目标/ACL、非秘密 grant/current scopes/expiry/digest、加密/独立恢复/rollback、目录精确清单、planId/digest/全部before→after与逐条读回。真实启用和该清单执行须对应授权；其它已授权代码/资格继续。本人只在实际HTTPS网页检查真实结果，不以合成演示代签体验验收。

## A2 共同验证与交付 GO

执行 `npm test`、`npm run typecheck`，再 `LIFEOS_PLATFORM_CANDIDATE=0 LIFEOS_REVIEW_GIT_SHA=$(git rev-parse HEAD) npm run build -- --webpack` 与同输出 `LIFEOS_PLATFORM_CANDIDATE=0 node scripts/check-built-platform.mjs`。`OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1 CI=1 openspec validate personal-agent-foundation --strict` 使用1.16.0；保留原UI change独立门禁。重新生成Skill/reference后跑 `node --test test/agent-skill-sync.test.ts test/agent-skill-download.test.ts`，`git diff --check`，`git diff --exit-code -- package.json package-lock.json`。

只有 enabled PG/Chrome 零失败/错误/skip、独立安全/代码 review、固定SHA完整CI满足，才是源码候选 GO。真实 SQL/权限/运行配置/业务清单的授权与 readback 是另一组 GO；缺项不能真写，也不阻断独立安全的工程进展。按清单 readback须核每个todo source/revision/personal及receipt；若有后续编辑，报告“已提交且当前再变化”，不覆写。关闭flag或回滚镜像不会撤销已有业务分类；逆向变更须基于原before/after、当前CAS与引用依赖的独立精确清单，不能覆盖整库。

## 自审映射

immutable plan/严格schema/独立receipt和最小事务→A2.1；trusted actor/owner approval/producer fence/库内原子/并发恢复→A2.2；网页审核/Skill/实际读回/交付→A2.3。Review Focus五类分别有合同、service、真实PG与Chrome行为验证。真正 LangGraph/GraphileWorker、模型出站、专业来源迁移与 MCPtransport沿总计划其它阶段推进；本片不以它们尚未启用为由伪造run/权限或延后可用网页。
