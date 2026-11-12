# Requirement event dispatch implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wake a bounded Mac dispatcher only for executable owner requirement tickets, preserving one authoritative requirement writer and offline recovery.

**Architecture:** PostgreSQL transaction outbox and NOTIFY carry minimal owner/space scoped events; a native credential broker holds the API key and the Mac supervisor persists cursor/queue before accepting events. Claims use expiring fenced leases; progress uses the existing RequirementsService writer, original payload/key and independent readback. Runtime mounting, discovery/Skill synchronization, migration, native broker stream and OS startup remain separate default-closed integration gates owned by root.

**Tech Stack:** Existing Node24/TypeScript6/PostgreSQL/pg; no new dependency.

**Spec:** Existing personal-agent-foundation tasks5.4/7.3/8.2/9.7, LO-REQ-001/#30, LO-AGENT-001/#35 and current owner clarification recorded by root (business intake pending credentials).

## Global Constraints
- No real credentials, business records, model calls, production SQL, startup registration or private data in Git.
- Existing requirements scopes and fresh transactional grant fence; no owner cookie, direct privileged SQL or self-grant.
- Dispatch state is separate from engineering evidence and owner acceptance. Owner requests default ready; suggestions candidate. No automatic admission of legacy records, pause/cancel recovery, or AI cancellation.
- Fixed stream GET `/api/platform/agent/v1/requirement-events/stream`; fixed claims POST and claims/{UUID} PATCH. Cursor only Last-Event-ID; no arbitrary header/host/query forwarding.
- Mac worker capacity defaults0; integration must reserve capacity against root/current Goal before enabling. One writer per requirement, finite attempts, no model empty polling.

## Review Focus
- Sequence assignment must serialize per owner/space until commit, so reconnect cursor cannot skip an earlier uncommitted change.
- Revoked/shrunk grants and changed source/work must stop both event delivery and fenced progress writes.
- Progress-only updates cannot self-trigger endless new work; paused/cancelled/candidate items remain held.
- Crashes after queue persist/claim/progress and before ack preserve exact replay identities and finite lease recovery.
- Queue overflow or cursor retention gaps must request replay/resync rather than silently discard executable work.

### Task1: Durable event/lease contract
- [x] Write failing synthetic tests for owner/space isolation, admission, dedupe, bounded replay, lease expiry/fencing and finite attempts.
- [x] Implement domain/service and PostgreSQL adapter plus proposed0020 migration; no production execution.
- [x] Added the real PostgreSQL rollback/outbox/receipt/lease qualification entry; execution is unavailable locally and remains an explicit open gate.

### Task2: Scoped streaming and original-writer progress
- [x] Write failing HTTP tests for default closure, exact origin/path, bearer grant revocation, scope shrink, cursor and idle heartbeats.
- [x] Implement handler and transaction-scoped fence interface consumed by existing RequirementsService.mutate. Root serializes shared registry/runtime/Transaction seam.
- [x] Verify stale lease cannot call the writer and unknown write retains original payload/key for recovery; independently read progress.

### Task3: Mac durable queue and worker candidate
- [x] Write failing tests for restart cursor recovery, event dedupe, bounded queue backpressure, no-work/no-slot zero worker launches and synthetic command invocation.
- [x] Implement opt-in supervisor/dispatcher using only native-broker channel and Codex exec command factory, no listener installation.
- [x] Verified focused/full suite, types, one default-closed webpack build and prepared the local commit; exact results below. Do not push/deploy.

## Reuse and current-tool evidence
- No existing outbox/lease component found. PostgreSQL NOTIFY is a wake-up hint; durable rows remain authority.
- Existing RequirementsService already accepts transactionGuard and preserves receipts/CAS/history; reuse it rather than create a second writer.
- Official OpenAI docs fetched2026-11-12: https://learn.chatgpt.com/docs/non-interactive-mode, https://developers.openai.com/codex/sdk/, https://developers.openai.com/codex/app-server/. `codex exec` supports stdin/JSON/sandbox and saved native CLI authentication. SDK adds an unnecessary dependency; app-server is for richer clients and would add a service/protocol.
- Actual installed CLI0.167.0-alpha.3.2 help confirms exec --json --sandbox --cd --thread-source; do not update/replace it or change model configuration. Only synthetic command stub is run in this slice.

## Verification checkpoint

- Focused17 total:16 pass,1 PostgreSQL opt-in skip; source/runtime credentials were never invoked.
- Final full command `node --test --test-concurrency=2 test/*.test.ts`:1694 total,1634 pass,0 fail,60 skip,51.9s. An earlier pre-final suite also passed; the final run follows fresh-renew-before-launch and removal of unused policy mirrors.
- `npm run typecheck`:pass.
- `NEXT_TELEMETRY_DISABLED=1 CI=1 npm run build -- --webpack`:pass, Next16.4.1; root-reserved single build slot released.
- `OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1 CI=1 npx --yes @fission-ai/openspec@1.16.0 validate personal-agent-foundation --strict`:pass.
- Root independently owns registry/Skill/runtime synchronization, current grant activation, source/run-bound PostgreSQL CI and production/worker/owner qualification. No task checkbox in the main OpenSpec has been advanced.


