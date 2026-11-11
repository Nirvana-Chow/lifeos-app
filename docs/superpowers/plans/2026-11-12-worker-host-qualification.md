# Worker host qualification implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans task-by-task. This is an isolated qualification candidate, not worker/model activation.

**Goal:** Give an assigned requirement worker a narrow reviewed business channel and prove owned-process cancellation/crash behavior without real credentials or models.

**Architecture:** Reuse Codex exec and the existing business client/writer; no second Agent loop. An assigned-job channel exposes only current assigned read, original-key claim, renew and workflow-only progress. A small macOS native process host owns its worker group, an anonymous start/control pipe and a private identity ledger. Recovery observes/quarantines; it never guesses a PID, restarts a model or marks business completion.

**Tech Stack:** Existing Node24/TS6, official MCP SDK2.4, Swift/Foundation/Darwin native process APIs; no new dependency. Base87e628ec3f16c8f377e0d1f66c9fadea5077e7ff.

**Spec:** Root's approved worker-host boundary, personal-agent-foundation5.2/5.4. Prior event/claim/receipt contracts remain authoritative. These source tasks do not complete the broader OpenSpec items or authorize live worker/model egress.

## Global constraints and design

- Only new worker-host named files. Do not edit API/registry/Skill/workflows/mac-dispatcher. Broker5b3a remains frozen, unmodified and unused by tests. No auth.json/Keychain/owner/production/model/launchctl access; slots default0.
- The channel consumes an injected, separately adopted `WorkerBusinessClient` with existing execute/retry semantics. Missing57-op client/slot/native attestation closes; root owns their later shared seam. No generic owner writer is delegated.
- Immutable assignment pins jobId/requirementId/sourceId/workDigest/holder and original claim key. Current GET execution metadata and server/current grant remain authority. Caller cannot supply target IDs, lease identity, URL, body, priority, dates, baseline or arbitrary operation.
- Progress accepts only workflow `{state,purpose,nextStep}`; states are in_progress/blocked/awaiting_review/done. Native host reads full current record, verifies source/digest/current lease/revision and supplies unchanged fields plus that workflow to the same original writer. Unknown results retain the existing client's recovery ID and block new worker commands; a separate operator recovery uses the original client, never a new body/key.
- JSON/MCP transport never grants new scopes. The per-job stdio server lists only the four assigned tools. Future exec config uses per-invocation MCP settings, not global configuration. Provider destination/auth/telemetry still needs qualification before any real CLI invocation.
- The native host launches a trusted wrapper in a fresh process group. The wrapper waits for anonymous FD release. Ledger PID-start/pgid/path/hash/argv/job is durable before release; EOF before release exits without executing the target. Supervisor control-pipe EOF requests owned cancellation. No file flag is a launch permit.
- While running, the original native parent retains the unreaped leader identity and performs bounded TERM/KILL cleanup on its owned group. The control API sends cancellation over the existing pipe; it does not target a caller-supplied PID.
- Hard native-host crash, PID/start/code/argv/group mismatch, escaped/unprovable descendants and lost outcomes quarantine the job/worktree. Recovery only reads OS identity; it never signals recovered unknown groups or launches a replacement. Group-empty is a bounded observation, not proof against arbitrary same-UID malicious code or escaped processes. Process exit0 never means business verified.

## Owned files and interfaces

- `src/worker-host-candidate/channel.ts`: `createWorkerChannel({assignment,client,attest})`, strict `handle(command)`; `WorkerBusinessClient.execute(id,args)` / `retry(requestId)` are the existing client port. Assignment and peer attestation are constructed by host, not model arguments.
- `src/worker-host-candidate/mcp.ts`: official SDK stdio server factory exposing only read_assigned/claim_assigned/renew_assigned/progress_assigned; no generic LifeOS tool or transport setting.
- `src/worker-host-candidate/owned-process.ts`: typed default-closed native host launcher, existing anonymous control pipe, fixed executable/hash/code/argv/job contract, stdout metadata only. No Codex spawn in tests.
- `native/worker-host/`: focused Swift ledger/process/CLI sources, no network/credential provider. Host immutable job spec contains non-secret identity/budget metadata, never a key.
- `test/worker-host-*.test.ts` and named synthetic fixtures: real business-client/handler tests, injected ownership tests, opt-in actual macOS compile/sleep/child/host-crash tests.

