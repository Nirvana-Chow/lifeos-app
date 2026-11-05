# Task/project planning — implementation checkpoint

Continues LO-TASK-001/#5 and LO-SCHEDULE-001/#12, `personal-agent-foundation` task9.3 and the original unified interface gates. This is not completion of deployment or owner acceptance.

## Contract and compatibility

- Todo fields accept optional `plannedStartOn` / `plannedEndOn`; project fields accept them inside `personal` metadata. Values are real ISO calendar dates or null. Missing endpoints are valid incomplete planning; only a complete, ordered pair is drawn. Deadline, project stage and record date never supply an endpoint.
- Legacy canonical payloads keep missing keys missing. Read projections expose missing dates as null. The original five required todo fields and four organization fields remain required; the two new date keys are optional. Explicit null clears an endpoint.
- `preserveOmittedPlanning(type, inputFields, previousDraft, nextDraft)` preserves only planning keys absent from the raw update, then validates the resulting pair. The coordinator integration invokes it after the existing update CAS inside `PersonalService`, without adding previous data to the original request/idempotency digest. Receipt replay still returns its historical result before deriving any new draft. Configuration and HTTP runtime remain unchanged by this integration.
- Update receipt matching allows only omitted new keys to be preserved; submitted dates/nulls remain exact constraints. Creates cannot acquire unsubmitted dates. Unknown retries retain the exact original key/body. Agent operation IDs/scopes are unchanged; registry descriptions and portable Skill/generated references describe the additive fields and individual readback.

## Owner interface

- Existing TaskEditor and project record form use native date controls, without a new writer. Title/status/deadline cell edits retain planning fields through the existing serializer and receipt bridge.
- Complete current-snapshot projections carry saved dates into todo/project Gantt. Gantt displays complete intervals only, with a count and table entrance for incomplete records. It does not render an incomplete-record card list. Dates and targets retain existing typography/control tokens; no appearance or dependency change is included.
- Planning-related todo saves require an individual authenticated GET before installing the new projection. Wrong identity/source/revision/body, failed readback or cancelled/late responses do not add a bar. Failed/cancelled readback requires a fresh snapshot before another write. A newer authoritative read is preserved instead of installing its older receipt; confirmation of the original command is separate from the latest projection.
- Project editing retains its original individual-record/history readback and full snapshot reload. Its Gantt projects the provided current projects; native category-table search/stage filters remain local to that table.

## Verification

- RED date/serializer/projection/readback tests were observed against the previous implementation.
- Core checkpoint `62a0db48dc41df4cd45387dc84dc3c0fcc47d89c`:27 focused tests, types and diff check passed; coordinator service hookup remains a separately owned integration.
- Current owner/editor/projection/Agent/Skill focused suite:88 passed, zero failures/skips. It includes real calendar/ordering/partial/null/legacy behavior, exact command recovery, readonly/owner/lifecycle/ReUI cell regressions, held readback, malformed/source-swapped readback, later revisions and cancelled responses. `npm run typecheck` and `git diff --check` passed.
- Schema2's existing `draft jsonb` and native todo/inbox constraints support the additive fields; no SQL, permission, grant or record migration was changed or executed.
- `RUN_TASK_PROJECT_PLANNING_BROWSER_TESTS=1 LIFEOS_TEST_CHROMIUM_PATH=<native Chrome> node --test test/task-project-planning-browser.integration.test.ts`: one enabled case passed on its first run (13.7s, zero failures/skips/page errors). Actual PersonalPage/TaskEditor/project UI verified held individual readback before task-editor completion, save→interval→refresh, clearing one endpoint excludes the record, creating a scheduled task, and project edit→individual GET→Gantt. It made three individual todo reads, two project reads and four writes to explicit synthetic Node memory only. At360px the document had no horizontal overflow. Browser/server exit and temporary-root cleanup all passed; no screenshot was captured. The test waits for the existing theme runtime's ready control before exercising hydrated UI. This is not an owner-data or PostgreSQL persistence acceptance fixture.

## Remaining delivery

Coordinator service CAS hookup is implemented and independently reviewed. Its actual shared-service/MemoryPort regression observed RED without the hook and GREEN after restoring it; it covers todo/project omission preservation, explicit clearing, merged interval rejection with rollback, and historical receipt replay without overwriting a later revision. The focused integrated service/contract/client suite passed25/25. The combined default suite passed1376 tests, with45 explicit integration opt-ins skipped and zero failures; typecheck and diff check passed. Two navigation-only VM harnesses gained the exact new Gantt child import mapping so they continue to exercise navigation, while dedicated planning/browser cases verify the Gantt itself. Exact-source CI/build, controlled runtime readback and owner acceptance remain open. No production build, live record, credential, host operation or deployment is claimed by this source checkpoint.
