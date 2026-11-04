# PersonalAgent foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 持续交付一个可检查授权资料、提出有依据建议、集中审核并核验结果的PersonalAgent网页，同时以同一服务承接API、Skill与本机MCP。

**Architecture:** LangGraph JS是唯一编排，PG checkpointer保存有界运行状态，Graphile Worker优先承接领取/唤醒/重试；现有AI SDK只负责模型与结构化输出，PersonalService及typed业务服务继续唯一写入。source/context/proposal/run/receipt分层存储；TrustedActor及窄委托决定每步权限，后台只能read/preview。

**Tech Stack:** 当前单锁Node24/Next16.4.1/React19.3/TS6.0.2/PG17.11、pg8.23.1、AI SDK7.0.150、固定ReUI/Radix；后续固定候选LangGraph1.6.1/core1.3.4/checkpoint1.2.2/PG saver1.1.2、Graphile Worker0.18.0、split MCP SDK2.4.0/protocol2026-07-28。声明兼容不等于集成通过。

**Spec:** [总设计](../specs/2026-11-05-personal-agent-design.md)、[新OpenSpec](../../../openspec/changes/personal-agent-foundation/proposal.md)。**唯一执行状态**在该change的[tasks.md](../../../openspec/changes/personal-agent-foundation/tasks.md)；这里的步骤只说明做法，不独立宣告完成。

## Global Constraints

- 原34个需求ID/Issue保持；新增输入追加原项。原unified-business-ui五task继承2/5和待验门禁不变；既有key-manager/operation旧change不复制完成状态。
- 普通功能在需求入池、必要查证和独立技术评审后持续实现，不逐项等owner确认计划；owner集中检查真实结果，执行者不能代签体验验收。
- 新费用、权限/身份扩大、私密出站、真实迁移、持久worker/系统设置及不可逆动作须具体固定包授权，仅暂停依赖动作。
- 新flags缺省关闭；不启动后台、不自动SQL/setup、不读真实凭据/来源、不默认真实模型调用，不接公司系统，不恢复已暂停工作流。
- 网页、API、Skill及MCP共用registry和业务writer。每片有可操作网页与实际数据核验路径；合成仅内部测试，真实缺源显示not-connected。
- v1 capability catalog保留旧todo:read和原六operation scope语义；v2 catalog以requiredScopes支持org-only，业务路径不自动升v2。仅404可按已知todo合同回退，不在401/403/503时回退。
- 分类preview只需todo:read+organization:read；APIcommit需todo:write+固定ownerapproval；ownercommit用本人写权并fence producer原read，不给producer扩权。后台无approve/commit。
- 事实、推断、候选、审批、执行状态与回执分开；模型/来源正文不是指令；禁止任意SQL/shell/URL、无边界derived JSON与静默合并/删除。
- 单npm lock、固定版本及NOTICE；生产授权不进入publicCI。实际执行/失败/skip/unavailable与部署/owneracceptance分别报告。

## Review Focus

- 只读producer可提出候选，owner独立写权与producer撤销不能互相冒充；A2.2真实PG覆盖此边界。
- 原v1用户不被新版catalog误导，MCP不能因工具包装扩大scope；A1.1和7.1做合同对照。
- 同一历史资料的计划/快照/回执/报告不是多份完成实绩；4.1/4.2用版本化合成包证明。
- worker重复投递、checkpoint恢复和未知计费不得重复调用/提交或免费重试；5.1–5.4用崩溃/并发/未知结果验证。
- 私人context/checkpoint/本机pending的保护与独立恢复需实际验证；3.1/4.3/5.1/8.2不能用schema或解析代替。

## 文件与唯一接口边界

