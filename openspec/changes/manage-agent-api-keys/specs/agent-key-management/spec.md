## ADDED Requirements

### Requirement: Owner manages Agent API keys in account settings

LifeOS SHALL allow a verified owner session to list, create, and revoke API keys for the configured space. Only supported todo permission presets SHALL be assignable. Management SHALL reject bearer-only access and cross-origin mutations.

#### Scenario: Owner lists grants

- **WHEN** an authorized owner opens API Key settings
- **THEN** LifeOS shows only that owner's grants for the configured space, including safe identifiers, permissions, expiry, and available status

#### Scenario: Unauthorized caller attempts management

- **WHEN** a caller has no verified owner session, supplies a foreign owner or space, or sends a cross-origin mutation
- **THEN** LifeOS rejects access without returning metadata or changing any grant

### Requirement: Keys have a bounded expiry and are revealed once

LifeOS SHALL enforce a future expiry no later than 365 days after issuance. The full key SHALL be returned only after successful creation and excluded from subsequent responses, logs, and caches.

#### Scenario: Owner selects a valid expiry

- **WHEN** the owner selects an allowed preset or custom future date and time
- **THEN** LifeOS creates one key with that expiry and displays the key for one-time copying

#### Scenario: Owner selects an invalid expiry

- **WHEN** expiry is omitted, in the past, or more than 365 days away
- **THEN** LifeOS rejects creation before issuing a key

### Requirement: Owner can revoke and replace a key

LifeOS SHALL revoke by disabling the authorization row used by the transaction fence. LifeOS SHALL issue a separate key when replacing a grant or changing its expiry.

#### Scenario: Revocation precedes a pending todo write

- **WHEN** revocation acquires the authorization row before a todo write
- **THEN** the write SHALL be rejected

#### Scenario: Todo write acquires the authorization row first

- **WHEN** the write acquires the authorization row before revocation
- **THEN** revocation SHALL wait for that transaction, and later writes using the revoked grant SHALL be rejected