## Review focus

- Invalid/foreign assignment and attempted accepted-body edits must cause zero API calls.
- A changed digest/source/lease or lost grant must stop before workflow write; unknown commands cannot acquire a new key or model.
- Killing the host between wrapper spawn and ledger write must leave no target execution; actual wrapper identity must disappear, not merely omit a marker.
- Leader-first exit, PID/start or pgid reuse and escaped children cannot become a clean/reusable job or an arbitrary kill target.
- stdout saturation, cancellation and supervisor EOF cannot deadlock cleanup or upgrade exit0 to receipt verification.

## Task1 — Assigned workflow channel
- [x] Write tests against absent channel; observe RED. Cover strict four-tool grammar, exact job binding, current source/digest/lease, immutable fields and unknown blockade using the existing client/handler with synthetic records.
- [x] Implement the minimum channel and exercise real schema/CAS/receipt/current-readback behavior. No network transport/provider is installed.
- [x] Run worker-host channel tests and typecheck; commit the independently reviewable contract.

## Task2 — Native ownership ledger and start/control handshake
- [ ] Write failing native tests for job/schema/code validation, atomic private ledger, exact PID-start/pgid/path/argv observations and zero signals on mismatches.
- [ ] Implement bounded native file/process helpers; private O_NOFOLLOW regular/nlink/uid/mode checks and atomic fsync. Anonymous start release follows durable identity, not a file flag.
- [ ] Compile/run only injected/native synthetic test programs; no production executable/real Codex is invoked.

## Task3 — Actual owned-child cancellation and recovery
- [ ] Observe RED with real synthetic parent/sleep child, pre-ledger hard crash, control EOF, early leader exit and orphan recovery cases.
- [ ] Implement cancellation through the live owned pipe/parent group. Keep an unreaped leader until cleanup. Recovery quarantines instead of reattaching/signalling/restarting unknown jobs.
- [ ] Verify actual PID states and target-not-started behavior, with test-owned cleanup for deliberately escaped fixtures. Record limitations explicitly.

## Task4 — Standard stdio integration and handoff
- [ ] Bind the channel to official MCP tools and a typed native launch/attestation interface. Defaults reject missing adopted client/reserved slot/provider qualification.
- [ ] Run real official-SDK in-process/stdio synthetic requests; unknown tools and owner operations remain unavailable. Do not run actual Codex or edit shared dispatcher seams.
- [ ] Run focused tests/types; obtain non-author review and report fixed SHA, executed native evidence and unavailable live/model/SQL/adoption gates. No webpack unless root later reserves it.

## Reuse evidence and execution ledger

- Installed CLI0.167.0-alpha.3.2 pure help confirms exec stdin/JSON/sandbox/config overrides. No update or real model invocation. Official [non-interactive docs](https://learn.chatgpt.com/docs/non-interactive-mode) support exec and required MCP failure; [MCP docs](https://developers.openai.com/codex/mcp/) document stdio and per-server command/args; app-server [dynamic tools](https://learn.chatgpt.com/docs/app-server#dynamic-tool-calls-experimental) are experimental and add an unnecessary protocol here.
- macOS SDK exposes proc_pidinfo PROC_PIDTBSDINFO microsecond start time/pgid and POSIX_SPAWN_SETPGROUP. Use native fields rather than ps string parsing. No debugger/taskport permission is requested.
- Root approved the minimum layered plan and anonymous-FD crash requirements before core implementation. Existing client50 package/5b3a broker are untouched. New managed worktree/branch is isolated at87e; committed lock exactly matches reused installed dependencies; no install.

- Task1 evidence: absent module RED, then5 focused groups pass/0skip against actual synthetic client/handler. An initial sync-throw async-contract mismatch was corrected; initial typecheck CFA errors were corrected by an explicit never-returning function declaration. Final tsc passes. No real network/model/credential access.
