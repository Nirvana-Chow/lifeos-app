# Fixed managed ChatGPT client — design and implementation plan

> **For agentic workers:** Execute inline with Superpowers executing-plans and TDD; Root provides the independent whole-candidate review. Do not spawn agents.

**Goal:** Let the current native owner with MFA prepare one standard provided/none ChatGPT client, without creating business authority.

**Architecture:** Reuse the same Better Auth 1.7.23 instance, official generateClientId and server-only adminCreateOAuthClient. Add one owner account page and one same-origin GET/POST route. All business delegation still uses the existing signed consent, original grant and transactional OAuth fence.

**Dependency:** Stacked on PR75, exact 4e0da2a2c91fd75d98b3528ae0358efdd4995d2f. Keep that branch/head unchanged; no rebase or force push. This implements existing OpenSpec11.1; shared OpenSpec status remains Root-owned.

## Fixed contract and decisions

- Fixed managed ID: https://lifeos.nirvanachow.com/oauth/clients/chatgpt. The official generator only supplies managed IDs; CIMD registration explicitly supplies its own clientId and remains unchanged.
- Callback input is canonical https://chatgpt.com/connector/oauth/[A-Za-z0-9_-]{8,128}, with no query/fragment/credentials/port/escaping. No callback fetch occurs.
- POST accepts exactly {callback, commandId}; commandId is an original UUID. The server selects fixed name, public none, S256/requirePKCE, code+refresh, one configured resource and current approved config scopes, skipConsent=false and application_type=web.
- The original UUID is stored as nonsecret client metadata with a fixed registration version. Existing complete matching metadata/body is read back; a different UUID/callback/scopes/metadata or client configuration returns409. No update/delete/rotation/automatic expansion path exists.
- HTTP identity is only the current owner Cookie+MFA via readVerifiedOwnerSession(context.readAuth,...). Authorization headers are rejected. Same-origin JSON and original assertLocalRequest apply; headers passed to SDK are cleaned with fixed x-platform-client. Recheck current owner/MFA and readiness before mutation/readback.
- DCR, generic adminHTTP, client_credentials and device grants remain closed. Provider client/resource privilege callbacks allow only owner+MFA create/read and linking the fixed resource; no generic client-management endpoint is added.
- GET projects only fixed public setup fields plus registered callback/original UUID when verified. It never returns raw SDK objects, client_secret, tokens, keys, user/space/grant identifiers or arbitrary metadata.
- Unknown creation results preserve body/UUID. The server independently reads the fixed client and links; only an exact complete match resolves success. No automatic second create after an uncertain call. The UI can explicitly read back or retry the same immutable request.
- SDK evidence: getOAuthClient omits discoveryId/resource links and uses CIMD on a missing HTTPS ID (including a deletion race). Therefore use the official context.adapter findOne/findMany with explicit nonsecret select, fixed model/ID and resource-link lookup for independent readback. No SQL, alternate admin helper, DDL or arbitrary identifier. This is the minimum SDK projection needed to verify managed origin and exact links without initiating discovery.

## Files and interfaces

- Modify src/business-mcp-oauth/provider.ts: official generator and narrow owner/MFA privilege hooks.
- Add managed-client-contract.ts: fixed ID, callback/UUID/body validation and safe projection types.
- Add managed-client.ts: official SDK registration/readback and strict immutable matching.
- Add managed-client-http.ts and managed-client-runtime.ts: exact GET/POST owner route, context reuse; no platform/runtime changes.
- Add app/api/platform/business-mcp/client/route.ts and app/account/mcp/page.tsx.
- Add managed-client-panel.tsx and minimal existing-theme styling; use original ReUI controls/tokens.
- Add focused real-provider, HTTP, UI and optional freshPG tests plus a synthetic fixture helper; no installed Skill or releaseSequence1402 edits.

## Verification tasks

- [x] Observe real official managed registration RED: the unmodified provider generates an opaque/random ID, not the fixed HTTPS ID. Add generator/hooks and turn this GREEN; original CIMD/provider tests remain green.
- [ ] Exercise actual handler and SDK with owner MFA, anonymous/password-only/wrong owner, APIKey/OAuthBearer, foreign origin, malformed callbacks/JSON/extra fields, changed current config, duplicates, concurrent same ID, unknown before/after persistence, mismatched metadata/resource/client state. Memory uniqueness constraint seam is test-only; actual uniqueness/transactions require freshPG.
- [x] Run a real HTTP synthetic server against the actual handler; test exact status/projection/no-secret response and native login/MFA coexistence. No production session or credentials.
- [x] UI: one synthetic browser pass for callback label/input, keyboard submit, pending/unknown body+UUID preservation, explicit independent GET and conflict; no repeated aesthetic capture or real-phone claim.
- [ ] After source is fixed, ask Root for a new strict isolated PG slot; run real official admin registration, unique-ID concurrency, readback and the existing consent/token/CRUD/revocation chain.
- [ ] Focused/full unit, types, one queued full default-closed production webpack build and same-output44+8+4/Skill bytes plus new management-route closed checks; Root independent review, normal feature Draft PR and production configuration handoff.

## Global constraints and review focus

Only approved new modules/routes/page/tests/docs and provider.ts are writable. No shared platform/runtime, agent config/runtime, Skill, SQL0021, private overlay or Key manager panel edits. No real registration, account authority, flags, business rows or schema mutation. Heavy build and browser/PG slots belong to Root until assigned.

Review specifically: SDK discovery fallback; stale owner/MFA during a call; UUID reuse with changed body; concurrent client insert with incomplete resource link; unknown response after official persistence. Metadata preparation alone never grants business access. Default closure, session/cookie policy and original Key/native behavior remain unchanged.

## Source checkpoint before PostgreSQL qualification

Root confirmed the fixed official adapter projection and reuse of the existing ownerRecoveryLock. Real official SDK fixed-ID and missing-MFA REDs became GREEN. Current focused memory/HTTP tests cover strict callback/UUID, safe response projection, metadata drift, unknown before/after persistence, foreign origin, APIKey/JWT rejection and current MFA under the lock; actual PG concurrency and transaction behavior remain unexecuted until a new Root-owned fixture.

Four native Chrome scenarios passed with actual components and the actual HTTP handler backed by synthetic official SDK storage: desktop keyboard save/readback;360px lost response then reload/same original request/GET; explicit same-body+UUID retry;409 without replacement. The first browser attempt retained three valid passes and one test-fixture assertion failure from reading a raw memory JSON string; only that conflict assertion was corrected to use independent handler GET. Product UI/HTTP bytes were unchanged and the narrow recheck passed. This is not a real owner, ChatGPT installation or phone/Mac-offline acceptance.

The preliminary full unit run passed2225 with0 failures and85 explicit opt-in skips. A later erased test return-type annotation fixed TypeScript inference in the new PG callback, and the already-effective canonical UUID guard received an additional passing test. Fixed-source PostgreSQL and final production/same-output gates remain open; no production registration, flags or schema mutation occurred.

