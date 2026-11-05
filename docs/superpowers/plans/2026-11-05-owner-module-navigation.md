# Owner module navigation and release notice implementation plan

**Goal:** Continue LO-SCHEDULE-001 / LO-REQ-001 / LO-VERSION-001 under personal-agent-foundation6.2/9.7 and unified-business-ui1.2/3.1/3.2: expose implemented owner pages and show verified current-version updates once dismissed per owner/space/source.

**Architecture:** Reuse the existing owner status flags, actual schedule/support routes, Radix dialog, release artifact/read-preference API and SupportMutationSession. A UI-only adapter validates status and release responses. Native document anchors preserve existing departure guards. Defaults and all sealed backend files remain unchanged.

**Spec:** docs/superpowers/specs/2026-11-05-requirement-support.md and the existing owner delivery-visibility intake in openspec/changes/unified-business-ui/tasks.md.

**Decision:** Use existing sidebar composition and source-bound server preferences. Avoid a second router, browser-only read ledger, new permission or candidate-version announcement. Absent/closed capabilities hide the added links; unavailable actual artifact/preferences suppress the automatic notice. Current source notes and owner acceptance stay distinct.

- [x] Add focused failing tests for closed flags, verified owner scope, exact running-source notes and unread-source eligibility.
- [x] Add UI-only status/response adapter, actual document links and guarded current-version dialog; close writes through the existing retained-command session and GET readback.
- [x] Run focused/type checks; use one bounded synthetic browser fixture for real navigation/dialog/unknown recovery when a slot is available. Preserve default skips and unavailable native/runtime gates.
- [ ] Commit source and evidence for root's independent review/integration; no push, host write, runtime flag, SQL or real API call.
