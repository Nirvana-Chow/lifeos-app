# Device login duration qualification

EXEC-SESSION-001 / LO-SEC-001 / LO-AUTH-001; the original [OpenSpec checklist](../../openspec/changes/device-login-duration/tasks.md) remains the execution entry.

The fixed application candidate f98378e105d5c0812058b8621043239b8f6890df normally merges main02a with Login and the reviewed shared a106/af225 seams. Public full tests:2341 pass,0 fail,95 explicitly opt-in skips; typecheck passes. The exact final private15 composition passes17 native/session/startup/readiness tests,2 private alias/runtime consumers,4 actual OAuth page consumers and types. Its full webpack build has BuildID `NPiN3A7Ee5_LtVh-3WQ44`; the same artifact passes44 platform,8 OAuth,10 device/MCP/account closed-boundary and5 Notes consumer checks. These are development build/in-process checks, not deployed HTTP or database evidence. No dependency or lock changes.

The added opt-in browser suite executes the actual login, OAuth consent/continuation pages, page-state, official signed-query verifier, HTTP consent boundary and native BetterAuth password/TOTP handlers. Only the synthetic memory database, platform runtime port and OAuth provider port are fixtures. It blocks external browser requests and keeps original rate limits enabled with a separate native Auth/database per scenario.

```sh
RUN_SESSION_DURATION_OAUTH_BROWSER_TESTS=1 node --test test/session-duration-oauth-browser.integration.test.ts
```

The pre-shared370e source produces expected behavioral RED for stale-session redirection and definite401 continuation; its unknown-result protection still passes. Final source passes4 tests/0 failures/0 skips, including actual native password and TOTP200 responses, exact signed-query restoration,401 rejection without provider dispatch, and one submission after unconfirmed consent/continuation with disabled repeat controls. Browser/Next processes and each unique temporary fixture are cleaned in `finally`, then independently checked absent. Initial fixture-only localhost normalization and cross-scenario native rate-limit interference are retained as failed evidence; the fixture now uses the original request boundary and separate synthetic databases without changing product guards.

Root independently approved the public session source and private three overlays, and another independent reviewer approved the shared seams. Private PR746 is source-only and preserves its original fixed product hashes and alias. Original public191118 PostgreSQL17.11 qualification covers native cookie/database expiry, runtime/read-only roles, immutable authentication age and sensitive SQL freshness; a subsequent SQL comment correction leaves execution/prosrc unchanged. It is not a rerun of private overlays or new shared readiness.

The browser/test/document addition changes no application, dependency, SQL or overlay bytes, so the exact f983 application build evidence remains applicable to those bytes. Final main CI, shared readiness actual PostgreSQL, controlled migration/flag/profile adoption, original Native/HTTPS readback and owner experience acceptance are tracked separately. Proposed0024 is never automatically applied by this feature PR.