| 边界 | 主要文件/职责 |
| --- | --- |
| A1/A2 | 见[组织权限详细计划](2026-11-05-organization-access.md)与[原子分类详细计划](2026-11-05-atomic-classification.md)，复用原PersonalService/registry/issuer/网页 |
| Authority | `src/agent-authority/{contracts,service,postgres}.ts`：唯一TrustedActor、producer和当前operation/source验证；A1先owner/agent，运行阶段再实现窄run委托 |
| Context | `src/personal-context/{contracts,service,postgres,http}.ts`、`coverage.ts`：typed证据引用、确认上下文、推断、覆盖与有限检索 |
| Intake | `src/source-intake/{contracts,domain,service,postgres,http}.ts`、`mappers/*`：包/版本/映射/回执/对账，原件仅私密引用，不暴露本机路径 |
| Runs/model | `src/personal-agent/{contracts,graph,model,tools}.ts`、`src/agent-runs/{contracts,service,postgres,http,events,checkpoint,worker}.ts`：单图、有界生命周期、守卫后的状态/事件及成熟worker适配 |
| Budget | `src/agent-budget/{contracts,service,postgres}.ts`：原子reserve/settle、unknown与唯一retry ledger；不是SDK配置预算字段的别名 |
| Website | `src/personal-candidate/agent-{context,coverage,runs,insights}.tsx`及有限CSS；复用现workspace导航、Radix/ReUI、原entity editor |
| MCP | `src/agent-mcp/{stdio,client,tools,config}.ts`与reviewed generic包装脚本；固定HTTPS client、registry投影，非第二业务后端 |
| Verification | 对应`test/*` unit及opt-in PG/Chrome/MCP资格；CI只加明确synthetic enabled cases与零skip守卫 |

新增迁移候选按执行前inventory确认：0011授权、0012分类、0013 source-intake-v2、0014 personal-context、0015 run-authority-budget、0016 graph-checkpoint-jobs；每domain其后独立proposed。编号不是已执行迁移，也不假定旧candidate SQL已在目标存在。vendor schema/setup必须由独立migration owner的固定包安装，应用启动不执行。

```ts
type AuthoritySourceRef = Readonly<{provider:string;sourceId:string;revision:number}>;
// contracts.ts中的opaque brand只能由service resolver生成；不是HTTP DTO
type TrustedActor = TrustedOwnerActor | TrustedAgentActor | TrustedRunActor;
type TrustedOwnerActor = Readonly<{kind:'owner-session';ownerId:string;spaceId:string;sessionRef:string}> & TrustedBrand;
type TrustedAgentActor = Readonly<{kind:'agent-grant';ownerId:string;spaceId:string;grantId:string;scopes:readonly AgentScope[]}> & TrustedBrand;
type TrustedRunActor = Readonly<{kind:'run-capability';ownerId:string;spaceId:string;runId:string;capabilityRef:string}> & TrustedBrand;
type ProducerAuthority = Readonly<{
 kind:'owner-session'|'agent-grant';reference:string;authorizationRevision:string;
}>;
type RunAuthorityProof = Readonly<{
 runId:string;capabilityRef:string;producer:ProducerAuthority;
 allowedOperationIds:readonly string[];sourceRefs:readonly AuthoritySourceRef[];
 policyRevision:string;expiresAt:string;
}>;
// AuthorityService(deps)
resolveOwnerActor(headers:Headers):Promise<TrustedOwnerActor|null>;
resolveAgentActor(key:string):Promise<TrustedAgentActor|null>;
resolveRunActor(runId:string,capabilityRef:string):Promise<TrustedRunActor|null>;
assertCurrentAuthority(actor:TrustedActor,operationId:string,sourceRefs?:readonly AuthoritySourceRef[]):Promise<void>;
```

A1 `AgentScope`初片只有todo/organization四scope；之后context:read/write、intake:read/write、agent:read/run以及professional域scope必须随实现逐片明列扩展，不能提前wildcard授权。context写修改本人确认资料；intake apply是固定包操作；agent:run依赖agent:read及独立预算/出站授权。MCP自身不增加scope。

## 1. A1组织与显式权限（OpenSpec1.1–1.4）

**Interfaces / Files / RED-GREEN:** 完整沿[详细计划](2026-11-05-organization-access.md)，不在这里抄第二套签名。依赖原owner/MFA与todo服务；产出TrustedOwnerActor/TrustedAgentActor、generalized grant fence、组织API、兼容catalog及网页权限。

- [ ] 先按1.1–1.4逐task行为RED→最小实现→GREEN→独立review；记录锁序仅修真实todo/project环，不重排原command→grant，不重构finance/import。
- [ ] 实际PG证明scope CAS/secret-freeaudit/read-only generalfence/撤销与旧todo fallback；真实Chrome证明组织读改与现key权限确认、取消和unknown。
- [ ] fixedSHA完整CI后交付默认关闭候选及可用网页；需要真实0011/现key扩权才在完成具体包后要求对应授权，未授权不阻塞独立A2代码。

