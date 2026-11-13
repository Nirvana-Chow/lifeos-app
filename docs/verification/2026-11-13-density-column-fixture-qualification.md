# Density fixture column profile

Continue LO-TASK-001, Issue #5/#30 and the sole `unified-business-ui` 1.2/3.1/3.2 mapping. The product's content-aware column defaults remain unchanged. This correction only prepares the intended full-field synthetic density profile explicitly.

## Failure and bounded diagnosis

At public source `b28df94351d4033d6f70d798db2c7512c685753d`, both required and visual qualification stopped in their early native Chrome batch: 39 passed, two failed and zero skipped. Both density fixtures switched to a fresh owner scope containing no project/area references, then expected the project header without selecting it. The new default correctly omitted that empty column. Later PostgreSQL/recovery/presentation steps did not run in those failed jobs and are not credited.

The two unchanged tests were reproduced locally with native Chrome before modification: zero passed, two failed, zero skipped, with the same project-header expected-one/actual-zero error. The earlier performance fixture defect and correction are preserved in the [original follow-up record](2026-11-13-todo-empty-reference-columns.md); that correction established explicit choices for the performance profile but missed the duplicated density scope assumption. This is a continuation of the same fixture diagnosis, not a reset of its failure history.

## Assumption audit

A search across all native/browser fixtures and helpers, together with the 22 test files that reference the todo grid, distinguished these cases:

| Fixture or consumer | Intended profile and action |
| --- | --- |
| Strict `task-grid-browser-driver` oracle | Exact seven labels and seven semantic cells remain unchanged. |
| Task-grid performance fixture | All seven fields remain explicitly selected before filtering and outside the measured interval; its reviewed uncheck/check setup is retained. |
| Personal workspace and private-business handoff | The original saved synthetic todo includes both project/domain references; the handoff verifies those references before the strict seven-column oracle. No change. |
| Two density fixtures | Empty references start with five default columns. Explicitly select both relationship columns before the existing hide/reorder/edit checks and in the second scope's full-field density profile. |
| Task-grid layout fixture | Deliberately checks five defaults, explicit sixth column, refresh, reset to five, and all seven after references arrive in four desktop/mobile theme cells. No change. |
| Settings, roadmap, classification and native editor lifecycle | Todo checks use bounded viewport/title/status/due/stable IDs rather than positions of optional reference columns. No change. |
| Category and requirements grids | Separate table consumers; their project/header/position assertions do not refer to the optional todo relationship columns. No change. |

## Minimal correction

The shared browser-test helper opens column settings and performs a real uncheck/check for each relationship column. This records explicit `true` even when a checkbox was already checked by a content-derived default. It performs no business write.

Both density fixtures retain the original completion-first, stable status/title editing, refresh, project-header, contrast, typography, row geometry, mobile and board/receipt checks. They now also check the fresh scope's five-column default, explicitly establish its seven-column profile, return to the first scope to verify its hidden project and reordered status, and return to the second scope to verify its independent visible project. No synthetic relationship was invented and no product default, assertion threshold, workflow or timeout was relaxed.

The local verification ran the same two early qualification commands with the existing native Chrome executable: the public-auth theme case passed 1/1, then the original five-file UI batch passed 41/41 in 86.3 seconds, both with zero failures, cancellations or skips. Both original failing density scenarios and their later board/receipt, row geometry/scroll, contrast, theme and mobile checks executed. The 15 focused component/strict-oracle tests and whole-application typecheck also passed. Product sources and both original strict seven-column predicate/DOM-oracle functions are byte-identical to the base.

These are local native-browser results. Independent review and subsequent fixed-SHA CI/runtime delivery remain separate and pending. No new full 48-sample benchmark, production operation or owner acceptance is implied.
