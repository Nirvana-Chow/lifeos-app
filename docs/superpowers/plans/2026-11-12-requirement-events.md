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
