# Design

## Current execution order — 2026-11-05 owner review

Make the requirements pool and matters actually usable, then connect journal/calendar/health/finance/people with matching API/Skill input/output; personal context and the website Agent follow. Maintain the shared identity/data/source/relation/operation core and add business modules within the existing app; do not build a third-party plugin engine now. The [owner refinement](../../../docs/superpowers/specs/2026-11-05-owner-review-refinement.md) covers the scoped next implementation. Existing candidates, original34IDs and unfinished acceptance remain; the owner-cleared continuous Goal and unrelated paused work are not restarted by this bounded UI/data request.

## Context

See `proposal.md` for motivation and the [complete architecture](../../../docs/superpowers/specs/2026-11-05-personal-agent-design.md) for product stages, source semantics and official references. Current source has a restricted PostgreSQL business repository, PersonalService, six todo Agent operations and guarded AI SDK calls limited to the current message. It has no durable personal run, unrestricted historical model context, MCP service or production-qualified worker.

The main spec inventory is empty; existing change-local key management, operation and UI contracts retain their own state. This parent change is the authoritative execution checklist for the new Agent intent, not a second copy of the original UI checklist or requirements pool.

## Goals / Non-Goals

**Goals:**

- One inspectable website connecting evidence, confirmed context, proposals, review, execution and readback, delivered in usable slices.
- Shared business services and one operation registry for owner website, authorized API, portable Skill and local MCP.
- Safe resumption, bounded cost and current authority for every durable step, preserving source identity and typed domain meaning.

**Non-Goals:**

- Autonomous approval or unattended business commits, arbitrary SQL/shell/URL tools, opaque permanent model memory, automatic model training or company-data integration.
- Production SQL, key expansion, private-source import, real model egress or persistent worker installation without the corresponding concrete package authorization.
- Replacing old task states, restarting paused workflows or treating internal synthetic qualification as owner experience acceptance.

## Decisions

### One orchestrator and mature worker

Use LangGraph JS as the sole graph, PostgreSQL persistence and Graphile Worker as the preferred delivery queue. AI SDK remains the model and structured-output client; neither ToolLoopAgent nor a second WorkflowAgent loop runs alongside the graph. A self-built state machine duplicates durable workflow responsibilities; Workflow 5/PG World remains a documented alternative, not a parallel runtime.

Fixed research candidates are LangGraph1.6.1/core1.3.4/checkpoint1.2.2/PG saver1.1.2 and Graphile Worker0.18.0. Qualification must compare package/license/lock changes, Node24/TS6/Next16/React19 build compatibility, restricted PG behavior and rollback. Declaration compatibility is not a passing result. Checkpoint setup and worker schemas run only through proposed migrations; launch does not call privileged automatic setup.

### Three server-constructed actors

`src/agent-authority` owns opaque owner-session, agent-grant and run-capability actors. Each operation revalidates its current producer, source scope, operation allowlist, expiry, policy and module readiness. Background run capabilities allow read/preview only. Approval requires a current same-origin owner MFA session; owner approval does not expand scope or bypass a revoked producer. Job payloads and checkpoints contain references, never bearer/session secrets.

### Compatible catalogs, one registry

`/v1/capabilities` retains todo:read authorization and the original six entries with unchanged `scope` values. `/v2/capabilities` returns a v2 catalog using `requiredScopes`, and supports any valid bound grant, including organization-only readers. Business routes stay explicitly versioned at their advertised `/v1/...` paths. New Skill prefers v2; only a 404 allows the known legacy todo fallback. API, Skill and MCP schemas/errors derive from one registry; disabled or unqualified operations are absent.

### A1 and A2 are the first visible slice

Project/domain/topic operations reuse PersonalService/ObjectFields and existing website grids/editors. Same-key scope changes use owner MFA, a nonsecret stable grant digest, CAS and a narrow SQL function; direct permissions/metadata/expiry/key UPDATE remains prohibited. A1 also fixes the concrete todo/project reference-lock cycle using only the affected PersonalService record set.

Classification uses immutable plans, owner approval and a separate batch receipt; no loop of single-record transactions. Initial limits are 100 todos, 30 minutes and128KiB. Commit locks owner maintenance→command→producer grant→plan advisory→ordered physical records, validates every before/source/revision/target, then writes all changed records/history and one receipt. Grant revocation serializes with an already locked commit; it does not interrupt that transaction. Same-key recovery precedes plan expiry/current-record checks after current authorization.

Preview requires only todo:read and organization:read: private candidate creation is not a business write. API commit also requires todo:write plus stored owner approval. Owner website commit uses the owner's existing write authority and rechecks the producer's original preview/read scopes, not a fabricated producer write permission. A read-only Agent can propose for owner execution but cannot commit itself. The generalized SQL fence is `assert_business_grant` and accepts explicit read sets; any write requirement still includes its matching read. Legacy todo write wrappers retain their existing fallback.

### Visible review completion

