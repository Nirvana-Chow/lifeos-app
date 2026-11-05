# Private native route oracle calibration

Issue 30 / unified-business-ui, source base f622faf5cf066198d83e706abfb28184b61da173.

Required qualification run 42071910538 attempt 2 reached the final private route boundary group, then failed before completing any route. The fixture retains the original five record types including journal. Native module navigation now correctly exposes its journal link, but the historical test required zero links. The same oracle still expected placeholder headings/actions on the newly implemented native health, people, finance and calendar pages.

This change calibrates that finite test contract: the exact granted journal link, current native headings, and exact disabled-module states with disabled native creation controls. It retains the anonymous/forged/expired-session, foreign query, no-store, source-receipt, zero business mutation and legacy-route denial checks. No product, dependency, workflow, database, runtime or authorization change is included.

Verification:
- Read-only reproduction with exact fixture status: actual journal links 1, obsolete expectation 0.
- `node --test test/private-business-browser-fixture.test.ts test/owner-modules.test.ts`: 21 passed, no skipped tests.
- `npm run typecheck`: passed.
- `RUN_PRIVATE_NATIVE_SURFACE_BROWSER_TESTS=1 LIFEOS_TEST_CHROMIUM_PATH=<native Chrome> node --test test/private-native-surface-browser.integration.test.ts`: passed, desktop 1365/light and mobile 390/dark; all four native closed surfaces on navigation and reload; only status GET requests; no page errors. Temporary fixture browser/server/root cleanup verified.
- The initial focused fixture exposed a duplicate Next route-announcer alert, then a synthetic SSR-ready mobile click before hydration. The final oracle scopes the module alert and the fixture waits for the actual status-driven journal link before clicking. Earlier failed logs remain retained privately.
- Scoped independent review: no P1/P2; no privacy gate relaxation.

Not yet evidenced by these local checks: final real TLS/PostgreSQL qualification, production publication, owner experience acceptance. The separate full visual matrix still contains legacy interactions and capture-source allowlists and remains unverified; this patch does not claim that matrix passed.
