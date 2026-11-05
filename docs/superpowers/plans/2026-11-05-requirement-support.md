# Requirement support implementation plan

> **For agentic workers:** Use superpowers:executing-plans in this isolated worktree. Root owns integration/deployment and canonical OpenSpec task status.

**Goal:** Deliver the existing LO-REQ-001 / LO-VERSION-001 roadmap, persistent feedback and actual-version update loop.

**Architecture:** New typed support rows share the existing owner Inbox transaction writer. Conversion is atomic with a normal private requirement creation. Source-backed updates are matched to actual runtime evidence; server-side read preferences do not imply acceptance.

**Tech Stack:** Existing Next/React/TypeScript/PostgreSQL/ReUI, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-05-requirement-support.md`.

## Constraints and review focus

- Preserve original34 IDs/evidence/acceptance, original allowedTypes and owner roles/SQL.
- Default closed owner flag; old Agent credentials cannot read feedback.
- Original text is immutable; no feedback conversion without explicit reviewed fields.
- Same-transaction requirement/link/feedback CAS/receipt; unknown responses retain the exact retry command.
- Running/source/read/owner-accepted facts remain distinct.

## Implementation checkpoints

- [x] Domain/owner persistence: typed feedback/read states, guard/transaction helpers, full snapshots and history, atomic convert/link/archive; focused failure tests first.
- [x] Owner HTTP/runtime: existing identity/origin/body/permit boundaries, independent flag and source/version read evidence, explicit disabled status; no new native owner SQL.
- [x] Keep new feedback Agent operations absent/closed for this owner slice. Existing requirements scopes, issuer and Skill do not acquire raw feedback. Independent explicit machine scopes are a later slice, with separate SQL/readiness only if required.
- [x] Independent roadmap/feedback/update components and guarded routes; durable read preferences and precise unknown-response recovery; hand root the actual entry/hook.
- [ ] Focused source/client/HTTP tests and types, applicable synthetic native/rendered checks when target/slot is declared, independent review and isolated commits. Root completes fixed-SHA CI/release/readback and retains owner acceptance as pending.
