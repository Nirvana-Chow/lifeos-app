## Why

LifeOS Agent todo access is available in production. An operator currently signs and revokes grants through a private path. The space owner needs to manage that access in LifeOS and select an expiry with a one-year ceiling.

## What Changes

- Add an API Key settings page with scoped issuance, expiry selection, safe metadata, and revocation.
- Require a replacement key for rotation or a new expiry.
- Keep issuer credentials behind a separate server-side control path.

## Capabilities

### New Capabilities

- `agent-key-management`: Owner-only creation, listing, and revocation of expiring Agent keys.

### Modified Capabilities

None. The existing Agent todo API retains its operation contract.

## Impact

Account settings, the owner session authorization boundary, private issuer deployment, synthetic PostgreSQL acceptance, and the LifeOS Agent Skill credential instructions.
