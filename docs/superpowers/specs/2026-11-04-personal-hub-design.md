# Personal data workspace refinement

## Intent and decisions

The owner's 2026-11-04 corrections extend the existing unified-business-ui work. LifeOS connects tasks, projects, areas, calendar and life stages, journal, training, sleep, health and finance. A task-led navigation shell is not the product goal. The owner delegated implementation sequencing and requested parallel work, actual records and API/Skill parity. Internal synthetic fixtures remain verification only.

Continue the original five OpenSpec tasks and stable LO-* requirements. Do not mark implementation, deployment and owner acceptance as equivalent. Preserve all earlier unfinished requirements, including drag/drop, batch entry, recoverable deletion, renderer measurements and full runtime qualification.

## Approaches and reuse

Use existing fixed ReUI DataGrid, Radix Dialog, TanStack and the single PersonalService/controller. Native history already has scope/index fencing and draft protection. Extending it is smaller than introducing parallel/intercepted routing. ReUI already supports sticky headers and a bounded virtual viewport. Keep the one lock and fixed upstream notices.

References: [Radix Dialog](https://www.radix-ui.com/primitives/docs/components/dialog), [Next native history](https://nextjs.org/docs/app/getting-started/linking-and-navigating#native-history-api), [TanStack filtering](https://tanstack.com/table/latest/docs/guide/column-filtering), and the fixed source under third-party/reui. No dependency upgrade is needed for this slice. Live versions checked: Radix1.8.1, ECharts6.1.0, table9.3.1 match current stable; newer Next16.4.5/virtual3.14.26 are separate reviewed maintenance, not mixed into this correction.

## Shared interface contract

- Sidebar label is 事项; existing canonical page IDs remain tasks/projects/areas. Internal sections are 待办/项目/领域.
- Entire Settings is a controlled overlay. Opening preserves the current page, drafts, filters and scroll. Finite query projection uses modal=settings and a whitelisted panel; old settings/account bookmarks remain protected compatible entrances. Panel changes replace the overlay entry. Only a verified opener permits history.back; direct links close to a safe canonical background. Opening an overlay must not invoke the destructive leave-page draft discard.
- API panel begins with issued keys and one New button. One stable controlled dialog transitions create → submitting → reveal. Pending requests block dismissal; unknown results retain the existing read-list-before-retry message. Copy and Close remain in reveal. Key bytes never enter URL/history/storage. Closing/pagehide/unmount clear them. Rotation never automatically revokes the old grant.
- Add a public, credential-free Skill download and copyable install/use instructions in the API panel. It uses the same reviewed operations registry as discovery, with explicit implemented scope. Sharing the Skill never shares a credential. Each user issues their own key.
- Requirements use one baseline and selectors for table/board/Gantt. Compact goal/current step, filters and short rows; descriptions, criteria, blockers and references belong in an ID-selected detail dialog. Fullscreen toggles layout without remount. No generic schema/formula platform or new mutation writer.
- Requirement Gantt is reachable now. All items lacking explicit planning dates remain in 未排期 and open their same details. Phase order and todo dueOn do not define a duration. No sample intervals or guessed dates.
- Bounded workspace views hold heading/toolbar above a min-height:0 remaining content viewport. ReUI headerSticky and its native virtual viewport handle tables. Lists scroll rows under fixed headers. Board columns hold fixed headings with their own card scroll regions. Do not break overview/long-form scrolling or footer reserve.

## Real records and integrations

Use the user's explicitly supplied key only through local macOS Keychain. Keep actual records/evidence outside Git. Discovery first; no silent grant widening. Read all pages or report truncation. Project/area creation and batch classification need implemented scopes, preview/commit, revisions, idempotency and readback before execution. Never use SQL or browser sessions to bypass unavailable operations.

Calendar can read this Mac's seven visible calendars through the installed EventKit tool; a bounded date window is coverage, not whole-history sync. Journal already has PersonalService CRUD; drafts/autosave must reuse its CAS/receipts. Xunji has training/body/food/plan contracts to verify; it is not evidence of sleep/HRV/Apple Health coverage. Apple Health needs device export or a separately authorized iOS connection. Qianji has no verified API and its source migration remains incomplete. These facts constrain integration work, not the visibility of the requested modules.

New persistence, business scopes or production SQL are separate concrete reviewed stages. Preserve closed defaults, owner/space checks, MFA, restricted roles and all proposed-migration gates. Do not fabricate data or claim unconnected modules complete.

## Acceptance

Real-browser desktop/mobile and both themes verify settings from a filtered/scrolled/draft-bearing page, Escape/outside/Back/Forward/focus, nested key creation/reveal/copy, pagehide cleanup, safe legacy deep links and busy/unknown guards. Readonly requirement views share filters and stable IDs; every undated record remains visible in Gantt. Long board/table/list content scrolls without moving its toolbar/header. Source tests, exact build, independent review and exact-SHA CI precede routine authorized delivery. Owner reviews the deployed site with verified records.
