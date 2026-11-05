# Atomic todo classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 网页呈现固定分类差异，由当前 owner 审核后，以一个事务提交整批待办关系并逐条读回。

**Architecture:** 在 A1 的组织能力、可信 actor 和统一记录锁序上，复用原 record/history writer，新增 immutable plan、owner approval 和独立 batch receipt。网页、Agent API 与未来 MCP 使用同一 ClassificationService；run-capability 只可读/preview，后台 worker 没有 approve/commit 权限。模型输出与 `confirmed:true` 不能代替服务端审批回执。

**Tech Stack:** 现有 Node24/Next16/React19/TypeScript6/PostgreSQL17、pg、Zod、固定 ReUI/Radix；无新依赖，无第二套编排器、数据库 writer 或 MCP server。声明兼容性须经实际 build/PG/Chrome 资格验证。

**Spec:** [PersonalAgent 总设计](../specs/2026-11-05-personal-agent-design.md)；[整体计划](2026-11-05-personal-agent-foundation.md)；[A1 前置计划](2026-11-05-organization-access.md)；[唯一执行清单](../../../openspec/changes/personal-agent-foundation/tasks.md)。本计划细化 canonical `2.1–2.3`（稳定别名 `A2.1–A2.3`）；完成状态只维护在该 OpenSpec 清单。

## Global Constraints

