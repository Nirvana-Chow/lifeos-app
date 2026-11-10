# Owner Storage Review Persistence Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans. Verify each step before advancing.

**Goal:** Let the verified owner open a saved checklist on another browser, make a review decision and independently reread it through LifeOS.

**Architecture:** Reuse the owner session, write permit and PostgreSQL repository. Give the current owner-space checklist a deterministic record ID and a distinct internal marker. A same-origin owner endpoint provides snapshots and revision-checked commands. The browser keeps unsaved imports as local previews and writes only after an explicit action.

**Tech stack:** Existing TypeScript, Next route handler, PostgreSQL transactions, Node test runner and Chrome.

**Spec:** [Owner storage review workspace](../../../openspec/changes/unified-business-ui/specs/workspace-interface/spec.md) and [Issue #41](https://github.com/Nirvana-Chow/lifeos-app/issues/41).

## Global constraints

- Store checklist display fields, numbered decisions and revision metadata. Keep file bytes, attachments and separate filesystem path fields out of the request contract. Use synthetic data in source and CI.
- Preserve the private production release boundary, existing data permissions, JSON export, local previews and the protected or processed state. This workflow records a decision and makes no filesystem changes.
- A website readback uses the verified owner session. A machine capability needs a reviewed exact scope, discovery and Skill reference before it can be offered.

## Implementation and verification

- [ ] Add `src/storage-review/domain.ts` and `service.ts`. In `test/storage-review-service.test.ts`, prove owner-space separation, immutable checklist version, protection of noneditable items, valid replacement, revision conflict, and idempotent replay. Verify the dedicated marker and PostgreSQL-compatible record shape.
- [ ] Add the owner endpoint to `src/personal-candidate/runtime-http.ts` through `src/storage-review/http.ts`. Test real request and response boundaries with `test/storage-review-http.test.ts`, including wrong owner, cross-origin write, authorization header, database readiness, permit loss, protected items and readback. Restrict generic reads and writes to the approved records; cover generic Inbox, export and window paths with focused regression tests.
- [ ] Add browser sync to `app/personal/storage-review/document.ts` and allow same-origin requests in `response.ts`. Verify import preview, explicit save, reopening in a separate browser, saved selection, reload and conflict recovery on the current route. Retain the local export path.
- [ ] Run isolated PostgreSQL readback with two owner browser sessions, full source and required qualification checks. Review scoped read capability and route policy before publication. Verify the running source, the owner page and durable review readback on the self-hosted instance after the controlled release work in Issue #43.