The owner review response includes the validated stored result for that plan, obtained through an owner/space/plan-scoped query over the existing unique batch receipt. Reading an outcome is not a commit or a business-write permission. Current owner MFA and the producer read fence still govern the response; a later edit is reported separately from the historical committed result. This adds no table, migration or role grant.

New plans bind `referenceObservationDigest` to the owner/space and all directly locked todo/target identities, types, sources and current revisions in the existing physical lock order. A stored before reference can be older than its current target, while its source/type and the todo's exact before remain fixed; after references must be current. Approval/new commit/review recheck the observation. Legacy plans without this optional field retain strict reference validation. The proposed0012 validator alone needs this additive JSON-field allowance; no new table or privilege is introduced.

Partial selection uses owner-only `POST /api/platform/personal/todo-classifications/{planId}/preview` with only `selectedTodoIds`. Before approval, the server validates the entire current base under its producer fence and plan/record locks, then selects immutable changes in original order, retaining producer/grant/policy provenance and the original expiry. Revoked producers, expired/policy-invalid bases, approved or consumed plans and unissued run provenance are rejected. The new plan has a new ID/digest and no approval. Original and derived plans remain independent; deriving or closing does not revoke an existing server approval. No owner preview/approval endpoint is advertised to Agent or MCP.

A finite `modal=classification&planId=<UUID>` workspace location preserves the canonical background, drafts, scroll and focus. The client derives the 68-character command key `cls-` plus SHA256 of JSON.stringify([planId,digest]) through Web Crypto, within the existing 8..96 limit, and preserves the exact commit body. Reload or outcome readback performs no write; unknown state offers only explicit retry of the original command. No business text or credential is persisted in browser storage. Busy/unknown navigation remains guarded with an explicit reauthentication path; ordinary idle dismissal and full-screen expansion reuse existing Dialog/theme patterns.

### Typed context and source migration

Evidence references, confirmed facts/goals/preferences, inferences and action proposals remain distinct typed records. Source packages preserve original identity, version, digest, coverage and mapper versions. Previews separate accepted/rejected/unknown/duplicate/no-op and require a fixed selected batch before application. Domain projections use explicit fields, enums, units and CHECK constraints; raw evidence is private and cannot become a free-form derived JSON database.

### Checkpoints and queue are not business authority

Run ownership is resolved server-side; arbitrary thread IDs are not authorization. Use isolated schemas/roles and guarded checkpoint get/list/stream/delete, proving the saver works without superuser/BYPASSRLS or cross-owner reads. If it cannot, the durable stage is NO-GO while independent UI/code work continues. Queue delivery is at least once; command receipts, leases and one retry ledger prevent duplicate effects and stacked model retries. Waiting review persists and ends the job; worker cannot approve or commit.

### Local MCP first

Use official split SDK server/client2.4.0 and protocol2026-07-28 as fixed candidates, qualifying the actual host before advertising support. A local stdio adapter obtains credentials through an explicitly approved runtime and calls the configured HTTPS API, with redirects rejected. It shares registry IDs/schemas/errors and cannot mint scopes or use cookies/direct SQL. Remote HTTP/OAuth, additional audiences and persistent settings are separate identity packages.

## Risks / Trade-offs

- [Package/runtime or saver isolation mismatch] → Fixed-version synthetic qualification, explicit NO-GO for that stage, no superuser fallback or double orchestrator.
- [Private context or logs escape] → Minimal source references, current-message-only default until explicit data-scope activation, no cloud tracing, outbound assertions and independently restored encrypted backups before sensitive intake.
- [At-least-once delivery or unknown provider cost] → Stable command identity, atomic budget reservation, conservative unknown settlement and one retry owner.
- [Stale approval or revoked grant] → Approval binds delta/revisions/producer policy; transaction fence rechecks current authority, and changes require a new preview.
- [Broader plan hides unfinished work] → Original IDs/Issues, finite stable tasks and per-slice website/readback criteria; the original UI five IDs and inherited 2/5 baseline remain; later qualification stays in its sole checklist.

## Migration Plan

1. Implement and qualify default-closed A1 and A2 source candidates; preserve the old todo path and existing single writer. Produce usable organization/permissions and review pages.
2. Add context/coverage and typed intake preview before any real source import; qualify storage, logging, encryption and independent restore using disposable synthetic targets.
3. Pin and qualify graph/saver/worker dependencies, authority, budget and recovery. Keep model egress and daemon settings disabled until their fixed packages are approved.
4. Integrate professional domains and the local MCP adapter in independently verified slices; missing sources remain not-connected or partial.
5. For each actual activation, bind source/artifact, migration hashes, target identity, exact roles/scopes, source selections, budget/retention and rollback/readback. Stop only the action whose authorization is missing; routine source work continues.
6. Roll back by disabling new work, preserving in-flight commands/receipts/checkpoints and restoring a qualified artifact. Data and scopes require explicit inverse/CAS actions; an image rollback is not a database or permission rollback.