- 保留原 `LO-TASK-001`/#5、`LO-PROJECT-001`/#7、`LO-AGENT-001`/#35 和 identity/privacy 原需求；原 UI 五个任务 ID、继承2/5和后续唯一清单的资格状态保留，未完成运行/本人验收不代签。
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
 referenceObservationDigest?:string; // A2.3a: new previews require hex64; absent legacy stays strict
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
 committed:boolean;stale:boolean;receipt:ClassificationResult|null;
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
 classificationPlanReceipt(planId:string):Promise<ClassificationReceipt|null>; // ninth DAO added in A2.3a
 saveClassificationReceipt(receipt:ClassificationReceipt):Promise<void>;
}
interface ClassificationRepository extends PlatformRepository {
 classificationTransaction<T>(owner:string,spaceId:string,key:string,
  fn:(tx:ClassificationTransaction)=>Promise<T>):Promise<T>;
}
declare class ClassificationService {
 constructor(repository:ClassificationRepository,config:PersonalConfig,
  options:{authority:AuthorityService;assertReady:()=>Promise<void>;assertWritable:()=>Promise<void>;policyRevision:()=>string;now?:()=>number});
 preview(actor:TrustedActor,input:unknown):Promise<ClassificationPreview>;
 review(actor:TrustedActor,planId:string):Promise<ClassificationReview>;
 previewSelection(actor:TrustedActor,basePlanId:string,input:unknown):Promise<ClassificationPreview>;
 approve(actor:TrustedActor,input:unknown):Promise<ClassificationApproval>;
 commit(actor:TrustedActor,input:unknown,key:string):Promise<ClassificationResult>;
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

### Task 3: [A2.3a] 审核安全、只读回执和受约束部分选择

**Files:** Modify `src/personal-candidate/classification-{contracts,service,postgres,http}.ts`、`src/platform/contracts.ts`、`test/helpers/classification-memory.ts`、`db/0012_todo_classification.proposed.sql` 及对应 contracts/service/http/PG tests；仅必要时改同client composition/runtime owner operation allowlist。没有新表、角色、依赖、writer 或 Agent operation。

**Interfaces:** 新 `ClassificationPlan.referenceObservationDigest?:string`（内部hex64）、`ClassificationReview.receipt:ClassificationResult|null`、第九DAO `classificationPlanReceipt(planId)`；owner-only `previewSelection(actor,basePlanId,input)` 与 `POST /api/platform/personal/todo-classifications/{basePlanId}/preview`，exact body `{selectedTodoIds}`。全套合同见本计划 ignored ledger `task-3-preflight-review.md`；唯一memory实验已证明历史before引用在target正常更新后卡死。该报告的精确canonical输入/物理排序/复验点纳入本任务，不复制服务端算法到客户端。

- [ ] **Step 1: 写并运行 RED。** 新preview允许真实历史before@1在目标@2时刷新、移除、换关联；after旧版/ahead/错source/type/foreign/missing仍拒。preview后before-only target变化使approve/commit409且零业务写；legacy缺观察值保持strict，篡改观察或plan digest拒。运行 contracts/service/http 焦点并保存实际RED；不能改真实before或先单条写todo规避。
- [ ] **Step 2: 实现观察绑定。** 新preview锁全部直接todo与before/after targets，todo exact before/source/revision；before同owner/space/type/source且revision≤current，after exact current。复用 `personalRecordLockOrder`，hash输入固定 `{version:'classification-reference-observation-v1',ownerId,spaceId,records:[{kind,id,type,sourceId,revision}]}`。新preview必填；approve/无receipt新commit/review锁后重算，legacy走原strict；只比较pre-write map，不能对递增todo自冲突。plan digest自然绑定观察。proposed0012仅classification_valid plan分支optional key及hex校验；不改表/ACL/trigger，不静默更新fixture hash。
- [ ] **Step 3: 实现receipt/selection并 GREEN。** DAO按owner/space/plan，decodeReceipt+assertReceiptMatchesPlan，service再次验证；review.committed由validated receipt决定。GET当前MFA+producer read fence，写关闭、到期/后来编辑/policy变化仍可读历史，不调用write guard；撤销/失read/MFA失效403。subset严格distinct1..100 UUID且均是base成员，原序；producer fence→base advisory→拒approved/consumed/run provenance→current(base)→全base物理/观察验证→current+owner再验→selected新plan。保留原producer/grant/policy和expiresAt，新ID/digest/selected观察、无approval，不调用generic owner preview。未选记录stale也拒；旧新plan独立，不承诺撤销。测试边界/extra字段/乱序/全base stale/批准或到期先赢/锁等待MFA变化，零额外业务/history。原receipt replay和逐次write前授权保留。
- [ ] **Step 4: 启用 PG 资格。** 先报告旧/新SQL和函数候选差异；root唯一fixture lifecycle与controlled amendment writer。仅root exact-target/hash/marker/0client/oldfunction/readback/metadataCAS追加证据链后更新未发布隔离validator，不reset/drop/改业务。完整 enabled PG测试新增新旧validator/DAO隔离、target编辑与approve/commit、subset与approval竞态、GET等待MFA变化；保留原ACL/锁/receipt/no-op，叶零skip。补focused/type/full，保存provenance。
- [ ] **Step 5: 提交并独立 review。** `git commit -m 'fix: bind classification observations and recover reviewed results'`；报告RED/GREEN、actualPG和未运行项。本内部子任务不勾canonical2.3，网页/整片CI仍必须完成。

### Task 4: [A2.3b] 可见 diff Dialog、unknown 恢复和 Skill

**Files:** Create classification-review.tsx/.module.css 与 browser test；Modify 原 workspace 的 finite plan 入口、generic Skill、reference/artifact generator、CI和既有 requirements/Issue映射。

**Interfaces:** `ClassificationReview({planId,onClose}:{planId:string;onClose:()=>void})`只接UUID，不接key/actor/URL，必要时增加host close guard/container/onPlanChange窄回调。finite `modal=classification&planId=<UUID>`保留canonical背景；type-only import DTO，不能把node:crypto带进client。review返回receipt/当前labels；当前标题不是历史快照。Web Crypto key=`cls-`+SHA256(JSON.stringify([planId,digest]))共68字符，满足现8..96界限；body固定 `{digest,confirmed:true}`，route注入planId。刷新只GET；approval/commit未知不自动POST。

- [ ] **Step 1: 写真实浏览器 RED。** 在360/1365px双主题显示todo/目标名称、before→after、条数/no-op/到期和影响，ID/版本等细节折叠，非关系字段只读。取消零POST；确认串行approve→commit各一次，审批失败不commit。unknown冻结原command/body/key，刷新GET receipt再逐条GET实际记录，显式同key重试；409不追新revision。仅approval前允许subset，成功读到新plan才切URL，approved/unknown锁选择，关闭不撤销服务器批准。receipt优先于stale，后续变化只报告；401/403隐藏diff并保留显式重新登录恢复位置。busy/unknown、Escape/outside、焦点、背景草稿/scroll、back-forward及跨导航guard均核验，不能把用户永久困在unknown。
- [ ] **Step 2: 运行 RED。** `RUN_CLASSIFICATION_BROWSER_TESTS=1 node --test --test-concurrency=1 test/classification-review-browser.integration.test.ts`，使用现有实际 Chrome（可由 `LIFEOS_TEST_CHROMIUM_PATH` 提供）；缺新UI/flow应失败。现 synthetic Next browser fixture 可以证明UI，但不能替 A2.2 的 native MFA/真实PG身份与事务验收。
- [ ] **Step 3: 实现现组件组合与 Skill。** 复用Radix Dialog/ReUI/theme portal、原workspace history/nav/anchor/settings切换保护，不增竞争popstate监听，modal精确判别且classification不误开settings。空闲outside/Escape关闭、全屏展开，busy/unknown挡意外dismiss；只有URL持久化planId，无正文/凭据storage。Skill顺序：完整todo/组织读取→目录建议→具体授权建目录并读回→真实ID preview→owner网页审核链接→精确commit→逐条GET source/revision/关系。read-only producer可建议，批准不扩权，Agent commit仍需write。unknown同body/key或owner GET恢复，subset同expiry/全basecurrent/旧新独立。owner-private接口不进Agent/MCPcatalog，生成operations/artifact并跑原sync/download；MCP/worker不冒充已启用。
- [ ] **Step 4: GREEN、提交与独立 UI review。** 四布局真实Chrome、现organization/key/settings smoke、导航/type/focused与Skill同步；保存精确日志/有限内部合成captures，MemoryUI不替native auth/PG。`git commit -m 'feat: add owner classification review dialog and recovery'`；actual vs未验证分开，canonical2.3留给Task5。

### Task 5: [A2.3c] 整片资格、CI与具体启用候选

**Files:** `.github/workflows/ci.yml`及现CI fixture helpers/tests窄接线、原public requirements evidence/verification doc、ignored `.release-local/`固定包。沿同一canonical2.3，不开新需求池。

- [ ] **Step 1: 接 enabled PG/Chrome门禁。** 复用固定隔离目标/role/readiness，分类leaf/parent/capture数按实际执行断言。保留全部organization/nativeMFA/TLS/recovery/五组118/performance/三回执与只读CI权限；default skip不算acceptance。MemoryNextUI与nativePG分开披露，未跑mounted native分类HTTP不宣称。
- [ ] **Step 2: 共同验证、独立整片 review 与fixedSHA CI。** 运行下方full/type/defaultclosedwebpack/same-output/OpenSpec/Skill/lock，nativePG和四布局Chrome；most-capable审整分支权限/观察/receipt/锁/隐私/许可和实际交互，修复后窄复审。固定head完整CI通过才普通PR/merge，沿已授权分支保护。公共进度仅基于真实证据，保留全部需求ID/验收；早期QA“不含分类”改成历史固定source范围而非移动branch断言。
- [ ] **Step 3: 固定启用包。** 列源码/制品、0011/0012 SQLhash/摘要、精确target/ACL、非秘密grant/scopes/expiry/digest、加密与独立restore/rollback、issuer lifecycle/privateoverlay变化、目录精确清单、真实plan/digest/全before→after/逐条GET。未满足项NO-GO，不执行真实SQL/权限/配置/数据来填证据。只执行已具体授权且包合格发布部分，HTTPS版本/主流程真实回读；owner体验不代签，独立工程继续。
- [ ] **Step 4: canonical与continuity收口。** Task3–5实际source门禁均完成才勾原2.3；运行启用、真实迁移、本人验收分别开放，不关闭更大PersonalAgent目标。

## A2 共同验证与交付 GO

执行 `npm test`、`npm run typecheck`，再 `LIFEOS_PLATFORM_CANDIDATE=0 LIFEOS_REVIEW_GIT_SHA=$(git rev-parse HEAD) npm run build -- --webpack` 与同输出 `LIFEOS_PLATFORM_CANDIDATE=0 node scripts/check-built-platform.mjs`。`OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1 CI=1 openspec validate personal-agent-foundation --strict` 使用1.16.0；保留原UI change独立门禁。重新生成Skill/reference后跑 `node --test test/agent-skill-sync.test.ts test/agent-skill-download.test.ts`，`git diff --check`，`git diff --exit-code -- package.json package-lock.json`。

只有 enabled PG/Chrome 零失败/错误/skip、独立安全/代码 review、固定SHA完整CI满足，才是源码候选 GO。真实 SQL/权限/运行配置/业务清单的授权与 readback 是另一组 GO；缺项不能真写，也不阻断独立安全的工程进展。按清单 readback须核每个todo source/revision/personal及receipt；若有后续编辑，报告“已提交且当前再变化”，不覆写。关闭flag或回滚镜像不会撤销已有业务分类；逆向变更须基于原before/after、当前CAS与引用依赖的独立精确清单，不能覆盖整库。

## 自审映射

immutable plan/严格schema/独立receipt和最小事务→A2.1；trusted actor/owner approval/producer fence/库内原子/并发恢复→A2.2；网页审核/Skill/实际读回/交付→A2.3。Review Focus五类分别有合同、service、真实PG与Chrome行为验证。真正 LangGraph/GraphileWorker、模型出站、专业来源迁移与 MCPtransport沿总计划其它阶段推进；本片不以它们尚未启用为由伪造run/权限或延后可用网页。
