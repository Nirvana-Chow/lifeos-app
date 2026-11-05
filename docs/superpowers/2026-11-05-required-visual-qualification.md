# Required release qualification and independent visual qualification

`qualification.yml` is the required safety/data qualification, at the existing workflow ID407828015. Its policy, core PostgreSQL/Auth/HTTP/MFA and machine/owner grant tests remain intact. Recovery, permit revocation, owner CRUD/persistence, route boundaries, appearance/draft lifecycle and journal checks retain their original assertions.

The TLS browser file has an explicit `LIFEOS_OWNER_BROWSER_QUALIFICATION_MODE=release` mode which registers exactly these four original cases, with no skipped presentation test:

- no-JS page lifecycle finishes and closes before the next page opens
- isolated browser owner recovery and password flow
- isolated private business route boundaries
- isolated private appearance and draft lifecycle

The JUnit guard requires those exact four names, plus the original recovery, permit and journal groups, with zero failures/errors/skips. Unknown modes reject. The default/full and explicit visual modes retain the original five cases; every original safety/data test body remains unchanged. Handoff cleanup runs after the final selected group in each mode.

`visual-qualification.yml` preserves the former complete qualification body, including all five browser cases, the guarded118-image manifest (112 personal captures plus six public captures), uploads and the historical037 renderer/bundle benchmark. It runs independently on UI/browser-helper paths or dispatch. It cannot mint the `lifeos-full-green-v1` pointer and is not consulted by the release gate or native CD worker. Its distinct job names avoid confusing it with required release checks.

The presentation-matrix prelude timeout remains unresolved visual work. Moving that case does not mark it passed, remove its assertions or substitute source inspection for rendered acceptance. The independent workflow preserves its failure and evidence path.

The internal legacy names `full` and `lifeos-full-green-v1` remain compatible with the installed worker/adapter. They now describe complete **required release safety/data qualification**, not a claim that the independent visual/history matrix passed. The existing full-green seed, scopes, closed defaults, permissions, production builder and installed adapter/worker are unchanged. The only native configuration delta needed for this source slice is the exact new `releaseEligibility.qualificationWorkflowSha256`; workflow ID stays407828015. The source release workflow hash remains unchanged.

Verified locally:26 declaration/guard/capture tests, including executing the actual required JUnit guard against valid/missing/extra/skipped synthetic XML; TypeScript; both YAMLs; unchanged required policy/core jobs and every unaffected recovery step; read-only permissions. Actual TLS/browser execution and publication require the fixed-source CI/native pipeline. No new artifact, production change or user acceptance is claimed by this source change.