## 2. A2固定审核与原子分类（OpenSpec2.1–2.3）

**Interfaces / Files / RED-GREEN:** 完整沿[详细计划](2026-11-05-atomic-classification.md)。直接import母TrustedActor，private candidate写不冒充businesswrite，run能力只preview/review；fixedplan approval/receipt不从body boolean推导。

- [ ] 依次落实2.1–2.3的8事务feature methods、strict operation schemas、read-only producer/ownerwrite/APIwrite分界、plan advisory与全record锁。
- [ ] PG以固定barrier证明末项冲突零写、all-no-op同plan并发、samekey回执恢复及producer撤销；Chrome在360px/desktop双主题证明精确diff、取消、调整和unknown恢复。
- [ ] 一片交付网页review→ownerapprove→exactcommit→逐条readback；真实SQL/目录创建/分类固定清单未批时只交默认关闭候选与诚实不可用状态，不显示合成owner数据。

## 3. Context / coverage（OpenSpec3.1–3.3）

**Files:** Create context四文件/coverage.ts、agent-context/coverage网页、`test/personal-context.test.ts`、`test/personal-context-postgres.integration.test.ts`、`test/agent-context-browser.integration.test.ts`。proposed0014。

**Interfaces:**

```ts
type EvidenceRef = Readonly<{sourceItemId:string;sourceRevision:number;digest:string}>;
type ConfirmedContext = Readonly<{
 id:string;revision:number;kind:'fact'|'goal'|'preference';title:string;text:string;
 validFrom:string|null;validThrough:string|null;state:'active'|'superseded'|'disabled';
 evidence:readonly EvidenceRef[];confirmedAt:string;
}>;
type SourceCoverage = Readonly<{
 provider:string;sourceScope:string;authorized:boolean;connected:boolean;
 status:'complete'|'partial'|'unknown'|'failed'|'not-connected';
 requested:Readonly<{from:string|null;through:string|null}>;sourceAsOf:string|null;
 lastReadAt:string|null;returnedCount:number|null;truncated:boolean;reason:string|null;
}>;
// ContextService(deps); owner/space取自TrustedActor，confirmed mutation另需owner guard或显式context:write
listCoverage(actor:TrustedActor):Promise<readonly SourceCoverage[]>;
queryContext(actor:TrustedActor,input:Readonly<{query:string;sourceRefs:readonly AuthoritySourceRef[];limit:number;cursor?:string}>):Promise<ContextPage>;
confirmContext(actor:TrustedActor,input:ConfirmedContextInput,key:string):Promise<ContextReceipt>;
```

`ContextPage={items:ContextItem[],coverage:SourceCoverage[],nextCursor?:string}`，ContextItem封闭union为evidence引用/confirmed/inference；inference含id/revision/evidence/modelConfigRevision/promptVersion/unknowns/stale，不含任意业务字段。query≤240字符、limit1..100、cursor绑定owner/filter/snapshot；confirmed text≤4000，date严格ISO，expectedRevision/CAS；更正保留旧版和invalidate依赖，不自动确认模型输出。provider实现前必须收窄为已实现provider enum。

- [ ] **RED:** 新测试`inference_never_confirms_itself`、`superseded_goal_invalidates_proposal`、`truncated_is_not_zero`、`revoked_source_is_filtered_before_retrieval`和foreign-owner cursor；`node --test test/personal-context.test.ts`必须先FAIL。
- [ ] **Implement:** strict合同及typed表（context种类/state/时间/owner复合键、版本/引用），复用sameowner SQL和source_version；表RLS与ACL独立资格，不把checkpoint Store当长期context。
- [ ] **GREEN:** unit+`RUN_PERSONAL_CONTEXT_POSTGRES_TESTS=1 node --test --test-isolation=none --test-concurrency=1 test/personal-context-postgres.integration.test.ts`在显式syntheticfixture零skip；含历史导出/恢复与引用失效。
- [ ] **Website / review:** `RUN_AGENT_CONTEXT_BROWSER_TESTS=1 node --test test/agent-context-browser.integration.test.ts`，实际看来源覆盖、改目标/偏好、刷新/更正历史；API/discovery/Skill同片登记，独立review/固定SHA交付，未接源诚实显示。

