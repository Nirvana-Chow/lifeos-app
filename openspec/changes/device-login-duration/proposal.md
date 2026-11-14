# Per-device login duration

Requirement: EXEC-SESSION-001; LO-SEC-001 / LO-AUTH-001.

Default login lasts 30 minutes. The owner may instead choose one day, seven days, a custom bounded duration, or keep signed in on this device. Server session policy, expiry and native cookie lifetime agree. Fixed sessions never slide. A persistent session rolls within the browser-supported 400-day cookie ceiling; clearing browser data, security changes, revocation or 400 days without use can require login again.

Reuse Better Auth 1.7.23 native sessions, signed cookies, MFA and revocation. Do not enable trusted-device MFA bypass. Ordinary access remains valid for the selected duration; sensitive delegation/account actions retain a separate fresh-MFA boundary. Recovery/password change invalidate all affected sessions. Device settings list redacted session IDs and revoke sessions without exposing bearer tokens.

The feature activates only after an explicit schema/ACL readiness check. Read-only authentication and all GET reads remain unable to extend or mutate sessions. Only same-origin owner-selected rolling sessions may renew through native deferred POST refresh. No business MCP account-security operation is added. Existing drafts and OAuth continuation remain intact.

Public source delivery does not change the frozen private overlay or current MCP production epoch. Exact private synchronization seams are delivered separately.
