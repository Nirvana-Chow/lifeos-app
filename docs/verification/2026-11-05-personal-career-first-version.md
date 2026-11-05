# Personal career first version — leaf verification

Scope: `LO-LEARNING-001` / execution Issue #13, timeline Issue #8 and links Issue #33, after owner intake `fd2e24a`. Leaf based on `3caa9279ff6bee41159be8654f83758b334f5f74`, branch `codex/career-first-version-20261105`. Central routing, API grants/discovery/Skill, source locks and release remain root-owned.

## Implemented leaf

- Strict complete-write `career` schema version 1: education, employment, achievement/life experience, resume versions and opportunities/JDs. Original prose and long JD text stay in outer `{title,text,occurredOn,personal}`. No personal fact source was read or migrated.
- Unknown organization/degree/title/dates stay null. Source date precision stays `YYYY`, `YYYY-MM` or `YYYY-MM-DD`; ongoing/ended/unknown range states are explicit. No fabricated dates, contacts, qualifications, application events or scores.
- Controlled `CareerFields` edits original facts, evidence URLs/record pins, organizational links, resume fact selection, JD requirement-to-fact mapping, gaps, actions and next-step dates. Existing unavailable reference pins remain visible until deliberately removed/replaced. Kind changes reset variant-specific fields and preserve source/organization links; `lockKind` supports root edit locks.
- `CareerBoard` groups six owner-entered states and delegates opening/moving records to its caller. `CareerMatch` separates requirements, exact fact evidence pins, unknowns and actions. `ResumePreview` prints only a selected resume's exact pinned education/employment/achievement facts, excludes changed/unavailable pins, escapes original prose, and isolates the cloned article from the rest of the workbench when printing.
- `careerPersonalReferences` derives `expectedKinds: ['education','employment','achievement']` for career evidence pins; caller input cannot supply this authority. Owner/space/type/current-source and subtype validation remain the root's single PersonalService writer responsibility.

## Reuse

Actual source fragment: Reactive Resume 6.1.0 at upstream `a53a86a4be6d57f59b6096b20e55744f811fbb76`, MIT (c) 2026 Amruth Pillai; adapted pure date presentation. Full original LICENSE and source/adaptation notes live in `third-party/personal-career/`. JobNest's fixed-SHA MIT workflow was reviewed; no code copied. No dependencies, backend, AI requests or model fees added.

## Executed checks

- `node --test test/personal-career-domain.test.ts test/personal-career-projection.test.ts test/personal-career-components.test.ts`: **14 passed, 0 failed**. Tests cover complete fields, unsafe URLs/authority fields, real dates/partial precision/order, source envelope, exact source/revision pins, board moves, unavailable evidence, unknowns and HTML escaping. Initial absence produced explicit red tests before leaf implementation.
- `RUN_PERSONAL_CAREER_BROWSER_TESTS=1 LIFEOS_TEST_CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node --test test/personal-career-browser.integration.test.ts`: **1 passed, 0 failed** with native Chrome, real Next rendering and synthetic inputs only. Flow: save partial-date ongoing education → choose its exact fact pin in resume → save JD mapping/gap/action → move saved opportunity to preparing → open record → isolated resume print clone. Verified desktop 1366×900 and mobile 390×844 dark theme; no page error, no page horizontal overflow, >=16px/44px mobile controls, and full-width responsive table caption.
- Browser investigation caught nested control names changing with textarea/option text; explicit accessible names now remain stable. Visual screenshot review caught a mobile table caption collapsing to 28px; a width regression assertion failed before the scoped CSS fix, then passed. Print assertion excludes the workbench/JD from the isolated printed article.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false`: **exit 0**.
- `git diff --check`: **exit 0**.
- Actual screenshots inspected at `.review-results/personal-career-desktop.png` and `.review-results/personal-career-mobile-dark.png` (ignored internal evidence, not delivery records).

## Integration contract and remaining gates

- Domain exports: `CareerPersonal`, `CareerPersonalFields`, `emptyCareerPersonal`, `validateCareerPersonal`, `normalizeCareerPersonalFields`, `careerPersonalReferences`.
- `CareerRecord = {id, sourceId, revision, fields: CareerPersonalFields}`. `projectCareerEntries(entries, spaceId, search?)` returns records plus `title`, `summary` and original `entry`; presentation projection is not an ownership gate.
- `CareerFields({value,onChange,options?,disabled?,lockKind?})`, with `options: Record<string,PublicEntry[]>` and career choices filtered to fact subtypes.
- `CareerBoard({records,onOpenRecord,onMoveRecord?,disabled?})`; callbacks receive the `CareerRecord`, and moves also receive the requested application state. Root must save through the existing writer and read back before updating records.
- `CareerMatch({record,records,onOpenRecord?})`; `ResumePreview({records,selected?})` defaults to the first explicitly saved resume, or accepts a controlled selected resume/null.
- Pending: root central integration, independent review, aggregate fixed-SHA CI/build, protected publication/runtime readback and owner experience acceptance. This leaf does not claim real-data access, production availability or owner acceptance. No full test/build was duplicated here; root consolidates those gates.
