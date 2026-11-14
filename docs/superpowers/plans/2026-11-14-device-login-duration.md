# Device Login Duration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Root directly assigned this isolated writer; no grandchildren.

**Goal:** Deliver server-backed per-device login duration with native expiry, renewal and revocation.

**Architecture:** A small Better Auth plugin selects request-scoped session/cookie lifetime and stores two server-only session fields. Fixed sessions never renew; rolling sessions use native deferred POST refresh. Read-only auth stays read-only. Dedicated owner session settings and an expiry guard preserve existing drafts and return paths.

**Tech Stack:** Next 16.4.1 / React 19.3.0 / Better Auth 1.7.23 / PostgreSQL; exact existing lock, no install.

**Spec:** openspec/changes/device-login-duration/specs/session-duration/spec.md

## Global Constraints
- EXEC-SESSION-001 / LO-SEC-001 / LO-AUTH-001; default1800s, fixed60..31536000s, rolling34560000s.
- Never mutate private frozen auth/runtime/profile or MCP registry/Skill.
- Read-only auth and GET remain non-mutating. Native cookies remain HttpOnly/Secure/SameSite Strict, no cookie cache.
- Owner/MFA/reset revocation remain enforced; no trusted-device bypass.
- No dependencies/lock change. Current MCP epoch/main integration coordinated with owner.

## Review Focus
- MFA challenge spanning two requests and enrollment rotation retains the selected policy.
- Cookie tampering, omitted/invalid durations and parallel requests do not share mutable policy.
- Read-only/expired/revoked sessions never renew or obtain account-security authority.
- Rolling renewal never changes createdAt or fresh-MFA age.
- Expiry while editing locks requests without discarding retained drafts or creating duplicate writes.

### Task 1: Native session policy and schema readiness
Files: src/session-duration/{policy,native,readiness}.ts, db/0024_device_login_duration.proposed.sql, src/platform/auth.ts/config.ts/runtime.ts, test/session-duration-native.test.ts.
- [ ] Write actual native memory-adapter tests for fixed1800/day/custom, invalid inputs, MFA rotation, real cookie expiry and parallel isolation; observe RED.
- [ ] Implement server-only policy fields and request-scoped native configuration. Preserve original behavior while readiness is absent.
- [ ] Test deferred POST rolling refresh, GET/read-only no writes, true revocation and fresh-MFA separation.
- [ ] Add guarded isolated migration/readiness and test actual PostgreSQL auth/read-only ACLs.

### Task 2: Login and owner controls
Files: src/personal-candidate/login*, src/session-duration/{picker,guard,settings,owner-access}.*, src/personal-candidate/live-workspace.tsx, app/login/page.tsx; dedicated tests.
- [ ] Test duration propagation through password/MFA and safe continuation, observe RED then add picker.
- [ ] Test redacted device list/revocation and same-origin/owner/fresh-MFA denial, then wire dedicated settings.
- [ ] Test expiry locking/draft continuity and valid-session reopen, then mount guard.

### Task 3: Delivery
- [ ] Run affected/native/HTTP/PG/UI tests, full project tests, typecheck and complete production build plus compiled-artifact check.
- [ ] Root independent code review; correct substantive findings.
- [ ] Coordinate main epoch and exact private overlay seams before normal feature PR/merge/CI/publication/readback.

## Source calibration
Official stable release checked 2026-11-14: https://github.com/better-auth/better-auth/releases/tag/v1.7.23 . Native session docs: https://better-auth.com/docs/concepts/session-management ; 2FA docs: https://better-auth.com/docs/plugins/2fa . Installed native source confirms rememberMe:false omits cookie Max-Age and uses a one-day native DB lifetime; custom expiry requires server fields/hooks. Trusted-device bypass is a different security choice and remains disabled.
