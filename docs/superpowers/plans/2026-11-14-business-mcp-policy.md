# Business MCP operation policy implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for this Root-assigned inline slice. Root arranges independent review; do not spawn another agent.

**Goal:** Keep the HTTP business MCP restricted to explicitly reviewed business operations even when a grant or future catalog also authorizes engineering execution.

**Architecture:** One exact operation-ID allowlist projects the reviewed registry. Discovery and execution share that policy; the in-process transport independently resolves the actual method/path through the same allowed registry entries before dispatch. The original Agent API, native clients and engineering workers keep their separate authority contracts.

**Tech Stack:** Existing TypeScript, Node24.18.0, official split MCP SDK2.4.0 and Zod; no dependency, lock, auth, SQL or runtime activation changes.

**Spec:** [agent-mcp](../../../openspec/changes/personal-agent-foundation/specs/agent-mcp/spec.md), personal-agent-foundation7.1/7.2, and [Issue35 owner clarification](https://github.com/Nirvana-Chow/lifeos-app/issues/35#issuecomment-6859451219). Root owns the parent OpenSpec update for the latest controlled-dispatch Goal. Business access never inherits engineering execution through shared scopes or policyClass.

## Global constraints

- Work only in the assigned isolated worktree/feature branch; preserve the sole registry, lock, Skill and OpenSpec files.
- Allow exactly the existing57 business CRUD/read operations and `previewTodoClassification`; keep the existing classification-commit manifest gap closed. Todo5, organization4, requirements4, storageReview5, feedback3, and journal/calendar/health/person/finance/media/career/portfolio/cooking4 each.
- Exclude both execution JSON operations (including admit/claim/renew/progress), event transports, coding launch, deployment, account/key/security management and every unreviewed ID. Do not block the original API's separately authorized execution routes.
- Synthetic fixtures only; no real credentials, API calls, claims, worker, services or production. No build/Chrome until Root grants the shared slot.
- Complete an actual production webpack build and same-artifact checks in a qualified environment before push/PR/CI. This security slice alone does not complete OAuth, files, ChatGPT/mobile or owner acceptance.

## Review focus

- A full-business grant and execution operations share requirements scopes/policyClass: no engine request reaches the dispatcher.
- A caller bypasses tools/list or the client wrapper: direct actual-route dispatch is still constrained.
- A future registry/discovery ID appears: it stays closed until explicitly reviewed into this policy.
- Previously supported record/storage/organization routes retain exact method/path/type/ID behavior and current grant/module checks.
- Unknown write outcomes, durable duplicate receipts, later revisions and independent GET failures keep their existing distinctions.

## Task 1: Enforce one closed business policy

**Files:** Create `src/mcp-http/business-policy.ts` and `test/mcp-http-business-policy.test.ts`; modify `src/mcp-http/business-client.ts` only as needed. Root subsequently assigned the same-root-cause consumer expectations in `test/requirement-admission.test.ts` and `test/requirement-events-agent.test.ts` to this writer. Handler/runtime remain unchanged because both already use the constrained client/transport.

**Interfaces:** Consume `agentOperations`, `Operation`, native ID validation and current `HttpBusinessClient`/`inProcessApiFetch`; produce `isBusinessMcpOperation(operationId:string):boolean` and `isBusinessMcpApiRoute(method:string,path:string):boolean`. The latter accepts only the relative Agent path and the internal GET `/v2/capabilities`, resolving all other requests from allowed reviewed registry descriptors.

- [x] Write consumer-level RED tests: broad discovery omits engineering/event operations; explicit admit/claim/renew/progress return403 with zero dispatch; raw in-process engineering/account/launch/deploy routes reject before dispatch; supported routes still pass.
- [x] Run the new file against the unchanged source and retain assertion failures proving the missing behavior.
- [x] Add the exact allowlist and same-policy route resolver; reject operation IDs before argument/discovery work, strip event transports, and gate every in-process request before dispatch. Remove unreachable execution-only receipt branches from this HTTP business adapter.
- [ ] Run focused original HTTP/compact/storage/receipt/readback/origin/cancel and native/API parity tests, then typecheck. Run the bounded unit suite when resource coordination permits; no synthetic skips count as real runtime acceptance.
- [ ] Root independently reviews the fixed source SHA; reserve the production build slot, run the full webpack build plus same-output checks, then integrate via normal feature PR after required checks. Do not mark parent OpenSpec delivery complete.

## Evidence and decisions

Initial base `7bc3059fabd264357fc9cf16d2d09df63a103b52`. The managed WT had no dependencies installed; the already authorized dependency tree with identical lock SHA `ddd3bb7a8b2018a5722e75562ac411299d7527299cf87c46fc413e9667d90e1d` may be linked locally for read-only test/type resolution, without installation or lock edits. Skill processing follows the existing Root assignment; no additional planning approval or child dispatch is introduced.

Baseline original HTTP/compact/storage tests:26 pass,0 fail,0 skip. The new policy file first ran25 tests:6 pass/19 assertion failures/0 skip, proving engineering IDs were advertised/dispatched and raw engineering/account paths reached the dispatcher. After minimal source changes, the new+original HTTP set passed51/51,0 skips.

The original consumer sweep then found two genuine stale expectations: HTTP MCP admission and HTTP MCP claim/progress were expected to succeed. These failed with the intended403 while the original scoped API tests stayed green. Root assigned the two consumer files for a narrow contract calibration: business-MCP denial now asserts zero engineering dispatch and unchanged records/history/work/outbox/commands; the separate API admission test retains its original receipt and later-state assertions. No worker/API implementation was changed. The expanded focused sweep passed124 tests/0 failed/1 explicit opt-in skip out of125; the skipped reviewed legacy-source check was not activated and is not acceptance. Final `npm run typecheck` and `git diff --check` passed after that calibration.

Independent review, coordinated full unit/build/same-output evidence, PR, release and owner acceptance remain outstanding. No OAuth, file input, real record or runtime activation is claimed.
