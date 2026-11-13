# Source Migration

## Purpose

Move explicitly authorized personal source packages into typed LifeOS records with preserved originals, stable identity, inspectable mapping and independently verified reconciliation.

## ADDED Requirements

### Requirement: Programmatic synchronization preserves one authoritative writer

LifeOS SHALL persist its own full business body/fields/source versions in its database. Specialized Apple/training/finance sources SHALL retain their existing authority rather than defaulting to dual-primary writes. Programs SHALL use available events, incremental APIs or controlled file imports with stable IDs, deduplication, conflicts, deletion semantics, independent readback and visible pending/as-of state.

#### Scenario: LifeOS receives a financial statement

- **WHEN** a statement is stored but no verified Qianji import/API readback exists
- **THEN** it is not reported as Qianji bookkeeping success or used to overwrite that specialized source

#### Scenario: Both sides modify the same authoritative field

- **WHEN** synchronization observes divergent source versions
- **THEN** it preserves the authority and conflict for reconciliation rather than applying dual-primary last-write-wins

### Requirement: History migration has server-independent backup and restore

Authorized history SHALL be inventoried, backed up, sample-validated and imported in idempotent batches preserving originals/body/time/IDs/source versions/relations. Database, necessary files and sync checkpoints SHALL have backup independent of the business server, with actual restore/reconciliation in a qualified independent environment. Company content and the complete Photos library MUST remain excluded.

#### Scenario: The only backup is on the business server

- **WHEN** restore succeeds only from another directory or database on that same server
- **THEN** independent backup and restore acceptance remains unmet and expansion of sensitive migration is held

#### Scenario: An original record is absent from the selected inventory

- **WHEN** an authorized history batch has missing source material
- **THEN** coverage identifies that gap without fabricated content or removal of unique old-source evidence

### Requirement: Migration starts from an immutable authorized package

A migration SHALL identify a fixed source package, content digest, source versions, authorized selection, coverage and mapper version. Credentials, runtime configuration, executable workflows and company material MUST be excluded. Package existence alone SHALL NOT authorize application.

#### Scenario: Source file changes after preview

- **WHEN** the package content or mapper differs from the reviewed digest
- **THEN** application is rejected and a new mapping preview is required

### Requirement: Mapping preserves typed meaning and uncertainty

Previews SHALL separate accepted, rejected, unknown, duplicate and no-op items. Domain projections SHALL preserve explicit units, precision, source authority and record type; missing values MUST NOT be fabricated. Plans, snapshots, commands, receipts and summaries MUST NOT be imported as duplicate completed activities.

#### Scenario: Financial refund lacks an original transaction

- **WHEN** an authorized refund has no reliable original-transaction reference
- **THEN** the preview preserves refund semantics with an unresolved reference rather than inventing a match or converting it to income

#### Scenario: Historical plan resembles a completed record

- **WHEN** a source contains a scheduled activity and a separate completion receipt
- **THEN** the mapping preserves their distinct types and does not count both as independent completed activity

### Requirement: Identity and conflicts are versioned

Migration SHALL use stable source identity, version and content digest. A changed version of the same identity SHALL be reviewed as a version or conflict; equal titles MUST NOT cause automatic merges. Cross-source duplicate candidates SHALL retain each authority and original.

#### Scenario: Reimporting the same package

- **WHEN** the exact reviewed package and command are applied again
- **THEN** the system returns the original receipt or no-op result without creating additional entities

### Requirement: Application and reconciliation preserve recovery

Application SHALL bind the selected mapping, target owner/space, digest and command identity. It SHALL record target revisions and receipts, advance watermarks only after target readback, retain source originals and expose partial or unknown results without blind retry. Real application SHALL require its concrete migration authorization.

#### Scenario: Response is lost after target commit

- **WHEN** application might have succeeded but its response was lost
- **THEN** the system reads the original command receipt and target before retrying, preserving the original command and selection

#### Scenario: Source deletion is observed

- **WHEN** a later source package no longer contains an earlier item
- **THEN** the system creates a deletion-review condition rather than deleting the original or the target automatically

### Requirement: Sensitive intake has qualified protection and restore

Sensitive source activation SHALL require verified storage and backup protection, key-recovery boundaries, access/retention controls, bounded logs and an independent disposable-target restore. A file listing, parsed archive or attachment pointer MUST NOT substitute for restored-record readback.

#### Scenario: Restore evidence is missing

- **WHEN** a sensitive migration package lacks independent restore qualification
- **THEN** its real application remains blocked while independent code and website qualification may continue
