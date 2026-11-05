# MCP API adapter source candidate — 2026-11-05

LO-AGENT-001 / Issue35, existing `personal-agent-foundation` 7.1; actual credential runtime/host packaging is still 7.2/8.2. This is an internal synthetic source qualification, not production deployment, personal-record access or owner acceptance. No Keychain, real API/key, host configuration, global install, daemon, network listener, remote OAuth or business database was used by the adapter.

## Identity and inheritance

- Branch `codex/mcp-api-adapter-20261105`, fixed base `190ca4f7f2f2ccbb2a8b28b3a3c86c513b6174eb`.
- The earlier `5eaf53f` / `e890615` candidate at `src/agent-mcp` was inspected read-only and preserved. Reused its official low-level SDK server projection, bounded API client pattern, canonical validation and test coverage; the current candidate resides only at `src/mcp-candidate`.
- Necessary differences: injected trusted credential seam instead of an FD3 secret file; current requirements/baseline/workflow and record schemas; generic call/discovery rather than an outdated operation-specific client; no v1 downgrade; independent GET after writes and unknown outcomes; explicit frozen-command recovery.
- The native worktree operation could not resolve the local base ref in this chat. Git fallback created the explicit isolated task branch from the verified local SHA. Dependencies were installed only into this worktree's own `node_modules`.

## Entrypoints and trusted configuration contract

`src/mcp-candidate/stdio.ts` exports `serveLifeOSMcp(options)`; this is the only serving entrypoint. `options` is trusted host code, never a tool argument or downloaded document:

```ts
{
  origin: 'https://the-reviewed-exact-origin', // exact HTTPS origin; no path, auth, query or fragment
  credentialProvider: async () => /* reviewed provider returns token or null */,
  beforeUse: async () => /* optional existing trusted documentation-updater wrapper */
}
```

`credentialProvider` is called immediately before each HTTP request. A missing, invalid or throwing provider denies before network access. `beforeUse` runs before each public discovery/call/retry; a failure stops that action. Hook/provider selection is not accepted from env, argv, records, MCP requests, downloaded instructions or a remote script. The optional hook seam does not claim that updater installation is complete.

`scripts/lifeos-mcp.ts` is intentionally closed: it prints only `MCP_CREDENTIAL_RUNTIME_UNAVAILABLE` to stderr and exits 1, even if secret-like env values are present. A root-reviewed provider wrapper is needed before a real host can use this candidate. There is no automatic host registration, background process or new MCP HTTP listener. Stdout is SDK protocol data only; raw transport/provider errors are not logged or returned.

## MCP and business protocol

The official SDK owns handshake/framing/validation. Tools are:

- `lifeos_discover({})`: current v2 authorized/ready operations with locally reviewed argument schemas.
- `lifeos_call({operationId, arguments})`: the same current business operation and native body; no URL, header, cookie, owner, credential, command or permission selection.
- `lifeos_retry({requestId})`: explicit recovery of one uncertain write with the original frozen operation/path/body bytes/idempotency key.

Every `tools/list` and execution refreshes `/v2/capabilities`. The shared `agentOperations` source registry is the sole executable operation definition. Exact ID/method/path/requiredScopes and uniqueness must match the fresh catalog; unknown IDs, changed tuples, disabled/readiness-closed operations and protected routes cannot execute. Descriptions/schemas come from reviewed local code, not remote text. `lifeos_call` lists only currently usable operation IDs; `lifeos_retry` is absent for grants with no current writes. A 401/403 stops without a v1 fallback or alternate credential. A v2 404 is unavailable, not downgrade permission.

The executable path envelope is `/api/platform/agent` plus only locally registered v1 todo, organization, requirements, existing journal/calendar/health/person/finance record, feedback and classification preview/commit paths. Route parameters use canonical ID/type parsers. Identity/system/security/key/payment/order/approval APIs are outside this envelope. Classification commit still needs its real stored owner approval; a model `confirmed:true` cannot approve, activate MFA or add scopes.

`all-personal-business-v1` remains a backend policy. The adapter and every holder of the same Key share its actual current authority; the adapter does not create a new permission system or mint a feature Key. The two generic tools avoid host tool-definition changes for current ordinary record operations. New executable operations must first enter reviewed shared source and a compatible adapter release/path+schema contract; an arbitrary remote catalog or updated Skill document cannot teach this binary new executable paths. New record kinds outside the fixed envelope require a reviewed source update but no replacement Key once backend policy explicitly covers them. No claim is made that the fixed 13-operation Swift client supports new operations.

## Request, result and recovery semantics

Origin is fixed to exact HTTPS; normal TLS verification remains enabled. Requests use Bearer Authorization only, `credentials:omit`, `cache:no-store`, manual redirects with every 3xx rejected, a 30s deadline, 128KiB JSON bodies and 8MiB fatal-UTF8 JSON responses. Redirected or changed response URLs are rejected, including a custom transport's off-origin response. The token is never returned in configuration, tool results or error text; decoded responses echoing it are rejected wholesale.

Current API/domain validators are reused for todo planning fields, organization, requirements (stable LO IDs, baseline binding, public revision zero and optional workflow), native record fields, finance minor units, feedback and classification. No direct writer, SQL, forged session or extra metadata store exists.

