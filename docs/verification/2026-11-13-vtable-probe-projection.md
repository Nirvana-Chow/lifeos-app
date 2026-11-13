# Historical renderer probe projection

Continue LO-TASK-001 and the sole `unified-business-ui` 1.2/2.1/3.1/3.2 mapping. The historical comparison remains pinned to `0371234b6b472790a4b1bc78a5869a2251fda68e`; no application, lock, workflow or baseline revision changes are part of this adapter correction.

## Observed boundary

At source `81b5e5a6471374d78fc968388561cfa50f79d18a`, required qualification passed. Current visual recovery, permit, all five browser groups and journal passed without skips, and the current renderer emitted its 24 raw benchmark samples. The later historical renderer stage failed with `BROWSER_STAGE_vtable-performance`. The global 118-image guard and artifact upload did not run; this is not a successful visual or production release.

The historical-probe producer removes the current helper's ReUI imports and substitutes the old renderer's canvas/accessibility checks. It previously left behind a newer middle-of-function column-settings preparation block. The generated old probe therefore called the removed `taskGridRoot` before its first sample. Restoring that import would also be wrong: the frozen VTable interface has no optional-column menu or ReUI grid root.

An isolated execution of the unchanged producer and its generated first sample reproduced the exact `ReferenceError: taskGridRoot is not defined` after navigation/theme checks, with the sample context closed. No browser, network or business service was used for that diagnostic. An initial diagnostic-VM omission of the standard `URL` constructor was corrected in the diagnostic environment and retained separately; the producer was unchanged throughout the successful reproduction.

## Bounded correction and checks

Only the historical projection removes the uniquely identified modern column-preparation span. It rejects duplicate/missing span boundaries and residual modern-only dependencies before writing the generated probe. The current helper and its strict seven-column oracle remain unchanged. The old canvas/accessibility checks, immutable receipt checks, seeding, measured interval, 100/1000 rows, both viewport/theme conditions and three cold/three warm runs remain.

The old renderer retains its original six canvas columns and five accessibility fields; this correction does not retrofit the modern completion column or describe those old fields as a seven-column renderer. The comparison still requires 24 samples per renderer, 48 in total.

Four producer regressions failed before the change and passed afterward with zero skips. They cover generated-probe closure, the actual first-sample boundary, rejecting duplicate preparation and rejecting unprojected dependencies. Synthetic application and lock bytes remain untouched.

Local original-UI/original-probe equivalence runs and the original Linux/PostgreSQL/TLS historical CI stage remain pending. The local machine has no Docker runtime, so a local memory-backed fixture cannot be reported as the original CI chain. Independent review, exact-SHA CI, publication/runtime readback and owner acceptance remain separate gates.
