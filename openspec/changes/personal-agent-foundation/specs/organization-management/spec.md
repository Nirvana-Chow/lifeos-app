# Organization Management

## Purpose

Expose the existing project, domain and topic model through scoped operations that agree with the owner website and provide complete, traceable classification targets.

## ADDED Requirements

### Requirement: Organization operations share the authoritative business rules

Project, domain and topic read/create/update SHALL use the existing owner/space boundary, typed fields, source identity, revisions, reference checks, history and idempotent writer. Organization writes SHALL require organization:read and organization:write. Unsupported deletion, merge or title-based upsert MUST NOT occur.

#### Scenario: Scoped client creates a project

- **WHEN** a permitted client creates a valid project with an idempotency key
- **THEN** the website and API read back the same entity, source ID, revision and typed fields

#### Scenario: Update has a stale reference

- **WHEN** an update references an unavailable, wrong-type or stale domain/topic source or revision
- **THEN** the whole update is rejected without changing the record or its history

### Requirement: Organization inventory is complete or explicitly unavailable

A complete organization snapshot SHALL return the current authorized project/domain/topic set and real source IDs with an exact total and no truncation. An unavailable or over-limit complete-read adapter SHALL fail without returning a partial inventory labeled complete.

#### Scenario: More organizations exist than the bounded list window

- **WHEN** the complete authorized set contains more than fifty organizations within the safe complete-read limit
- **THEN** the snapshot includes every organization and excludes other record types and owners

#### Scenario: Complete coverage cannot be established

- **WHEN** the adapter is missing or exceeds its safety limit
- **THEN** the operation returns an unavailable result with no misleading partial total

### Requirement: Updates preserve CAS and exact request boundaries

Organization updates SHALL require complete typed fields and expectedRevision. Owner, space, source identity and confirmation authority SHALL be server-derived. Identical command replay SHALL restore the original result; changed content with the same command SHALL conflict.

#### Scenario: Client omits an existing field

- **WHEN** a PATCH omits title, text, occurredOn or personal metadata
- **THEN** the request is rejected rather than filling a default that overwrites unrequested content

### Requirement: Each organization slice has a usable website path

The owner website SHALL provide existing organization grids/editors and explicit permission controls, showing unavailable state when a capability is closed. New operations SHALL ship with current discovery and Skill documentation; source implementation alone SHALL NOT count as deployed owner acceptance.

#### Scenario: Owner changes an organization and refreshes

- **WHEN** the owner saves a permitted organization edit and refreshes or signs in again
- **THEN** the website shows the persisted entity and version from the same business service
