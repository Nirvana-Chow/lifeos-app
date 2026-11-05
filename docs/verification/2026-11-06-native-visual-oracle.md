# Native closed-surface visual oracle alignment

This is a bounded continuation of LO-OPS-001 / LO-VERSION-001 and the existing `unified-business-ui` tasks 3.1 / 3.2, based on `f262f49a07dbfb249a23c596ec3789340a444436`. Original task status, failed CI attempts, runtime gates and owner acceptance remain unchanged.

## Problem and change

The independent full visual matrix still exercised removed finance draft/filter forms and a legacy inline health set form after those routes adopted their native business workbenches. Its finite capture-source list also omitted the native components, rejecting the actual finance heading. The recovery fixture intentionally enables only its original five record types; health and finance remain closed there.

Align those two visual surfaces to their actual closed state: native creation remains disabled, no editor form appears, refresh reads only module status, health view selection stays local, and unavailable text fits the content width. The mobile finance navigation check uses the actual LifeOS dialog and retains close/focus restoration. All 96 existing case names and paths remain unchanged.

The screenshot-source allowlist adds four exact source files needed by these two native surfaces, plus the single exact rendered compound `新增健康`. It does not admit prefixes, arbitrary paths, unknown response text or private record bodies. Existing handoff, original-three-receipt equality, anonymous/forged/expired-session denial, no-store, zero-business-write and credential/capture guards are unchanged.

## Verification

- RED: the actual finance workbench heading was rejected by the old finite capture guard; real Chrome stopped on the removed health `添加一组` action.
- GREEN: 19 focused capture/privacy/SSR tests pass, including accepting the real finance heading and rejecting appended unknown financial text. The source-path and credential/body-negative cases remain.
- Real native Chrome: four widths (1365 / 360 / 390 / 430) × both themes × two native modules, 16 surfaces. Closed-state interaction, exact capture text, unknown-text rejection and mobile navigation/focus pass with zero non-GET requests and only status endpoints requested. Browser, server and temporary-root cleanup all pass.
- `npm run typecheck` and `git diff --check` pass.
- Default `npm test`: 1602 tests, 1545 passed, zero failed, 57 explicitly opt-in skipped. The new browser check is one of the defaults-off cases and was separately enabled above; the other skipped integration/visual conditions are not accepted by this result.

The optional browser test uses real application components in a disposable local Next server and intercepted synthetic status responses. It does not use a real account, private data, production API or database and is not owner delivery evidence.

Run the scoped browser check with:

```sh
RUN_PRIVATE_NATIVE_VISUAL_BROWSER_TESTS=1 LIFEOS_TEST_CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node --test test/private-native-visual-browser.integration.test.ts
```

The original complete 96-cell TLS/PostgreSQL presentation/capture matrix and its rendered contrast, typography, geometry, performance and image review still require their own exact-source workflow result. This local result does not assert that entire matrix passed, nor that the website was deployed or accepted.
