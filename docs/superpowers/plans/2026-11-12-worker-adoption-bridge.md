# Worker adoption and assigned MCP bridge

> **For agentic workers:** Use executing-plans and test-driven-development for this bounded slice.

**Goal:** Connect the existing owned native process and assigned four-tool channel to a pinned CLI, Node bridge and original business client, without activating a worker.

**Architecture:** A parent reserves one single-use slot and supplies exact reviewed runtime/qualification pins. Concrete preparation verifies those files, adopted-client metadata, current discovery and the assigned live fence, then produces fixed CLI/MCP argv. A separate pinned Node entry reuses the existing code gate, native peer attestor, channel and SDK server; its business adapter calls only the original client wrapper. Original receipts, payloads, keys and recovery IDs remain with that wrapper.

**Tech stack:** Existing Node24.18, TypeScript6, Zod4 and official MCP SDK2.4; original frozen Swift worker host and broker/client. No dependency update.

**Spec:** personal-agent-foundation5.2/5.4, LO-AGENT-001/#35 and the existing worker-host qualification plan. These tasks remain open.

## Constraints and review focus

- Own only new worker-host-adoption modules, dedicated tests/fixtures and this document. Do not change the original native host, registry, Skill, dispatcher or frozen client.
- Workspace-write and ordinary code editing/testing remain available. Four-tool restriction applies to LifeOS business authority; this is a cooperative same-UID boundary, not a hostile-code sandbox.
- No model, credentials, Keychain, real API, background service or production state is accessed by tests. Actual slots remain0.
- Exact root-reviewed qualification/evidence pins are required; JSON booleans cannot create authority. ChatGPT login status is not effective provider/route/budget evidence.
- Missing/changed client adoption, stale fence, reused slot, project configuration, changed closure and pending unknown results must fail closed.
- Native original-parent launch/cancellation and quarantine are retained. Exit0 does not establish a business result or release an uncertain slot.

## Implementation

- [x] Qualify the inherited adapter/durable-pending draft with focused tests; retain a three-operation wrapper adapter and private pending journal. Preserve original recovery IDs and never replay uncertain writes.
- [x] Qualify the inherited fixed-argv/preparation draft with focused tests; retain concrete slot reservation, checked runtime preparation, live discovery/GET fence checks and single-use launch composition.
- [x] Observe the missing-bootstrap failure, then implement/test the actual script and SDK stdio composition with synthetic executables, the reviewed code gate, native attestor, assigned channel and bounded original-wrapper calls.
- [x] Run focused original/new tests, types and diff checks, freeze reviewable commits and obtain independent review. No worker deployment or adoption.

## Source composition and focused evidence (2026-11-12)

Base `64599005868ebe7ec7a4d894915cce2900cc04b6` depends on the existing worker source/qualification slice (PR53). Root serializes integration; this branch owns only the adoption directory, its script/tests and this plan. The actual business client was subsequently adopted separately, but its current discovery still offers only todo business operations; requirements/event claims and real worker activation remain closed.

`scripts/lifeos-worker-bridge.mjs` is packaged as `worker-bridge-entry.mjs` under a future reviewed private bundle. The parent pins that entry/Node/manifest/gate and supplies one private assignment path plus SHA. Only built-ins load before binding integrity and the code gate. The gate is the exact pure-export source already reviewed in business57 (`code-guard.mjs`, SHA256 `56a7646977705a8d13d9a3be0c6cbfdd6f5d527a718cc45694d998fa6d1f9d98`), retained byte-for-byte here; no alternative code trust framework was introduced. Bundle layout reuses `public/src` and a closed dependency tree; the entry loads only the fixed `public/src/worker-host-adoption/bridge.ts` after gating.

The bridge composes `attestOwnedWorker`, `createWorkerChannel` and `serveAssignedWorkerStdio` directly. The original client remains the only business writer and receipt/body/key/recovery owner. Operator recovery is absent from the four model tools. Root-produced provider evidence pins are required rather than an approval boolean; actual provider/account/route/usage-budget qualification still has no production receipt here. The concrete `launchAdoptedWorker` uses the original `prepareOwnedWorker` and `startPreparedWorker` path, with no second process launcher.

