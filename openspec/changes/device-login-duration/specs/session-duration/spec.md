# Session duration

## ADDED Requirements

### Requirement: Device-selected server session lifetime
The system SHALL default to a fixed 1800-second session. It SHALL accept a fixed duration from 60 seconds to 365 days, and a rolling mode with a 400-day browser ceiling. Session fields SHALL be server-only and fail closed on invalid policy. Fixed sessions SHALL expire without GET or POST extension.

#### Scenario: Reopen a remembered device
- GIVEN a valid persistent native cookie and unrevoked server session
- WHEN the owner reopens LifeOS
- THEN ordinary access SHALL resume without another password or MFA prompt
- AND refresh SHALL use a same-origin POST with matching server and cookie expiry

#### Scenario: Expiration or revocation
- GIVEN an expired or revoked session
- WHEN it is presented to any owner endpoint
- THEN access SHALL fail and the active page SHALL lock while retaining drafts and the current safe return path

### Requirement: Separate security freshness
Sensitive account/delegation operations SHALL require owner MFA and a fresh authentication window of at most 1800 seconds. Ordinary session refresh SHALL NOT refresh authentication age. Password change and recovery SHALL retain native revocation.

### Requirement: Read-only and privacy boundaries
GET and read-only-role authentication SHALL NOT renew sessions. Account session listing SHALL return no bearer tokens. Device revocation SHALL use native deletion after owner/MFA validation. Anonymous callers and business MCP SHALL receive no account-session authority.
