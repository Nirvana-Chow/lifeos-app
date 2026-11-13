# Better Auth schema provenance

The proposed OAuth PostgreSQL schema in `db/0021_business_mcp_oauth.proposed.sql`
is derived from the official `@better-auth/oauth-provider` 1.7.23 model fields and
Better Auth 1.7.23 PostgreSQL migration type mapping. In particular, `string[]`
fields use `jsonb`. The application-specific authority tables, functions and
activation gates are identified separately in that migration.

- Upstream: <https://github.com/better-auth/better-auth/tree/v1.7.23>
- OAuth models: `packages/oauth-provider/src/schema.ts`
- JWT model: `packages/better-auth/src/plugins/jwt/schema.ts`
- License: MIT, retained in `LICENSE` from the fixed npm package.
- Runtime packages stay pinned in the single npm lock. No schema migration is
  performed by importing the plugins or this source candidate.
