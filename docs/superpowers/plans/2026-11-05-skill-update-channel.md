# Skill update channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a closed, testable trusted-release metadata foundation for LO-AGENT-001 / Issue35.
**Architecture:** Reuse the existing public archive and allowlist. Pure build/verification functions bind reviewed manifest bytes to exact archive and compatible API version; no network or installer side effects.
**Tech Stack:** repository-pinned Node24.18.0 / TypeScript6; builtin crypto.
**Spec:** docs/superpowers/specs/2026-11-05-skill-update-channel.md

## Global Constraints

Only generic allowlisted docs/license; no user config/key, runtime binary, permissions, background task, host writes, new dependency or auto-trusting unsigned release. Keep personal-agent-foundation7.2/8.2 open.

## Review Focus

Tampered archive, self-trusted manifest, unknown/private paths, unsupported API, origin/version mismatch all reject before a candidate is returned. Candidate validation is not extraction or installation. Pre-use hook/atomic rollback/signature freshness remain outside this static slice.

### Task1: Pure release manifest and verification

Files: src/agent-api/skill-update-channel.ts; test/agent-skill-update-channel.test.ts.
Interface: buildSkillRelease() → manifest bytes, archive bytes, manifestSHA256; verifySkillRelease(manifestBytes,archiveBytes,{trustedManifestSha256,apiVersion}) → verified-not-installed metadata.

- [x] Write behavior tests for valid manifest and rejected tamper/trust/origin/files/version/size; observe red.
- [x] Implement smallest strict verifier using existing archive builder/generated allowlist.
- [x] Run focused/source tests, full test command and available types; record unavailable dependencies or skipped integration accurately.
- [ ] Root independent review, serial integration and exact-SHA CI remain downstream; do not push/deploy from this worktree.

## Execution evidence

Ruling: preserve tar.gz instead of adding ZIP — the existing deterministic writer and anonymous download already use it; an extra format adds parser/dependency risk without a host requirement. Root confirmed this choice. This slice is closed/static: no updater transport or host installer, and no deployment/acceptance claim.

- Baseline existing Skill/source tests:4 passed.
- Red: the new suite failed because skill-update-channel.ts did not exist; then implemented the source.
- Focused final tests:8 passed,0 failed,0 skipped; includes rehashed malicious symlink/path/archive trailers/per-file corruption and decompression limit fixtures.
- First full npm test in clean worktree failed135 tests because dependencies were absent (707 total/572 passed); log /tmp/lifeos-skill-update-channel-tests-20261105.log. No production operation was requested. Reused the existing locked node_modules through a local temporary symlink; installed no packages or changed lock.
- Full suite after dependency reuse:1325 passed,0 failed,41 opt-in integration skipped; final suite after the archive-structure fixture:1326 passed,0 failed,41 skipped. Subsequent exact high-bit path regression failed as expected, then changing tar-header decoding from ASCII (which masks bit7) to latin1 fixed it; final rerun recorded below.
- Initial typecheck rejected a test assert.throws overload; changed only its Error predicate. Fresh npm run typecheck passed.
- openspec1.16.0 validate personal-agent-foundation --strict passed with telemetry/tracking disabled.
- Next production build, enabled PG/network/Chrome, update-channel serving, actual installer/rollback and host pre-use invocation were not executed. New code has no route or startup import; source typecheck and pure tests cover this bounded candidate. Root independent review and exact-SHA delivery remain pending.

Final exact candidate verification after high-bit regression fix: focused8/8; typecheck exit0; full npm test1326 passed/0 failed/41 skipped (1367 total,24.7s), log /tmp/lifeos-skill-update-channel-tests-20261105-final.log. Strict OpenSpec and git diff --check passed. Source manifest911bytes, archive6797bytes, reviewed candidate manifest SHA2565c11f9f7d43ef4a382b28b8f3eb13986958eefd874abed49d1e8f711ce2f8c89. This hash is local output, not a deployed release or signature. Temporary dependency symlink removed after checks; original dependency directory unchanged.


## Follow-through: real on-demand update implementation

