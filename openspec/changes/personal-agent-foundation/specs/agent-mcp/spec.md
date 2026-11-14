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

### Requirement: File permissions and receiver adoption remain explicit

Under task11.6, the four `fileHandoff` operations SHALL use the independently versioned `file-handoff-v1` grant permission and exact `file-handoff:read`/`file-handoff:write` scopes. Existing todo, requirements and `all-personal-business-v1` grants MUST NOT inherit them. Only the original owner/MFA key-management path may change this permission using original-grant digest plus file-permission revision CAS.

#### Scenario: File authority is read, delegated or executed

- **WHEN** current file authority is read, delegated or executed
- **THEN** backend current-grant readers, OAuth consent/token publication and original-client SQL execution SHALL enforce the current permission
- **AND** OAuth refresh/reconnect SHALL retain the original grant/owner/space command namespace and SHALL NOT confer website/Codex consumer identity

#### Scenario: File permission is withdrawn while a writer waits

- **WHEN** an original file writer waits behind a committed scope/permission/identity change
- **THEN** it rechecks the exact permission and OAuth fences on the original SQL client before business mutation, without changing old business grants or silently using engineering/account authority

#### Scenario: An uncertain transfer already has complete original bytes

- **WHEN** the original staging command is reconciled after its transfer lease expires
- **THEN** only the known complete atomically published original may supply independently recomputed SHA/bytes; the old writer is fenced before readiness, the original command/receipt and linked target source remain stable, and no replacement URL download is inferred from expiry

#### Scenario: A consumer is not adopted or cannot verify bytes

- **WHEN** an old host lacks explicit executable adoption, or actual downloaded/local bytes fail SHA/size/no-overwrite checks
- **THEN** the binary receive/ack capability stays unavailable; downloaded Skill updates, client names, prompts and Base64/model checksums cannot authorize it or produce a successful acknowledgment

#### Scenario: Public runtime is covered by a private overlay

- **WHEN** file runtime composition intersects a separately maintained deployment overlay
- **THEN** public build success does not establish a deployed entry; the private composition must retain the new reviewed contexts and independently pass its original release qualification before activation

### Requirement: Explicit full business consent reuses the current original authority

Under task11.1, business MCP exposure SHALL derive from the reviewed executable Agent registry. Full OAuth consent SHALL require both explicit `personal-business:all` and the current original `all-personal-business-v1` grant. Effective operations SHALL intersect reviewed enabled registrations, available modules and the same original grant. Narrow grants and consents MUST NOT become full by inference.

#### Scenario: A reviewed business operation is delivered

- **WHEN** a new personal business operation is reviewed and enabled
- **THEN** its API, MCP and Skill contracts and approved SQL registration SHALL be delivered together without changing old Agent wire definitions
- **AND** account/security, engineering execution, owner-approved commit and independently permitted file consumers SHALL retain their original boundaries

#### Scenario: A full-policy OAuth caller previews a classification

- **WHEN** the authorized caller saves a classification preview
- **THEN** the original plan and immutable OAuth producer metadata SHALL save or roll back on the same original transaction, binding plan ID, digest, version, expiry and current token/binding/policy authority
- **AND** expiry SHALL not exceed the original plan limit or producing token lifetime; owner subset selection SHALL retain that authority and expiry

#### Scenario: Producer authority changes before owner action

- **WHEN** the producing token is revoked, its binding is replaced, its original grant changes, its module becomes unavailable or plan metadata conflicts
- **THEN** owner approval/commit/recovery SHALL fail closed rather than adopt an old plan through a still-live API key, new consent or replacement binding
- **AND** MCP SHALL NOT expose classification approval/commit or engineering claim operations
