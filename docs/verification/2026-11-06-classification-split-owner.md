# Classification split-owner migration candidate — 2026-11-06

This source-only compatibility correction continues LO-AI-001 / [Issue 30](https://github.com/Nirvana-Chow/lifeos-app/issues/30), PersonalAgent A2 and the existing unified-business-ui task 3.2. It does not complete activation, delivery or owner acceptance. Base: `25764b5ccc4be3cc5fd9a36f66703de659159e2f`.

## Guard and authority

0012 previously required one `current_user` to own both the authentication key table and the existing platform record table. The producer-binding `SECURITY DEFINER` function reads the key table, so its creator must remain the actual authentication-table owner. Existing platform ownership must not be changed to satisfy that requirement.

The candidate keeps that authentication ownership check and requires an independently reviewed, explicit `lifeos.todo_classification_expected_platform_owner`. The role must exist, must not be a runtime/bootstrap/issuer/verifier/key-manager identity, and must own the `lifeos_platform` schema plus the exact existing meta/source/record/history/command tables. Empty, absent, unknown or mismatched expectations fail closed. A qualified same-owner installation remains supported. This explicit setting is an operator-supplied expectation, not proof of approval or a substitute for separately qualifying its exact target and existing owner.

All remaining prerequisite, approval, database, restricted-role and membership predicates are retained. The migration's functions, owner/space bindings, MFA/authorization fences, composite foreign keys, immutable storage, forced RLS and ACL statements are unchanged. It creates no roles, memberships, ownership transfers or new existing-key scopes and replays no business records. Runtime readiness and application code are unchanged.

[PostgreSQL 17 schema privileges](https://www.postgresql.org/docs/17/ddl-schemas.html#DDL-SCHEMAS-PRIV) permit independently owned objects within a schema; the [function security rules](https://www.postgresql.org/docs/17/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY) support retaining the actual function creator and fixed safe search path. The fixture reuses the project's pinned PostgreSQL 17.11 binaries; no software, dependency or lock update is required.

## Executed qualification

The actual proposed SQL ran on fresh disposable local PostgreSQL 17.11 clusters with synthetic identities only. Before the guard change, the split-owner probe failed at the original prerequisite exception (RED). After the change, rollback-only probes accepted the qualified split ownership, preserved original table ownership/ACL/RLS, created the producer check under the authentication owner with its original `SECURITY DEFINER` and safe path, created empty classification storage and passed runtime readiness. Negative probes rejected empty/unknown/mismatched owner expectations, service-role ownership even when the objects match, schema or any of the five table owner drifts, RLS/binding/MFA/function prerequisites and restricted-role membership/inherit drift. Runtime/bootstrap/issuer/verifier/key-manager execution and platform-owner-only execution remain denied. Every probe rolls back, including fixture-only ownership/role changes.

The existing enabled classification command reported **66/66 passes, zero failure/cancellation/skip**, including its two parent suites. `python3 scripts/check-classification-junit.py postgres <report>` confirmed both suites and all 64 required real-PG leaf cases with zero skip/failure/error. The new prerequisite probes run before the migration in that existing source-bound CI fixture; the finite manifest, workflows and their permissions are unchanged.

`npm test` reported **1613 total, 1556 passes, zero failure/cancellation, 57 explicit opt-in skips** both before and after the change. Skips are not integration acceptance. Types, whitespace checks and strict OpenSpec 1.16.0 validation for both existing changes passed. Local application build/browser tests were not rerun for this SQL/test-only change; fixed-source public CI and independent source review remain delivery gates.

## Required live qualification

Before separately authorized schema administration, bind the reviewed source and SQL hash to the exact target and independent authentication migration identity; independently read back the existing platform schema/table owner and restricted role/catalog prerequisites, then supply the exact expected owner setting. Missing or changed evidence is NO-GO. Do not repair a mismatch with ownership, membership, ACL or role changes. The candidate does not qualify a live target, issue or widen a key, enable runtime flags, restore sensitive data, classify real records or sign owner experience acceptance.
