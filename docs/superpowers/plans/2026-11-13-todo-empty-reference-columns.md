# Todo empty reference columns implementation plan

> **For agentic workers:** Use the existing isolated implementer and one independent review before root integration. The parent serializes main and delivery.

**Goal:** Avoid two empty relationship columns in the default todo view while retaining explicit column choices.

**Architecture:** Reuse ReUI/TanStack's existing controlled `columnVisibility`. Only project and area receive content-aware defaults; existing editable columns and stable column IDs remain unchanged. Persist explicit boolean choices in the existing owner/space-scoped layout preference.

**Tech Stack:** Existing React 19.3.0, TanStack Table 9.3.1 and fixed ReUI source; no dependency changes.

**Spec:** Existing LO-TASK-001 desktop empty-column acceptance, Issue #5/#30 and the sole `unified-business-ui` 1.2/2.1/3.1/3.2 mapping. This is a small follow-up to the full-width title-column slice, not real-data classification or parent completion.

## Design and reuse

- Keep the established light/dark semantic tokens, system Chinese font and desktop/mobile sizes. No new colors, visual containers or motion are needed.
- Default: hide project/area only when the current displayed rows have no corresponding saved reference. The column menu remains the place to show them explicitly. Existing task detail and organization editors remain reachable.
- Explicit `true` and `false` take precedence, including after refresh. Old valid `false` preferences retain their meaning; order/visibility validation and scope isolation remain.
- A column becoming empty never changes records or discards a draft. Editable title/status/due and required completion remain available.
- Alternative considered: always retain empty columns, which leaves the reported gap; a replacement table or record classifier is unnecessary for this view-only change.
- Official [v9 column visibility guidance](https://tanstack.com/table/latest/docs/framework/react/guide/column-visibility) confirms the existing controlled boolean map remains supported. The installed 9.3.1 implementation already supplies the feature; no upstream update or new atom is needed for this small adaptation.
- Preserve the strict existing seven-column browser oracle. The existing complete-field/performance fixture explicitly selects both relationship columns before that oracle; a new focused fixture checks content-aware defaults separately.

## Constraints and review focus

- No API, permissions, schema, source baseline, real records, private runtime, CI workflow or shared OpenSpec edits.
- Explicit visible overrides must survive refresh; omitted preferences must continue adapting as references arrive.
- Scope switches use the new scope's defaults before loading its preference and never show a prior owner's choice.
- Native title editing, column reorder, focus/draft guards and zero layout-related business writes remain.
- The parent requirement remains in progress and owner acceptance is separate from all engineering evidence.

## One independently reviewable slice

- [x] Add failing component tests for empty references, existing data, explicit choices, refresh and scope isolation.
- [x] Make the smallest consumer-side visibility/default/parser changes in `task-grid.tsx`.
- [x] Make full-field browser fixture choices explicit without changing its strict seven-column oracle.
- [x] Run focused tests, whole-app types, strict OpenSpec and four synthetic desktop/mobile light/dark browser cells with zero writes.
- [ ] Commit with the public repository identity and hand off exact source/evidence for independent review; root alone integrates and publishes.
