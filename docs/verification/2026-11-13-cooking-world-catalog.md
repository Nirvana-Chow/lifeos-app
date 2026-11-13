# LO-COOK-001 world recipe catalog verification

Issue #45; sole OpenSpec `unified-business-ui` tasks 1.2/3.1/3.2 remain open.
Base: `85d60ec603bc235eb7f4d5c8f26799bb6a9c7d3e`. Business intake revision 3
was independently verified by root before implementation. This is an engineering
record, not a second business backlog or owner acceptance.

## Scope and sources

Add 20 distinct world recipes (377 total), with Chinese names, searchable original
names and visible regional labels. Reuse the same ten category controls,
ingredient matching, pagination and random selection. Preserve the original 357
HowToCook entries byte-for-byte, including all record pins. The original JSON
SHA-256 remains `eb661761dfe3fb3ababc9efd2264592de998ef8bc6cffa427dae9fad0c5c6ad9`.

The new dataset is separately licensed CC BY-SA 4.0. Each recipe links an immutable
Wikibooks `oldid`, contributor history and license, with an AI-assisted Chinese
adaptation label. `third-party/wikibooks/provenance.json` identifies all source
revisions and original wikitext digests. A second official MediaWiki API read by
all 20 revision IDs independently matched every recorded source digest. The
complete official license text and its SHA-256 are included. Images, nutrition
estimates and unrelated text are omitted. Missing servings and total times are
explicitly left unreported. Specific source inconsistencies and edits are
identified in recipe notes. No runtime external calls or new dependencies.

World recipes are reference-only. They have no recipe-association action, and
an authenticated request to the history route with a world ID returns 404.
The original HowToCook pin/domain/API and Agent permission contracts are unchanged.
A direct synthetic HTTP POST of a world pin returns 400 with zero stored rows or
receipts. Original recipe create/retry/readback/update/history behavior passes.

## Executed checks

- RED: the first three new world catalog/search/history-boundary tests each failed
  before implementation (world count 0 and missing original-name match).
- GREEN: `node --test test/cooking-world-catalog.test.ts test/cooking-catalog.test.ts test/cooking-filter.test.ts test/cooking-routes.test.ts test/cooking-log-native.test.ts test/cooking-log-agent.test.ts test/cooking-log-client.test.ts` — 33 passed, 0 failed, 0 skipped.
- `npm run typecheck` and `git diff --check` — exit 0.
- `RUN_COOKING_BROWSER_TESTS=1 RUN_COOKING_LOG_BROWSER_TESTS=1 LIFEOS_TEST_CHROMIUM_PATH='<native Google Chrome executable>' node --test test/cooking-browser.integration.test.ts` — 2 passed, 0 failed, 0 skipped.
- Browser coverage includes authenticated catalog and detail navigation, Chinese
  ingredient/category filtering plus original-name search, filtered random pick,
  regional search, source/license links, absent-amount disclosure, light/dark mobile
  layout without horizontal overflow, and original cooking save through unknown
  response/retry/refresh/readback. Existing desktop record layout checks remain.
- World details have no association action even with an actual synthetic writable
  cooking grant. The visible browse flow sends no mutations and no remote requests.
  Browser/server fixture processes stopped and fixture directory cleanup passed.

## Preserved development-only failure and diagnosis

The first browser run completed the new visible interactions but failed its
zero-mutation assertion because a newly navigated world-history 404 caused
`POST /__nextjs_original-stack-frames`. Two diagnostic reruns preserved that same
failure; no product fix or mutation filter was applied during those reruns.
The diagnostic request body identified React's `completeWork` -> `<script>` ->
root `Layout`; the console message was: “Encountered a script tag while rendering
React component.” React further explained that client-rendered component scripts
are not executed. The shared root layout's existing inline theme-initialization
script triggers the Next development error overlay on that 404 navigation. No
world-detail page error or business POST was observed.

Root approved the bounded test adjustment: the deliberately unsupported history
seed has no visible entry point, so assert its real authenticated HTTP GET returns
404, with the existing unit boundary test, rather than navigating the dev overlay.
All visible world interactions, original unknown-detail 404 navigation, and the
unchanged no-mutation/no-external-request assertions remain. Shared layout is
unchanged. The final browser run passed after this one test adjustment. This does
not claim the inherited shared-layout development warning is fixed.

## Outstanding delivery gates

No production build, deployment, real-data write, runtime permission change or
real-device owner acceptance was performed. Root owns independent technical
review, PR integration, one complete combined-main CI/build/publication/readback
cycle and business-status writeback. Synthetic checks do not substitute the
actual deployed site or owner experience. World recipe association remains
unsupported until its pin/Agent contract is separately designed and delivered.
