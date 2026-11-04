## 1. Approve the issuer boundary

- [x] 1.1 Confirm the isolated, default-off management service and the owner's session verification design.
- [ ] 1.2 Prove session and MFA checks on disposable PostgreSQL before selecting live privileges.

## 2. Build management

- [x] 2.1 Add bounded issuance, metadata listing and revocation with the pinned Better Auth plugin and existing grant fence.
- [x] 2.2 Add API Key settings using the existing account shell and ReUI. Cover one-time reveal, custom expiry, replacement and revoke.
- [x] 2.3 Update the LifeOS Agent Skill credential instructions and keep its operation reference in sync.

## 3. Qualify and deliver

- [ ] 3.1 Test missing, excessive, expired and boundary lifetimes, unauthorized management, both concurrent revocation orders, and redaction.
- [ ] 3.2 Verify settings on desktop and mobile, review the diff and run fixed-SHA CI.
- [ ] 3.3 Obtain production trust approval, then verify runtime and public access with an owner-approved grant and a minimal readback.
