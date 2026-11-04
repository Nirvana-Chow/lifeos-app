# Agent MCP

## Purpose

Offer portable local MCP access to implemented LifeOS business capabilities while preserving the same authorization, evidence, schemas, review and result semantics as the HTTPS API.

## ADDED Requirements

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