Focused synthetic checks cover actual official SDK stdio, all four tool names, accepted-field preservation, unknown command/recovery retained across a process restart, peer loss, changed binding/gate/module/extra-code rejection, missing adoption, expired provider evidence, missing discovery, stale fence, one-use parent slots and prepare→owned launch. The synthetic host emits exit0, but the resulting business outcome stays `unknown`/non-reusable. No actual Codex/model/native-production worker or API was launched. No package/lock, shared channel/native source, CI or installed MCP configuration changed.

Type verification is scoped to adoption modules/tests with the existing Node24/TS6 dependencies: `tsc --ignoreConfig --noEmit --strict --target ES2022 --lib esnext,dom --types node --module nodenext --moduleResolution nodenext --allowImportingTsExtensions --skipLibCheck` followed by the adoption entry/test files. Two initial command-only attempts omitted TS6's explicit config opt-out and ambient Node/lib selection; the corrected scoped command passed without source changes. Whole-project build/full suite and live native/provider qualification are intentionally not claimed by this source slice.

CI declares Node24.22.1 while the private reviewed business client retains24.18.0. The bridge source accepts the repository engine >=24.18 <25; the root/native host still pins the actual executable/argv. A synthetic metadata-only24.22 bootstrap case was observed failing under the accidental24.18-only check, then passing after removing that redundant private-client minor restriction. This checks startup policy on actual24.18 APIs, not native24.22 execution; main CI remains the actual24.22 check. No runtime or dependency was installed or updated.

Independent review of the initial source found one Important launch timing gap: provider evidence could expire or the owner could revoke client adoption during a slow discovery/GET, after the first gates but before the original launcher. Both were reproduced with the actual synthetic wrapper before fixing. `launchAdoptedWorker` now snapshots the same root pins/assignment at entry, then rechecks those fixed code pins, provider evidence and client adoption immediately before `startPreparedWorker`; it cannot select replacement authority during the wait. Two negative cases prove the launcher is never reached and the consumed slot cannot be reused. This closes that normal waiting window without changing original native/channel/client code or claiming atomic protection against hostile same-UID changes.

Final source verification: five focused files25 tests/pass25/fail0/skip0; scoped TypeScript and diff checks pass. Independent fixed-SHA review of6459900..f148531 identified that one P2; review of the minimal fix f148531..8403c72 closed it with GO/no additional Important or Critical finding, independently rerunning nine bridge tests and scoped types. Source commits are d502e27, f148531 and8403c72. Actual provider/account/route/budget/tier, private final packaging/native-host qualification, model/worker activation and owner experience acceptance remain unverified and closed. These exclusions preserve the original OpenSpec5.2/5.4 unfinished gates.

## Native static evidence and remaining gates

The fixed signed CLI a636331ed87605efc4cf84028ac2884a75363f9d10ead63cffb57ea0016d486e (0.167.0-alpha.3.2) was exercised only through help, features list and synthetic stdio MCP list in an empty private CODEX_HOME. Explicit false values for multi_agent/hooks/apps/remote_plugin/fast_mode are effective; shell_tool/unified_exec remain enabled. Bad boolean/provider types and an invalid forced_login_method fail native parsing. service_tier accepts arbitrary strings, so accepting "default" is not proof of a backend service tier.

Synthetic MCP list did not execute its touch sentinel and returned both the home synthetic service and the CLI-added assigned service. The table merges. exec --ignore-user-config skips only CODEX_HOME/config.toml, as its captured native help states. Preparation therefore refuses any .codex/config.toml in the worktree or ancestor chain and rechecks at launch; it does not read, remove or modify such files. Managed/system layers still require actual effective-provider qualification.

Official sources: [CLI commands](https://learn.chatgpt.com/docs/developer-commands), [MCP configuration](https://developers.openai.com/codex/mcp/), [advanced configuration](https://learn.chatgpt.com/docs/config-file/config-advanced). Request flags, isolated tests and source pins do not qualify the actual provider, HTTPS route, usage/budget enforcement, client adoption/current grant, reserved parent capacity or owner acceptance.
