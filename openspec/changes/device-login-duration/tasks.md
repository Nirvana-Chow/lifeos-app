## EXEC-SESSION-001 / LO-SEC-001 / LO-AUTH-001

- [x] 1.1 Confirm fixed Better Auth1.7.23 native session/cookie/MFA/refresh behavior and preserve ownership boundaries.
- [x] 1.2 Write design/spec and test native duration, cookie alignment, concurrency, MFA rotation, fixed expiry and explicit rolling refresh (RED→GREEN).
- [x] 2.1 Implement request-scoped server-only session policy and default-closed runtime activation.
- [x] 2.2 Implement login picker, native owner-session list/revocation and expiry lock preserving mounted drafts.
- [x] 2.3 Verify actual browser routes/interactions/keyboard/responsive behavior and step-up return paths.
- [x] 3.1 Qualify guarded0024 migration against marked PostgreSQL17.11, runtime/read-only behavior, immutable authentication age and sensitive SQL predicates.
- [x] 3.2 Run full tests/types/complete production build and inspect the same compiled output.
- [x] 3.3 Verify actual OAuth pages, signed-query verification and native password/MFA handlers in Chrome: stale session step-up, definite401 continuation and unknown-result no replay.
- [x] 4.1 Obtain independent review and fix findings; provide exact private overlay interfaces to MCP owner.
- [ ] 4.2 Coordinate normal feature PR/main integration, fixed-SHA CI and original private publication/readback. Production migration remains separately controlled.
- [ ] 4.3 Retain owner experience acceptance as distinct from technical delivery.

## Qualification boundary

Root reviewed117d8c91 and its test/comment-only successors (C0/I0/M0). Shared a106/af225 received independent source review. Candidate f98378e normally merges current main02a with those changes: full public tests2341 pass/95 opt-in skips, types pass; the exact final private15 composition passes full production build and same-artifact44 platform/8 OAuth/10 device and closed-boundary checks. The unchanged Notes consumers add5 same-artifact checks. See [verification](../../../docs/verification/2026-11-14-device-login-duration.md).

Private PR746 merged the independently reviewed three source overlays, preserving the existing alias; it does not adopt or deploy them. The final15 composition includes the shared exact optional flag loader and fixed SQL body alternatives. Chrome4/0fail verifies actual login/OAuth pages, the official signed-query verifier and native MFA handlers, with isolated memory data and a synthetic OAuth provider port. Actual PostgreSQL191118 remains public Auth qualification; new shared readiness PostgreSQL qualification is separately tracked by its owner. Proposed0024 is never applied automatically. Source approval, private source merge and public merge each remain distinct from production account/session activation and owner acceptance.
