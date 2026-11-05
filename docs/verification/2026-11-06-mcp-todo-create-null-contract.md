# Todo create-null MCP contract correction — 2026-11-06

Base `ff6af1efe7a47b706978c78c33fa3451d7fda0c0`; a narrow correction of the reviewed MCP source contract. No backend, native credential runtime/Swift copy, client/config, operation registry, scopes, provenance, Skill, dependency or production setting was changed.

## Evidence and correction

The real `createAgentHandler` fixture returns HTTP 400 `INVALID_BODY` for `createTodo` with `fields.personal:null`; POST with personal omitted succeeds, POST with a real current project relation succeeds, and PATCH with the complete fields and `personal:null` succeeds and clears the relation. The domain todo validator treats a present personal value as a relation object; only the native HTTP PATCH adapter removes null for its clear operation. The MCP parser had removed null during validation for both methods, then returned the unmodified body, incorrectly permitting a POST that the API would reject.

Creation discovery now advertises personal as optional or a relation object, without null. Parsing applies the existing null-removal validation rule only on PATCH; POST null reaches the original canonical `validateTodo` and rejects with `INVALID_BODY`. No normalization authority, body rewrite, key replacement or scope/operation tuple is introduced. PATCH still returns the full original wire fields including null so the native clear behavior is retained. Existing create relation objects continue to work through MCP and the actual native writer with independent GET.

Schema and parser failures were each observed red before their respective fix: first JSON Schema incorrectly accepted null, then the unchanged parser failed to throw. The regressions now prove omitted/object creation, explicit-null rejection, unchanged caller body/key and PATCH-null preservation. Actual-handler tests additionally exercise current project pins and read back the saved and cleared relations.

## Verification and handoff

- `node --test test/lifeos-mcp-adapter.test.ts test/lifeos-mcp-inherited.test.ts test/lifeos-mcp-discovery.test.ts test/lifeos-mcp-stdio.integration.test.ts test/three-business-agent.test.ts`: **40 passed, zero failed/skipped**. The existing 50-operation discovery/argument pairing, authorization/tuple checks, native records, CAS and exact recovery tests remain included.
- `npm run typecheck` and `git diff --check`: passed. A scoped diff confirms all backend/native/client/config/package/lock/provenance/Skill files remain unchanged.
- The public candidate client still refreshes its authorized catalog before parsing. This slice proves a pure local parser rejection and no business POST; it does not claim zero catalog/provider access for that unchanged client. The separate native-runtime author owns moving local operation lookup/parse ahead of its credential and discovery seam, while retaining fresh discovery before valid dispatch. This writer does not modify the private closure.
- Two source files for that author's exact closure synchronization: `schemas.ts` SHA-256 `f750a054054bb99a749d5b4d2d570f6ef9baa3c67e2a17e02f9130e3b269cc7c`; `field-schemas.ts` SHA-256 `809c288979f2f04b7b51476655ea20b936378f7f74a4f5086222278bfdb97af9`.

No push, host/Keychain/live API access, real credential/data action or production qualification was performed. The default MCP executable remains closed. Root's narrow independent review and the separate credential/runtime qualification remain required.
