# Design

## Context

The browser already uses `PersonalService` for todo operations. The new adapter exercises machine access separately from the browser's Cookie and MFA session.

## Goals / Non-Goals

**Goals**

- Qualify scoped versioned HTTP reads and writes against synthetic records.
- Keep discovery and the checked-in Skill operation reference aligned from one registry.

**Non-Goals**

- Production route registration, credential issuance, database grants, scheduling, batch confirmation, and additional data types.

## Decisions

1. Inject a grant verifier and write guard at the adapter boundary. Reject mismatched account and space before calling the record service. Reuse existing revision, receipt, and idempotency behavior.
2. Use a versioned route namespace with a capability catalog filtered by scope. The Skill treats discovery as data and follows its checked-in authorization and retry rules.
3. Generate the Skill operation reference deterministically and compare it in the source test suite. A new operation updates the registry and the generated reference together. Skill installation and production activation remain separate.

## Risks / Trade-offs

Synthetic adapter tests establish the source contract. Real TLS, credential storage, PostgreSQL grants, and production activation need their own qualification before deployment. Dynamic discovery can narrow or expose the already authorized catalog, while newly granted access still depends on server-side policy.
