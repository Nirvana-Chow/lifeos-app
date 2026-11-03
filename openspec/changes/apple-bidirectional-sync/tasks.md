# Tasks

This change continues the approved server-canonical, editable-Apple direction. Candidate source evidence and live activation remain distinct. No checkbox implies real synchronization, device authorization, background execution or owner acceptance.

## 1. Reconciliation contract

- [x] 1.1 Implement strict loss-aware observations and native capability/identity contracts, deterministic three-way field merge, semantic hashes, verified echo prevention and safe disappearance assessment; prove unknown/null, independent/same-field edits, atomic recurrence/alarm fields, ID churn, limited coverage and unsupported writes with behavioral tests.

## 2. Authoritative server candidate

- [ ] 2.1 Add default-off transaction-bound capture and additive owner-RLS proposed sync state; preserve existing business services, atomic history/outbox/receipt/mapping, ordered cursors, one bridge lease and fencing. Add bounded active-delivery state with globally monotone versions, exact CAS/binding and only its column-level grant/readiness. Test rollback, foreign ownership, stale fences, ordered publication and replay; do not apply live SQL or GRANT.
- [x] 2.2 Implement a narrow service adapter and default-closed bounded API for capabilities/preview/lease/read-only pull/observation/prepare/claim/fresh claim authorization/never-claimed retirement/receipts/ACK using trusted principal and independent write gates. Persist current-canonical immutable deliveries before replying; distinguish historical replay from execution authority, cursor from canonical revision and issued retirement from claimed uncertainty. Prove the original independent-field/old-snapshot timeline, reply loss, claim-vs-retire, no-op and later canonical edits. Route incoming supported changes through existing business services in the same transaction; preserve unsupported fields as evidence/conflicts. Keep authentication/device provisioning separate and no cookie copying or client-asserted ownership.

## 3. Manual bridge candidate

- [x] 3.1 Implement atomic durable intent/evidence state, original shared-writer fence injection, snapshot/capability checks, manual preview and recoverable replay with synthetic native/server adapters. Persist stable claim request and claim receipt before exclusive native-applying, and server receipt before ACK. Prove create-unknown does not recreate, historical claim cannot renew save authority, ACK loss retries the same command, no-op still reads back, only readback advances baseline and corrupt/epoch-changed state blocks. Claimed precondition/fence uncertainty remains explicit; do not claim automatic recovery for it.
- [x] 3.2 Document the bounded API/capability contract for Skills and clients, native CLI limits, exact source/synthetic evidence and activation prerequisites; no general SQL/command execution or implicit device grant.

## 4. Qualification and complete acceptance

- [ ] 4.1 Complete focused/full tests, types, default-closed build/compiled-route checks, strict OpenSpec, applicable synthetic PostgreSQL/HTTP qualification, independent security/data-correctness review and exact-SHA PR/CI. Preserve the UI change's separate unfinished gates and existing work.
- [ ] 4.2 Complete native-field and business-model coverage for the approved two-way scope, including reminder timed dates/alarms/status and event recurrence/occurrence/time-zone/terminal semantics; qualify a lossless native adapter. Unsupported native operations must stay explicit; source stubs and lossy CLI JSON do not complete this task.
- [ ] 4.3 After specific candidate approval, activate registered scoped device identity, the original writer handover, approved real schema/data scope and optional background bridge. Verify website→Apple→phone edit/completion→website refresh/relogin, offline replay, no duplicate/echo, conflict/deletion/reopen/date/DST/recurrence exceptions and isolated restore. Publish only through the qualified controlled path and read back the running version; owner experience remains separate.

## Workflow follow-up

- Source checkpoint: focused service/HTTP/manual-journal and actual-business-service synthetic loops were independently reviewed; full local suite, types, default-closed build/compiled checks and strict spec passed. Actual PostgreSQL qualification, exact-SHA CI and full native/live acceptance remain open in 2.1/4.1/4.2/4.3. No checked source task claims a native adapter or runnable credentialed transport exists.
- Do not archive or report complete two-way synchronization while native, identity, real-data, release or owner gates lack evidence.
- The existing UI five-task checklist and original source requirements are not replaced by this change.
