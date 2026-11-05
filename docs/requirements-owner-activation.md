# Owner requirements activation

This source implements LO-REQ-001 through the existing unified-business-ui criteria and personal-agent-foundation9.7. Source, native synthetic qualification, deployed capability and owner experience acceptance remain distinct. Do not migrate private records or execute this document as an automatic SQL/runtime change.

## Minimal website capability

On an already approved owner deployment, add only:

```text
LIFEOS_PERSONAL_REQUIREMENTS=requirements-v1
```

Keep `LIFEOS_PERSONAL_ALLOWED_TYPES` unchanged (`todo,journal` or its existing approved `todo,journal,project,domain,topic` form). A requirement is an independently typed schema2 inbox record under PersonalService.requirements, rather than a generic personal type. Existing todo/journal/organization readers ignore these rows. No new owner PostgreSQL role, ACL, table or migration is required. Existing owner MFA, same-origin checks, current sessions and the current business write policy remain mandatory. A legacy deployment using a source/config-bound write permit must refresh that existing permit for the approved source/config binding; a stale permit intentionally keeps writes closed. Owner-managed writes use their existing configured authority.

Keep `LIFEOS_AGENT_REQUIREMENTS` absent and retain the existing issuer mode/key permissions. Website CRUD does not require proposed0014, a requirements Agent grant, an Agent module flag, a new model or a website Agent. Proposed0014 and `businessScopes:'requirements-v1'` apply only to a separately approved Agent scope activation; they never modify existing keys automatically.

Without the owner flag, status returns `requirementsEnabled:false`; the page states “当前仅可查看公开需求。”, disables create and shows readonly public detail. With the flag but a closed existing write policy, complete authorized reads remain available and create/save stay disabled. A changed/foreign owner clears visible private rows and editor state; pending recovery remains scoped to its original owner/space in browser storage.

## Source and prerequisites

1. Bind deployment to the reviewed source SHA and its unchanged dependency lock. Build through the existing trusted publication path and preserve previous-image rollback.
2. Verify existing schema2 persistence/restricted repository, complete-current snapshot support, native owner MFA and the approved owner/space. The owner module reuses platform_record/source/history/command and owner RLS. Its first public-row overlay uses a transaction advisory identity lock plus the existing owner/UUID primary key; do not substitute a generic writer without that capability.
3. Prepare the sole flag delta above through the existing protected runtime mechanism. It is not permission to read/echo keys, widen grants, migrate records or apply optional SQL.

## Runtime readback

Use the authenticated owner session in the actual target. No session tokens belong in output/logs.

1. Read `/api/platform/personal/status`: current owner/space, `requirementsEnabled:true`, existing `storageVerified:true`, and current `writable:true` for edits. Unauthenticated/foreign sessions must still fail.
2. Read `/api/platform/personal/requirements/snapshot`: scope `full-current-requirements-snapshot`, `truncated:false`, total matches all returned items; all34 public IDs remain. Private text must never enter public Git or Issues.
3. If synthetic write qualification is explicitly authorized for that target, create one clearly marked synthetic requirement in the website with long text, P3, a phase and actual optional dates. Close/reload, reopen by the returned stable ID and compare title/body/phase/priority/dates/sourceId/revision. Edit and repeat reload/readback. No creation is implied merely by publication authority.
4. Verify bounded `/{id}/history`, stale revision/baseline rejection and exact same-key/body recovery of a deliberately unknown synthetic response. Public overlays retain immutable evidence and acceptance. No implementation or owner acceptance is inferred from a saved edit.
5. With the Agent flag absent, v2 discovery and actual requirement endpoints remain unavailable regardless of todo/organization grants. Legacy catalogs/issuer stay usable.

## Rollback

Remove the owner requirements flag or restore the previous qualified image/config through the existing release path. Public readonly requirements and old task readers remain; private requirement records, history and command receipts stay in PostgreSQL. Do not delete or transform them, reset MFA or broaden grants. Disable affected access if the older deployment cannot safely read its existing owner records. Browser pending commands remain secondary recovery material, scoped to their original owner/space; they are never the authoritative business pool.

## Current evidence

Independent synthetic PostgreSQL17.11 qualification uses a separately declared host Docker container behind an explicit temporary SSH loopback forward at Mac127.0.0.1:55452, with exact source-hash/fixture markers. It covers deterministic concurrent first overlays/CAS,16K text persistence, restarted-service readback, update/history, exact lost-response replay, restricted optional requirements issuer and revocation fences. It is not a local Docker deployment or production acceptance. Actual Chrome qualification uses the real UI and same owner HTTP/service with explicit synthetic memory storage; its PostgreSQL evidence remains separate. The coordinator records exact commands, results, source SHA and target cleanup ownership in the delivery report.
