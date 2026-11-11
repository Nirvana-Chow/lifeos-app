# Fresh business-policy and storage SQL CI qualification

Stack dependency: storage-review Agent source `9690fdbf480427aecfc94bfee189428cb00a606d`, which inherits owner storage-review PR42. This slice changes only qualification workflows, synthetic test fixtures and verification documentation. No runtime, business API, operation registry, SQL migration or owner data is changed.

## Reuse and boundary

The original all-business-policy test already qualifies PostgreSQL17.11 with a new local `initdb` cluster, but its macOS binary-path guard cannot run against the Ubuntu service containers. The requirements fixture provides a useful source/run/workspace preflight pattern; its initialized cluster cannot be shared because the policy test creates cluster-global canonical roles. Catching duplicate roles or skipping their creation would weaken the original qualification.

Both qualification workflows therefore add one dedicated `policy-postgres` service at `127.0.0.1:55449`, using the same existing official PostgreSQL17.11 image digest as the other services. It starts with only the `postgres` database and role. The new CI-only helper checks actual Linux/GitHub/workspace/head facts before connecting, uses only the fixed loopback port and synthetic account, verifies server version/data directory/private container address, and refuses any pre-existing application database, nonstandard schema or user role. The original test then creates its own database and restricted roles and stores/readbacks an exact repository/run/attempt/source marker. It never resets or reuses another fixture. The service and all its data disappear with the job.

[GitHub's service-container documentation](https://docs.github.com/en/actions/tutorials/use-containerized-services/use-docker-service-containers) documents host-runner access through published localhost ports. [PostgreSQL17's CREATE DATABASE documentation](https://www.postgresql.org/docs/17/sql-createdatabase.html) provides the native database creation behavior; no database framework, external service or compiled PostgreSQL download is added.

## Gates and verification

The same original test file runs all 34 native leaf cases, including the new storage registration/scope/CAS/receipt/readback/revocation case from the frozen source. Each workflow requires 34 distinct JUnit leaves, the named storage and authorization cases, and zero skips/failures/errors. There is no fallback from failed CI qualification to the local native-binary mode.

Local RED/GREEN evidence: the source/run and empty-cluster guards initially failed as unimplemented; the workflow test failed for a missing dedicated service. The completed preflight/workflow, existing requirements/release guards, business-policy fences and storage tests passed 36/36 with zero skips. The actual workflow JUnit Python code was executed against positive and missing-storage/duplicate/count/skip/failure/error fixtures. Both workflow YAML files parsed and their fixed service port/env were checked. Typecheck and the complete sequential default suite passed: 1710 tests, 1651 passed, 59 explicit opt-in skips, zero failures. No application rebuild is needed for this CI/test-only slice.

Actual PostgreSQL execution is still pending: this Mac has neither Docker nor the separately approved local PG17 binary. A default test-suite skip does not qualify the new SQL behavior. The required fixed-source CI step sets:

```sh
RUN_BUSINESS_POLICY_POSTGRES_TESTS=1
LIFEOS_FIXTURE_FRESH=approved-isolated-fixture
LIFEOS_POLICY_FIXTURE_CONTEXT=github-actions
LIFEOS_POLICY_FIXTURE_ID=business-policy-ci-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}
```

It runs `node --test --test-isolation=none --test-concurrency=1 test/agent-business-policy-postgres.integration.test.ts` with the workflow's source identity and JUnit reporters. Only a successful new fixed-SHA CI run establishes the 34 native cases. Contents/actions permissions remain read-only; CI has no production authority. The coordinator must update the private trusted workflow digest through the existing controlled process, retaining old evidence; source changes cannot relax that binding or promote a partial-green run.

## Separate font diagnosis

The reported recovery job failed during two bounded DNS resolution attempts for the pinned Ubuntu font package, not in application tests. [Ubuntu's current official metadata](https://packages.ubuntu.com/noble/all/fonts-noto-cjk/download) still identifies the same package/version, size and SHA256. [curl's connection timeout](https://curl.se/docs/manpage.html#--connect-timeout) includes DNS resolution, consistent with exit28. The helper already verifies package hash/identity, reuses exact installed state, checks its runner-local cache, bounds installation and fails closed. GitHub-hosted jobs start with fresh runner state, so that cache does not establish cross-run availability; no cache action, mirror or DNS setting is added here.

No font source change is made without evidence beyond the observed transient failure. The coordinator's single failed-job retry on the unchanged MCP source remains an infrastructure retry, never a source fix or a waiver of required qualification.