## 4. Immutable source intake / reconciliation（OpenSpec4.1–4.3）

**Files:** source-intake各模块、`mappers/legacy-lifeos.ts`首mapper、网页migration-preview、`test/source-intake.test.ts`、`test/source-intake-postgres.integration.test.ts`、`test/source-intake-browser.integration.test.ts`；proposed0013公共表，domain表按子片另加。

**Interfaces:**

```ts
type SourceItemKind = 'profile'|'domain'|'project'|'topic'|'todo-snapshot'|'journal-original'|'reflection'|'report'|'rule'|'attachment-reference';
type SourceManifest = Readonly<{
 packageId:string;packageDigest:string;schemaVersion:2;mapperVersion:string;
 provider:'legacy-lifeos';coverage:readonly SourceCoverage[];
 items:readonly Readonly<{sourceIdentity:string;sourceRevision:string;kind:SourceItemKind;contentDigest:string;bytes:number;privateObjectRef:string}>[];
}>;
type MappingDisposition = 'accepted'|'rejected'|'unknown'|'duplicate'|'no-op'|'conflict';
// IntakeService(deps)，无client任意文件路径/URL/SQL；sourcePackageRef由获准private包注册服务解析
previewPackage(actor:TrustedActor,sourcePackageRef:string):Promise<MappingPreview>;
applyPackage(actor:TrustedActor,input:Readonly<{previewId:string;digest:string;selectedItemIds:readonly string[];approvalRef:string}>,key:string):Promise<IntakeReceipt>;
reconcilePackage(actor:TrustedActor,batchId:string):Promise<Reconciliation>;
```

`MappingPreview={id,digest,expiresAt,mapperVersion,items:{id,kind,disposition,reason,targetRef?,beforeRevision?}[],counts}`；typed `MappedRecord`按domain分支，不接受任意derived JSON。首片默认最多1000manifest项/200apply项，超过显式拒绝/拆包，不静默截断；摘要不替源身份。每个选中item在同batch/owner映射，apply目标写与receipt同事务；跨batch watermark只在Reconciliation的source/target/counts/refs核对后推进。后续training/body/food/finance等另加各自typed mapper，不把未知列随手塞入通用字段。

- [ ] **RED:** `snapshot_plan_receipt_not_duplicate_activity`、`changed_package_requires_new_preview`、`same_identity_new_content_is_version`、`same_title_different_source_not_merge`、`secret_or_executable_item_rejected`；`node --test test/source-intake.test.ts`先FAIL。
- [ ] **Implement/GREEN:** immutablebatch/item_version/command、source identity locks、selecteddigest/CAS及typedprojection；enabledPG测试同包二次零新增、末项冲突零写、应答丢失同command恢复、tombstone不删原件、对账前不进watermark。
- [ ] **Website:** realChrome显示accepted/rejected/unknown/conflict、来源/target差异和回执对账，未授权apply不能发生；privateObjectRef不下发真实文件路径。
- [ ] **Protection/GO:** 固定包含实际存储/backup加密与key恢复、日志保留/限额、临时目标独立恢复逐实体/来源/权限读回及附件可读性；缺项NO-GO敏感真实导入，继续独立代码/页面工作。原件不删除，回滚为精确inverse/CAS和引用依赖处理。

## 5. Durable run / authority / budget（OpenSpec5.1–5.5）

**Files:** agent-authority运行分支、agent-budget三文件、personal-agent四文件、agent-runs七文件、agent-runs网页及聚合view；unit/PG/Chrome按各模块分开。proposed0015/0016，vendor迁移仅固定资格脚本，不在launch调用setup。

**Interfaces:**

