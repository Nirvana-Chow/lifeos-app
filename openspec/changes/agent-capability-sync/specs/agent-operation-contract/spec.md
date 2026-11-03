# Agent Operation Contract

## Purpose

Define how authorized agents discover versioned operations and access LifeOS todos through the same record and write rules as the website.

## ADDED Requirements

### Requirement: Scoped Agent operations

The isolated Agent adapter SHALL expose versioned todo list, detail, create, and update operations. It SHALL derive account and space from a verified grant and enforce the required operation scope before accessing data. Write operations SHALL use the existing record service and write guard.

#### Scenario: Authorized Agent updates a todo

- **WHEN** an Agent with the required write scope submits a valid update with the current revision and an idempotency key
- **THEN** LifeOS applies the requested change through the existing record service and returns the resulting record identity and revision
- **AND** replaying the same command with the same key does not apply it again

#### Scenario: Unauthorized operation

- **WHEN** the grant is absent or invalid, lacks the required scope, or belongs to a different account or space
- **THEN** the adapter rejects the request before accessing records

#### Scenario: Invalid or conflicting write

- **WHEN** a request attempts to supply account or space, targets a stale revision, or reuses a key with different content
- **THEN** the adapter rejects the request without applying the change

#### Scenario: Unsupported contract version

- **WHEN** a client calls a route outside the supported version
- **THEN** the adapter rejects the request without applying an operation

### Requirement: Synchronized Skill capability discovery

LifeOS SHALL maintain one operation registry for the versioned contract. The adapter SHALL return only operations within the verified grant's scopes. Source checks SHALL detect drift between the registry and the generated Skill operation reference.

#### Scenario: Agent discovers permitted operations

- **WHEN** an authorized Agent reads the capability catalog
- **THEN** the response identifies the contract version and lists only operations permitted by the grant

#### Scenario: Registry changes without updating the Skill reference

- **WHEN** a developer changes the registry without regenerating the checked-in operation reference
- **THEN** the source check fails and indicates that the reference must be regenerated

### Requirement: Isolated qualification

This change SHALL leave the Agent adapter unregistered in the production runtime and use synthetic fixtures for verification.

#### Scenario: Existing website runtime

- **WHEN** the existing website starts with its standard configuration
- **THEN** it does not expose this Agent adapter or issue Agent credentials
