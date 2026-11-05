# Owner review: usable requirements and matters first

The owner reviewed actual source release `8ccc33d` and requested a denser desktop, better dark colors, editable requirements and practical matter interactions. This is actionable feedback under the existing delivery authorization. The cleared broad Goal, paused Agent implementation and unfinished calendar drafts are not automatically resumed.

## Product order

The owner subsequently clarified the immediate priority: make shared business API access usable for different AI clients before the website Agent. Prioritize current todo/organization read/write, the actual key/runtime and portable instructions; requirements/matters UI may progress independently. Then migrate supported old LifeOS repository data and deliver persistent requirements plus usable journal, calendar, health, finance and people modules with matching API/Skill input and output. Personal context, retrieval and an autonomous Agent come afterwards. Keep identity, permissions, storage, source/version/relations and the operation registry as the shared core; extend business modules within the existing application. A third-party plugin loader, sandbox or marketplace is not needed for these business modules.

Website AI and a user's own AI client are two later entry points over the same authorized data and tools. Neither creates a second writer or a separate fact store. Existing Agent/framework/MCP candidates remain recorded, with their unfinished gates.

## Visual and interaction decisions

Retain the shared Chinese workbench, system font and current mobile experience. At desktop widths >=1024px, target body14px, metadata12px, headings22px, controls32px, rows40px, header52px and sidebar208px; refine using real1366×768/1440×900 rendering at100% browser zoom. Mobile body/input16px and touch44px stay. This implements the owner's density intent without CSS zoom or disabling browser zoom.

Reuse semantic tokens and the existing appearance lifecycle. Offer three curated Radix3.0.0 palette families (slate/indigo, sage/teal, mauve/violet), each with light/dark variants: six complete appearances. Preserve system/light/dark choice and first-paint/cross-window/storage-denied behavior. Keep business topic data separate and name it as business labels. Remove the unnecessary question-mark help entry. Each preset requires measured readable contrast, focus and selected/hover states; no claim that copied base colors alone are tested.

Requirements use a one-line goal and compact current/next/later stage line, with search/view/actions together and extra filters disclosed on demand. Target <=128px for this page's top controls and >=8 readable rows at1366×768. Table and board group by phase. Priority P0/P1/P2/P3 and phase colors retain text. Genuine dates drive Gantt intervals; unscheduled items remain visible and grouped, with no invented dates. Long descriptions and engineering evidence belong in detail. Expanding detail uses the content region, preserving sidebar and background state.

Create-todo remains a dialog. Project and domain selectors are immediately visible and optional. New-todo UI omits topic controls; existing topics survive other edits. Complete appears before title in the table. Native table column-order/visibility controls must use stable column IDs so edits cannot switch fields after reordering.

Reuse the fixed MIT ReUI Kanban with its keyboard/mouse/touch sensors and commit/cancel hooks. Status drops call the existing authoritative writer once; receipts and subsequent reads drive projected state. Escape, failure, conflict and unknown outcomes never fabricate a successful move. Provide an explicit move menu as an alternative. Card/column arrangement may initially be a clearly scoped browser view preference; this is not shared business ranking and must not be reported as such. Persistent status movement remains a real service operation. Scrollbars are narrow but discoverable and draggable.

## One persistent requirements pool

Keep all34 public stable IDs, sources, evidence and acceptance facts. Add typed private requirement records through PersonalService and its existing PostgreSQL inbox writer, history, idempotency and CAS. Do not repurpose todo/journal or remove synthetic-only guards. Merge public requirements and private new/overlay records server-side into one visible pool. Private user prose never enters public Git or Issues automatically.

Public-item edits bind the exact baseline version/item version/content digest; one long-lived owner+space+public-ID identity prevents duplicate overlays. Use deterministic identity and transaction locking/unique enforcement through the same service. A changed baseline becomes a visible conflict, never silent overwrite. Ordinary edits cover title, body, phase, priority and actual optional planned dates; source/evidence/acceptance remain independently authoritative. Editing cannot manufacture implementation or user acceptance.

Owner create/update use existing MFA, same-origin, write permit and current owner checks, complete fields, idempotency keys and version readback. Large text is bounded by the existing16K-character/128KiB request limits and never silently truncated. Browser recovery is secondary to PostgreSQL, not authoritative storage. Unknown writes retain the exact frozen command; account changes clear visibility appropriately.

Add matching scoped requirement operations to the same registry, discovery, Skill and downloadable artifact. Requirements permissions are distinct from todo/organization. Preserve legacy catalogs and old issuer modes. New permission SQL stays proposed and exact-target guarded until its concrete runtime package is qualified/authorized; unavailable new grants do not disable independent owner/UI source work. New keys do not automatically gain future scopes.

## Separate security and real-data follow-through

The new credential supplied in chat is never echoed, committed or put in command arguments. Verify its scopes through an approved secure runtime before claiming it usable. Preserve the immutable old readonly runtime and old key until replacement validation; no global Keychain access changes. A per-request authentication prompt is not a desired workflow.

Read a complete current real-todo snapshot before classification. Produce project/domain/duplicate proposals with exact IDs, fields/revisions, evidence and unresolved targets. Batch execution requires supported preview/approval/atomic commit and current permissions; no cookie/SQL bypass. Keep genuine data analysis separate from UI qualification fixtures.

Record owner-session/IP/device visibility under existing security requirements. Reuse native BetterAuth through a secret-free owner DTO, not raw session tokens. Valid sessions, recent activity and actual online counts differ. A loopback-normalized address is not a real client IP. Cross-account statistics require an explicit administrator boundary and are not silently exposed in this slice.

## Reuse evidence and acceptance

Use existing TanStack9.3.1/ReUI column features and fixed ReUI source `067aa0dc7f8bbfec1cd76fc5ad31f842be5f569a`. Native Kanban requires exact MIT `@dnd-kit/core6.3.1`, `sortable10.0.0`, `utilities3.2.2`; retain source/provenance/full license and the sole lock. This necessary mature component supersedes the older UI phase's no-new-dependency constraint for this feature only. Do not update unrelated React/Virtual patches as a side effect.

Primary references: [Radix scale roles](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale), [palette composition](https://www.radix-ui.com/colors/docs/palette-composition/composing-a-palette), [shadcn semantic tokens](https://ui.shadcn.com/docs/theming), [fixed ReUI Kanban source](https://github.com/keenthemes/reui/blob/067aa0dc7f8bbfec1cd76fc5ad31f842be5f569a/registry-reui/bases/radix/reui/kanban.tsx), [fixed MIT](https://github.com/keenthemes/reui/blob/067aa0dc7f8bbfec1cd76fc5ad31f842be5f569a/LICENSE.md).

Canonical intake: LO-UI-001/LO-REQ-001/#30, task/project#5/#7, API#35, security#3 and AI#19. Continue original unified-business-ui task IDs/status and personal-agent-foundation9.4/8.x; requirement persistence is an explicit extension, not a duplicate UI checklist. Test source boundaries and native PG, render real Chrome at mobile/desktop in both themes, independently review, qualify fixed SHA CI, publish the authorized part and read it back. Owner experience remains owner-provided.
