# Owner backlog first delivery batch

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Preserve the sole unified-business-ui checklist.

**Goal:** Restore the current main release gate, then deliver usable multiline todo intake and owner-record search through existing business services.

**Architecture:** Keep the scoped business API and database authoritative. Multiline intake previews editable rows and calls the existing single-record writer sequentially; it is explicitly a partial, non-atomic batch. Search reads the existing owner-filtered snapshot and links stable records without external providers. CI repair follows the failed run's actual evidence.

**Tech Stack:** Existing pinned Next.js, React, TypeScript, ReUI and PostgreSQL; OpenSpec 1.16.0. No dependency or schema changes.

**Spec:** `openspec/changes/unified-business-ui/specs/workspace-interface/spec.md`; original refinement in `docs/superpowers/specs/2026-11-05-owner-review-refinement.md`. Business acceptance is read from the authorized requirement pool, never copied into source.

## Global Constraints

- Continue LO-OPS-001, LO-TASK-001, LO-CAPTURE-001 and LO-SEARCH-001 with their existing execution Issues and unified-business-ui tasks 1.2/3.1/3.2. Do not reset inherited evidence.
- Source contains generic engineering details and synthetic fixtures only. Keep private requirements, session ownership, real records and receipts outside Git.
- Use feature branches and ordinary PRs. Never force push, rewrite published history, reset hard or push directly to main.
- Root dispatches direct children only. Each owns a separate worktree and Git index. Merge, business writes, heavy builds and deployment have one writer at a time.
- Preserve owner/MFA, no-store, IDs, revisions, idempotency, unknown outcomes and independent readback. Do not change grant, account settings, runtime flags or production trust.
- Reuse existing createTodo operation and discovery/Skill contract for each row; add no bulk API or atomicity claim. No natural-language model inference, invented dates or automatic writes.
- Search stays local to existing authorized data. No embeddings, provider activation, network egress, background jobs, new paid service or real migration.
- A failed fixed-SHA CI prevents publication. Use the original private release/readback path after all required checks. Implementation, CI, deployment and owner acceptance remain separate.

## Design choices

Reusing single-record writes gives each saved row its own verified identity and recovery path. A new atomic batch service would enlarge the schema and transport surface without being required for newline intake. Search reuses the current read service; a second index or external semantic provider would add unqualified data handling. UI consumers retain the existing ReUI patterns, draft guards and error states.

## Review Focus

- Duplicate/blank/oversized input is visible during preview; selecting or editing a row never silently creates a record.
- An uncertain response stops new writes and preserves the exact row command across refresh; already verified rows are never resent.
- Session expiry, partial failure and navigation preserve appropriate drafts without exposing records to another owner.
- Search does not treat serialized metadata as prose, invent completeness, drop unknown dates or link an unstable identity.
- CI repair preserves the original assertions and security windows; no timeouts, skips or eligibility bypasses hide the failure.

## Task 1 — Repair the actual current-main CI failure (LO-OPS-001)

**Files:** Only the failure-owning source/fixture and focused regression selected after reading run 43436324315 attempt 1. Record the exact list before editing.

**Interfaces:** Preserve original workflows, release eligibility, finite capture manifest and private deployment authority.

- [ ] Read exact job/step/log and reproduce the smallest relevant failure.
- [ ] Add or run the existing strict regression to observe RED; identify product versus fixture cause.
- [ ] Implement one evidence-backed minimal fix; rerun the focused case and typecheck.
- [ ] Obtain independent technical review, open a normal PR, and serialize integration. Do not rerun the known-bad SHA.

## Task 2 — Multiline todo preview and sequential save (LO-TASK-001 / LO-CAPTURE-001)

**Files:** `src/personal-candidate/connected-workspace.tsx`, `task-editor.tsx`, `workspace-controller.ts`; `src/ui-review/workspace.tsx` for the task entry action only; focused new batch helper/component/tests. Do not edit shared navigation, global CSS, server authorization or the record service.

**Interfaces:** Consume the existing task draft/command writer and readback. Produce one selected row at a time and explicit pending/verified/failed/unknown row state; reuse the original unknown-command recovery path. Keep single todo editing behavior.

- [ ] Inspect the current controller and editor; specify the smallest row model, parsing limit and recovery storage using their existing contracts.
- [ ] Observe failing behavior tests for preview/edit/selection, duplicate lines, partial success, unknown response, reload and authorization loss.
- [ ] Implement the accessible preview and sequential writer, retaining original input and exact command identity.
- [ ] Verify focused tests and types, then actual synthetic desktop/mobile route interaction and keyboard behavior using the established fixture.
- [ ] Update the relevant user help/Skill reference with sequential, non-atomic semantics; independently review and open a feature PR. Request the shared build slot before building.

## Task 3 — Search actual owner records (LO-SEARCH-001)

**Files:** New `src/personal-search/*`; existing owner search service/HTTP only if a tested correctness gap is shown; the existing module route map for the search destination only. Root owns any shared navigation link and sole OpenSpec checklist updates.

**Interfaces:** Consume the existing authenticated personal search endpoint and source/record IDs. Display query, record type, date or unknown date, excerpt, coverage and stable original-record destination. No mutation operation is added.

- [ ] Read the existing owner read service, search route and navigation contracts; verify the canonical original-record destination.
- [ ] Observe failing tests for meaningful field search, no-match/empty/error, stable links, partial coverage, revoked sessions and absence of external requests.
- [ ] Implement the smallest working search page and necessary deterministic query correction. Preserve original records and no-store/owner boundaries.
- [ ] Verify focused service/HTTP/page tests, types and actual synthetic route/keyboard/back-navigation behavior. Request a build slot before browser fixture builds.
- [ ] Document the local search scope and unavailable semantic search; independently review and open a feature PR.

## Integration and rolling continuation

- [ ] Independently review each changed slice, serialize ordinary PR merges and keep exact commit provenance.
- [ ] Run the full original qualification/build once on the combined fixed main SHA, wait for terminal state and repair failures under the same track.
- [ ] Observe existing private automatic publication and independently read back Native + HTTPS source/build/behavior. Failed CI retains the last running version.
- [ ] Update the original requirement records through the reviewed API with receipt and independent GET; read the complete pool again and select the next executable slice, preserving all unfinished work and authorization boundaries.
