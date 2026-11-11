# Storage review Agent parity implementation plan

> **For agentic workers:** Use superpowers:executing-plans and test-driven-development. This slice inherits PR42 `f1df7d8ac08ac50fef4724f1c54db98bd3776ebc`; it does not replace its owner page.

**Goal:** Upload an explicitly supplied private checklist and read owner decisions through the same authorized API/MCP writer, without any filesystem action.

**Architecture:** Keep the existing owner/space singleton, platform identity/source/history and durable receipts. Add five closed Agent operations, registry-derived MCP schemas and portable Skill instructions. Only an explicitly selected all-personal-business policy, reviewed operation catalog and ready native storage can expose the new scopes; old explicit grants stay unchanged.

**Spec:** LO-FILES-001 / #41; unified-business-ui 1.2/3.1/3.2; personal-agent-foundation 9.7. New owner intake remains pending because the local credential path is unavailable; this is engineering tracking, not a replacement business backlog.

**Constraints:** Synthetic fixtures only; no new dependency, scan, real checklist/API, credentials, production SQL, automatic activation or deletion. Root serializes builds/integration and owns actual upload/readback.

**Review focus:** Preserve decisions across checklist revisions; reject altered decided objects; enforce current grant both around reads and inside transactions; replay historical receipts rather than infer outcomes; keep tagged storage records out of ordinary inbox routes.

- [x] RED/GREEN: Preserve unchanged decided items on a new checklist revision and conflict on changed/removed decided items.
- [x] RED/GREEN: Add exact snapshot/detail/create/checklist-update/decision-update API operations using the existing writer and scoped transaction fence.
- [x] RED/GREEN: Project the same commands, no-op/replay receipts and independent reads through shared MCP validation; no durable recovery is inferred from current state.
- [x] Publish matching generic Skill/operation references and a disabled registration proposal; preserve current runtime/permission activation gates.
- [x] Run focused tests, full default suite and types. Default suite: 1646 pass, 59 explicit opt-in skips, zero failures; new storage Agent cases: 7 pass. Opt-in skips are not acceptance.
- [x] Run the serialized webpack build and compiled default-closed handler checks; both passed. Independent initial review found no reproducible P1/P2 and ran 36 focused tests without skips.
- [ ] Obtain fixed-SHA independent review/CI and qualify the new fresh-PostgreSQL storage fence case without skips. Running release, actual private upload and owner experience remain separate.
