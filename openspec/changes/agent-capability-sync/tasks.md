# Tasks

## 1. Isolated Agent todo contract

- [x] 1.1 Add the versioned Agent adapter and shared operation registry. Reuse the existing record service, injected grant verifier and write guard.
- [x] 1.2 Verify scope and owner isolation, strict version handling, record validation, write conflicts, and idempotent replay with synthetic fixtures.

## 2. Skill synchronization

- [x] 2.1 Write the Skill instructions for capability discovery, permitted operations, and safe retries.
- [x] 2.2 Generate the operation reference from the registry and check for drift during source verification.

## 3. Source qualification

- [x] 3.1 Run the scoped tests and confirm the production runtime has no Agent route registration.

## 4. PostgreSQL qualification

- [ ] 4.1 Run the pinned API key plugin and existing record service in the disposable PostgreSQL fixture. Verify scoped authorization, expiry, throttling, revocation inside the write guard, and saved-record readback.
