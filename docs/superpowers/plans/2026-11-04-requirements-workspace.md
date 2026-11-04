# Requirements and workspace refinement implementation plan

**Goal:** Make the development path visible in the existing private workspace and make Todo categories and API-key expiry understandable.

**Architecture:** Reuse the public requirement baseline as the sole product-roadmap data source, the existing finite workspace router, ReUI/TanStack grids and Radix dialogs. All record mutations retain the existing personal editor and authoritative revision/receipt controller. This is a refinement of `unified-business-ui`; its five original task IDs and inherited 2/5 state remain authoritative.

**Tech stack:** Existing pinned Next.js, React, TypeScript, ReUI/TanStack, Radix; no new dependency.

**Spec:** `openspec/changes/unified-business-ui/specs/workspace-interface/spec.md`; owner-approved refinement below.

## Approved refinement

The owner approved this scope on 2026-11-04: a requirement pool showing project goals, phases, development path, what exists, what remains and next steps; Todo/Projects/Areas sections with filters and tables; business topics in Settings; dismissible lightweight settings; equal-height API-key controls with duration and explicit expiry; proposed real-task categorization before writes. Calendar/Gantt remains an explicit future stage pending truthful start/end-date semantics. The owner additionally requires each new supported input feature to ship its Agent API, capability discovery and Skill together; existing todo-only grants must not be described as whole-system credentials.

## Global constraints

- Preserve owner/MFA, private no-store, finite route parsing, source IDs, revisions, frozen commands, one writer and dirty-navigation safeguards.
- Source implementation, automated validation, deployment and owner acceptance are separate facts. Do not mark baseline acceptance from code or CI.
- The public baseline contains generic product information and public Issue/PR/spec links only; no personal tasks, private deployment facts, secrets or raw conversation.
- Existing API grants last at most 365 days and support only advertised scopes. The UI must label any estimated expiry and show the issued server expiry as authoritative.
- A due date is not a start/end interval; do not fabricate calendar Gantt bars or personal task classifications.
- Reuse system fonts, Modern theme tokens, 44px controls, responsive grids and existing dialogs.

## Implementation slices

### Task 1: API-key expiry form

Files: `src/personal-candidate/account-api-key-expiry.ts`, `account-api-keys.tsx`, `account-api-keys.module.css`, existing expiry/browser tests.

Unify computed input/select height locally; keep native date/time selection with a full-width custom row. Show duration choices and an explicitly estimated expiry with timezone. Retain server duration validation, one-time reveal, scopes, issuance payload and revocation. Extend the synthetic browser geometry oracle and exercise it before and after the fix; test any new date-formatting calculation at month/year boundaries. No production credential creation from a synthetic fixture.

### Task 2: Requirements and development route

Files: `src/platform/requirements.ts`, `public-requirements.json`, new `src/ui-review/requirements-page.tsx` and its local CSS/tests.

Extend the existing baseline with optional roadmap metadata and existing stable product IDs. Preserve all six original requirements. Show ordered milestones, priority, implementation versus acceptance, next step, blockers and links to public Issues/PRs and original OpenSpec IDs. Search/filter and expandable acceptance detail use the same data, without a second backend or invented dates. Export `RequirementsPage()` for the host. Run meaningful baseline/selector/render tests before implementation and preserve the existing acceptance guard.

### Task 3: Category tables and shared workspace integration

Files: `src/ui-review/workspace.tsx`, `contract.ts`, `src/workbench/private-navigation.ts`, category grid component/CSS, `src/personal-candidate/workspace-data.ts`, focused route/data/browser tests.

Add the finite `requirements` destination and left navigation; hide task-create actions on this informational page. Replace the collapsed management entry with Todo/Projects/Areas tabs. Reuse ReUI sorting/resizing and explicit search/area/stage filters for project and area rows; each row has separate view-tasks and edit actions, and creation is explicitly labeled. Settings opens a lightweight topic browser dialog, lists saved topics and offers explicit create/edit links through the existing editor. Retain old project/area URLs, draft guards and account destinations. Category browsing acquires no new save authority.

### Task 4: Qualification and delivery

Run baseline and focused tests, complete unit suite, typecheck, default-closed webpack build plus checks against the same output, strict OpenSpec and dependency audit. Run synthetic Chrome checks for both themes, desktop and narrow widths, requirement navigation/filtering, category tables, topic dismissal and API-key geometry. Independent review must cover specification, code, privacy and rendered results. Create a PR associated with existing #5/#7 and the requirement IDs; fixed-SHA CI is required before the already-authorized routine main merge. Production delivery requires the existing private release path and verified runtime readback; public CI alone cannot deploy. Preserve explicit open benchmark, runtime and owner-acceptance gates.

## Review focus

Finite query parsing rejects arbitrary destinations; informational pages do not create tasks; unknown/partial personal snapshots do not show complete category counts; changed project references remain visibly stale; topic navigation cannot discard an active task draft; key expiry is estimated until the issuer replies; public requirement text never implies personal-data or production acceptance.

## Decisions

Prefer the existing baseline/grid/dialog composition over an external roadmap service: it avoids duplicate requirement authority, credentials and network dependencies. Dedicated category editors are unnecessary in this slice; saved records open their existing revision-aware editor explicitly. A calendar Gantt, broad automatic grant expansion and bulk merge are separate capabilities with missing data/authorization contracts; their requirements remain visible rather than being simulated.
