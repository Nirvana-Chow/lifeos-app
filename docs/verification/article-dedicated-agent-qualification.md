# LO-ARTICLE-001 dedicated Article Agent qualification

The candidate follows #13, #168 and OpenSpec personal-agent-foundation 10.1. The native Article page and REST contract share the private record writer. The Article-only API key authorizes live v2 discovery and only the Article operations for its exact owner and space. Existing general business, OAuth and server MCP catalogs are independent.

The Article runtime flag is absent by default. Qualification uses the exact flag `LIFEOS_AGENT_ARTICLE=article-v1`, the existing native Article gate and separately qualified restricted Agent storage. A new dedicated, enabled and expiring native API-key row has the exact metadata object `{spaceId, articleAccess:"article-v1"}` and only the Article read or read-plus-write permissions. Existing web credential issuance and scope editing gain no Article option. The SQL proposal is separately approved and applied by the existing owning migration role. It adds one restricted function and changes no key rows or operation catalogs.

Local verification uses a fresh loopback PostgreSQL 17 container with the database `lifeos_platform_test_local`. The opt-in `personal-article-agent-postgres.integration.test.ts` checks the fresh target before provisioning synthetic users and credentials. It exercises the native API-key verifier, v2 discovery, restricted writer, current source/readback, CAS, idempotency, owner/space binding, revocation and the same-row write lock. The existing `personal-article-browser.integration.test.ts` separately verifies the owner web route with synthetic data.

Production activation, new private credential provisioning, end-to-end deployed readiness and owner experience remain separate approval and verification gates.
