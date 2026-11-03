# Apple Bidirectional Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. OpenSpec tasks.md is the sole execution checklist; these numbered sections are implementation briefs.

**Goal:** Build the approved default-closed reconciliation/server/manual-bridge candidate and retain the complete two-way activation acceptance.

**Architecture:** Existing PersonalService/CalendarService remain the only business writers. Optional repository capture and transaction-bound adapters atomically update sync state and outbox; a fenced Mac executor journals native intents and verifies readback before ACK. Authentication and native lossless capabilities remain explicit injectable gates, not invented privileges.

**Tech Stack:** Existing Next/React/TypeScript/Node/PostgreSQL and native node:test; no new dependency for the core.

**Spec:** ../../../openspec/changes/apple-bidirectional-sync/specs/apple-synchronization/spec.md and sibling design/tasks.

## Global Constraints

- Keep credentials, runtime settings, personal records, exports, attachments and backups outside Git. Use explicit synthetic fixtures only.
- Preserve closed defaults, ownership checks, restricted PostgreSQL roles and opt-in integration gates. A skipped integration test is not acceptance.
- No live Apple reads/writes, schema/GRANT, device registration, daemon, tool upgrade or production trust activation in source implementation.
- Preserve complete unknown/null, source identity, field, conflict/deletion/recurrence/restore acceptance; unavailable capabilities remain open.
- Root owns Git operations and integration. Parallel workers own disjoint files. UI qualification stays in its existing PR; sync code is committed separately after the UI qualification checkpoint, in this same application folder.

## Review Focus

1. Commit-order cursor publication and row-lock ordering under two concurrent business transactions; no unseen earlier outbox event can be skipped.
2. EventKit partial/unknown data, original occurrence identity and ID churn; missing records must not become false deletes or recreates.
3. External write succeeds but ACK/reply is lost, or an old executor resumes; immutable intent, fences and readback must prevent duplicates.
4. Existing website updates and source evidence/CAS/reference guards remain intact with capture disabled or enabled; no second business writer.
5. Device identity, host/origin/scope and independent write gates cannot be supplied by JSON; synthetic injection must not create a production bypass.

## Task 1: Pure reconciliation contract (OpenSpec1.1)

Files: new src/apple-sync-candidate/{contracts.ts,domain.ts,reconcile.ts}; new test/apple-sync-domain.test.ts and apple-sync-reconcile.test.ts.
Interfaces: JSON-only known/unavailable observations; NativeIdentity, NativeCapabilities, ScanCoverage; canonicalDigest, mergeFields, isVerifiedEcho, assessMissing, checkWriteCapabilities. The sibling OpenSpec design/spec and tracked contracts provide the public implementation brief.
Steps: behavioral RED for merge/unknown/identity/capability; minimal deterministic implementation; focused GREEN; report source/fixture limits. Types carry complete native evidence but never claim the current CLI can produce it.

## Task 2: PostgreSQL capture and transaction scope (OpenSpec2.1)

Files: src/apple-sync-candidate/{capture.ts,store-contracts.ts,postgres.ts}, db/0006_apple_sync.proposed.sql, optional capture/bound-scope extensions in src/platform/postgres.ts and src/calendar-candidate/postgres.ts; focused SQL/service rollback tests.
Interfaces: optional SyncCapture.begin/append on the SAME SqlClient; transaction-bound repositories reuse existing business services without nested BEGIN/COMMIT. SyncRepository.transaction provides a scoped state transaction, platform/calendar adapters, immutable command receipts, mapping/conflict state, ordered outbox and lease/fence validation. Owner/space fixed from verified configuration/principal.
Steps: RED default-off behavior and atomic rollback/order/foreign owner/stale fence/replay; implement guarded proposed schema with FORCE RLS/restricted grants; serialize cursor publication before business row locks to avoid out-of-order commit gaps/deadlocks; focused GREEN. No real migration or runtime settings.

## Task 3: Server service and default-closed API (OpenSpec2.2)

Files: src/apple-sync-candidate/{service.ts,http.ts,config.ts,runtime.ts}; existing personal Next catch-all boundary and focused tests. Projection stays in the small service adapter rather than adding a separate module. Root integrates this task after public UI fixture files are stable.
Interfaces: trusted principal reader (ownerId,spaceId,bridgeId,epoch,scopes); same-transaction business service adapters; bounded strict operation bodies; no runtime credential provisioning. No principal provider or independent write permit means unavailable.
Steps: RED supported create/update/complete/reopen, CAS/receipt/conflict/echo/ACK and host/scope/body/default-off; implement service projection for exactly representable business fields and explicit unsupported evidence; wire the personal-mode boundary explicitly without enabling legacy APIs; focused/HTTP GREEN. Full native-field coverage remains task4.2 until evidenced.

## Task 4: Durable manual bridge (OpenSpec3.1/3.2)

Files: src/apple-sync-candidate/{journal.ts,bridge.ts}, existing pure domain/reconciliation capability checks, focused recovery/preview/service-loop tests and public docs/apple-sync.md. Native capabilities compose the existing pure checks; no duplicate module or executable CLI/transport is supplied by this source checkpoint.
Interfaces: injectable NativeAdapter, BridgeServerPort and SAME shared writer verifier; no default real writer; immutable prepared/applying/verified/ack intents and fsync atomic state. Manual preview is an injectable method using synthetic adapters. A future runnable native CLI/transport remains subject to the native/identity qualification; credentials never belong in args/logs.
Steps: RED crash/unknown create/ACK loss/offline/stale fence/corrupt state/epoch; implement smallest journal+replay against synthetic adapters; pure capability report marks current CLI incomplete and unsafe fields blocked; focused GREEN. Do not import private runner or trigger its discovery path.

## Task 5: Source qualification and activation tracking (OpenSpec4.1–4.3)

Run focused/full node tests, typecheck, fixed default-closed webpack and compiled routes, strict OpenSpec, applicable disposable PG/HTTP fixtures, privacy/license review and independent whole-branch security/data review. Fix verified issues with RED/GREEN, then exact-SHA draft PR/CI and remote readback. Do not import private Issue/operational data into public docs.
Keep native full-field coverage and actual device/background/schema/data/writer/production/phone/restore acceptance open until their specific permissions and real evidence exist. Do not downgrade these goals to make candidate source look finished.


## Reviewed issuance correction (same approved scheme)

The real-service diagnostic confirmed a same-mutation changing intent and a historical outbox snapshot reverting an already accepted independent phone field. The reviewed correction retains the original authority/writer/stack and task IDs. Read-only pull now returns only notification/status; write-authorized prepare freezes current canonical state and persists one bounded active delivery on the existing lease before replying. Claim and fresh current-claim authorization are distinct from immutable command replay. Only an exact never-claimed issued attempt may retire; claimed uncertainty cannot be guessed away. Full transition, local fsync order, monotone version/binding, cursor-vs-canonical revision and no-op requirements are in the updated design/spec.

Implementation boundary: extend the Task2 store contract/proposed restricted lease column/readiness; adapt Task3 service/API; adapt Task4 durable claim lane and synthetic server/native integration. No new business store, identity provider, crypto, runtime credential, background task or live ALTER/GRANT. Different device/epoch handover and claimed-precondition automatic recovery remain unqualified activation work. Keep UI files/CI source commits separate. Use behavioral RED/GREEN for the original A/N0→B/N0→N1 timeline, response loss and transition races, then scope/full/real synthetic PG/HTTP and independent review. If the original timeline remains unresolved, return to the retained diagnosis before any alternate repair.
