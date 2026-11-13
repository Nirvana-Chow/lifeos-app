# Todo empty reference columns

This is the LO-TASK-001 view-only follow-up under Issue #5/#30 and the sole `unified-business-ui` 1.2/2.1/3.1/3.2 mapping. It builds on public base `b689437d2dd964e85b4ba02e610d7064b4c975da`.

The default todo table now hides project/area columns when none of the displayed rows has that saved reference. Explicit show/hide choices override those defaults and survive refresh in the existing owner/space-scoped layout preference. Title, completion, status, due date, detail, column IDs and business writers remain unchanged. This is presentation only; it does not classify actual records or complete the parent requirement.

## Verification

- Component RED: the original eight tests passed and the three new default/preference/scope tests failed on the missing behavior.
- Focused component, parent/native editor lifecycle and strict grid oracle: 31 passed, zero failures or skips.
- `npm run typecheck`: passed. The initial type inference error on indexing the visibility map was corrected with the existing `Record<string, boolean>` contract, without a runtime change.
- `OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1 CI=1 openspec validate unified-business-ui --strict`, CLI 1.16.0: passed. No shared checklist status changed.
- Explicitly enabled `test/task-grid-layout-browser.integration.test.ts`: passed, zero skips. The existing resize/reorder/draft/access/keyboard/mobile assertions remain. Four additional isolated native Chrome cells cover 1365/390px in light/dark: five default columns, explicit sixth-column choice, refresh, restoring defaults, and automatic reappearance after reference data arrives. All four had zero business writes and page errors; no document-wide horizontal overflow. Both desktop cells measured title width 643px and native filler width 0px.
- All four new synthetic frames were visually inspected. The established theme, desktop density and bounded mobile table scroll remain. They are internal verification, not owner previews.

The strict seven-column grid oracle is unchanged. The performance fixture explicitly selects all seven fields outside its measured interval, preserving its original comparison profile even when the filtered synthetic tasks have no references. This slice does not claim fresh 48-sample A/B performance results or a new private PG/TLS run.

Independent review of the initial source found a fixture-only defect: `.check()` on an already checked content-derived default does not fire a change event, so the old preparation did not persist explicit `true`. The fixture now performs `uncheck()` then `check()` for each relationship column before measurement. A regression executes that actual fixture block against the real TaskGrid component, preserving the browser checkbox no-op semantics. Initial related rows followed by unrelated filtered rows reproduced the failure (one pass, one failure); after the fixture-only correction, all 13 component tests passed with zero skips. Both initially checked and unchecked cases independently require persisted `project:true, area:true`. Product logic, the strict oracle, measurement interval and original review evidence remain unchanged; the previously passing product/native-browser evidence is reused, with no fresh full performance benchmark claim.

Independent review, exact-SHA CI, root integration, private publication/runtime readback and owner experience remain separate delivery gates. No API, grants, schema, real records, portable Skill, dependencies, CI workflow or production configuration changed.
