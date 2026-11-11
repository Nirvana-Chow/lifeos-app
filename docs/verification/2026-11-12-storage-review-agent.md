# Storage-review Agent slice verification

This slice inherits owner storage-review PR42 at `f1df7d8ac08ac50fef4724f1c54db98bd3776ebc`. It adds five closed Agent operations, shared MCP validation and the matching portable Skill; it does not replace the private owner page or execute filesystem actions.

## Executed locally

- TDD: checklist revision preservation/conflict and missing Agent routes/discovery first failed; the shared client initially rejected the new paths before implementation. The final new storage Agent file has seven passing cases, covering scoped discovery, legacy/foreign/read-only/closed grants, real writer CAS and receipts, protected objects, trusted audit, injection rejection, lost POST response with the original frozen payload/key, and lost PATCH response whose historical receipt differs from a later current GET.
- `node --test --test-concurrency=1 test/*.test.ts`: 1705 tests, 1646 passed, 59 explicit opt-in skips, zero failures. Skipped integration cases are not acceptance.
- The earlier concurrency-two run reported two failures: the pre-existing full-registry assertion expected 50 instead of the new 55 operations, and the unchanged CJK downloader one-second deadline test expired before curl under load. The registry assertion was updated; the unchanged font file passed its independent focused run and the final complete sequential suite. No font implementation or deadline was changed.
- `npm run typecheck`, strict OpenSpec 1.16.0 validation (4/4) and `git diff --check` passed.
- One serialized `npm run build -- --webpack` passed using the committed lock and a local dependency installation. `LIFEOS_PLATFORM_CANDIDATE=0 node scripts/check-built-platform.mjs` passed its compiled-handler checks. Those checks call handlers in process and do not establish HTTP, browser or database acceptance.
- Independent initial source review found no reproducible P1/P2 and independently ran 36 focused tests, all passing without skips.

## Fixed-source integration review

An independent non-author reviewed storage commit9690fdb and the policy-CI adaptationee67cd0 at tree15f4c9e5750d71d2be83ed851c45faabf0dfbd98. The review found no P1/P2 and independently passed24 storage/service/fixture/JUnit cases with zero skips. Root read the same source and independently passed38 cases including shared discovery, with zero skips. The source preserves choices for unchanged objects, rejects changed/removed decided objects, retains current authority before receipt recovery and distinguishes historical receipts from later current reads. Neither review executed real SQL.

The CI adaptation adds a fourth dedicated empty PostgreSQL17.11 service. It checks source/run/attempt/workspace and actual cluster facts before initialization, then requires34 distinct SQL leaves with no skips/errors/failures. It does not reuse the requirements service or introduce a production container. Its real Linux result on this exact source remains required. The separately reviewed font repair retains the exact package/hash/metadata and180-second deadline, using one attempt per documented official Ubuntu hostname. No production authority is added.

## Required gates still open

The new case in `test/agent-business-policy-postgres.integration.test.ts` registers proposed0019 disabled by default, enables only its synthetic registrations, uses the actual restricted PostgreSQL writer and current SQL grant fence, verifies receipt replay/readback, then disables the exact operation and proves zero further revision change. It has not run locally: the required isolated PostgreSQL17.11 binary is unavailable. The new CI adaptation now sets the opt-in flag and enforces its zero-skip gate; a source-only or partial green run does not qualify it. The retained macOS fresh-cluster invocation is:

```sh
RUN_BUSINESS_POLICY_POSTGRES_TESTS=1 \
LIFEOS_POLICY_PG_BIN=/private/tmp/lifeos-pg17.APPROVED/install/bin \
node --test --test-isolation=none --test-concurrency=1 test/agent-business-policy-postgres.integration.test.ts
```

The local mode accepts only its approved temporary binary-path pattern and PostgreSQL17.11, creates its own new private data directory and loopback service, and stops it afterward. It never redirects to an existing database. The separate CI mode requires its dedicated empty service and source-bound identity; see `2026-11-12-policy-ci-qualification.md`.

The separately implemented HTTP MCP transport uses the shared registry/schema/semantic contract. Its storage commands still need focused transport integration after source integration. The installed credential runtime, disabled SQL registrations, module/policy configuration, production build/version, real authorized checklist upload and exact counts/revision readback remain root-owned delivery gates. No private checklist, credential, account data or real scan was used for this verification. Owner experience acceptance remains open.
