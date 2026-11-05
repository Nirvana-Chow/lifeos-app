# LO-OPS-001 / LO-VERSION-001: small public-CI cache candidate

Prepared on `codex/ci-npm-cache-20261105` from verified default main `5bc64dbb8846f4e06e6e84b9e7867e786496d9ac`. This is a source candidate for adoption after the current release, not a deployed optimization or measured CI speedup. Do not push it merely to restart the in-progress release. Continue the existing unified-business-ui3.2 delivery requirement; no new backlog or completed acceptance is asserted.

## Change and preserved gates

Both existing jobs use the already pinned `actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1` (v7.1.0), unchanged Node24.22.1, with explicit `cache: npm` and `cache-dependency-path: package-lock.json`. The action uses npm's configured global cache path and derives the key from platform, architecture, package manager and lock hash. This saves npm download data; it does not restore node_modules, installed native output, Next output, images or build proof.

Both jobs still execute unconditional `npm ci --ignore-scripts --no-audit --no-fund`. A cache hit never bypasses installation, audit, tests or a source/lock check. No lifecycle-script execution is enabled. The existing committed lock and npm's integrity checks remain authoritative.

Remove only `requirements-multiview-browser.integration.test.ts` from the late “Exercise key dialogs, settings and requirements” invocation. Its complete early invocation with RUN_REQUIREMENTS_BROWSER_TESTS=1 remains. API-key dialogs, settings, roadmap, legacy password, CRUD, native Auth/MFA/PG, classification, visual assertions and every other unique test invocation stay unchanged. The two jobs, triggers, timeouts, source bindings, services, action pins, permissions, synthetic fixtures and artifact qualification remain unchanged.

Public permissions remain contents:read, checkout does not retain credentials, and no production credentials or private data enter the cache. GitHub permits PRs to restore a public base cache. PR-created caches are scoped to refs/pull/.../merge and cannot be restored by base/main or another PR; checking out the exact PR head does not change that event-ref isolation. Cache contents remain untrusted input: use only the public dependency download cache, never secrets, runtime settings, private records or credentials. This patch adds no pull_request_target, privileged cache writer, private-release cache reuse or cache-mode override.

## Official source review at the pinned version

- [Pinned setup-node README](https://github.com/actions/setup-node/blob/949feb2413d6458794dcd2491c4babbbce0c15c1/README.md#caching-global-packages-data): explicit npm cache, lockfile identity and no node_modules restoration.
- [Pinned native cache restoration](https://github.com/actions/setup-node/blob/949feb2413d6458794dcd2491c4babbbce0c15c1/src/cache-restore.ts) and [npm cache path](https://github.com/actions/setup-node/blob/949feb2413d6458794dcd2491c4babbbce0c15c1/src/cache-utils.ts): platform/architecture/package-manager/lock-hash key and npm config get cache. npm uses the exact key, without a broad npm fallback key.
- [GitHub cache scope restrictions](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#restrictions-for-accessing-a-cache): base visibility and PR merge-ref isolation. No permission override is introduced.

No action or dependency version was changed. Default cache limits/settings were not changed; no paid capacity, account or runner setting was enabled. The first cache miss still downloads dependencies. Upload/restore overhead can offset savings, and two cold parallel jobs may both miss before the first successful save. No net speedup is claimed until a later fixed-SHA workflow shows its cache outcome and timings.

## Executed source verification

Local Python3 + already available PyYAML6.0.3 parsed the complete YAML. An ephemeral preflight (`/tmp/lifeos-ci-cache-preflight.py`) was first RED for absent explicit cache, then GREEN after this patch. It compares the parsed workflow with base5bc64db and verifies:

- Exactly the same two jobs, all other job/global state, events, permissions, services, source bindings and steps.
- Both unchanged pinned setup-node actions use only the committed lock for npm cache; both npm ci steps remain unconditional with ignore-scripts.
- Every run block passes bash -n. Every distinct explicit test-file invocation remains; the only removed duplicate is the one late multiview occurrence.
- Normalizing those three permitted step edits yields the complete original parsed workflow; no other workflow change is allowed by preflight.

`node scripts/require-lock.mjs` and `git diff --check` passed. No npm ci, build, browser matrix, artifact download, workflow dispatch, push or remote cache operation ran for this candidate. A local schema/command preflight does not prove a real Actions cache hit or total runtime improvement; those remain post-release fixed-SHA CI checks.

## Docker cache remains a separate boundary

This patch does not change Dockerfile.platform-review, its fixed hash, the production controller, host_build.py or server caches. The coordinator already verified that the server's buildx call permits its local layer cache and that the dependency layer precedes source COPY. Public ephemeral runners currently have no cross-run cache-from/cache-to configuration. npm download caching alone is not a Docker layer cache.

A separate cross-run Docker cache backend/exporter or production-controller change needs its own scoped implementation and validation; it is not added here. The exact public source image build and readback are retained. Do not assume the public synthetic image is the private production artifact or share unqualified PR build output with a privileged release path.

Rollback is a source revert: restore package-manager-cache:false in both unchanged setup-node steps and the one late multiview argument. No schema, production state or real data rollback is involved.