```ts
type RunStatus = 'queued'|'observing'|'planning'|'proposing'|'awaiting-review'|'committing'|'verifying'|'completed'|'paused'|'rejected'|'cancelled'|'conflict'|'budget-exhausted'|'failed'|'outcome-unknown';
type RunLimits = Readonly<{nodes:20;modelCalls:6;readPreviewTools:20;activeMilliseconds:600000}>;
type RunSnapshot = Readonly<{id:string;revision:number;status:RunStatus;eventCursor:string|null;limits:RunLimits;proposalIds:readonly string[];receiptRefs:readonly string[];waitReason:string|null}>;
// RunService(deps); start/resume不在请求里嵌第二个模型loop
start(actor:TrustedActor,input:RunStartInput,key:string):Promise<RunSnapshot>;
read(actor:TrustedActor,runId:string):Promise<RunSnapshot>;
cancel(actor:TrustedActor,runId:string,expectedRevision:number,key:string):Promise<RunSnapshot>;
resume(actor:TrustedActor,runId:string,expectedRevision:number,key:string):Promise<RunSnapshot>;
events(actor:TrustedActor,runId:string,cursor:string|null,limit:number):Promise<RunEventPage>;
// BudgetService，整数minor units，币种/价格版本由固定policy绑定
reserve(actor:TrustedRunActor,input:BudgetReservationInput):Promise<BudgetReservation>;
settle(reservationId:string,input:Readonly<{status:'known'|'unknown';actualMinor:number|null}>):Promise<void>;
```

`RunStartInput={goalContextRef,sourceRefs,policyRevision,modelConfigRevision}`全strict且goal/source已实现授权；`BudgetReservationInput={runId,operationKey,priceRevision,worstCaseMinor}`，唯一run/operationKey，reserve事务锁预算，known不得超未经批准政策，unknown保持占用；一次resume不自动加预算。`RunEventPage={items:{sequence:number,kind:RunEventKind,occurredAt:string,projection:RunEventProjection}[],nextCursor?,hasMore:boolean}`；event kind及projection为状态/工具/候选/预算/回执封闭union，limit1..100，cursor绑定owner/run，禁止rawprompt/state/providererror。graph内部有committing/commit等既有状态时只表示owner/API提交结果观察，worker无执行commit工具。

- [ ] **5.1 qualification RED:** 固定候选包元数据/许可/peer/source API查证后，在独立synthetic资格target写`test/langgraph-postgres-qualification.integration.test.ts`，检验真实native saver getTuple/list/put/putWrites、同owner连接上下文、foreign-thread/复用连接隔离、restart/oldschema和无superuser/BYPASSRLS。`RUN_LANGGRAPH_POSTGRES_TESTS=1 node --test --test-isolation=none --test-concurrency=1 test/langgraph-postgres-qualification.integration.test.ts`先见未实现FAIL，后固定单lock/GREEN；NO-GO时不自建第二引擎或特权旁路。
- [ ] **5.1 storage rule:** vendor checkpoint独立schema/role，run→owner映射及每条native查询的scope须实证；不能只在外层guard后让nativepool脱离ownercontext。schema若无owner列，可审过的join-policy/owner-boundclient薄适配后验证FORCE RLS；原生API无法安全适配则该片NO-GO。worker role无业务record UPDATE/approval INSERT/key管理权，queue权限只覆盖明列task与runRefs，不能把job权限当业务权限。
- [ ] **5.2 RED/GREEN:** `test/agent-authority.test.ts`/`agent-budget.test.ts`钉住owner-session失效暂停、grant缩scope、run不能approve/commit、capability不能从body构造、相同operation只reserve一次、并发最后额度只一调用、unknown不自动释放；enabledPG证明事务/role边界。真实费用上限未配置时modeladapter直接拒绝调用。
- [ ] **5.3 RED/GREEN:** `test/personal-agent-graph.test.ts`以syntheticmodel序列验证observe→plan→工具→observe，20node/6model/20tool/10active分钟停止，maxRetries=0、数据先过滤、structuredschema失败不写、abort不再调用。只有一个StateGraph，没有ToolLoopAgent/WorkflowAgent第二loop；LangSmith/环境trace禁用，syntheticfetch捕获0额外出站。
- [ ] **5.4 RED/GREEN:** `test/agent-worker-postgres.integration.test.ts`用真实PG+Graphileworker明确barrier做重复job、租约/同run串行、kill后checkpointresume、awaitingreview释放job、未知receipt不换command、graphschema不兼容安全暂停；后台即使收到approvalevent也只更新观察/下一预览，不调用commit。jobpayload仅runId/commandId，恢复按当前capability而非checkpoint权限。
- [ ] **5.5 Website/GO:** `RUN_AGENT_RUN_BROWSER_TESTS=1 node --test test/agent-run-browser.integration.test.ts`覆盖current stage/wait/cancel/refresh/cursor断线重连/跨客户端/unknowncost，不展示内部thought。源码/PG/Chrome/独立review/fixedSHA合格后才准备model数据出站/费用与常驻worker精确包；未批不得把新worker装成系统服务。

