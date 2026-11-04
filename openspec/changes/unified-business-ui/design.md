# Design

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
3. **Group content by intent.** Keep Overview and Todo in the primary navigation. Put category management in Todo and limit Settings to password, API keys and sign-out. Center the settings group within the available workspace width. Help explains everyday Todo actions. Hide unfinished Calendar, Journal and More Business entries. Retained Calendar and old data-management bookmarks show concise states in the primary shell. The existing protected journal editor remains reachable via its canonical bookmark, shares the appearance preference and shows only journal actions and records.

4. **Use the approved free ReUI primitives.** Reuse the public upstream source and full MIT attribution recorded in `third-party/reui/provenance.json` and `third-party/reui/LICENSE`. Retain the reviewed TanStack versions (`@tanstack/react-table` 9.3.1 and `@tanstack/react-virtual` 3.14.25) in the single npm lock unless a separately reviewed update is adopted. Existing Radix/shadcn primitives and small local adapters supply controls; ECharts remains the chart engine. A second live renderer or replacement CRUD system would duplicate lifecycle and save responsibilities.
5. **Retain the authoritative editing adapter.** The grid consumes the original stable records, source IDs, revisions, writable/blocked state and save callbacks. Keep receipt matching, frozen retry commands, unknown/conflict handling and retained drafts across virtual remounts. In Overview, double-click the title, press Enter or F2, or use the visible edit button to open the existing full editor inline. Use a separate expand control for read-only detail. Preserve focus, the discard guard and retained request handling across both layouts. Native status/date controls, first-character typing and Chinese composition remain regression targets. Read-only projections use the shared record grid without a save writer. Do not restore excluded demonstration pages merely to satisfy tests.
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
