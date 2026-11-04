# Personal Context

## Purpose

Make authorized personal evidence, confirmed goals and preferences, and model inferences inspectable without turning generated summaries into a second source of truth.

## ADDED Requirements

### Requirement: Evidence and judgment remain distinct

The system SHALL distinguish source evidence, owner-confirmed context, model inference and proposed action. Each item SHALL retain source identity/version, relevant time precision and its confirmation or inference status. A generated inference MUST NOT silently become a confirmed fact.

#### Scenario: Model infers a preference

- **WHEN** a model suggests a preference from retrieved records
- **THEN** the website labels it as inference, shows its evidence and unknowns, and leaves it unconfirmed until an owner decision

#### Scenario: Owner corrects a confirmed goal

- **WHEN** the owner replaces an existing goal with a correction
- **THEN** the system records the new version and confirmation, retains the replaced version and identifies dependent proposals or reports as stale

### Requirement: Coverage is explicit and bounded

The system SHALL report authorization, connection, requested scope, source as-of time and complete, partial, unknown or unavailable coverage per source. A truncated or failed read MUST NOT be represented as a complete inventory or a zero result.

#### Scenario: Source read is truncated

- **WHEN** an upstream limit prevents complete coverage
- **THEN** the website and tool response identify the incomplete range and limitation rather than claiming all data was understood

### Requirement: Context retrieval enforces current authority

The system SHALL select the minimum relevant authorized evidence before model context construction. Revoked or unavailable sources SHALL be excluded from new retrieval, caches and dependent candidate execution; record text MUST be treated as data rather than tool or policy instructions.

#### Scenario: Retrieved note requests an upload

- **WHEN** source text instructs the assistant to upload unrelated records or widen scope
- **THEN** the system treats that text as untrusted evidence and performs neither action

#### Scenario: Source authority is revoked

- **WHEN** a previously included source loses authorization
- **THEN** subsequent context construction excludes it and affected proposals show their stale or unauthorized basis

### Requirement: Context is privately scoped and portable

Evidence, confirmed context and inference lineage SHALL be isolated by owner and space, with explicit retention and correction history. Export or restore SHALL preserve type, source references and versions without including runtime credentials or making unverified attachment-recovery claims.

#### Scenario: Foreign owner requests context

- **WHEN** a caller requests another owner's context or source reference
- **THEN** access is rejected without returning the existence or content of that context
