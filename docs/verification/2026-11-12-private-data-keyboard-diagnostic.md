# Private data keyboard diagnostic — DIAGNOSTIC_ONLY

## Actual failing source and preserved history

- Source/base: `995b864006b46c51d059b76fc7cc456fe6d86fcd`.
- [Run 43081609976, attempt 1](https://github.com/Nirvana-Chow/lifeos-app/actions/runs/43081609976), [job 130735444388](https://github.com/Nirvana-Chow/lifeos-app/actions/runs/43081609976/job/130735444388): the private visual group completed 70 cells, then failed with `family=private-data`, `width=430`, `theme=light`, `stage=keyboard`, `reason=AssertionError`. The run had four passing groups and one failing group. The failure supplied no keyboard metrics.
- The preceding finance capture correction and health typography correction made measurable progress (the earlier actual run stopped after 40 cells at health typography). This is a new observed stage; neither those fixes nor a local green run establishes that the complete private visual gate passes.
- The unchanged keyboard oracle focuses the Header theme button, presses `Tab`, presses `Shift+Tab`, and requires the theme button to be the active element, match `:focus-visible`, and have a non-`none` outline. The present patch retains all three conditions, key order, timeouts, capture cases and gate requirements.

## Evidence and scope

The actual `/personal/settings/data` branch in `app/personal/[...section]/page.tsx` renders `LifeOSWorkspace` with `state.status=unknown`, authenticated access with `writable=null`, and the existing unavailable-data title/message. Its main content has no interactive controls. The native synthetic fixture now renders that same component branch and uses Next's native `devIndicators:false` setting in its temporary fixture config; application configuration is unchanged.

In local macOS Chrome, a preliminary run with the dev indicator enabled moved mobile forward focus into `NEXTJS-PORTAL`. With only `devIndicators:false` changed, the forward `Tab` instead left the document (`document.hasFocus()=false`, active element `BODY`). In both runs, `Shift+Tab` returned to the theme button and the original assertion passed. Desktop forward focus moved to another application control. The exact CI failure remains unreproduced locally: browser-owned focus traversal is a demonstrated difference to measure, not a confirmed failing root cause.

The shared helper adds only a finite numeric projection before the existing assertion, carried by the existing bounded `PRIVATE_PRESENTATION_FAILURE.metrics` channel when that assertion fails. There are no new private-text capture allowances, attributes, class names, record identifiers, screenshots or arbitrary diagnostics. A whole-page focus trap would change nonmodal keyboard behavior and is not introduced.

The nine metric positions are:

| Index | Meaning |
| --- | --- |
| 0 | Initially, target is active (0/1) |
| 1 | After forward Tab, document has focus (0/1) |
| 2 | After forward Tab, active element kind |
| 3 | After backward Shift+Tab, target is active (0/1) |
| 4 | After backward Shift+Tab, target matches `:focus-visible` (0/1) |
| 5 | After backward Shift+Tab, target outline is non-`none` (0/1) |
| 6 | After backward Shift+Tab, document has focus (0/1) |
| 7 | After backward Shift+Tab, active element kind |
| 8 | After backward Shift+Tab, target is disabled (0/1) |

Active element kind is exactly `0=target`, `1=BODY`, `2=another application element`, `3=other`. The existing collector retains its maximum of nine finite bounded numeric metrics. The native fixture consumes this same helper, so it does not duplicate or replace the CI oracle.

## Executed verification

Environment: Node `24.18.0`, pinned Next `16.4.1`, pinned Playwright `1.64.1`, installed Google Chrome on macOS. This is a local headed-capable Chromium executable launched headlessly by Playwright, not the Linux CI browser environment.

```sh
RUN_PRIVATE_NATIVE_VISUAL_BROWSER_TESTS=1 \
LIFEOS_TEST_CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
node --test test/private-native-visual-browser.integration.test.ts
node --test test/private-business-browser-fixture.test.ts
npm run typecheck
git diff --check
```

- Final native Chrome regression: **1 passed, 0 failed, 0 skipped**. Original health/finance checks and their read-only/status-only guards remain. The added unavailable-data keyboard check passed all four widths (`1365`, `360`, `390`, `430`) in both themes. At mobile widths, its final metrics were `[1,0,1,1,1,1,1,0,0]`.
- Fixture cleanup independently reported browser stopped, server stopped, temporary root removed, and no cleanup failures.
- Existing focused fixture suite: **22 passed, 0 failed, 0 skipped**.
- Typecheck and diff whitespace check passed.
- No product source, API, registry, capture allowset, deployment or real business data was changed. No full application build is claimed for this test-only diagnostic slice.

## Remaining gate and next action

This is **DIAGNOSTIC_ONLY**. Independent review and a new fixed-source CI run are required. The old failing source is not blindly rerun. A new failure should supply the finite factor needed to distinguish browser reentry, active target, focus-visible or outline; it must be evaluated before selecting a product or test correction. The currently published version and unfinished private visual acceptance remain unchanged.

## Primary references

- [Next.js devIndicators configuration](https://nextjs.org/docs/pages/api-reference/config/next-config-js/devIndicators): the native `false` option hides the development indicator. The locally pinned Next type also accepts `false`.
- [WHATWG sequential focus navigation](https://html.spec.whatwg.org/multipage/interaction.html#sequential-focus-navigation): focus can pass to browser controls when document candidates are exhausted. Returning from browser controls follows browser/platform conventions.
- [WCAG Understanding No Keyboard Trap](https://www.w3.org/WAI/WCAG21/Understanding/no-keyboard-trap): keyboard users must be able to move focus away; the whole document is not turned into a modal focus trap to satisfy this diagnostic.
- [MDN Document.hasFocus](https://developer.mozilla.org/en-US/docs/Web/API/Document/hasFocus): an active element alone does not establish that its document has focus.
- [Playwright Keyboard](https://playwright.dev/docs/api/class-keyboard): key dispatch provides the native Tab/Shift+Tab input; it does not make browser chrome traversal identical across platforms.
