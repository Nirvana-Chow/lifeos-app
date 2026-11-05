# Fast release implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Root remains the sole integration and production writer.

**Goal:** Routine changes pass necessary source gates, build the actual private production image once and publish through the existing native readback.

**Architecture:** Keep the existing release workflow identity and two honestly named required jobs. A separate full qualification workflow and a fixed real full-green ancestor protect sensitive cumulative changes. A small private adapter repeats classification from verified source manifests; the existing builder adds the compiled-closed image check.

**Tech Stack:** Existing Node24/TypeScript/Python3/GitHub Actions/native Docker publisher; no dependency changes.

**Spec:** `docs/superpowers/specs/2026-11-05-fast-release-design.md`.

## Constraints and review focus

- Preserve closed defaults, old five allowed types, ownership, issuer identity, permissions, SQL and real data.
- Failed prior backend changes must remain in the cumulative diff even if the newest commit only changes CSS.
- Workflow aggregate success must not turn skipped native jobs into qualification.
- Wrong source/repository/tree/attempt/workflow, missing manifests and unknown paths fail closed/full.
- No production image is accepted from public CI; compiled default-closed checks must run on the exact single native image before publish.
- Old full-green metadata may advance only from actual full-run evidence and reviewed byte pins.

## Task 1 — Source policy and evidence contracts

- [x] Add fixed real full-green metadata and explicit path policy.
- [x] Write negative tests before classifier/evidence validation.
- [x] Implement cumulative Git diff and actual run/attempt/job validation.
- [x] Add trusted Python classification parity and full-qualification negative tests.

## Task 2 — Separate release and qualification

- [x] Reuse `62147c2` npm tarball caching and remove duplicate requirements browser execution.
- [x] Include main `8cd640a`'s minimal optional-details browser-helper correction.
- [x] Keep release `ci.yml` at exactly two real jobs, unit/types/audit/contracts and eligibility; no public application build.
- [x] Preserve complete old fixtures in independent qualification workflow with explicit policy job.
- [x] Run pure tests, native typegen/types, YAML parse/structure and whitespace checks.

## Task 3 — Private native candidate, then controlled adoption

- [x] Derive small worker/builder diffs from exact reviewed installed-source hashes, outside Git.
- [x] Reuse twenty existing synthetic worker tests against the actual candidate module.
- [x] Root validated the existing8ccc image offline:44 checks, exact build, no runtime/network mounts.
- [x] Add automatic verified-full-green manifest/receipt advancement and four bounded synthetic failure/reuse cases.
- [ ] Independent focused review; root integrates source and reads the new workflow ID/full-green evidence.
- [ ] Root binds the final source/workflows/policy/adapter/baseline manifests and current controller/config CAS in one reviewed installation package.
- [ ] Root installs once, runs finite check/readback, then verifies one native build and actual startup/version publication. Failure keeps the existing live version; no forced green or manual state deletion.
