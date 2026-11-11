# Requirement event dispatch source candidate

This is a default-closed Agent source slice under LO-REQ-001/#30 and LO-AGENT-001/#35, personal-agent-foundation5.4/7.3/8.2/9.7. Business intake remains pending the authorized runtime; this document is not a second requirement pool. No production migration, real requirement import, background task, model execution or owner experience acceptance is asserted.

## Flow and boundaries

The original requirement writer remains authoritative. Proposed0020 installs a restricted invoker trigger after its record write. Outbox and current work projection commit or roll back in the same PostgreSQL transaction; NOTIFY is a post-commit wake-up hint only. Owner/space serialization covers event ID assignment through commit. Retention is1000 outbox rows per owner/space; a gap returns reset plus the current ready projection, not guessed historical events. Pages are100 and local queue128; backpressure does not advance the local cursor or discard a ticket.

No migration backfills/adopts old requirements. Only a newly inserted explicit planned owner request enters ready; suggestions and previously stored rows begin candidate. Dispatch states are independent of engineering evidence and owner acceptance. Candidate/paused/cancelled holds are sticky and have no automated resume/cancel operation in this slice. Owner-controlled promotion/hold UI/API still requires integration. Existing workflow blocked/awaiting_review/done stops dispatch. Progress purpose/nextStep and planned→in_progress do not change the work digest. A changed accepted content generation can be dispatched again. Three claim attempts per content generation are the finite crash budget.

Claims bind current grant, owner, space, source, work digest, holder and monotonic fence. A120-second lease can renew every40 seconds while a worker runs. The original repository adds an optional same-connection row-lock fence, off by default. A worker must use the fenced progress operation; ordinary owner edits retain the general requirement API. Before real activation the derived worker channel/run capability must deny that general write operation, otherwise a holder of the same full owner grant can bypass a cooperative lease. This slice does not claim isolation from such a caller. The RequirementsService checks current authority and its transaction grant before receipt lookup, then checks the lease only for a new write after original record locks/CAS and before write. Thus expired/reclaimed workers cannot issue new progress writes, while an authorized same-body/same-key historical receipt remains recoverable. Receipt recovery never fabricates current-state verification or a fresh command key.

Mac connection code is I/O only. Native broker owns Authorization; JavaScript sees no key. Cursor and queue are persisted atomically before accepting a batch. The dispatcher claims before launching and starts no worker when empty or reserved slots are0. Per-process Codex `agents.enabled=false` prevents a second subagent tree. Slot reservation must include the owner Goal and existing app workers: the observed host limit is4 total, not4 plus external workers. No timer starts a model; server heartbeat/NOTIFY/reconnect do not consume a model turn.

The `codex exec` candidate uses existing native CLI authentication and fixed stdin arguments; it does not inspect auth.json, change the configured model, enable a paid mode or install SDK/server dependencies. CLI exit0/turn.completed is not a business receipt. Its result remains unknown until the reviewed business client independently confirms progress. A running/uncertain job found after supervisor death is retained and is not relaunched automatically. Adoption still requires a native worker-host cancellation/orphan proof plus current receipt reconciliation; a source candidate is not unattended delivery acceptance.

## Root-owned integration contract

| Operation ID | Method/path | Scope |
| --- | --- | --- |
| streamRequirementEvents | GET `/api/platform/agent/v1/requirement-events/stream` | requirements:read |
| claimRequirementExecution | POST `/api/platform/agent/v1/requirement-events/claims` | requirements:read + requirements:write |
| updateRequirementExecution | PATCH `/api/platform/agent/v1/requirement-events/claims/{lease UUID}` | requirements:read + requirements:write |

Claim body is `{requirementId,workDigest,holderId}` with the original Idempotency-Key. PATCH is `{action:'renew',lease}` or `{action:'progress',lease,input:{fields,expectedRevision,baselineBinding}}`, same original key on unknown outcome. The server derives owner/space/actor from the reviewed current grant. Progress uses the exact original RequirementFields writer and independently GETs that requirement. Complete immutable evidence and owner acceptance remain unchanged.

The source integration now registers two JSON operations and one separate eventTransports SSE descriptor, exact argument schemas, default-closed readiness, disabled optional SQL registrations and Skill release2026111203. JSON/MCP execution never includes the stream descriptor. Claim/renew receipts use durable command keys and independently GET the existing requirement execution projection. The existing branded AuthorityService/current grant and original transactional writer fences remain authority. Do not enable the module before exact-source qualification. The HTTP adapter requires the existing authority boundary to issue its branded actor and current-grant guard; all-business policy cannot bypass its allowedOperationIds. Mounting and readiness stay closed until restricted schema/ACL/RLS metadata has independently passed qualification. There is no caller-provided host/URL/cookie or arbitrary header forwarding.

