# Spec Delta

## Purpose

Allow LifeOS and its editable Apple clients to exchange changes reliably through one authorized Mac bridge while preserving canonical business identity, native evidence, revisions, field semantics and recoverable state.

## ADDED Requirements

### Requirement: Loss-aware native observations
The system SHALL distinguish known values, known null and unavailable fields, retain native identity/date/time-zone/recurrence/alarm evidence and reject changes that cannot be represented or applied without loss.

#### Scenario: A CLI omits recurrence details
- **WHEN** an adapter lacks a complete recurrence or alarm snapshot
- **THEN** the missing information is unavailable rather than an empty array or null
- **AND** a write needing that information is blocked with an explicit capability reason

### Requirement: Stable mapped identity
The system SHALL maintain one canonical business ID and scoped native identity, aliases, store epoch and original occurrence identity; ambiguous remapping MUST be blocked.

#### Scenario: A local Apple identifier changes
- **WHEN** a full sync or calendar move changes a native identifier
- **THEN** remapping requires unique source/container/external and occurrence evidence
- **AND** matching by title or the edited start time does not create or merge records

### Requirement: Three-way reconciliation and echo prevention
The system SHALL compare both endpoints against the last mutually acknowledged base, merge independent field changes, retain same-field conflicts and suppress only verified echoes.

#### Scenario: Both ends edit different fields
- **WHEN** the website edits the title and Apple edits notes from the same base
- **THEN** both changes remain in the merged result without overwriting other fields

#### Scenario: A phone changes a previously delivered value
- **WHEN** an observation carries the same operation marker but a different semantic payload
- **THEN** it is treated as a new external change rather than discarded as an echo

### Requirement: Atomic authoritative mutation and outbox
The system MUST use existing business services and atomically commit business data, history, outbox, mapping/base and incoming command receipts on the same database transaction where applicable.

#### Scenario: Outbox persistence fails
- **WHEN** business validation succeeds but outbox append fails
- **THEN** business revision, history and receipt are rolled back together

### Requirement: Fenced authenticated protocol
The system SHALL default closed, accept identity only from a trusted authenticated principal provider, enforce owner/space/bridge/scopes and reject stale leases or fences on pull, apply and ACK.

#### Scenario: An old bridge acknowledges after lease replacement
- **WHEN** a prior executor submits a stale fencing token
- **THEN** it cannot commit changes or advance the cursor

#### Scenario: No device provider is approved
- **WHEN** a caller requests device synchronization without an approved identity provider
- **THEN** the route remains unavailable and no Apple or database mutation occurs

### Requirement: Durable manual bridge and unknown-write recovery
The system SHALL persist immutable intents before external operations, share the original writer fence, retain offline work and require authoritative native readback before server ACK and baseline advancement.

#### Scenario: A create times out
- **WHEN** the bridge cannot determine whether Apple created the object
- **THEN** it re-reads the same intent identity and preserves unknown state if unresolved
- **AND** it does not issue a second create

### Requirement: Immutable delivery from current canonical state
The system MUST separate read-only notification retrieval from write-authorized delivery preparation, persist a complete immutable intent before replying and use the current owned canonical business state rather than replaying a historical outbox snapshot as the target.

#### Scenario: Phone changes a field after an earlier website revision was queued
- **WHEN** the website changes title from A to B and an independent phone notes change N0 to N1 has been accepted before prepare
- **THEN** the delivery freezes current B/N1 even if its triggering cursor originally contained B/N0
- **AND** repeated retrieval of that attempt returns the same mutationId, intent and hash

#### Scenario: A later canonical revision exists at ACK
- **WHEN** cursor2 prepares canonical revision3 and the website then creates revision4
- **THEN** ACK confirms the frozen revision3 baseline and only advances cursor2
- **AND** canonical revision4 remains unchanged and queued for later delivery

### Requirement: Claim authority and conservative retirement
The system MUST distinguish immutable command replay from current permission to execute, require exact current claim authorization before native save and allow retirement only for an exact never-claimed issued attempt/version.

#### Scenario: Claim and retirement race
- **WHEN** a claim and retirement address the same issued attempt/version
- **THEN** only one succeeds under the same lease row lock
- **AND** a delayed old claim cannot authorize a retired or replacement attempt

#### Scenario: A claim response or execution lease is lost
- **WHEN** a claim reply is retried or the same device obtains a newer fencing token
- **THEN** historical replies do not renew native save authority
- **AND** a possibly executed create is resolved/read back or remains blocked without automatic retirement or recreation

#### Scenario: A never-claimed native precondition changes
- **WHEN** a complete native observation changes before claim and the exact issued attempt is retired by CAS
- **THEN** retirement and observation reconciliation commit together without advancing the cursor
- **AND** a separate prepare uses a new attempt/mutationId only after successful conflict-free reconciliation

### Requirement: Durable delivery history and local execution order
The system SHALL retain full historical intents/proofs/results, use globally monotone owner/space delivery versions and reject automatic device or identity-epoch handover in this source phase. The Mac MUST durably save its stable claim request, claim receipt and exclusive native-applying state in order before native save, and its server receipt before ACK.

#### Scenario: An old prepare command is replayed after completion
- **WHEN** an acknowledged attempt is no longer the active queue head and its original command key is retried with a valid current fence
- **THEN** the immutable historical result is returned without replacing the active slot or granting native execution

#### Scenario: A no-op update is delivered
- **WHEN** a prepared update has an empty patch
- **THEN** no native save occurs
- **AND** exact fresh readback and persisted receipt/ACK are still required before baseline/cursor advancement

### Requirement: Safe external disappearance and terminal states
The system SHALL distinguish completion, cancellation, deletion and reopening; missing records SHALL require complete comparable coverage and identity resolution before becoming deletion candidates, with no automatic permanent delete or recreation.

#### Scenario: Calendar coverage is bounded or permission is lost
- **WHEN** an event is absent from a partial window or access is reduced
- **THEN** no deletion fact, completion or cancellation is inferred

### Requirement: Two-way acceptance and activation evidence
The system SHALL retain source/synthetic, native capability, authenticated device, real-data, release and owner acceptance as distinct gates. Full acceptance includes website-to-Apple-to-phone-edit-to-website refresh/relogin, no duplicate/echo, conflicts, offline recovery, dates/time zones/recurrence exceptions and isolated restore.

#### Scenario: Synthetic reconciliation passes
- **WHEN** the default-closed candidate passes synthetic tests
- **THEN** it is reported as candidate evidence only
- **AND** no background service, device grant, live migration, Apple data access or production synchronization is assumed enabled
