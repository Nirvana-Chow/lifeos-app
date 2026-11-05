# Appearance presets and scheduled Gantt — source slice

Continues LO-UI-001 and LO-REQ-001 under the existing `unified-business-ui` change, and LO-TASK-001/#5 / LO-SCHEDULE-001/#12 under `personal-agent-foundation` task9.3. This is a partial implementation record, not a new backlog or completion of the original rendered, delivery or owner-acceptance gates.

## Behavior

- General Settings shows the existing three paired palettes as visible native radio choices with color swatches. The existing document theme store, first-paint initialization, system/light/dark selection, storage-denied notice and cross-window synchronization remain authoritative. Typography and browser zoom are unchanged; swatch labels inherit body text rather than adding small captions.
- Scrollbars use native `scrollbar-width: thin`, with a 6px WebKit fallback. No custom scroll controller or dependency was added.
- Requirements Gantt draws only saved, valid start/end pairs in chronological order. A missing endpoint, invalid calendar date or reversed interval remains accessible in the table; the Gantt shows only its compact unscheduled count. A same-day interval remains visible. Calendar days are parsed at UTC midnight, without local-time conversion or inferred dates.
- Todo and Projects expose Gantt with a clear empty state and a guarded return to their table. Current task records supply `dueOn` only; current project records supply no planning dates. Neither deadline, stage nor record order becomes a fictional interval. Their real scheduling fields and persistence remain outstanding under task9.3.

## Executed checks

- RED: the new interval tests failed against the previous projection (partial dates were drawn; invalid input could throw). GREEN: `node --test test/requirements-planning.test.ts test/workbench-theme-runtime.test.ts test/personal-workspace-editing.test.ts test/workbench-theme.test.ts` — 36 passed, zero failed/skipped.
- `npm run typecheck` and `git diff --check` passed.
- `RUN_APPEARANCE_GANTT_BROWSER_TESTS=1 LIFEOS_TEST_CHROMIUM_PATH=<native Chrome> node --test test/appearance-scheduled-gantt-browser.integration.test.ts` — one enabled case passed. Actual `LifeOSWorkspace` and `RequirementsGantt` used only explicit in-memory synthetic records and local GET/HEAD requests. No screenshots, real records or network writes.
- Chrome measured unchanged desktop body14px and mobile body16px; mobile palette targets48px. It verified palette/dark selection and reload persistence, native thin scrolling, todo/project empty Gantt and table return, and one actual complete requirement interval versus two partial dates and one undated item. Zero page errors and zero attempted network writes. Browser/server exit and temporary-root cleanup all succeeded.
- The first browser attempt used the wrong test-only navigation name (`项目` instead of the existing accessible `项目分类视图`); only that locator was corrected before the passing run. Final source subsequently wrapped the two table-return callbacks in the existing departure guard and repeated focused tests/types. No product assertion was relaxed to obtain the browser pass.
- Existing density browser selectors now target native palette radios; their geometry/contrast/board assertions remain intact. The requirements multiview test retains filtering, detail/focus and capture assertions while requiring undated rows to be absent from the Gantt and reachable through its table action.

## Remaining qualification

This slice has no production build, full browser matrix, deployed-version readback or owner acceptance. The broader existing visual qualification remains separately unverified; this short interaction case does not replace it. Exact-source CI/build, independent review and controlled release are performed by the coordinator. No dependency, owner API, shared writer, database, grant, real data, CI workflow or deployment controller changed.

Coordinator refinement: actual Chrome first reproduced four requirement rows for one complete interval (three undated/partial rows were incorrectly still stacked under the chart). The view now renders only the scheduled row, keeps a compact undated count and a return-to-table action, and colors bars by existing phase tokens. Same-day bars stay inside the track. Integrated-source checks passed: the enabled short Chrome case (one scheduled row, zero undated/partial rows, unchanged palette persistence and mobile geometry), all36 focused cases, types and diff check. Broader rendering and deployed-owner acceptance remain open.
