## Context

Production verifies API keys with the pinned Better Auth API Key plugin, a dedicated read and usage role, and a PostgreSQL write fence on the authorization row. The existing private issuer uses another role. The account area already has owner login and MFA, and the repository uses ReUI for application controls.

## Goals / Non-Goals

- Give the owner a settings page for creating, viewing and revoking todo credentials.
- Keep the maximum lifetime enforceable server-side and preserve the existing revocation fence.
- Keep the existing Agent operation registry and transport behavior. Credentials do not become browser sessions.

## Decisions

1. Reuse Better Auth's server-side `createApiKey` and `updateApiKey` with the current pin, and reuse existing account navigation and ReUI. Use a bounded owner-and-space projection for listing. Better Auth's session list endpoint expects a user session in its own auth store. The dedicated Agent auth compatibility tables remain empty.
2. Keep issuance in a separate default-off private control service. Before exposing management, prove the service can independently verify the existing owner session and MFA using narrowly scoped access. The verifier process must not gain the issuer credential. The web client connects to the fixed Unix socket at `/run/lifeos-agent-issuer/control.sock`. The host may mount the protected socket directory read-only into the web process so an issuer restart can replace its socket inode. Evaluate that authentication bridge on disposable PostgreSQL before any production trust change. Mounting the plugin's generic management endpoints or trusting an owner ID asserted by the browser would expand the control surface.
3. Use a 365-day cap measured from server time. Offer 7-, 30-, 90- and 365-day presets measured by the issuer, and a custom expiration with explicit timezone. Validate before issuance and set the matching plugin cap. Rotation means issuing a separate key, validating it, then revoking the earlier key.
4. Render the plaintext once in the create response with no caching. For older keys without a stored prefix, show a grant identifier. Management returns allowlisted metadata only.
5. Require the verified owner session and same-origin protection on changes. Bind the space and supported permissions on the server. Revocation updates the same grant row the write transaction locks. Leave active grants valid until their own expiry or revocation.
6. Use an owner-only synthetic browser fixture for UI and a disposable database for session, permissions, expiry, and revoke/write concurrency. Qualify production activation separately under its own explicit approval.

## Risks / Trade-offs

- A management service that trusts arbitrary assertions from the website moves the issuer boundary without isolating it. Require independent session verification and a constrained interface before proceeding to live activation.
- An interrupted create response can leave an active key whose plaintext is unavailable. Show its metadata so the owner can revoke it and issue a replacement. Avoid automatic retries that create extra grants.
