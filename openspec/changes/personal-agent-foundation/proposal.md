# Proposal

## Why

LifeOS currently exposes individual business tools without a durable personal assistant that can explain its evidence, preserve review decisions, and resume safely. The owner needs one inspectable website workflow for authorized context, organization proposals, review, execution and verified results, with the same business capabilities available through API, Skill and MCP.

## What Changes

Current owner priority (2026-11-05 live review): requirements/matters first, then usable personal business data with API/Skill, then the durable Agent and modular extensions. Retain the candidates below as later architecture, not a prerequisite blocking the data system. See the [refinement specification](../../../docs/superpowers/specs/2026-11-05-owner-review-refinement.md).

- Establish a single LangGraph JS orchestrator with a PostgreSQL checkpointer and a mature PostgreSQL worker; retain AI SDK as the bounded model/structured-output client and the existing business services as the authoritative writers.
- Add typed source coverage, confirmed facts/goals/preferences, inferences, immutable proposals, review receipts, run authority and budget reservations. Import approved source packages through versioned typed mappings while preserving originals and source authority.
- Deliver visible website slices: organization and explicit scope settings; atomic classification review; context/coverage and migration reconciliation; durable run progress; professional business views; evidence-backed insights and a local MCP adapter.
- Extend scope management only through owner/MFA CAS. Preserve the six legacy todo operations and `/v1/capabilities` semantics; add a version-2 capability catalog for multi-scope and organization-only grants. Generate API/discovery, Skill and MCP projections from one registry.
- Permit background delegated runs to read and preview only. Owner-only approval remains a current MFA website action; exact API commits require the stored approval and current producer authority.
- Keep new runtime features closed by default. Real SQL/roles, permission expansion, private-source migration, model egress/costs and persistent worker/system settings require concrete activation packages; routine source implementation continues through technical review and existing delivery gates.

## Capabilities

### New Capabilities

- `personal-context`: Versioned evidence, confirmed context, inference lineage and truthful authorized coverage.
- `source-migration`: Immutable source packages, typed mapping previews, conflict review, idempotent application and reconciliation without deleting originals.
- `agent-authority`: Server-constructed actors, constrained run delegation, explicit business scopes and compatible capability catalogs.
- `organization-management`: Scoped project/domain/topic operations using the existing website business model and writer.
- `action-review`: Fixed-digest owner approval and atomic, recoverable todo classification without unattended business writes.
- `agent-runs`: One durable orchestration loop, restricted checkpoints, worker recovery, bounded budgets and observable outcomes.
- `agent-workbench`: Usable website slices connecting review, context, run progress and professional business modules.
- `agent-mcp`: A local stdio adapter projecting implemented authorized operations from the same registry and HTTPS services.

### Modified Capabilities

None. `openspec list --specs` currently reports no synchronized main specs. Existing change-local `agent-operation-contract`, `agent-key-management` and `workspace-interface` remain referenced dependencies with their original task and qualification state; this parent change does not archive, copy completion state or silently rewrite them. A1 explicitly extends the supported key preset set when organization is enabled, preserving the old todo-only behavior by default and all existing expiry/replacement gates.

## Impact

Original requirement IDs and Issues remain authoritative: LO-AGENT-001/#35, LO-AI-001/#19, LO-DATA-001/#10, LO-SOURCE-001/#4, task/project #5/#7, capture #18, search #9, privacy/auth #3 and backup #20. Professional domains retain #6/#12/#15/#11/#32/#33/#34; see the existing 34-ID intake rather than a new backlog. The original `unified-business-ui` five tasks retain inherited 2/5 and all open rendering, performance and delivery gates.

Affected areas include the Agent registry/issuer, PersonalService, typed intake and context services, owner review UI, a separate run/checkpoint/job boundary and a portable MCP package. New dependencies are fixed qualification candidates, not installed or verified by this proposal: LangGraph JS, its PostgreSQL saver, Graphile Worker and official split MCP SDK. Public CI remains source/synthetic and read-only; this change grants no production authority or access to company data.