Successful writes preserve the native result/duplicate receipt and attach a separate independently authorized GET under `readback`. `ok:true` describes the write response, not successful readback or owner acceptance; inspect `readback.ok` separately. Conflicts are not silently rebased. Unknown writes attempt an independently authorized GET without deciding from a snapshot that a command succeeded.

Uncertain writes are retained in process memory with a random nonsecret recovery ID (at most 100 active/pending commands). The caller may explicitly retry with that ID; the adapter refreshes authority again and sends the frozen original bytes/key once. Changed caller objects cannot change the stored command; a new call with its pending key receives `RECOVERY_REQUIRED`. Revocation blocks recovery but leaves the outcome unknown. There is no automatic retry and no persistent private-record file. On process exit, the caller must retain its original body/key and use native API receipt semantics to recover in a new process; a snapshot is not a command receipt. Readback after classification is current todo state, not a new owner approval or an inferred classification receipt.

## Official SDK and license review

Verified against npm primary metadata and official v2 docs/releases on this task:

- [v2 stable documentation](https://ts.sdk.modelcontextprotocol.io/v2/)
- [official 2.4.0 release and upgrade notes](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v2.4.0)
- [official stdio factory/lifecycle](https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio.html)
- [official source repository](https://github.com/modelcontextprotocol/typescript-sdk)

`@modelcontextprotocol/server`, `core` and test-only `client` are fixed at 2.4.0 in the existing single lock; Node >=20 is declared and Node24.18.0 was actually used. V2 uses split packages and `serveStdio(factory)`; the older monolithic v1 maintenance package was not installed. Relevant 2.4.0 changes include protocol parameter validation/outputSchema behavior and optional experimental Skills support. This adapter uses the low-level current list/call contract, does not use experimental Skills attachment, sampling, OAuth or telemetry, and tests both modern 2026-07-28 and legacy 2025-11-25 negotiation.

New lock entries only (all other package versions and React/Next remain unchanged):

| Package | Version | License |
| --- | --- | --- |
| @modelcontextprotocol/server, core, client | 2.4.0 each | Apache-2.0 |
| cross-spawn | 7.0.6 | MIT |
| eventsource | 3.0.7 | MIT |
| isexe | 2.0.0 | ISC |
| path-key | 3.1.1 | MIT |
| pkce-challenge | 5.0.1 | MIT |
| shebang-command | 2.0.0 | MIT |
| shebang-regex | 3.0.0 | MIT |
| which | 2.0.2 | ISC |

These license families already existed in the base lock. `npm install --package-lock-only --ignore-scripts` preceded comparison; only then `npm ci --ignore-scripts` installed into isolated storage. Audit reported zero vulnerabilities. Full upstream MCP Apache-2.0 license is retained at `src/mcp-candidate/third-party/MCP-LICENSE`; all three installed package licenses match. The project MIT license does not replace dependency licenses. Uninstall/rollback is a source/package+lock revert and has no schema/data/config inverse.

## Verification and remaining root integration

The task handoff supplies the final fixed commit SHA. Fresh focused verification: `node --test test/lifeos-mcp-adapter.test.ts test/lifeos-mcp-inherited.test.ts test/lifeos-mcp-stdio.integration.test.ts` passed 22 tests, zero skips; `npm run typecheck`, `git diff --check` and OpenSpec1.16.0 `validate personal-agent-foundation --strict` passed. Full `npm test` (before the final authorization-denial regression) executed 1554 tests:1501 passed,2 failed,51 opt-in skips. Its two failures are unchanged base190ca4f generated-Skill drift: `test/agent-skill-download.test.ts` (anonymous archive), `test/agent-skill-sync.test.ts` (reference matches registry). The four requirements workflow descriptions changed in the base registry without matching reference/artifact regeneration. This subtask did not modify those shared files; root reports regenerating them in `3caa927` for sequential integration. This report does not claim a green full suite on this isolated base. Tests exercise the actual official client child process, both negotiated protocol modes, trusted disposable TLS and the native `createAgentHandler`/services using synthetic MemoryPort storage. They verify native todo create/update/GET, lost-response exact retry without a new revision, readonly/disabled/unsupported/changed-tuple rejection, redirect refusal, unchanged credential across authorized current personal-module calls with separate GET readback, post-commit revocation blocking recovery, malformed/oversized responses, no credential echo, default-closed executable, classification stored-approval requirements and body boundaries.

These fixtures are not PostgreSQL authorization proof or production acceptance. The existing API owns its restricted PostgreSQL and revocation transaction fence; no backend behavior was widened here. No full Next build, production probe, CI/push, host install, real Keychain provider or owner acceptance was performed in this subtask.

Root's minimal sequential integration remains:

1. Independently review this fixed source SHA; merge the three exact SDK additions into the single package/lock and current dependency provenance manifest/third-party notices (the shared files were outside this subagent's ownership).
2. Wire a separately reviewed trusted fixed-origin credential provider and optional existing before-use documentation updater; retain the closed default until that concrete runtime is approved and qualified. Do not obtain secrets through tool stdout.
3. Qualify the intended MCP host, installed artifact and actual scoped API behavior using independent readback, then preserve 7.2/8.2, CI/release and owner-acceptance gates until their own evidence exists. This candidate does not mark the shared checklist complete or edit Skill/registry.
