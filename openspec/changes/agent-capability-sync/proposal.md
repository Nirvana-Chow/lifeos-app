# Proposal

## Why

LifeOS needs a documented way for authorized agents to discover available operations and work with records through the same business service used by the website. A shared operation registry keeps the Skill reference aligned with the API.

## What Changes

- Qualify a versioned Agent HTTP adapter for synthetic todo reads and writes. Require a verified account grant and reuse existing record access, revision checks, write authorization, and idempotency.
- Return a capability catalog filtered to the grant's scopes. Generate the checked-in Skill operation reference from the same registry and fail verification when it drifts.
- Keep production activation, credential issuance, database grants, automatic scheduling, and batch confirmation outside this qualification.

## Capabilities

### New Capabilities

- `agent-operation-contract` provides scoped, versioned Agent operations and synchronized Skill discovery.

### Modified Capabilities

None.

## Impact

The isolated HTTP adapter, operation registry, Skill reference, and source checks cover this phase. The existing personal browser API and `PersonalService` remain the source of record behavior. Real network and database qualification are separate.
