# Design

## Context

See [proposal.md](proposal.md). The existing private workspace and business workbench share record services but have separate shells. This change carries their approved theme, navigation and table implementations into one application source tree. [tasks.md](tasks.md) is the sole active execution checklist for this mapped change; inherited implementation status is distinct from fresh validation and delivery.

The public repository has source-only CI and a synthetic exact-target configuration. It has no production deployment authority. Private requirement records, operational policy, credentials and deployment identities do not enter these artifacts.

## Goals / Non-Goals

**Goals:** preserve the approved interface, one authoritative record/save adapter, exact access boundaries and all unfinished rendered/performance/delivery acceptance while maintaining one source entry point.

**Non-Goals:** configurable table/schema/formula products, new data integrations, a second task writer, a new chart engine, device-session policy, database migration/GRANT, production trust changes, paid components or external fonts.

## Decisions

1. **Continue the existing visual language.** Use neutral surfaces and one indigo action accent rather than a new template. Light tokens are background `#FAFAFA`, surface `#FFFFFF`, foreground `#18181B`, muted text `#52525B`, border `#E4E4E7`, action `#4F46E5`; dark counterparts are `#09090B`, `#18181B`, `#FAFAFA`, `#A1A1AA`, `#3F3F46`, `#A5B4FC`. Retain measured contrast thresholds. Use local Chinese-capable system fonts, 16px body/forms, 28px desktop and 24px mobile titles, 18px sections and 14px metadata; spacing is 4/8/12/16/24/32/48px, with 8px control and 12px surface radii. Scope global styles to protect native controls and portals.
2. **Share one root appearance lifecycle.** Keep `lifeos-ui-theme`, validated light/dark/system values and the existing pre-paint initialization. A root runtime owns storage/system synchronization; both Headers subscribe to the same state. This avoids mount-local controls diverging or settings being required for system changes. Storage denial applies the current-document choice and reports the persistence limit without changing permissions or caching.
3. **Compose current business pages.** Preserve canonical controller routes and journal editor guards. Resolve complete private path segments through a finite typed map and invoke the existing server owner/MFA reader; unknown or extra segments return 404. Private shell links receive explicit destinations. Do not initialize unavailable AI/chat/import transports, consume synthetic query modes or call review-only version APIs from business pages. Keep existing review purposes and honest unavailable states.
4. **Use the approved free ReUI primitives.** Reuse the public upstream source and full MIT attribution recorded in `third-party/reui/provenance.json` and `third-party/reui/LICENSE`. Retain the reviewed TanStack versions (`@tanstack/react-table` 9.3.1 and `@tanstack/react-virtual` 3.14.25) in the single npm lock unless a separately reviewed update is adopted. Existing Radix/shadcn primitives and small local adapters supply controls; ECharts remains the chart engine. A second live renderer or replacement CRUD system would duplicate lifecycle and save responsibilities.
5. **Retain the authoritative editing adapter.** The grid consumes the original stable records, source IDs, revisions, writable/blocked state and save callbacks. Keep receipt matching, frozen retry commands, unknown/conflict handling and retained drafts across virtual remounts. Native status/date controls, first-character typing and Chinese composition remain regression targets. Read-only projections use the shared record grid without a save writer. Do not restore excluded demonstration pages merely to satisfy tests.
6. **Keep the comparison and rendered gates intact.** Use the fixed previous-renderer source only as a baseline, without importing private history or maintaining another application. Match synthetic fields, saves and guards. Measure 100/1000 filtered rows (103/1003 total with the original three-record guard), 1365-light and 390-dark, three cold and three warm samples per condition. Report raw samples and median/min/max; no unsupported p95, 10k-row or native-OS-IME claims. Correctness/cleanup failures and missing samples keep task 2.1 open.
7. **Preserve isolated-fixture security.** Rendered acceptance uses fresh synthetic PostgreSQL/TLS/browser fixtures, never an owner profile, cookies or personal records. Preserve the original three authoritative receipts, 180-second recovery case, 300-second recovery approval and cleanup-before-memory-only handoff. Do not serialize authentication, renew approval or mutate MFA state to make fixtures pass. Any test-only GET/HEAD allowance for `/review/admin/reference` and `/review/admin/articles/workspace` stays exact, with default fixture and production edge policy unchanged; other paths, APIs and methods remain denied. Artifact routes/names and synthetic records require explicit allowlists.

## Risks / Trade-offs

- Global styles can alter portals, focus or narrow layouts → check computed geometry and real desktop/mobile interactions in both themes.
- Table replacement can discard drafts or change save authority → retain controller/receipt lifecycle tests and execute persisted save/refresh/re-login readback.
- Source-only green checks can be mistaken for a running product → report source, build, isolated integration, browser, deployment and owner acceptance separately.
- Public fixtures omit operational tools and deployment authority → report unavailable checks accurately; do not copy private tooling, weaken exact-target validation or invent a source/manifest receipt.
- A source transfer can lose outstanding work → retain the original five task IDs and open acceptance, including unrelated original business work outside this change.

## Migration Plan

Transfer reviewed file deltas into the public tree without private Git history; manually preserve public package metadata/scripts, anonymous fixtures, layout and CI boundaries. Retain complete upstream attribution, refresh the dependency inventory from the exact lock and verify no removed renderer remains installed.

Run focused behavioral regressions, full tests/types, a default-closed webpack build, checks against that same compiled output, strict OpenSpec and applicable isolated PG/HTTP/MFA/recovery qualifications. Record unavailable manifest/browser/TLS/performance checks explicitly. Obtain independent source/privacy/license review and exact-SHA PR/CI evidence; source qualification is not completion of tasks 2.1, 3.1 or 3.2.

Production handover requires a concrete versioned source/control candidate, exact protected target validation, qualified build identity, current-runtime readback and compatible recovery/rollback preparation. Installing or enabling the new source trust boundary requires its specific approval. Do not change production configuration or migrate real data as part of this source transfer. Owner experience acceptance remains independent after any approved release.
