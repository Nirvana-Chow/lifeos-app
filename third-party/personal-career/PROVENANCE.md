# Personal career reuse

- Project: [Reactive Resume](https://github.com/reactive-resume/reactive-resume), formerly `AmruthPillai/Reactive-Resume`.
- Reviewed version: package.json `6.1.0` at fixed upstream commit `a53a86a4be6d57f59b6096b20e55744f811fbb76` (checked 2026-11-05).
- Source: [`packages/schema/src/resume/dates.ts`, `formatResumeDates`](https://github.com/reactive-resume/reactive-resume/blob/a53a86a4be6d57f59b6096b20e55744f811fbb76/packages/schema/src/resume/dates.ts).
- License: MIT, Copyright (c) 2026 Amruth Pillai. The complete unmodified upstream LICENSE is retained beside this file.
- Actual reuse: `src/personal-career/resume-dates.ts` adapts the start/end/present formatting fragment. It uses the stored date's precision and explicit range state, substitutes Chinese labels, and explicitly renders unknown dates. It does not infer `Present` from a null end date. It omits locale parsing, schema upgrades, unstructured HTML and mutable resume-data visitors.
- The rest of the LifeOS career model, controlled editor, status-board projection, JD evidence table and print preview are native small compositions. No Reactive Resume server, package, font, sample resume, image, model integration or dependency is bundled.
- Compatibility: React 19.3.0 / Next 16.4.1 already installed in LifeOS. The reused helper is pure TypeScript with no dependencies or side effects. Reverting this leaf removes the adaptation; existing general inbox storage is unchanged.
- Also reviewed [JobNest](https://github.com/maerzhase/jobnest) at `0b62523b77b7f05332ce96cd2f2b4d6c3af5cac1` for stage/next-step workflow; its fixed-SHA LICENSE is MIT, Copyright (c) 2026 Markus Märzhäuser. Its desktop/database architecture is unnecessary for the existing PersonalService writer; no code or assets copied. No AGPL source copied.
