# Requirements intake and continuity

The 2026-11-04 owner feedback requires intake before implementation: record the addition, deduplicate by behavior, retain a stable ID/source/acceptance/priority/dependencies/status, split independently verifiable slices, then execute. New messages append to unfinished requirements. Explicit owner cancellation or replacement is required to remove scope. The project AGENTS and LO-REQ-001 now state this order.

## Reconciliation

The original product baseline has 31 IDs. The previous public projection retained25 and omitted6; those6 are restored as their original IDs, not replacement backlog items. Only generic product requirements enter public source. Private operational targets, personal records, credentials and historic private evidence remain outside it. Previously implemented evidence is not reset; original implementation/verification/deployment/owner-acceptance gates remain distinct.

| Inherited ID | Current mapping |
|---|---|
|LO-VERSION-001|Same ID, version/evidence distinction|
|LO-UI-001|Same ID, shared workspace and original five OpenSpec tasks|
|LO-REQ-001|Same ID, intake-first and visible roadmap|
|LO-AUTH-001|Same ID, default-closed owner login|
|LO-AUTH-002|Restored original ID, object isolation; Issue3|
|LO-SEC-001|Restored original ID, MFA/recovery/session boundaries; Issue3|
|LO-TASK-001|Same ID, real todo inventory and guarded classification; Issue5|
|LO-FIN-001|Same ID, financial semantics and truthful source coverage; Issue11|
|LO-SOURCE-001|Same ID, stable source/version/history; Issue4|
|LO-CAPTURE-001|Same ID, confirmed input and unknown outcome recovery; Issue18|
|LO-OVERVIEW-001|Same ID, summaries and evidence navigation; Issue14|
|LO-TIMELINE-001|Same ID, date/time/history semantics; Issue8|
|LO-TIME-001|Restored original ID, historical time coverage; no automatic time-ledger restart|
|LO-HEALTH-001|Same ID, real training/body/diet/health source coverage; Issue15|
|LO-PROJECT-001|Same ID, project/area categories and evidence; Issue7|
|LO-ARTICLE-001|Same ID, content/source and separate publishing; Issue13|
|LO-SCHEDULE-001|Same ID, calendar/life stages/anniversaries/countdown; Issue12|
|LO-PEOPLE-001|Restored original ID, people/social links; Issue32|
|LO-FILES-001|Same ID, verified file index/project backlink; Issue16|
|LO-REPORT-001|Same ID, traceable reviews and invalidation; Issue17|
|LO-AI-001|Same ID, guarded AI runtime; Issue19|
|LO-DATA-001|Same ID, previewed exchange and source mapping; Issue10|
|LO-OUTPUT-001|Same ID, separate publication approval; Issue17|
|LO-SEARCH-001|Same ID, deterministic permitted search; Issue9|
|LO-PRIVACY-001|Same ID, private defaults and account isolation; Issue3|
|LO-OPS-001|Same ID, qualified source/build/runtime and recovery|
|LO-BACKUP-001|Same ID, independently verified restore; Issue20|
|LO-EXPERIMENT-001|Restored original ID, controlled isolated experiments|
|LO-LEARNING-001|Same ID, reviewed collection/source; Issue13|
|LO-LEGAL-001|Restored original ID, jurisdiction/source-limited experiment|
|LO-JOURNAL-001|Same ID, diary/drafts/CAS/history; Issue6|

## New additions, recorded before their implementation

| ID | Scope and dependency | Execution |
|---|---|---|
|LO-LINK-001|Typed cross-business references to projects, areas, people, topics and tags; same-owner IDs/source/revision, unique writer; prerequisite for graph aggregation|Issue33, design pending|
|LO-GRAPH-001|Quantitative relationship graph, time/type filters and evidence drilldown; depends on explicit permitted links|Issue34, open-source selection only|
|LO-AGENT-001|Portable credential-free Skill download/copy and API/discovery parity; same key only within granted scope|Issue35, source implementation in current slice|

The resulting source baseline has34 IDs. Journal/calendar/health/finance refinements append to their existing Issues6/12/15/11. Settings/key dialogs, matters navigation, bounded scrolling and compact requirements views append to Issue30. Real todo classification and project/area creation stay in Issues5/7 and require complete reads and implemented authorized writes. No required feature is declared complete merely because it is now visible in the pool.

## Delivery boundaries

The current UI slice adds a complete todo snapshot operation within the existing todo:read scope using the existing bounded full-current reader. It does not introduce organization or business write scopes. Current key grants, real source authorization, proposed SQL, import preview/commit and owner experience remain separate gates. Integration designs must include operations, discovery, Skill and actual source readback together.

### 2026-11-05 owner addition — portable Skill update channel

LO-AGENT-001 / Issue35 retains its original identity. Add pre-use trusted Skill update checks and discovery of newly available API contracts; generic documentation updates must preserve private local runtime/config and require compatible reviewed executable support. The key's broader personal-business/future-module authorization policy is a separate authority slice. The source now implements fixed-publisher pre-use download/validation, seq anti-rollback and recoverable atomic normal activation; synthetic source tests are not installed host automation or owner acceptance. Candidate: [bounded update channel](2026-11-05-skill-update-channel.md); execution remains personal-agent-foundation7.2/8.2, both open.
