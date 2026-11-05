# Unified UI source qualification — 2026-11-05

This is a public evidence record for the [sole original checklist](../../openspec/changes/unified-business-ui/tasks.md), not a new backlog. Original IDs, failed/cancelled runs and owner acceptance remain intact. Tasks 2.1 and 3.1 now have qualified evidence; 3.2 is open.

## Fixed sources and actual CI

| Scope | Fixed source / public trace | Observed result |
| --- | --- | --- |
| Deployed UI iteration | [PR #36](https://github.com/Nirvana-Chow/lifeos-app/pull/36), `44ce13d7cd819ba8e61bc166add23d5d51d48233` | Last verified production build `mKrYMa97UML1dRHUFHZQp`; this record does not perform a new production readback. |
| UI qualification | [PR #37](https://github.com/Nirvana-Chow/lifeos-app/pull/37), `4fb5e2c5e5acba49afae6021ad5c7a02f908e1b8`; [run 41905231084, attempt 1](https://github.com/Nirvana-Chow/lifeos-app/actions/runs/41905231084/attempts/1) | Core `126837985741` and recovery `126837986667` succeeded; independent whole-branch and criterion review approved. |
| Merged UI qualification | `db00939d4cb55f182aaf1122451a24e1a70c9323`; [main run 41909921417](https://github.com/Nirvana-Chow/lifeos-app/actions/runs/41909921417) | Both jobs succeeded: core `126854445813`, recovery `126854445160`. |
| Separate organization tools | [PR #38](https://github.com/Nirvana-Chow/lifeos-app/pull/38), `9a8e80a73c1a873320a01fc4f7eb0648e5343877`; [run 41908714692, attempt 1](https://github.com/Nirvana-Chow/lifeos-app/actions/runs/41908714692/attempts/1) | Core `126850228325` and recovery `126850227861` succeeded; source review approved. Not proof of live SQL, grant expansion or runtime enablement. |

Application `app/src/public`, package/lock, third-party and Docker recipe have no difference from original rendered source `0a2fc4f4866d7207ad2f02256b880ce0fc4d5a8e` through production `44ce13d` to QA `4fb5e2c`; QA changes concern verification and CI. This supports reuse of the independent review of 12 actual representative frames and complete 118-entry source/run/build/hash/PNG verification. The fixed QA CI separately executed 96 presentation cells and the 118-capture guard. It does not mean every image received a new manual visual review.

## Task 2.1 measurement and correctness scope

Actual public CI compares previous source `0371234b6b472790a4b1bc78a5869a2251fda68e` with current `4fb5e2c5e5acba49afae6021ad5c7a02f908e1b8`. Both use the same pinned packaging recipe/toolchain and their own locked dependencies, with equivalent synthetic fields and edit/save/receipt guards. The 48 raw samples comprise two sources × 100/1000 filtered rows × 1365-light/390-dark × cold/warm × three samples. Actual CI logs retain raw values and min/median/max. The interval is search input → matching result count → next RAF; renderer-ready is a subsequent correctness guard. Cold means a fresh browser context; warm means another navigation in that context. It is not OS cache eviction, full paint timing or a pure causal renderer comparison.

| Source | Build | Static JS paths | Bytes | Sum of per-file gzip bytes |
| --- | --- | ---: | ---: | ---: |
| Current `4fb5e2c` | `s6zy-LHKP0k0gUWgwD55d` | 60 | 3,135,775 | 1,003,128 |
| Previous `0371234` | `PZrxm8YrmKymMxuwLzrF2` | 51 | 5,112,789 | 1,456,136 |

Scope is all `.next/static/**/*.js`, unique paths counted once, each file compressed separately at gzip level 9/default strategy using the same Node/zlib toolchain. These are not route download bytes, route-exclusive increments or image sizes; differences cannot all be attributed to the renderer. Inventory includes source/build/lock proofs, hashes and per-file bytes. Candidate five cases and baseline two cases had zero failure/cancellation/skip with successful cleanup; baseline does not claim the candidate's additional private groups.

Existing fixed MIT ReUI provenance, authoritative writer, IDs/revisions/receipts/drafts, typing/composition, status/date, keyboard/focus, sort/filter, cancellation, readonly, unknown/conflict and persisted-readback evidence remain valid. OS IME and all browser fault injections are not newly claimed.

## Task 3.1 and remaining delivery boundary

The enabled fixed-source TLS/PG/browser cases passed with zero failure/error/skip: native MFA/recovery/cache boundaries, original authoritative receipts, business-route boundaries, appearance/storage/system/navigation, desktop and 360/390/430px themes, dialogs/editing/history and cleanup. Actual Header Enter/Space executes against the native button and checks theme/state/persistence. A separate fresh synthetic journal scenario performs save → authoritative receipt → refresh → independent no-store GET equality. Synthetic checks are internal qualification and do not represent personal records or owner experience acceptance. Default opt-in skips are not accepted as executed integration coverage.

Task 3.2 remains open. Production is last verified at `44ce13d`, not a newly deployed `4fb5e2c` or `db00939`. Public CI is read-only and source-only, with no production deployment authority. Explicit source-to-running-artifact handover, applicable production public/private/cache/recovery/rollback readback and separate owner experience remain to be recorded; this document does not sign owner acceptance.

## PersonalAgent progress is separate

The [top-level design](../superpowers/specs/2026-11-05-personal-agent-design.md) selects LangGraph with PostgreSQL and a mature worker direction; runtime is not installed/enabled by this source evidence. The [foundation plan](../superpowers/plans/2026-11-05-personal-agent-foundation.md) follows unified tools → classification review → traceable context/durable Agent. Existing source includes [organization operations](../../src/agent-api/organization.ts), [scopes](../../src/agent-api/scopes.ts), [capability registry](../../src/agent-api/capabilities.ts) and [portable Skill](../../skills/lifeos-agent/SKILL.md). Native TOTP → compiled Next PATCH → socket → restricted PostgreSQL and organization leaf cases passed in the separate fixed-source CI. Existing issued keys retain only their explicit grants.

Organization SQL, live scope expansion, private runtime configuration and real classification were not executed under the fixed QA sources above. Those historical QA sources did not contain classification review. The later [atomic classification qualification](2026-11-05-atomic-classification-qualification.md) records its own source, independent tests and delivery gates; earlier separate-source runs do not qualify that later source automatically. Model/worker/RAG/MCP, broader personal data connections and real owner review remain unfinished.

## Automatic delivery on 2026-11-05

Earlier production observations in this document are historical. The existing private production publisher automatically delivered public main source `e83e8133fe014afd36ba154927572bd51a7e2aca` at **16:29:53 Asia/Shanghai**. No operator invocation of the build or publish service was used for this release.

### Verified release

- Source tree: `19aadd2d65039de64d35628d8c596f13aba52fe4`.
- [Release CI 41991249397, attempt 1](https://github.com/Nirvana-Chow/lifeos-app/actions/runs/41991249397): both required jobs succeeded.
- [Required qualification 41991249279, attempt 1](https://github.com/Nirvana-Chow/lifeos-app/actions/runs/41991249279): all three declared security/data jobs succeeded, including isolated PostgreSQL, authentication, recovery/MFA and applicable owner HTTP/browser cases.
- The existing server timer detected the qualified source. An incomplete source download failed before native state changed; its bounded automatic retry succeeded. Both attempts remain recorded.
- The native publisher built one production image, checked that same image with the compiled-platform guard, published it and completed its health/version readback. The image check passed; it does not claim HTTP, browser, database or user acceptance.
- Running source, source approval, completed build/publish receipts and container build agree: build `tkYBIWtsEUcvCjtIqlEL3`, image `sha256:8d2510ae843b2990e77f38249d4646cfa9876431054e7048cb79cf132e6a7c33`.
- Fresh readback confirmed a running container, successful publisher exit and an active waiting timer. The website's login response contains the same build. Anonymous owner-requirements and Agent discovery requests return `401` with `private, no-store`.
- Startup verification confirms owner requirements enabled, the original five allowed business types unchanged and the new Agent module flags absent. This release did not expand existing keys or migrate personal records.

### Ongoing path and timing

Public CI has read-only permissions and no production credentials. The private server now receives signed GitHub `workflow_run` notifications for completed-success main-push CI and required qualification. Durable local queue and systemd socket/path activation wake the existing private publisher, which independently verifies source and CI evidence. The previous three-minute polling timer is disabled and inactive. A normal source update does not require another server configuration change. Ordinary descendants use cumulative changes from the verified qualification baseline; reviewed routine paths can use the short release path. Unknown or sensitive changes require the declared complete security/data qualification.

For this first sensitive-source release, required CI took about 18 minutes. The successful server attempt took 5 minutes 32 seconds from qualification detection to health/version completion, including source preparation; native build/publish took 4 minutes 15 seconds. The Next.js build step took about 70 seconds. These are observed timings, not a one-minute delivery guarantee. The next documentation-only update verifies the routine path separately.

### Event-triggered release verified

The actual new-source release `89447d2d38524a0243e6d6ae8c787cd6370fbe36` completed through GitHub events without a manual CD invocation or periodic trigger. [Public CI42022676876](https://github.com/Nirvana-Chow/lifeos-app/actions/runs/42022676876) and [required qualification42022677049](https://github.com/Nirvana-Chow/lifeos-app/actions/runs/42022677049) succeeded. Both eligible completion notifications were durably admitted; their queue records finished with zero pending, inflight or blocked entries. The finite post-publication reconciliation completed and left no pending retry. A separate early, ineligible `requested` notification timed out; this failure is retained and was not needed for publication.

The current container, complete build/publish records, source proof, controlled startup checks and public login page agree on source89447d2 and build `dgX5TTY0zaacsdFzoq47o`, image `sha256:271acbe24c651402ea339881a484940c3e586e2e5a241bd8a331943d732bae1d`. Owner requirements remained enabled; the original five business types, absent Agent module flags, existing issuer identity and business write mode remained unchanged. Anonymous owner status returned401. The event-drain receipt itself does not attest HTTPS; this separate public readback does.

The receiver uses its own unprivileged no-login identity and a root-owned queue parent. An actual root/sub-UID fixture proved that the receiver cannot rename the protected parent entries. Bad signatures returned403 and GET returned405. The first installer attempt stopped before source replacement because umask077 narrowed two newly created directories to0700; an independently reviewed recovery bound the exact empty-directory identities and original receipt, repaired only their modes, and completed installation without erasing history.

Normal idle operation has no timer or polling scan. Known transient failures can arrange one bounded causal retry after a real admitted event; publication arranges one finite reconciliation for its HTTPS-recreation gap. GitHub does not automatically redeliver general receiver outages, so outages outside that finite reconciliation can still require explicit redelivery. The event queue is bounded, and no automatic retention daemon is installed. These limits remain explicit; this result is not a permanent zero-maintenance or owner-acceptance claim.

### Remaining acceptance

[Independent visual qualification 41991249579](https://github.com/Nirvana-Chow/lifeos-app/actions/runs/41991249579) failed its visual matrix/browser step. Its full capture/history work remains open; release eligibility does not imply visual acceptance. The owner has not accepted the real-account interface. Post-native failure recovery has not been qualified by this successful release. Business work was paused for this CI/CD task; the owner subsequently requested continued feature delivery after routine-path verification.