Stream stdin is `{cursor:string}` (initial `'0'`; native broker may normalize null only to0). Last-Event-ID is the only derived cursor header. SSE comment `: keepalive` is ignored; event name is `requirement-work`, event id equals data.cursor. Data/credential-free broker JSONL is exactly:

```
{cursor,events:[{cursor,requirementId,sourceId,revision,workDigest,state}],ready:[{requirementId,sourceId,revision,workDigest,state:'ready',attempts,fence,lease:null}],reset,readyTruncated}
```

Both arrays max100, frame UTF8 max256KiB. Cursors are canonical nonnegative decimal PostgreSQL bigint strings. IDs are strict stable requirement IDs/UUIDs; source UUID, positive integer revision,64 lowercase hex workDigest, safe nonnegative fence and attempts0..2. reset requests ready reconciliation; never clear an existing local queue. Event state is candidate/ready/running/blocked/awaiting_review/done/paused/cancelled. Empty frames do not dispatch. EOF in a partial native JSONL frame is an error, retaining cursor and queue.

## Qualification and rollback

Focused source tests cover admission, held work, generation dedupe, concurrent claims, finite expiry/reclaim, historical receipt after expiry, fresh-grant denial, same-transaction lock/clock ordering, default closure, scoped stream cancellation, queue restart/overflow, cursor reconnect, synthetic command spawn and owned-child cancellation. PostgreSQL tests are separately opt-in; a skip is not atomicity or RLS acceptance.

The source-bound disposable requirements fixture can qualify the new SQL with:

```
RUN_REQUIREMENTS_POSTGRES_TESTS=1 RUN_REQUIREMENT_EVENT_POSTGRES_TESTS=1 node --test --test-isolation=none --test-concurrency=1 test/requirements-postgres.integration.test.ts test/requirement-events-postgres.integration.test.ts
```

It also requires all existing exact CI/local-fixture identity environment values from `test/helpers/requirements-stage-pg.ts`; this command alone does not authorize or redirect a database. The migration is applied only to a fresh event schema after that helper verifies its isolated target. Public CI remains read-only with synthetic fixture authority only.

Before production: independently review fixed source; root obtains exact-SHA CI with all four requirements/event PG leaf cases and35 policy/storage/event PG leaves executed without skips; qualify native stream, slot reservation, current grants and actual worker readback/cancellation; separately prepare approved migration backup/rollback and only then enable. No launchctl/installer is supplied or run here. Roll back source to the preceding fixed release and leave runtime flags off. Do not drop migrated work/outbox/receipts or revoke/delete credentials as an automatic rollback.

Official documentation checked2026-11-12: [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode), [SDK](https://developers.openai.com/codex/sdk/), [app-server](https://developers.openai.com/codex/app-server/), [per-invocation agents settings](https://learn.chatgpt.com/docs/agent-configuration/subagents#global-settings). Actual installed CLI is0.167.0-alpha.3.2; no runtime was updated.

PostgreSQL17 official [NOTIFY transaction semantics](https://www.postgresql.org/docs/17/sql-notify.html) and [LISTEN initial-read race guidance](https://www.postgresql.org/docs/17/sql-listen.html) were checked: subscribe/commit before the initial durable query, use short transactions, and never treat the public notification payload as business data or authorization.


## Integrated source checkpoint

The explicit `LIFEOS_AGENT_REQUIREMENT_EVENTS=requirement-events-v1` module also requires the existing requirements activation. Schema/ACL/RLS/trigger-source readiness gates every descriptor and request. A separate lazy max1 notification pool reuses the restricted business role; closed/not-ready/unauthorized requests create no listener pool. A second open request fails immediately, including while the first acquisition waits, instead of accumulating behind LISTEN. Cancellation and15-second authorization revalidation release a notification connection even for an unread/backpressured stream. This is bounded server I/O, never a model poll.

Proposed0020 requires exact database/owner/space and owning migration role. Core fixture identity is reused only after its original source/run/attempt readback. The event migration uses one checked-out admin client for all approval/target GUCs and their readback, then records a separate core/SQL/source-bound marker; it never resets core schema/roles. Both existing qualification workflows run core requirements plus event SQL in the same serial process and reject missing/duplicate/skipped/failed/error leaves. A narrow policy registration case checks unchanged legacy grant digest, three disabled registrations and only explicitly enabled exact-scope SQL fences. These are source gates awaiting actual CI, not a claim that real PostgreSQL has passed locally.

The retention race found during independent review is fixed: event bounds and page now come from one materialized SQL statement snapshot, so concurrent retention cannot silently mark a lost interval as reset:false. The regression observed RED before this change and GREEN afterward. Native worker capacity remains0; narrow worker capability/channel, orphan proof and real original-command readback remain adoption prerequisites.
