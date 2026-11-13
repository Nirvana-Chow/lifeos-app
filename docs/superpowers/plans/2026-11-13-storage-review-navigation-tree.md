# Storage review navigation and directory detail implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline; Root arranges independent review and delivery. Do not delegate further.

**Goal:** Make the existing owner storage-review page discoverable and let exact dotted child IDs be reviewed separately without resetting historical choices or implying file deletion.

**Architecture:** Keep the existing protected server HTML page and save/CAS/receipt/readback flow. Project the already available storage service in owner status; reuse the module map and settings navigation. Build a presentation-only tree from exact existing dotted parent IDs, retaining original records and choices. A parent with children is read-only; standalone folders remain selectable.

**Tech stack:** Existing Next.js/React/TypeScript, native HTML details, existing Lucide icons; no dependency, schema, config or grant changes.

**Spec:** Existing unified-business-ui workspace-interface specification, 1.2/3.1/3.2 and storage-review acceptance, Issue #41 / LO-FILES-001 / LO-UI-001. This plan is engineering mapping, not a business progress ledger.

## Constraints and design choices

- Reuse the current page rather than creating a second review table or schema. Native disclosure keeps keyboard support without a tree-widget dependency.
- Parent identity is the exact last dotted prefix when that record exists and both IDs have nonempty safe segments. Orphans remain independent records; no renumbering or record mutation.
- Parent choices remain visible as historical choices. Only pending leaves count toward the current choice progress. Protected/processed states remain distinct from decisions.
- Upload completion and independent restore verification have no structured fields in this contract. Show them as unverified for media, retain the original body, and never infer completion from body keywords, names or a trash choice.
- Preserve owner/MFA/no-store, unknown command recovery and the existing Agent operation/discovery/Skill contracts. No file action or actual-record access.
- Root owns private intake, real child records, source allowlist, independent review, PR integration, fixed-main CI/release/readback and owner acceptance. Do not change the sole OpenSpec checklist or call the parent requirement complete.

## Implementation and verification

- [ ] Add failing behavior tests for exact gated navigation/status, dotted identities, parent write protection, leaf filtering/counts, historical choices, unknown media evidence and malformed/orphan IDs.
- [ ] Make the smallest navigation/status and existing-page presentation changes; preserve current save/auth/recovery behavior.
- [ ] Run focused tests and TypeScript. Reserve the full default suite/build for Root's fixed-main pipeline under the delivery agreement.
- [ ] With Root's exclusive browser slot, extend and run the existing isolated synthetic browser fixture for route/expand/filter/keyboard/mobile/save/recovery. No repeated aesthetic captures.
- [ ] Report fixed SHA, source copy for finite allowlisting, exact checks and pending independent/production/owner gates.

## Browser fixture diagnosis (three attempts retained)

1. **Target:** LO-FILES-001 / LO-UI-001 owner navigation, settings tool discovery, directory detail and preserved save/recovery; no production or owner acceptance claim.
2. **Evidence:** 25 focused checks and TypeScript passed. Existing isolated storage HTTP/Chrome fixture passed at 1920/1365/390, including directory/leaf state and recovery. Next attempts reached progressively later assertions; all three cleaned browser/server/temp root successfully.
3. **Boundary:** The owner-module fixture copies the real workspace but hand-authors its Page. First it expected an obsolete release title/count; next it expected product links in the old mobile navigation location; finally its direct settings query loaded a Page that never passed initialPage to the workspace.
4. **Attempts:** #1 preserved the old title assertion and failed before navigation. #2 tested one current heading with nonempty changes and failed at the old navigation placement. #3 followed the actual Settings button and successfully checked calendar/storage navigation plus all four settings links, then failed at a redundant direct query visit. No production code was changed to satisfy those assertions.
5. **Supported cause:** app/personal/page.tsx parses readWorkspaceLocation and supplies initialPage/panel; src/personal-candidate/live-workspace.tsx also uses syncUrl. The fixture supplied neither. The captured browser tree showed Overview after the direct query, while the preceding real Settings-button navigation passed. This disproves a missing tool-link hypothesis; query propagation remains a fixture gap.
6. **One minimal action:** Pass the same readWorkspaceLocation-derived initialPage/panel into the fixture Page. Re-run the original owner-module case once, under Root's exclusive browser slot; success requires every assertion and cleanup to pass. A further failure retains the count and returns to diagnosis without another product change.
