# Requirements intake and continuity

The 2026-11-04 owner feedback requires intake before implementation: record the addition, deduplicate by behavior, retain a stable ID/source/acceptance/priority/dependencies/status, split independently verifiable slices, then execute. New messages append to unfinished requirements. Explicit owner cancellation or replacement is required to remove scope. The project AGENTS and LO-REQ-001 now state this order.

## 2026-11-05 owner correction: usable business modules before detailed polish

Source: the owner rejected the current requirements-table screenshot, then explicitly asked for usable first versions of all previously requested business modules before concentrated product review. Continue the original IDs and Issues: LO-TASK-001/#5 and projects/#7; LO-JOURNAL-001/#6; LO-SCHEDULE-001/#12; LO-HEALTH-001/#15; finance/#11; LO-PEOPLE-001/#32; LO-LINK-001/#33; LO-REQ-001/#30; LO-AGENT-001/#35. The execution intake is recorded on [Issue30](https://github.com/Nirvana-Chow/lifeos-app/issues/30#issuecomment-6658805425).

Priority: finish and publish existing owner module candidates, in parallel with health, finance and people input/list/detail/edit slices. Every new input includes scoped Agent operations, discovery and portable Skill contracts in the same delivery. Keep shared owner/space checks, CAS, exact idempotent recovery, reference pins and individual readback. Empty modules stay empty; synthetic fixtures remain internal verification, never owner delivery. Existing Keys retain their actual grants; the explicit all-business policy is a separate activation gate.

The rejected table's heavy filler borders, button-as-input styling and fixed-width clipping remain LO-REQ-001/LO-UI-001 corrections, to be fixed without delaying the business first versions. All original acceptance and unfinished migration/classification requirements remain. Actual private migration, bulk business writes, new permissions and external source activation still require their concrete authorized target; no direct production business SQL. The personal Agent/model/worker phase stays later. A cleared execution Goal is not recreated by this intake.

Implementation plan: [business first versions](../plans/2026-11-05-business-first-versions.md). Source, verification, deployment and owner acceptance remain distinct.

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

## 2026-11-05 data-driven layout and direct reuse clarification

The owner clarified that the intended reference is Xunji-style training presentation, not Codex. Continue LO-HEALTH-001/#15, LO-FIN-001/#11, LO-PEOPLE-001/#32 and LO-UI-001/#30: inspect authorized source data shapes and mature open-source implementations before designing domain pages. Generic CRUD tables are the base recording surface, not the completed training dashboard. Prefer actual code reuse of compatible, reviewed MIT components with pinned provenance and complete attribution; adapt data, authentication and ownership boundaries rather than replacing them. No new license or background synchronization is implied.

Research identified the third-party MIT xunji-log dashboard for training calendar/chart/detail presentation, Actual Budget for finance, and Vikunja/Monica for task and relationship information structure. AGPL examples remain layout references in this slice; no AGPL code is imported. Keep source coverage, planned/completed state, units, date precision and missing measurements truthful. Health source ingestion, upstream-truncated training dates, private migration and actual owner acceptance retain their separate unfinished gates; no private records enter public source or synthetic delivery.

## 2026-11-05 reuse is a foundation, not the product boundary

Owner addition, continuing the original IDs: LO-HEALTH-001/#15 includes sleep, weight/body-fat and diet trends, general sports such as ultimate frisbee/running, with strength training as a dedicated topic rather than the whole health model. Preserve source-specific detail and explicit planned/completed state; unknown duration/measurements stay unknown. LO-LEARNING-001/#13 now explicitly includes a reading and viewing library for books, films and series, with want-to/read-or-watch/in-progress/completed views and explicit personal notes/status. Public catalog metadata lookup (for example Douban/IMDb or a verified alternative) is separate from personal consumption records: verify supported public access, provider terms and provenance before enabling a connector; do not infer completion from imported titles. LO-FIN-001/#11 includes separate accounts, assets, transactions and investments; manual holdings, valuations and their dates must retain units/currency/source and never infer balances or live prices from transaction totals.

Acceptance: usable initial views and inputs with shared owner/source/revision checks, scoped Agent/discovery/Skill parity, then iterative owner review. Reuse compatible licensed components and complete supported modules where practical; retain LifeOS's broader data model, privacy and permissions. These additions append to unfinished work and do not cancel original migration, classification, business or UI requirements. External fees, new licenses/permissions, bulk private migration, automated scraping and background jobs are not implicitly enabled.

## 2026-11-05 requirements are API-managed business data

Owner clarification, LO-REQ-001/#30 and LO-AGENT-001/#35: the pool should explain each business capability's purpose, expected use, current progress and next action. Routine owner changes to that information must persist through the implemented scoped API/Skill and independent readback, without source edits, CI/CD or direct database business edits. Preserve immutable engineering evidence and owner acceptance separately; an editable progress label cannot assert verified deployment or acceptance. Retain baseline stable IDs/source binding, compatible old commands, CAS/history/idempotency and unknown-result recovery. Add only the missing optional workflow/purpose/next-action metadata to the existing writer; do not add a parallel store. Current deployed todo-only Key grants do not imply requirements authority, and live writes wait for the concrete permission path.
