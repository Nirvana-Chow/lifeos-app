# Storage note API/MCP/Skill contract

LO-AGENT-001 / LO-FILES-001. Consume the storage-note domain contract and reviewed draft-CAS correction without changing the storage implementation again.

Shared Agent routing and local MCP path/schema support now include `updateStorageReviewNote`, `PATCH /v1/storage-reviews/{id}/notes`, the original record/checklist revisions, exact item ID, raw note and original idempotency key. Empty text clears the note; whitespace/newlines remain unchanged. Shared receipt verification uses the original storage-field normalizer and a separate same-ID GET. Historical replay is distinguished from a newer current revision.

The original strict discovery assertion reproduced5 versus6 operations before the fix. Three additional functional tests observed RED then GREEN for schema fidelity, save/clear/readback, unknown-response replay and current write-fence denial. The affected storage/MCP/OAuth/Skill test selection passed35 tests; TypeScript passed. These are synthetic handler/contract checks, not public HTTP acceptance.

New0026 registers the same operation/scopes in the original business-policy and OAuth registries, with business-policy `enabled=false`. Original0019 and0021 remain unchanged. A marked PostgreSQL17.11 SSH-loopback fixture actually verified missing-registration denial, missing approval and restricted-role denial, both registrations, default-off fencing, explicitly enabled fixture success, grant-revocation denial and unchanged original grant. Final result:1P/0F/0skip, sourceDigest `7e91813daa8f03bca3d9d8461827abc62354bae6b2e3b9f3e6471acd57358014`.

The first PG attempt correctly failed closed after `pg.Pool.query` disposed an erroring session and lost its session approval GUCs. Actual backend-PID/GUC readback confirmed that cause. The fixture test now holds one explicit `PoolClient` across migration negatives and checks the PID. Its first failure remains recorded; only the exactly observed synthetic setup was reversed in the same fixture before the second attempt. Product SQL was unchanged and original0021 was not replayed.

Skill reference/archive are regenerated from the reviewed source allowlist, sequence2026111403. No installed Skill, actual grant, production migration or runtime flag is changed. The notes track must qualify the changed combined app source with a fresh complete build and same-artifact checks before PR/release; earlier storage-only builds do not cover this shared change. Full-business OAuth policy is a separate0025 slice and is not required to review this source commit.
