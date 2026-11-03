# Proposal

## Why

The existing application keeps website records and Apple import evidence but has no reliable two-way synchronization. The approved direction makes the LifeOS service the canonical business store and Apple Reminders/Calendar editable clients, with a single Mac bridge preserving identity, fields and authoritative readback.

## What Changes

- Add explicit observations, capability negotiation, stable identity/aliases, three-way field merge, conflicts, deletion candidates and echo prevention.
- Capture website business changes into a transactional outbox; apply incoming changes through the existing business services and store mapping/receipts in the same transaction.
- Add default-closed, authenticated candidate API contracts and a manual Mac bridge with durable intents, offline replay and readback-before-ACK.
- Separate read-only queue notifications from write-authorized prepare/claim operations. Persist an immutable delivery from current canonical state before replying; preserve uncertain attempts and allow retirement only before any claim.
- Reuse existing PostgreSQL/RLS/CAS/history, request boundaries and writer fencing. No second business store or Apple writer.
- Treat unavailable fields separately from explicit null. Unsupported recurrence, alarms, native cancellation and identity ambiguity remain blocked rather than being simplified or reported synchronized.
- Preserve the complete two-way acceptance and future activation gates. Source/synthetic qualification does not activate a device, background task, live schema, Apple data access or production sync.

## Capabilities

### New Capabilities

- `apple-synchronization`: Reliable, loss-aware two-way synchronization through one authenticated Mac bridge with durable reconciliation.

### Modified Capabilities

None. Existing authentication, authoritative business mutation and UI contracts retain their current guarantees.

## Impact

Adds a focused sync candidate package, proposed additive SQL including bounded lease delivery state, transaction-bound business adapter hooks, candidate routes, manual synthetic tooling and tests. Uses the existing npm lock and Node/TypeScript/PostgreSQL stack; no additional dependency is required for the reconciliation core. Device identity and complete EventKit capability activation remain separately controlled. No credentials, records, runtime configuration or private operational identities enter public source.
