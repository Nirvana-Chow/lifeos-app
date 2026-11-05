# Agent Authority

## Purpose

Keep website, API and delegated-run authority explicit and current while exposing compatible, discoverable business capabilities without silently expanding existing credentials.

## ADDED Requirements

### Requirement: Trusted actors originate at server boundaries

The system SHALL construct trusted owner-session, agent-grant and run-capability actors only from verified server authority. Client bodies, model outputs and MCP parameters MUST NOT choose owner, space, scope or actor kind. Every operation SHALL recheck current authority and module readiness.

#### Scenario: Tool parameters claim owner authority

- **WHEN** a model or client supplies an owner identifier, scope or owner-session actor in operation arguments
- **THEN** the system rejects those fields rather than treating them as verified identity

### Requirement: Delegated runs have no approval or commit authority

Run capabilities SHALL bind producer authority and revision, run, permitted read/preview operations, sources, policy, expiry and budget references. A run MUST NOT approve or commit business actions. Expired owner sessions or revoked producer grants SHALL block the next delegated operation until a valid narrow authority is established.

#### Scenario: Worker resumes after producer revocation

- **WHEN** a queued run resumes after its producer grant is revoked or loses required scope
- **THEN** the next operation is denied and the run records a truthful authorization wait or failure

#### Scenario: Background run requests commit

- **WHEN** a delegated run calls approval or business commit
- **THEN** the operation is denied even if the run has produced a valid proposal

### Requirement: Same-key scope changes require explicit owner CAS

Supported business scopes SHALL be assignable to the same valid key only through current owner MFA, an exact scope selection and a compare-and-swap grant digest. Writes SHALL require the corresponding read scope. Scope changes MUST NOT replace key bytes, extend expiry, change binding or silently authorize future modules.

#### Scenario: Owner expands organization access

- **WHEN** the owner confirms the displayed current-to-proposed scopes and matching grant digest
- **THEN** only those scopes change, all existing key holders share the new permissions, and a secret-free audit is recorded

#### Scenario: Concurrent scope update changes the digest

- **WHEN** the submitted grant digest is stale
- **THEN** the change is rejected without modifying permissions or automatically substituting the latest digest

### Requirement: Future-module data coverage requires a separate explicit policy

The owner MAY select `all-personal-business-v1` through current MFA and policy-aware CAS. It SHALL cover current and future reviewed, enabled ordinary personal business data operations on the same bound key without changing its expiry. Existing module grants SHALL retain their exact scopes. The policy SHALL remain closed until its SQL, issuer and verifier are qualified.

#### Scenario: Owner explicitly includes later business modules

- **WHEN** the owner selects the displayed all-personal-business policy using current MFA and the exact policy-aware grant digest
- **THEN** key bytes, owner/space and expiry remain unchanged, all holders share the chosen coverage, and later registered ready data operations need no replacement key
- **AND** account security, credential management, system settings, external payment/order and irreversible operations remain excluded

#### Scenario: Policy is removed while an Agent request waits

- **WHEN** a request parsed an all-data policy actor before a policy-removing CAS acquires the authorization row
- **THEN** the transaction fence rejects that old actor after the wait, even if fallback explicit scopes would independently allow the operation

#### Scenario: One operation closes while a same-scope operation remains enabled

- **WHEN** a request passes HTTP authorization and its exact operation is then disabled, unregistered or rescoped before its transaction fence acquires the operation row
- **THEN** the write is rejected even if another enabled operation advertises identical scopes
- **AND** a transaction that locks the exact operation and policy control first may finish before closure commits; closure waits for that transaction

### Requirement: Legacy and multi-scope capability catalogs are distinct

The v1 catalog SHALL retain todo:read authorization and the original six-operation universe filtered by the original scope fields. A v2 catalog SHALL admit any valid bound grant and filter operations by all required scopes, implementation, enablement and readiness. Catalog version MUST NOT imply unadvertised business routes.

#### Scenario: Organization-only grant discovers operations

- **WHEN** a valid organization:read grant requests `/v2/capabilities`
- **THEN** it receives only its available operations with requiredScopes and advertised paths, while `/v1/capabilities` remains denied without todo:read

#### Scenario: Existing todo client requests v1

- **WHEN** a legacy todo:read client requests `/v1/capabilities`
- **THEN** the original operation contract and scope-filtered subset remain intact and no new module is falsely represented by a legacy single scope

#### Scenario: Strict existing todo client requests v2 with policy absent or enabled

- **WHEN** an existing client compares the advertised todo operation method, path and requiredScopes against its reviewed contract
- **THEN** createTodo and updateTodo still advertise exactly todo:write, and both policy-off and policy-on catalogs pass that unchanged strict contract
- **AND** the policy authorization layer independently requires read with write; its two-operation compatibility closure cannot authorize future arbitrary write-only operations

### Requirement: Portable entrypoints share one current contract

API, capability catalogs, Skill and MCP SHALL project one registry of operation IDs, schemas, errors and scopes. Disabled, unimplemented or unqualified operations MUST NOT be advertised. A portable artifact SHALL contain no credential or private runtime configuration.

#### Scenario: New module is configured without required SQL readiness

- **WHEN** module configuration exists but restricted database qualification fails
- **THEN** its operations remain unavailable and absent from discovery rather than falling back to a broader credential path
