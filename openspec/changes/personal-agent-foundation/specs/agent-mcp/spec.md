# Agent MCP

## Purpose

Offer portable local MCP access to implemented LifeOS business capabilities while preserving the same authorization, evidence, schemas, review and result semantics as the HTTPS API.

## ADDED Requirements

### Requirement: HTTPS business MCP is actually connected

The HTTPS service SHALL reuse the API/database/owner-MFA with qualified OAuth and current authorization. Discovery and execution SHALL enforce a closed business operation policy independent of shared scopes. Arbitrary commands, coding-agent launch and deployment MUST NOT be exposed. Explicit saves SHALL preserve ID/version/idempotency and independent readback; discussion MUST NOT automatically create tasks.

#### Scenario: A new business input is delivered

- **WHEN** a new input capability is offered
- **THEN** its scoped operation, discovery and Skill ship together and actual ChatGPT installation, web/phone query, create, same-ID update and independent readback are verified against the fixed resource/audience

#### Scenario: Shared scope advertises an engineering operation

- **WHEN** a business MCP credential has a scope also used by an execution operation
- **THEN** the business adapter refuses the operation before engineering dispatch even if the wider registry advertises it

#### Scenario: The Mac is offline

- **WHEN** an authorized phone client explicitly saves business data through the installed server MCP
- **THEN** the server persists it and an independent authorized read verifies it without a Mac listener

### Requirement: Real generated files use a qualified transfer contract

MCP files SHALL use official top-level parameters, authorized bounded transport and durable identity/bytes/checksum/retention with receipt/readback. Temporary URLs, sandbox paths and library pages MUST NOT be reported as saved originals; large Base64 payloads MUST NOT be copied through a model. Temporary versus long-term retention SHALL preserve unique originals.

#### Scenario: ChatGPT generates a new real file

- **WHEN** the owner explicitly hands that file to the MCP service
- **THEN** website and Codex each download the persisted original, independently verify checksum and bytes, and acknowledge receipt before eligible temporary cleanup

#### Scenario: A temporary download URL expires before transfer

- **WHEN** the staged source cannot be downloaded and durably verified
- **THEN** the service reports unavailable/pending rather than successful file persistence or a fabricated checksum

### Requirement: Local MCP adapts the existing business API

The first MCP transport SHALL use local stdio and a configured fixed HTTPS API origin through an explicitly approved credential runtime. It MUST NOT expose SQL, browser cookies, arbitrary origins, raw credentials or an independent business writer. Redirects SHALL be rejected.

#### Scenario: API redirects the adapter to another origin

- **WHEN** a configured API call receives a redirect
- **THEN** the adapter stops without forwarding its credential

### Requirement: MCP projects the current operation registry

MCP tools SHALL use the same operation IDs, validated schemas, scope requirements, errors, coverage and receipt semantics as API/discovery/Skill. Listing SHALL include only implemented, enabled, ready and currently authorized operations; MCP parameters MUST NOT widen identity or authority.

#### Scenario: Grant is read-only

- **WHEN** a read-only grant lists available MCP tools
- **THEN** it can access its authorized reads and proposals but cannot approve, add scope or commit business changes

#### Scenario: API module is disabled

- **WHEN** a module is unavailable in the current authorized API catalog
- **THEN** its MCP tools are absent rather than falling back to a privileged path

### Requirement: Adapter installation is credential-free and host-qualified

The distributable adapter and Skill SHALL contain no account secret, private source path or personal record. Fixed SDK/protocol compatibility SHALL be tested against the actual host before supported behavior is advertised. Persistent host settings or permission expansion SHALL require their corresponding concrete authorization.

#### Scenario: Adapter package is inspected

- **WHEN** a portable package is unpacked
- **THEN** it contains only reviewed generic code, operation references, license material and nonsecret installation instructions

### Requirement: Remote authorization is a separate activation

Remote HTTP/OAuth support SHALL remain unavailable until a fixed resource/audience, discovery, PKCE, scope and token-validation contract is qualified and authorized. A token for another resource MUST NOT be forwarded or accepted through the local adapter.

#### Scenario: Client supplies an unrelated bearer token

- **WHEN** a token is not issued for the configured LifeOS resource
- **THEN** the adapter rejects its use without forwarding it or substituting an owner session
