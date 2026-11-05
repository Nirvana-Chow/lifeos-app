# Design

## Owner review refinement — 2026-11-05

Continue the original five task IDs and inherited status. The owner reviewed actual release8ccc33d and requested desktop compact density, curated paired palettes, practical matters and an editable single requirements pool. The binding [refinement specification](../../../docs/superpowers/specs/2026-11-05-owner-review-refinement.md) and [work plan](../../../docs/superpowers/plans/2026-11-05-requirements-matters-refinement.md) refine the shared interface; they do not restart qualification or create a replacement UI checklist. Mobile16/14/44 remains; the earlier all-width rule changes only for the explicit desktop preference. Preserve source, tests, deployed capability and owner acceptance separately. The cleared broad Goal and unrelated paused work remain stopped.

## Context

See [proposal.md](proposal.md). The existing private workspace and business workbench share record services but have separate shells. This change carries their approved theme, navigation and table implementations into one application source tree. [tasks.md](tasks.md) is the sole active execution checklist for this mapped change; inherited implementation status is distinct from fresh validation and delivery.

The public repository has source-only CI and a synthetic exact-target configuration. It has no production deployment authority. Private requirement records, operational policy, credentials and deployment identities do not enter these artifacts.

## Goals / Non-Goals

**Goals:** preserve the approved interface, one authoritative record/save adapter, exact access boundaries and all unfinished rendered/performance/delivery acceptance while maintaining one source entry point.

**Non-Goals:** configurable table/schema/formula products, new data integrations, a second task writer, a new chart engine, device-session policy, database migration/GRANT, production trust changes, paid components or external fonts.

## Decisions

