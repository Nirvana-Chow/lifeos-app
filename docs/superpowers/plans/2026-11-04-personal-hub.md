# Personal data workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Correct the approved workspace interactions and connect real data through truthful, scoped capabilities.

**Architecture:** Compose existing ReUI and Radix primitives, retaining the sole record writer and finite history guards. Implement independent UI slices in parallel; integration/data stages retain separate permission and persistence gates.

**Tech Stack:** Next16.4.1, React19.3, fixed ReUI/TanStack9.3.1, Radix1.8.1, existing PersonalService and Agent registry; no new dependency.

**Spec:** [design](../specs/2026-11-04-personal-hub-design.md) and the sole unified-business-ui checklist.

## Global Constraints

- Preserve original five OpenSpec IDs and inherited 2/5; no synthetic owner demonstration.
- Keep one npm lock, fixed ReUI notices, closed defaults, owner/MFA checks and the existing authoritative writer.
- Credentials/records/exports outside Git; no silent scope expansion or proposed SQL execution.
- Implementation, tests, deployment and owner acceptance are distinct.

## Review Focus

- Overlay/history restores the exact background without losing cell drafts or unknown requests.
- Nested dialog focus and closing do not leak a one-time key or retry an uncertain issuance.
- Undated requirements remain visible; no phase order is converted into an invented date.
- Long/narrow/short workspace content scrolls while controls remain reachable.
- Skill downloads contain only reviewed generic instructions and discoverable operations, never secrets.

### Task 1: API dialog and portable Skill distribution

**Files:** account-api-keys.tsx/.module.css; isolated account browser test; new public Skill artifact route/module and focused tests; skills/lifeos-agent metadata as needed.
**Interfaces:** Keep AccountApiKeys({embedded?}) and endpoint unchanged. Public artifacts contain only registry-generated reference and generic instructions; own credential required.

- [ ] Add behavioral RED covering initially closed create form, create→reveal, focus, busy dismissal, copy/close/pagehide, and secret-free downloaded Skill.
- [ ] Implement controlled stable create/reveal Dialog and a compact Skill download/copy panel. No permission or issuance-policy changes.
- [ ] Run focused tests, typecheck and enabled account Chrome lifecycle; retain owner/MFA and negative-body assertions. Commit only assigned files, use public noreply identity.

### Task 2: Settings overlay, matters shell and bounded content

**Files:** private-navigation.ts; workspace.tsx; live-workspace.tsx; connected-workspace.tsx; review.css; task/category-grid adapters; app/personal/page.tsx and account canonical entry adapters; focused navigation/browser tests.
**Interfaces:** Finite modal/panel location; preserve existing page IDs and history fencing. Existing AccountApiKeys can nest inside overlay without remounting background.

- [ ] Add RED navigation tests for direct/legacy settings, open/close/Back/Forward, query rejection, preserved draft/background and fixed content boundaries.
- [ ] Implement overlay-safe capture/guard separately from leave-page discard; rename sidebar to 事项; integrate protected security/API panels.
- [ ] Enable native sticky ReUI headers and remaining-height viewport, list row scroll and per-column board scroll. Run focused/controller/browser checks and typecheck. Preserve old compatibility gates; commit assigned files only.

### Task 3: Compact multidimensional requirements

**Files:** requirements-page.tsx/.module.css, optional requirements-view/detail modules, requirements.ts/public-requirements.json; focused roadmap/page/browser tests.
**Interfaces:** One requirements() baseline; shared selectRequirements typed filters. No source data migration or writer. Stable IDs retained.

- [ ] Add RED for all three views, same filters/IDs, detail fullscreen continuity, no inline verbose criteria and all undated records in 未排期.
- [ ] Compose read-only ReUI table and board; implement real Gantt destination with undated items; move long text to controlled detail. Correct full-system goal and preserve every existing requirement/acceptance.
- [ ] Run focused metadata/SSR/browser and type checks; commit assigned files only. No new chart dependency or fake dates.

### Task 4: Credential/Skill and real-record analysis

**Files:** private local Keychain runtime/Skill install only, generic Skill runtime reference in source if required; no real data in Git.

- [ ] Independently review native helper, pure tests, exact binary hash and safe stdin import; import the authorized key from this exact conversation without printing or writing it.
- [ ] Discovery and bounded todo listing/detail reads; save private evidence, respect limits, report actual scopes/truncation. Install verified local Skill with only nonsecret runtime metadata.
- [ ] Analyze actual records for category/project/duplicates; produce exact reviewed change proposal. Execute only supported authorized preview/commit with revision/readback; missing API remains an explicit implementation dependency.

### Task 5: Business integration stages and delivery

**Files:** original requirements/Issues/OpenSpec; separate business source adapters and contract plans as qualified.

- [ ] Verify Xunji actual fields and existing safe runtime; export only authorized readable training/body/food/plan coverage to private storage; assess Apple calendar window and financial input gaps.
- [ ] Specify new calendar/journal/health/finance interfaces, schemas and least scopes with API/discovery/Skill parity; ask only concrete new security/persistence decisions after implementation candidate is reviewable.
- [ ] Run full tests/types/exact default-closed build/compiled checks/strict OpenSpec and independent branch review; exact-SHA PR/CI, authorized routine merge and protected release readback. Keep original performance/full-rendered/owner gates open where incomplete.
