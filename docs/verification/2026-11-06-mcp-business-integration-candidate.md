# MCP current business integration candidate — 2026-11-06

LO-AGENT-001 / Issue35; existing `personal-agent-foundation` 7.1. Fixed current-main base: `6ab06cc0915fab5f50bf67642078c16f026701fe`. Isolated branch: `codex/mcp-business-integration-20261106`. Original source candidate `dc7ed29` and independently rechecked discovery fix `a99dff30` were cherry-picked without conflicts as `9379039` and `236d955`. Author and committer use the public Nirvana-Chow noreply identity.

This extends the local source candidate to the current reviewed media/career/portfolio record APIs. It does not activate a credential runtime, host, permission, API key, database authority or production integration. Earlier dated candidate notes describe their own fixed source and validation; this note supersedes their old statement that these three record kinds are excluded. No source push or release is performed here.

## Scope and native reuse

- Only the inherited MCP candidate, its original required package/lock/script additions, module tests and verification notes are included. No Agent registry/normalizer, generated Skill/artifact, UI, SQL or production setting was changed. Package versions remain exactly the original candidate's SDK server/core/test-client 2.4.0, Zod 4.6.7 and Node 24.18.0; the 28 previously reviewed tests passed on the new main base before this extension. Dependencies were borrowed via links inside this worktree's own ignored `node_modules` directory; no install or mutation of another worktree's dependencies occurred.
- The registry contains 52 descriptors: 50 reviewed business operations plus two catalog operations. MCP exposes the same 50 business operations only when the fresh authorized catalog allows them. Twelve added operations are snapshot/get/create/update for media, career and portfolio. The executable fixed route whitelist names these exact reviewed types; it does not become an arbitrary `/records/*` wildcard.
- Discovery projects the current `personal-media/domain.ts`, `personal-career/domain.ts` and `personal-portfolio/model.ts` contracts. Existing native exported enums and currency precision mapping are reused, and TypeScript checks each metadata projection against its native personal type. All generic writes require the four full fields, with source pins, nullability and closed objects. Operation IDs remain paired with their actual argument schemas by `oneOf` in `tools/list` and `lifeos_discover`.
- Media publishes book/film/series alternatives, matching ISBN/provider choices, page/episode/percent/unknown progress, dates, rating and links. External URLs are stored record data; they never select an MCP request origin and trigger no automatic lookup.
- Career publishes education/employment/achievement/resume/opportunity alternatives, manual source, known date precision (`YYYY`, `YYYY-MM`, `YYYY-MM-DD`), facts/evidence, current source pins and application state. Existing native checks retain allowed fact subtypes and current-owner pin validation; this does not perform an import, application or evidence certification.
- Portfolio publishes account/asset/investment alternatives, native currency enum and minor-unit precision, exact integer amount strings, exact decimal quantity strings, valuation dates and typed account/asset pins. Unknown remains null. Values are not converted through floating-point numbers or rounded.
- `parseArguments` already dispatches these reviewed record modules to their shared native complete-field and personal normalizers. No second normalizer, writer, storage or validation authority was introduced. Semantic constraints such as ISBN checksum/provider URL, chronology, known-amount dates, ownership and allowed/current pin kinds remain native checks and are stated in schema descriptions.

## Validation actually performed

New behavior was first observed red because the unchanged candidate did not discover any of the twelve operations. After the narrow schema/route extension:

`node --test test/lifeos-mcp-adapter.test.ts test/lifeos-mcp-inherited.test.ts test/lifeos-mcp-discovery.test.ts test/lifeos-mcp-stdio.integration.test.ts test/three-business-agent.test.ts`

**38 passed, zero failed, zero skipped.** The actual official MCP client consumes advertised schemas. An independent schema interpreter constructs complete POST/PATCH commands, the SDK's native Ajv provider validates them, and the real scoped Agent HTTP handler persists synthetic MemoryPort records followed by independent GET. Coverage includes:

- Every new media/career/portfolio metadata alternative; twelve new operation descriptors; complete create/update/GET bodies and revision/source identity; exact matching of all 50 operation/arguments alternatives.
- Legacy grants, read-only writes, disabled native types and changed/unreviewed remote ID/path/scope tuples remain absent or denied. No unadvertised business write is sent.
- CAS conflicts and, for each new type, a lost response after commit, independent readback, frozen original body/key retry without a second revision, and denial after grant revocation.
- Current project/source pins in all three modules; stale pins and wrong career/portfolio subtypes reject with native conflicts. Career resume fact and portfolio account/asset references are checked by the existing single writer. A 30-digit KWD minor amount and a precise small decimal quantity survive storage/readback exactly.
- Invalid ISBN/current period/amount-without-date values that satisfy structural JSON Schema still fail through the canonical normalizer before any write request. Wrong numeric amount types and film/episode combinations fail advertised schema validation.
- Inherited modern/legacy stdio, default-closed executable, fixed origin/manual redirect, 401/403 stop, unknown-body recovery and bounded request/response cases remain green.

`npm run typecheck` passed. `git diff --check 6ab06cc0915fab5f50bf67642078c16f026701fe` passed for the integrated candidate. The existing lock guard ran as part of typecheck. Full suite, browser suite, Next build, PostgreSQL integration and CI were not rerun for this source-only extension; older dated full-suite results are not presented as current checks.

## Remaining root-owned gates

Root must independently review the fixed integration commit, reconcile the shared generated Skill/artifact and dependency provenance/NOTICE with the inherited exact SDK additions, and run its fixed-SHA CI/release path. Those shared files were intentionally left outside this writer's scope. No integration gate or owner acceptance is marked complete by this note.

The CLI still exits with `MCP_CREDENTIAL_RUNTIME_UNAVAILABLE`, and does not read env/argv credentials. A trusted fixed-origin provider and optional existing trusted updater hook remain injection seams, without a bound production wrapper. Actual MCP host registration, Keychain access, compiled credential runtime changes, live API/key testing, private record access, production readback and 7.2/8.2 qualification remain pending under their own authorization and evidence. No real data, credentials, permission expansion or new background setting was used.
