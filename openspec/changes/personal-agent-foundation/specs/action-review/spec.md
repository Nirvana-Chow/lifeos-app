# Action Review

## Purpose

Let the owner inspect and approve fixed action differences before deterministic execution, beginning with atomic todo classification and recoverable, authority-bound receipts.

## ADDED Requirements

### Requirement: Review binds a fixed proposal and current producer

Approval SHALL bind proposal revision, complete delta digest, selected operations, all source/target revisions, producer authorization/policy revision and expiry. Only a current owner MFA website session SHALL approve. A browser boolean, model approval or run checkpoint MUST NOT substitute for the stored approval receipt.

#### Scenario: Proposal changes after approval

- **WHEN** selected operations, differences, source/target versions or producer policy differ from the approved proposal
- **THEN** execution is rejected and a new preview and approval are required

#### Scenario: Owner reviews an Agent proposal

- **WHEN** the owner approves a proposal produced by an Agent grant
- **THEN** approval does not add scope or bypass the current producer grant fence at commit

### Requirement: Classification previews are immutable and bounded

A classification preview SHALL cover one to one hundred distinct todos, expire after thirty minutes and accept at most128KiB input. It SHALL retain todo source ID/revision, exact before and proposed project/domain/topic relations, unchanged items and a complete digest. Preview MUST NOT modify business records or history.

#### Scenario: Input exceeds a bound

- **WHEN** input contains zero or101 todos, duplicate todo IDs, excess topic references or more than128KiB
- **THEN** the preview is rejected without storing a misleading partial plan

#### Scenario: Classification is a no-op

- **WHEN** proposed relationships equal the current relationships
- **THEN** preview identifies the item as unchanged and successful commit does not create a new business revision for it

### Requirement: Proposal authority is distinct from business write authority

An Agent classification preview SHALL require todo:read and organization:read without todo:write. API commit SHALL additionally require todo:write and stored owner approval. An owner website commit SHALL use the owner's own write authority while fencing the producer's current preview/read scopes; approval MUST NOT grant the producer write access.

#### Scenario: Read-only Agent proposes and owner commits

- **WHEN** a valid read-only Agent proposes a fixed classification and the owner approves and commits it from the website
- **THEN** the owner may perform the exact authorized write, the producer's read authority is rechecked, and that Agent remains unable to commit through the API

#### Scenario: Producer read authority is revoked before owner commit

- **WHEN** a read-only producer loses required preview/read authority after review
- **THEN** owner commit is rejected without bypassing the producer fence or silently converting the plan to an owner-origin plan

### Requirement: Classification commit is atomic within the database

Commit SHALL revalidate current authority, stored approval, plan/digest, every todo before/source/revision and every target reference in one transaction. Any conflict SHALL leave all business records, history and the batch receipt unchanged. Classification MUST NOT change titles, notes, status, dates or source originals.

#### Scenario: The final todo conflicts

- **WHEN** the last item in an otherwise valid batch has a stale revision
- **THEN** no item, history entry or success receipt from that batch is committed

### Requirement: A plan is consumed once and command recovery is stable

Each plan SHALL succeed at most once. After current authorization, the same command and content SHALL return its existing receipt even after plan expiry or later edits; changed content SHALL conflict. A new command for an already consumed plan SHALL conflict, including all-no-op batches.

#### Scenario: Two commands commit an all-no-op plan

- **WHEN** distinct commands race to commit the same approved all-no-op plan
- **THEN** exactly one consumes it and the other receives a conflict rather than an unhandled storage error

#### Scenario: Commit response is lost

- **WHEN** the caller retries the exact original command after an unknown result
- **THEN** the stored receipt restores the outcome without repeating writes

### Requirement: Revocation and execution have truthful serial semantics

Producer revocation SHALL serialize with commit. A commit that acquired its authorization lock first may finish; revocation that finished first SHALL reject later commit and receipt recovery. Owner approval MUST NOT bypass producer revocation, and background run actors MUST NOT commit.

#### Scenario: Revocation finishes before commit

- **WHEN** the producer loses required scope before the commit authorization lock is obtained
- **THEN** commit is denied with zero business changes even when the owner approved the earlier preview

### Requirement: Review is usable and verifies the real result

The website SHALL show readable before/after differences, source versions, no-ops, expiry and conflict/unknown states with approve, reject or adjust actions. It SHALL preserve an uncertain original command and verify committed entities and receipts. Internal synthetic fixtures MUST NOT be shown as owner records.

#### Scenario: Owner selects only part of an atomic proposal

- **WHEN** the owner adjusts the selection before committing
- **THEN** the system creates a new proposal and digest rather than reusing approval for a different batch
