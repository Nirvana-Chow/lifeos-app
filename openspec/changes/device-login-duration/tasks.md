## EXEC-SESSION-001 / LO-SEC-001 / LO-AUTH-001

- [x] 1.1 Confirm fixed Better Auth1.7.23 native session/cookie/MFA/refresh behavior and preserve ownership boundaries.
- [x] 1.2 Write design/spec and test native duration, cookie alignment, concurrency, MFA rotation, fixed expiry and explicit rolling refresh (RED→GREEN).
- [x] 2.1 Implement request-scoped server-only session policy and default-closed runtime activation.
- [x] 2.2 Implement login picker, native owner-session list/revocation and expiry lock preserving mounted drafts.
- [ ] 2.3 Verify actual browser routes/interactions/keyboard/responsive behavior and step-up return paths.
- [ ] 3.1 Qualify guarded0024 migration against marked PostgreSQL17.11, runtime/read-only behavior, immutable authentication age and sensitive SQL predicates.
- [ ] 3.2 Run full tests/types/complete production build and inspect the same compiled output.
- [ ] 4.1 Obtain independent review and fix findings; provide exact private overlay interfaces to MCP owner.
- [ ] 4.2 Coordinate normal feature PR/main integration, fixed-SHA CI and original private publication/readback. Production migration remains separately controlled.
- [ ] 4.3 Retain owner experience acceptance as distinct from technical delivery.