## 6. Professional typed domains（OpenSpec6.1–6.4）

各域沿原Issue及已有source inventory，使用相同source/context/actor/registry，不让专业事实进入自由JSON万能表。下列各片在编码前形成其typed接口增量计划并技术评审后继续，普通细化不另等owner；原需求的完整验收仍保留。

- [ ] **6.1 Journal/people/links:** 修改既有personal business/service/editor唯一writer并加`src/personal-candidate/business-links.ts`与`src/agent-api/{journal,people}.ts`。Journal={title,text,occurredOn,links}完整CAS；Person={displayName,aliases,notes}，links明确project/domain单值、people/topics/tags各≤20/source/revision；不读通讯录。autosave需本篇明确启用、IME/debounce/单writer/unknown冻结/多标签CAS，先行为RED再realChrome+PG；history按id真正取齐，不bounded全局窗口后过滤。
- [ ] **6.2 Calendar/life stages/anniversaries:** 独立`src/personal-projections/calendar-*`typedservice，CalendarEvent按calendar/event/occurrence identity、all-day结束不含、timezone/read-only/取消unknown；LifeStage={title,startOn,endOn,links}、Anniversary={title,originOn,calendarSystem:'gregorian',repeat:'none'|'yearly',timeZone,personRef}；无日期未排期、农历不支持明确。窗口≤92天、页1..100且cursor绑来源snapshot。用DST/重复例外/共享creatorunknown/read-only合成RED与获准来源逐源readback，网页可核真实专业视图。
- [ ] **6.3 Health:** 独立TrainingSession/Exercise/Set、BodyMeasurement、FoodLog/Item、TrainingPlan/Day/MealTemplate；组次/单位/RPE/unknown及sourceoriginal保留，有实测才存HeartRateSample；计划不作完成，模板不作实吃，缺覆盖不是0。每域typedendpoint/明确health:read、coverage/units；无AppleHealth连接时睡眠/HRV/日常步数not-connected。source envelope/日期窗/截断用真实合同验证，再独立专业页/PG/Chrome/同scopeSkill。
- [ ] **6.4 Finance:** 独立FinanceTransaction={kind:expense|income|refund|transfer|repayment,amountMinor,currency,occurredOn,from,to,originalLink}；Account/Category/BalanceSnapshot/DebtSnapshot有明确字段，refund可unresolved、未知余额不是0。窗口与同筛选totals/coverage一致；无可靠export不称已连接。先synthetic退款/还款/转账/多币种/asOf不一致RED，再typedparser/query/网页/PG与独立授权的余额/恢复对账；不自动切authority或开第二账本。

每域新输入和查询一并交API/discovery/Skill，以及从同registry自动投影的MCP支持状态；未完成adapter/host资格不声称可用。source缺材料只挡该域真实接入，其他域和网页候选继续。

## 7. MCP and measured insights（OpenSpec7.1–7.4）

**MCP Files/Interfaces:** `src/agent-mcp/{stdio,client,tools,config}.ts`；`createLifeOSMcpServer({client,registry}):McpServer`、`LifeOSApiClient.discover():Promise<CapabilityCatalogV2>`、`execute(operationId,args,key?):Promise<OperationResult>`。构造器从批准runtime取固定HTTPSorigin/credential不出现在参数schema、stdout或Skill；stdio stdout仅协议，脱敏诊断stderr。API/discovery错误只映射协议错误和非秘密码，unknown写仍回原command/receipt恢复。

