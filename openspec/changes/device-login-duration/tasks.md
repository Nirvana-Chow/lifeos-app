## EXEC-SESSION-001 / LO-SEC-001 / LO-AUTH-001

- [x] 1.1 Confirm fixed Better Auth1.7.23 native session/cookie/MFA/refresh behavior and preserve ownership boundaries.
- [x] 1.2 Write design/spec and test native duration, cookie alignment, concurrency, MFA rotation, fixed expiry and explicit rolling refresh (RED→GREEN).
- [x] 2.1 Implement request-scoped server-only session policy and default-closed runtime activation.
- [x] 2.2 Implement login picker, native owner-session list/revocation and expiry lock preserving mounted drafts.
- [x] 2.3 Verify actual browser routes/interactions/keyboard/responsive behavior and step-up return paths.
- [x] 3.1 Qualify guarded0024 migration against marked PostgreSQL17.11, runtime/read-only behavior, immutable authentication age and sensitive SQL predicates.
- [x] 3.2 Run full tests/types/complete production build and inspect the same compiled output.
- [x] 4.1 Obtain independent review and fix findings; provide exact private overlay interfaces to MCP owner.
- [ ] 4.2 Coordinate normal feature PR/main integration, fixed-SHA CI and original private publication/readback. Production migration remains separately controlled.
- [ ] 4.3 Retain owner experience acceptance as distinct from technical delivery.

## Qualification boundary

Source review is fixed to117d8c91 (C0/I0/M0), with actual native/HTTP/PostgreSQL17.11, full tests/types/build and same-output checks. The subsequent test/document-only commit adds remembered-session password-change/reset revocation coverage; application source and dependency bytes are unchanged. The build remains evidence for those exact application bytes.

Private delivery still requires the single owning integration track to preserve its existing login alias while replaying Auth/Runtime/PageAccess seams, admit only the exact optional session flag in the strict loader, admit the exact hardened SQL body fingerprints, and return stale sensitive OAuth actions to fresh login with the original signed query. Proposed0024 is never applied automatically. Neither source approval nor public merge activates production account/session policy.