### Task4: Root-assigned Agent integration (base1b4706d, same requirement slice)
- [x] Separate SSE eventTransports discovery from the57 executable JSON business descriptors; reuse existing branded actors, current grants and source-owned policy registry.
- [x] Add two JSON argument/receipt/current-readback/durable operations and use the existing getRequirement top-level execution projection; never add SSE to lifeos_call.
- [x] Integrate lazy restricted max1 notifications, immediate concurrent-open refusal, abort and bounded revocation release; preserve normal requirement editing.
- [x] Add readiness/source parity and disabled SQL registration, Skill/reference/artifact sequence2026111203; no new dependency or credentials.
- [x] Fix reviewed replay retention race with one statement snapshot and RED→GREEN interleaving regression.
- [x] Add core/event four-leaf and policy/storage/event35-leaf CI zero-skip gates, same-client migration GUC and source-bound fixture marker.
- [x] Freeze integration checks for fresh independent review and CI:1762 total/1701 pass/0 fail/61 opt-in skips; types, strict OpenSpec and one integration webpack build pass. Exact commit is reported by the writer. Production SQL, grant/module activation, native worker adoption and owner acceptance remain open.


### Task5: Split platform and Auth/policy migration ownership (base afd4cf9, same LO-AGENT-001/#35)

- [x] Reproduce the mixed-owner0020 contract failure and isolate platform DDL/invoker trigger from private Auth registry registration.
- [x] Keep platform target/record-owner approval checks; perform the authoritative singleton owner/space binding and private registry ownership checks in the separate Auth-owner step. Neither step grants private table access or transfers ownership.
- [ ] Qualify the real two-owner boundary on the existing source/run-bound disposable PG service: wrong owner/target/binding fails, three registrations start disabled, runtime cannot mutate the registry, trigger/readiness and no-backfill remain intact.
- [x] Run focused source checks and types; freeze a small commit for root integration and independent review. No real migration/activation, worker launch or owner acceptance is implied. Existing personal-agent-foundation5.4/7.3/8.2/9.7 and sole UI checklist remain open.

**Split-owner source evidence (2026-11-12):**

- New source boundary test was RED on the original platform SQL's Auth schema reference, then GREEN after the split. The new `db/0020_requirement_events_agent_operations.proposed.sql` requires separate `lifeos.requirement_events_agent_approved=1`, exact database and singleton owner/space binding, Auth ownership of the key/binding/registry tables, existing grant functions and the platform event structures. Registration explicitly inserts only the original three operation IDs/scopes with `enabled=false`; no grant, owner transfer, key update, admission or backfill is performed.
- Platform DDL now uses the platform record owner, explicit target/approval, an existing expected platform user and a syntactically valid space. The private binding is authoritatively checked by the separate Auth step; platform DDL alone creates empty restricted structures and authorizes no event activation. All table/index/sequence/RLS/ACL/trigger statements from `CREATE TABLE requirement_work` through the trigger are byte-identical to base `afd4cf9` (SHA256 `261b0c99f73cac616c6554e40c399837307a4c3be7db11a8e6d1cea77a92997d`). Trigger body digest, two JSON operations, one SSE transport, IDs/scopes and existing transaction fencing remain unchanged.
- The existing source/run-bound requirements PG case now also creates a fixed disposable database with two restricted login owners at object creation, without `ALTER OWNER` or private-registry grants. It executes the real two SQL steps and tests wrong roles/target/binding, closed registrations, unchanged legacy key/record, readiness and original-writer trigger execution. Its minimal Auth catalog uses always-false fixture grant functions only for prerequisite existence; full real authorization and activation fencing stay in the existing business-policy PG case, which now explicitly runs both steps. The CI four requirements/event leaves and35 policy leaves retain their existing names/counts; no workflow file was modified.
- Final local focused command on Node24.18.0: `node --test test/requirement-events-qualification.test.ts test/requirement-events.test.ts test/requirement-events-agent.test.ts test/requirement-events-http.test.ts test/requirement-event-fence.test.ts test/requirement-events-postgres.integration.test.ts test/agent-business-policy-postgres.integration.test.ts`:24 total,21 pass,0 fail,3 skips (two PG opt-ins unavailable locally; reviewed fixed legacy client not selected). Scoped strict TypeScript and `git diff --check` passed. The new fixture's initial quoting/type errors were corrected before this final run.
- `psql`, `postgres` and `docker` were unavailable on PATH. No local PG service was started. The new dual-owner PG assertions are **not yet executed**; existing CI must run both PG cases without skips at the integrated source SHA. No full suite/build, SSH, real database migration, runtime/config/CI change, provider or worker launch was performed in this source slice. Independent root review and actual CI remain required; owner acceptance is separate.
