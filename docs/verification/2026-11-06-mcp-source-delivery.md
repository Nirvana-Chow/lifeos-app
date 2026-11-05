# MCP source delivery candidate — 2026-11-06

Continues LO-AI-001 and the API-parity work tracked by Issue #30 and the existing `unified-business-ui` checklist. No task or owner-acceptance status is changed. The integration base is `25764b5ccc4be3cc5fd9a36f66703de659159e2f`.

## Source scope

The already-reviewed source commits `9379039`, `236d955`, `1a5c9b7`, `ff6af1e` and `96572a6` were applied in that order. The public native-request seam adds complete canonical receipt checking, independent current-read verification, durable original-command/settlement recovery and local argument validation before updater/provider work. The six added or changed seam files match the reviewed public source exactly. The two todo-null schema corrections were already present in `96572a6` and were retained rather than applied twice.

Writes distinguish historical receipts from current state. Create receipts require revision1 and exact canonical business fields; PATCH retains CAS/source checks and omitted planning/workflow semantics. A matching GET cannot make an altered historical receipt valid. A later current revision is reported separately. Confirmed or completed durable commands recover through fresh authorization and GET without another business write; unconfirmed commands keep their original body/key. Lock recovery is explicit, requires an inspected unchanged digest and a proven-dead owner, and preserves the abandoned lock.

The stdio tool description and portable Skill explain those results without claiming an installed host. The default executable still exits with `MCP_CREDENTIAL_RUNTIME_UNAVAILABLE`. No host-specific executable, loader, manifest, configuration, credential or private journal is included or installed.

## Portable Skill release

The existing generators refreshed the allowlisted artifact. The operation reference remains byte-identical because the operation registry did not change. Changed document bytes require a new monotonic sequence; `2026110502` advances to `2026110601`.

- Archive release ID: `sha256:c97b97a996c412beb7787a83d83ad84db1ed2709c020446f23baf495ae3d8e1e`.
- Manifest SHA-256: `89246059770bc8b478ea0335038ddce3f9f9bb7cc22d9ae9cc9bc4ca605e01a4`.
- Archive size: 13,653 bytes. The same four public files remain eligible: LICENSE, SKILL.md and the two existing references. No executable transport or account material is added to the archive.

## Verification performed

- Own, real `node_modules` from `npm ci --ignore-scripts --no-audit --no-fund`; no borrowed or symlinked dependency directory. Node24.18.0, npm11.16.0, TypeScript6.0.2.
- Before the seam: 36 original MCP tests passed. The added full-receipt and local-validation cases first failed against that baseline, then passed after applying the reviewed seam.
- `node --test test/lifeos-mcp-*.test.ts`: **43 passed, 0 failed, 0 skipped**. Includes official modern/legacy stdio clients; complete 50-operation discovery tuples; schemas and real in-process synthetic Agent HTTP projections; POST/PATCH and public requirement overlays; classification approval/receipt/readback; semantic mismatch rejection; confirmed/complete restart recovery without resend; original-byte unknown recovery; dead/live-lock boundaries; default-closed CLI.
- MCP plus `test/agent-skill-*.test.ts`: **64 passed, 0 failed, 0 skipped**. Download, manifest, updater and generated-source agreement use the actual package. Removed one obsolete prose assertion that falsely required the MCP server to be unimplemented; executable default-closed behavior remains tested.
- `npm test`: **1,599 passed, 0 failed, 57 explicit opt-in skips** out of1,656. The skipped browser/PostgreSQL/network qualification is not acceptance and was not activated by this source task.
- `npm run typecheck`, Skill Creator `quick_validate.py`, lock guard, `git diff --check` and OpenSpec1.16.0 strict validation of `unified-business-ui`: passed. The sole checklist retains4/5 with delivery3.2 open.
- Official npm registry still reports SDK server2.4.0 as latest. The lock retains exactly the reviewed eleven added paths; all prior non-root lock entries are unchanged. All300 indexed provenance rows match the lock (including its existing null representation for absent metadata), all eleven additions are covered, and their installed versions/licenses match. The full retained SDK license matches all three actual installed SDK distributions at SHA-256 `0382b0057770ca05e9c350a50aa3b1c1fea84da0bc81d723bf00b9aa841be58a`. No additional dependency or license family was introduced.

The first post-seam run exposed old fixture expectations: altered catalogs now fail wholly, invalid input makes zero provider requests, an unconfirmed POST has no known ID to GET, and classification requires a durable preview manifest. Tests were aligned to those reviewed behaviors using complete receipts and the existing real HTTP handler; no approved seam code was weakened to satisfy old expectations.

## Remaining gates

This is a source candidate, not deployment or host adoption. Narrow independent integration review, fixed-SHA CI and root-controlled main integration remain required. No production build, host registration, Keychain access, live grant/API call, real record mutation, SQL, migration or production configuration was performed. Actual host qualification, current grant/revocation boundaries, controlled live operations and independent readback, and owner experience acceptance retain their separate evidence gates. Local synthetic coverage does not demonstrate that all50 operations are enabled or usable on the deployed host.