- [ ] **7.1 RED/GREEN:** `node --test test/agent-mcp.test.ts`先FAIL，覆盖tool-list∩catalog、同schema/error/coverage、read-onlyproducer能preview但commit403、无approve/keymanagement/SQL工具、固定origin/redirectstop、无actor字段注入。固定officialsplitSDK2.4.0/protocol2026-07-28后用真实SDKclient与stdio进行initialize/list/call，不能仅mock声称互通。可在A1后并行写adapter，不等待所有领域。
- [ ] **7.2 Host/GO:** syntheticruntime测试包无账号/key/privatepath；目标host实际请求discovery→read→preview→readback；接真credentialruntime/改持久配置前列完整包获批。remoteHTTP/OAuth另列audience/resource/PKCE/discovery不在stdio包里隐式启用。
- [ ] **7.3 Insight RED/GREEN:** `src/personal-agent/insights.ts`产`Insight={id,revision,evidence,goalRevision,kind:'classification'|'link'|'duplicate-candidate'|'improvement',unknowns,proposalRef|null,stale}`；先`test/agent-insights.test.ts`覆盖缺证据/过期目标/source撤销/同候选去重/频率和budget，无自动merge/delete。网页owner-entry触发或已具体批准事件，不顺手创建系统timer。
- [ ] **7.4 Evaluation:** `src/personal-agent/evaluation.ts`及`test/agent-evaluation.test.ts`用versionedsyntheticdataset验证按source实体/时间隔离heldout、无越权/重复sideeffect、100%动作有receipt及事实/建议有source或unknown；分类precision95%是候选目标，必须披露实测precision/recall/采纳/成本，未达则改prompt/context继续测。更正只在本人确认后成长期偏好；不用自评分/自动fine-tune或上传私密trace代验收。

## 8. Shared verification / delivery（OpenSpec8.1–8.3）

- [ ] **8.1每slice sourceGO:** 受影响focus RED/GREEN→`npm test`→`npm run typecheck`→固定sourceSHA的`LIFEOS_PLATFORM_CANDIDATE=0 npm run build -- --webpack`→同输出`LIFEOS_PLATFORM_CANDIDATE=0 node scripts/check-built-platform.mjs`；CLI1.16.0下`OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1 CI=1 openspec validate personal-agent-foundation --strict`及原UIstrict；生成Skill/reference/artifact并测drift、dependencylicense/audit与sourceinventory，`git diff --check`。独立review实际diff/spec/security/privacy/license，不把逐份自审当独立review。
- [ ] **8.1集成GO:** 上述opt-in PG/Chrome/MCP在精确隔离syntheticfixture显式enabled并JUnit零skip，所有原Auth/TLS/recovery/未知写入门禁保留。未运行/缺工具写unavailable；不把默认skip算通过。触发新失败按现纠偏机制取证，不改失败oracle来迎合未批准行为。
- [ ] **8.2实际activationGO:** 每固定包列source/artifact/version、SQLhash/目标/角色与readonly风险、现grant非秘密summary+scope差异、来源manifest/选择/approvaldigest、费用上限/出站目的、常驻settings、backup/restore/logretention、精确rollback及逐实体readback。常规源码PR按已有授权/branchprotection/固定SHA全CI后合并并跟既有CD读回；真实SQL/权限/迁移/后台/成本未批仅相应动作NO-GO，不拿publicCI作生产执行器。
- [ ] **8.3持续收口:** 每片实际HTTPS页面/运行版本/专业数据主流程与receipt/refresh/relogin结果readback，owner体验另记；原Issue/34ID/OpenSpec单一状态追加证据，未完成/paused保留。checkpointhandoff记目标/真实状态/命令/固定版本/失败计数/下一动作，不能把聊天承诺当后台机制。

## 9. 原关系图谱与事项工作流接续（OpenSpec9.1–9.6）

这组承接原需求，不复制原UI五tasks状态。详细来源见[原成熟图谱选型](../specs/2026-11-04-relationship-graph-selection.md)与原unified-business-ui的Owner requests；新canonical执行项显式补齐未覆盖部分。

