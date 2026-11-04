# Proposal

## Why

LifeOS has two workspace shells with inconsistent controls, typography and appearance behavior. This change continues the approved shared-interface and ReUI work in the single application source tree, retaining its existing task identifiers and unfinished acceptance rather than opening a second product backlog.

## What Changes

- Use the VS Code Modern light and dark color hierarchy as the palette baseline for business pages, forms, tables and dialogs.
- Use one labeled sun/moon button in the shared header. The first visit follows the system, and a click switches between light and dark.
- Focus the primary workspace on Overview and Todo. Use double-click or keyboard activation to edit a single task field and a separate expand action to open directly editable details. Keep sidebar and Header stable while content scrolls, embed password and API-key pages in the same shell, and preserve destinations in the URL. Overview summarizes pending/due/overdue tasks and active projects with links to complete views. Move categories into Todo and keep only account actions in centered Settings. Hide unfinished links and the old generic record-management entry. Existing journal bookmarks still lead to a focused editor.
- Use the fixed-source free ReUI Data Grid for current editable and read-only tables, retain the authoritative record/save adapter, and remove VTable runtime and type dependencies. The previous renderer remains a fixed comparison baseline, not a second active implementation.
- Preserve the original five-task execution mapping. Shared theme and navigation implementations carry inherited completion status; equivalent renderer measurements, rendered integration and final delivery remain open until their full evidence exists.

## Capabilities

### New Capabilities

- `workspace-interface`: A coherent, responsive business interface with reachable private navigation, Header appearance controls and consistent record-table behavior.

### Modified Capabilities

None. Existing authentication, record editing, persistence and recovery contracts remain authoritative.

## Impact

Changes affect global theme/layout, workspace shells, shared controls, business styles, ReUI/TanStack adapters and synthetic regression fixtures. Existing APIs, ownership/MFA, no-store, stable IDs, revisions, CAS, command receipts, drafts and recovery semantics remain intact.

This source transfer does not authorize production configuration, credentials, real-data migration, external data transmission or a new deployment trust boundary. Public source CI qualifies source only; production handover and owner experience acceptance remain separate gates. Traceability continues under LO-UI-001, LO-REQ-001, LO-TASK-001 and LO-PRIVACY-001 without importing private requirement records or repository history.
