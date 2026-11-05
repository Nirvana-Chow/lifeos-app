# Requirements table refinement — 2026-11-05

Scope: the existing LO-REQ-001 UI refinement, tracked in [Issue 30](https://github.com/Nirvana-Chow/lifeos-app/issues/30#issuecomment-6658805425) and the sole `unified-business-ui` checklist (1.2/3.1/3.2). The requirements Agent mapping remains under 9.7; this slice adds no operation, scope or data capability. No task or owner-acceptance state is changed.

Source base: `e29c5bf38696531aa84cc77a71e3765a19a8761e`, isolated branch `codex/requirements-table-refinement-20261105`. The remote default branch and HEAD matched that base at preflight. The existing untracked `node_modules` symlink was preserved.

## Cause and minimal changes

- The six configured data columns total 1090px. With native column resizing enabled and no fill column, ReUI puts all additional width into an empty filler. The existing local `DataGridColumnMeta.fillWidth` implementation now assigns that space to the title column. No table replacement or dependency change is required. Native resizing remains enabled; the existing documented trade-off applies: title resizing is visually compensated while free space remains.
- Requirement title buttons had no `data-slot`, so the shared shell's `button:not([data-slot])` rule painted each as a bordered input. A scoped native-button slot excludes them from that fallback. Titles remain buttons with their original accessible names, click handling and focus restoration. The title is visually primary and its stable ID is secondary without reducing the accepted font scale or row target.
- Native fill cells do not receive the column's cell metadata. The requirements module sets semantic border colors on every table header/body cell, including the filler, avoiding default dark dividers in light mode.
- Requirements view controls use the existing muted/card/border tokens as a segmented control. Scoped selectors override the shell fallback. Sorting controls keep labels on one line without changing the existing desktop/mobile font and target-size split.

Reuse/reference: fixed, already-installed ReUI source in `src/ui-review/reui/data-grid.tsx` and `data-grid-table.tsx`; existing React 19.3.0, Next 16.4.1 and TanStack 9.3.1 lock remain unchanged. [MDN's specificity reference](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Specificity) confirms the shell attribute-selector precedence; removing the fallback match for the native title button and narrowly increasing requirements selector specificity avoids global changes. The `ui-ux-pro-max` focused UX search recommended readable mobile text, internal table overflow and token-based contrast; the existing design system is retained.

## Verification

The previous synthetic browser fixture omitted `.lo-shell` and `review.css`. It now loads the actual shell cascade, header/sidebar/content allocation, semantic theme and real requirements components. It remains public-metadata-only internal verification, with no account service, credentials or real records.

Test-first evidence:

- Against the unchanged implementation, the new checks reproduced a 1px title-button border across all six size/theme combinations, empty wide-screen filler strips and unthemed native-cell dividers. Typography and existing behavior checks continued to pass.
- A screenshot review exposed the same cascade overriding segment borders and making the compact desktop header 53px tall. Added measurements failed on those specific symptoms before the final local selector fixes.

Final commands and results:

```sh
RUN_REQUIREMENTS_BROWSER_TESTS=1 LIFEOS_TEST_CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node --test test/requirements-multiview-browser.integration.test.ts
# 29 passed, 0 failed, 0 skipped; 31.1s

node --test test/requirements-page.test.ts test/requirements-navigation.test.ts test/requirements-planning.test.ts test/requirements-roadmap.test.ts
# 16 passed, 0 failed, 0 skipped

npm run typecheck
# exit 0

git diff --check
# exit 0
```

Browser coverage: 1920×900, 1365×900 and 390×900, each in light and dark mode; no page horizontal overflow, internal mobile table scrolling, compact single-line desktop header, title target and border/background, themed native-cell dividers, zero-width filler, selected view segment, native metadata-column drag resize, existing filtering/grouping/sort control, board and honest undated Gantt, detail open/expand/close/focus containment/restoration. Existing 390×400 cases retain first/last record reachability in table/board and access from the undated Gantt. No page errors were observed. Local ignored screenshots were inspected at wide desktop, 14-inch representative width and phone sizes in both palettes, including final 1920/light and 390/dark table images.

## Limits and handoff

Only the requirements view, its module CSS, its browser test and this note changed. Shared shell/workspace CSS, data/API/Agent/Skill/configuration/permissions and real data were not modified. No push, host, CI, production action or migration was performed by this worker. Full-suite/build/fixed-SHA CI, independent integrated review, deployed-site/version readback and owner experience acceptance remain with the root delivery path. These local synthetic results do not prove real-account persistence, current deployed appearance or owner acceptance.