Owner authorization explicitly selected the existing fixed HTTPS publisher as the documentation trust root. Ruling: no new signing identity or default-off trust placeholder; integrity hashes are not called signatures. This supersedes the earlier static-only candidate boundary while preserving its evidence/history.

Files: extend skill-update-channel.ts with positive release sequence, manifest parsing and validated document output; add skill-updater.ts, local-skill-update/store.ts, scripts/lifeos-skill-before-use.ts, fixed manifest/content-addressed artifact routes and agent-skill-updater.test.ts; update public Skill/credential instructions and regenerate the existing allowlisted content module.

- [x] Watch release-sequence assertion and missing updater module fail before implementation.
- [x] Implement fixed same-origin bounded transport and source publisher routes, no credentials or package-code execution.
- [x] Implement monotonic high-water, same-sequence substitution refusal, managed immutable docs, original backup, fsynced journals, atomic normal activation and failure/crash recovery.
- [x] Preserve3local overlay files/external runtime configuration; immutable version callback and13operation binary gates remain separate.
- [x] Exercise synthetic filesystem, transport, malicious tar, overlay edits, interrupted adoption/activation, live lock and unsafe versions symlink; no actual host/API/Keychain operations.
- [x] Finish applicable full tests/types/build/generated Skill/OpenSpec validation; root independent final-SHA review/serial delivery remains downstream.

First focused follow-through run17passed after correcting a synthetic fixture trying to create an existing versions symlink. The existing generic-package test initially rejected a host-specific filename mentioned in generic prose; generalized that prose instead of weakening the no-local-runtime packaging check. Initial follow-through typecheck found two Node typing-only issues (Stats bigint overload, Buffer generic); narrowly fixed them. Follow-up focused18passed. Invalid-argument CLI smoke exited1 with a fixed error, made no request and touched no installed Skill.

Bootstrap limitation: first conversion of a real directory has a recoverable journaled gap, explicitly not atomic. Subsequent releases use a single atomic symlink rename. Host has not been configured or converted; source supports it after review. Existing local13-op binary cannot gain requirements/new operations by updating documents. Retain both7.2 and8.2 incomplete until actual host/distribution/runtime delivery evidence.


### Final implementation/review evidence

- Publisher routes compile in a real Next16.4.1 build. Initial ordinary npm run build failed because Turbopack rejects a node_modules symlink outside its root; the existing next.config.ts LIFEOS_PREVIEW_SHARED_DEPENDENCIES=1 mode succeeded (NEXT_TELEMETRY_DISABLED=1), listing both new routes. No config or dependency was changed. Log: /tmp/lifeos-skill-updater-real-20261105-build-shared.log.
- Root pre-review removed a host-specific13-operation/requirements claim from the generic installer header. Only present local overlays receive priority links; generic installations do not inherit Dan's local runtime facts. The original local overlay itself remains preserved.
- Independent WIP review reproduced a current-version fast-path race: a local public document edit or active target swap during the manifest download could reach the callback unchecked. Added both regressions, observed both fail (Missing expected rejection), then re-inspected current target/public hashes before returning the immutable path; both pass. Trusted local overlay edits during download remain current and preserved.
- Final focused source/download/update suite:21 passed/0 failed/0 skipped, including real route response binding and filesystem recovery. The CLI invalid-argument smoke exits1 with a fixed error, no network or installed-Skill write.
- npm run typecheck, Skill Creator quick_validate, strict OpenSpec1.16.0 validation and git diff --check pass. Generated public artifact parity passes, retains LICENSE and excludes local config/runtime details.
- Full suite after the final review fix:1339 passed/0 failed/41 skipped (1380 total,24.4s), recorded at /tmp/lifeos-skill-updater-real-20261105-final-tests.log;41 opt-in PG/network/Chrome tests remain skipped, not accepted. No real API/Keychain/private records, live installation, actual host hook registration, push or production deployment was performed.

Next: root independent final-SHA review, serialize this slice into the approved main pipeline, then verify real HTTPS manifest/archive and install the reviewed local pre-use adapter. Both7.2 and8.2 remain open until that actual delivery/readback. No downloaded instructions can auto-upgrade local executable support or grant scopes.