1. **Map the Modern palettes to LifeOS.** Compare [VS Code Dark Modern](https://github.com/microsoft/vscode/blob/077bec303574782e7b6f09b94c761ca96c7068eb/extensions/theme-defaults/themes/dark_modern.json), [Light Modern](https://github.com/microsoft/vscode/blob/077bec303574782e7b6f09b94c761ca96c7068eb/extensions/theme-defaults/themes/light_modern.json), and [Obsidian Minimal](https://github.com/kepano/obsidian-minimal/tree/93321bdc23fc879966e1e3aa0cfeda77012f540f). Use Dark Modern's graphite sidebar, lighter content surface and quiet borders. Use its brighter blue for links and focus. Use a darker action blue when white button text needs stronger contrast. Use white content and light gray navigation in the light palette. Borrow Minimal's restrained sidebar-to-content contrast for records and reading. Keep one shared semantic token set and the existing ReUI controls. Use system UI fonts with local Chinese fallbacks and tabular numerals for metrics. Use consistent weight and line height for Chinese text without loading a remote font. If importing upstream code, pin its source and retain the applicable MIT notice.

   | Role | Dark starting point | Light starting point |
   |---|---|---|
   | Sidebar and header | `#181818` | `#F8F8F8` |
   | Content and table | `#1F1F1F` | `#FFFFFF` |
   | Raised surfaces | `#2B2B2B` | `#F8F8F8` |
   | Primary text | `#CCCCCC` | `#1F1F1F` |
   | Secondary text | `#9D9D9D` | `#616161` |
   | Links and focus | `#4DAAFC` | `#005FB8` |
   | Action fill with white label | `#005FB8` | `#005FB8` |

   Candidate pair checks give 10.26:1 for dark primary text, 6.08:1 for dark secondary text and 6.31:1 for white action text. Verify all interactive states again in the rendered application.

2. **Use one appearance action.** Render one accessible sun/moon button in the shared header. Give it a keyboard-visible focus ring, a 44px target and an accessible name describing the next appearance. Keep `lifeos-ui-theme`, the existing stored modes, system fallback, pre-paint initialization and cross-window synchronization. A click chooses the opposite of the effective appearance.
3. **Group content by intent.** Keep Overview and Todo in the primary navigation. Keep Todo, Projects and Areas as sections of Todo with shared ReUI category tables and explicit filtering, creation and editing actions. Put business topic browsing in a dismissible Settings dialog alongside account actions. Center the settings group within the available workspace width. Password and API-key pages reuse the same Header/sidebar and return to Settings; API-key management has no duplicate password navigation. Help uses three short numbered Todo instructions. The workspace occupies the viewport: only content and an overflowing navigation region scroll, while bottom sidebar actions stay reachable. Any separately installed filing footer overlays the content-width bottom edge and reserves its measured height inside the main scroll area; it must not create another document row. Isolate main content instead of the entire shell: main notifications and chart tips remain below body-portal dialogs, while shell navigation/help can cover the body footer. When a filing footer is present, reserve its measured height below Undo as well as content; preserve the normal mobile inset without counting the footer safe area twice. Normal workspace destinations update canonical URLs and support refresh/back/forward with existing draft guards. The native history subscription stays mounted across router commits; a ref updated in layout effect supplies its latest committed tasks and guards, so re-rendering cannot remove the listener during a restoration event. Overview clearly labels the limited Todo preview and links to all pending tasks; project summaries count and show only stage `active`, not every followed or planned project. Hide unfinished Calendar, Journal and More Business entries. Retained Calendar and old data-management bookmarks show concise states in the primary shell. The existing protected journal editor remains reachable via its canonical bookmark, shares the appearance preference and shows only journal actions and records.

4. **Use the approved free ReUI primitives.** Reuse the public upstream source and full MIT attribution recorded in `third-party/reui/provenance.json` and `third-party/reui/LICENSE`. Retain the reviewed TanStack versions (`@tanstack/react-table` 9.3.1 and `@tanstack/react-virtual` 3.14.25) in the single npm lock unless a separately reviewed update is adopted. Existing Radix/shadcn primitives and small local adapters supply controls; ECharts remains the chart engine. A second live renderer or replacement CRUD system would duplicate lifecycle and save responsibilities.
5. **Retain the authoritative editing adapter.** The grid consumes the original stable records, source IDs, revisions, writable/blocked state and save callbacks. Keep receipt matching, frozen retry commands, unknown/conflict handling and retained drafts across virtual remounts. In Overview, list and board cards, double-click the title or press Enter/F2 to edit only that title through the existing native field adapter. Do not retain a second full inline editor or pencil action. A separate expand control opens the existing detail dialog with writable fields immediately available; readonly sessions retain static detail. In the table, double-click edits the selected editable field and native ReUI/TanStack column resizing changes presentation only. Completion/reopen actions are available in all three existing views through the same status writer. Preserve focus, the discard guard and retained request handling across these layouts, including cancelled navigation and browser history. Native status/date controls, first-character typing and Chinese composition remain regression targets. Read-only projections use the shared record grid without a save writer. Do not restore excluded demonstration pages merely to satisfy tests.
6. **Keep the comparison and rendered gates intact.** Use the fixed previous-renderer source only as a baseline, without importing private history or maintaining another application. Match synthetic fields, saves and guards. Measure 100/1000 filtered rows (103/1003 total with the original three-record guard), 1365-light and 390-dark, three cold and three warm samples per condition. Report raw samples and median/min/max; no unsupported p95, 10k-row or native-OS-IME claims. Correctness/cleanup failures and missing samples keep task 2.1 open.
7. **Preserve isolated-fixture security.** Rendered acceptance uses fresh synthetic PostgreSQL/TLS/browser fixtures, never an owner profile, cookies or personal records. Preserve the original three authoritative receipts, 180-second recovery case, 300-second recovery approval and cleanup-before-memory-only handoff. Do not serialize authentication, renew approval or mutate MFA state to make fixtures pass. Any test-only GET/HEAD allowance for `/review/admin/reference` and `/review/admin/articles/workspace` stays exact, with default fixture and production edge policy unchanged; other paths, APIs and methods remain denied. Artifact routes/names and synthetic records require explicit allowlists.

## Risks / Trade-offs

- History restoration uses the native Navigation API index where available and a same-scope entry marker otherwise. On older browsers without that API, cancelling a completely unmarked pre-upgrade entry retains the current draft, URL and full router state without truncating Forward entries, but replaces that traversed legacy entry instead of reconstructing its unknown position. This compatibility fallback is not equivalent history-chain preservation.
- Global styles can alter portals, focus or narrow layouts → check computed geometry and real desktop/mobile interactions in both themes.
- Table replacement can discard drafts or change save authority → retain controller/receipt lifecycle tests and execute persisted save/refresh/re-login readback.
- Source-only green checks can be mistaken for a running product → report source, build, isolated integration, browser, deployment and owner acceptance separately.
- Public fixtures omit operational tools and deployment authority → report unavailable checks accurately; do not copy private tooling, weaken exact-target validation or invent a source/manifest receipt.
- A source transfer can lose outstanding work → retain the original five task IDs and open acceptance, including unrelated original business work outside this change.

## Migration Plan

Transfer reviewed file deltas into the public tree without private Git history; manually preserve public package metadata/scripts, anonymous fixtures, layout and CI boundaries. Retain complete upstream attribution, refresh the dependency inventory from the exact lock and verify no removed renderer remains installed.

Run focused behavioral regressions, full tests/types, a default-closed webpack build, checks against that same compiled output, strict OpenSpec and applicable isolated PG/HTTP/MFA/recovery qualifications. Record unavailable manifest/browser/TLS/performance checks explicitly. Obtain independent source/privacy/license review and exact-SHA PR/CI evidence; source qualification is not completion of tasks 2.1, 3.1 or 3.2.

Production handover requires a concrete versioned source/control candidate, exact protected target validation, qualified build identity, current-runtime readback and compatible recovery/rollback preparation. Installing or enabling the new source trust boundary requires its specific approval. Do not change production configuration or migrate real data as part of this source transfer. Owner experience acceptance remains independent after any approved release.


## Approved requirements visibility refinement (2026-11-04)

The owner-approved refinement is described in [the implementation plan](../../../docs/superpowers/plans/2026-11-04-requirements-workspace.md). Reuse `public-requirements.json` as the single generic product roadmap, with stable IDs and public Issue/PR/spec references. Its workspace page shows goals, ordered phases, priority, implementation versus acceptance, blockers and next steps. Phase order is not a promised calendar schedule. No personal requirements, tasks or production evidence enter the public source.

Todo exposes Todo/Projects/Areas sections rather than a management link that opens a new record. ReUI category grids provide sorting, column resizing, search and project area/stage filters; row actions separately view tasks or edit the saved category through the existing editor. Counts remain unknown on partial snapshots. Settings opens a saved-topic browser dialog which dismisses on outside click or Escape; explicit new/edit links retain the existing writer and navigation guard. It does not add a second mutation session.

The API-key form retains native controls and issuance validation, uses equal computed control height and a full-width custom date row, and separates estimated expiry in the local timezone from the authoritative issued expiry. Current grants remain todo-only and at most 365 days. Every future input-capable feature must include its scoped Agent operation, capability discovery and Skill reference; unsupported business grants and automatic expansion are not introduced here.

Calendar Gantt requires explicit planning start/end semantics; current `dueOn` does not supply a task interval. Real-task categorization and merge require a complete owner snapshot and reviewed per-record changes; no data is invented or changed by these UI projections. These capabilities remain visible future work.

References reviewed: [Radix Dialog](https://www.radix-ui.com/primitives/docs/components/dialog), [TanStack v9 column filtering](https://tanstack.com/table/latest/docs/framework/react/guide/column-filtering), existing fixed ReUI source and the pinned dependencies. No library update is necessary. OpenSpec official stable version checked as 1.16.0, matching the project pin.