- [ ] **9.1 关系projection:** 新`src/personal-context/relationship-projection.ts`只派生明确links；输入actor/type/from/through，输出stable nodes/typed edges/counts/sourceRefs/unknownDateCount。`test/relationship-projection.test.ts`先RED验证同权限分母、修订/重复、时间/类型过滤、错owner；GREEN后对原实体source/revisiondrilldown，不从共现制造关系。
- [ ] **9.2 成熟图谱:** Gephi Lite1.1.0/GPL-3.0为现选型候选，独立React18/Vite应用，通过固定同源driver薄适配，不混装进React19树，也不退回被否决的自建ECharts探索器。先固定artifact/许可/网络/identity隔离试验，再实际浏览器图谱搜索/过滤/边计数/来源回看/清理会话/无外传；GPL分发或新部署包未批只挡实际接入，JSON导出不作图谱完成。
- [ ] **9.3 事项Gantt:** 在真实task/schedule视图加独立Gantt入口及未排期，先钉住明确startOn/endOn/date precision及source版本，再编composition；`test/matter-gantt.test.ts`和Chrome覆盖无日期、跨月/年/时区、筛选同taskIDs及刷新，不把需求池Gantt当交付，不从dueOn猜duration。
- [ ] **9.4 Kanban:** 扩既有board adapter，拖动只生成原mutation session的状态差异；RED拖动/键盘取消、CAS冲突、unknown原key恢复、触摸与刷新；GREEN原writer及真实Chrome，无第二保存入口。
- [ ] **9.5 换行批录:** 接续accepted batch-entry方向，逐行预览/稳定临时ID/精确选中确认，空行/重复/多次提交与未知回执先RED；在专用小计划明确创建批次原子合同，不把A2分类plan硬塞创建。网页/API/discovery/Skill同片并用PG/Chrome验实际批量结果。
- [ ] **9.6 可恢复删除:** 用独立软删除/restore合同保留identity/source/history并定义引用影响，cancelled不是delete；先synthetic旧引用/重复restore/CAS与unknown RED，再proposed迁移/网页/API/PG/Chrome。真实删除/永久删除不从“整理”泛化，原件和后续用户编辑不能被回滚镜像覆盖。

## 10. 原其他业务与限定实验（OpenSpec10.1–10.5）

- [ ] **10.1 内容/学习:** 沿#13现有文章/收藏来源，普通自主设计细化本地草稿/auto-save/CAS/history与API parity；先unit行为RED，再网页真实刷新/跨会话读回，不以摘要代原件。
- [ ] **10.2 文件索引:** 沿#16保留受控reference/private对象存储，索引与project backlink只读定位；synthetic不在授权范围/缺附件/换版本/跨owner先RED，真实搬移、删除、外传另批。
- [ ] **10.3 时间历史:** 沿#8/LO-TIME-001，仅已获准历史query/readback；数据覆盖/实际记录日/不等长区间/重叠/闰日/时区与修订去重先RED。网页缺数据不推断未发生，不重启退役自动time writer。
- [ ] **10.4 报告/输出:** 沿#17将报告保存为有sourceRefs/生成版本/失效状态的artifact，不重复写业务事实；synthetic输出目标和明确confirmation先验，真正外部发布需其具体目标授权。
- [ ] **10.5 实验/法律边界:** 保留LO-EXPERIMENT-001隔离代码/测试/结果追溯；LO-LEGAL-001先地区/资料范围/官方来源及未连接状态，不把本Agent目标授权成任意法律资料导入/模型外调。仅在指定实验包授权后接通，未完成不标done。

## Self-review / execution handoff

八个capability映射唯一tasks1–8，原未覆盖关系图谱/事项工作流和其他业务以9–10显式接续，34ID逐项覆盖见[映射表](../specs/2026-11-05-personal-agent-requirements-coverage.md)。A1/A2以独立详细计划执行；typedcontext、intake、run/budget/MCP合同在各自入口定义，不让实现者选择第二编排或权限模型。ReviewFocus五类均有对应behaviortest；写SQL、发布或owner验收没有被计划existence勾成完成。

当前是规划提交，没有产品行为/PG/Chrome/模型/MCP通过结论。接续者核对newchange apply instructions、原Issues及真实worktree后，从1.1开始持续实现；本计划不再要求owner先选执行菜单。用当前平台真实持续执行机制维护已启动目标，技术任务完成后进入下一已授权片；只有具体授权/材料/硬门禁缺口暂停相应动作。
