# Requirement support owner activation candidate

This is an activation checklist, not a record of production activation. Root owns the private image overlays, runtime package, CAS operator, host and real-data decisions. No SQL, grants, keys or real records were changed by this slice.

## Minimal delta

Deploy the reviewed source containing the owner support service/HTTP, source-backed release reader and three guarded routes. Rebase the existing private `src/personal-candidate/config.ts` overlay onto the public flag/type change; do not overwrite the other private constraints. Public source alone cannot prove the private image accepts the new flag. Re-pin the normal source/image/runtime binding and run the existing compiled closed-default/startup checks on the actual image.

The sole new owner runtime setting is:

```text
LIFEOS_PERSONAL_REQUIREMENT_SUPPORT=requirement-support-v1
```

Prerequisite: the already approved `LIFEOS_PERSONAL_REQUIREMENTS=requirements-v1`, existing owner MFA, restricted owner PostgreSQL access and owner write gate. Existing `LIFEOS_PERSONAL_ALLOWED_TYPES` remains unchanged (the original two or five types). Owner support reuses Inbox JSONB/source/revision/history/receipt tables and the same identity locks/transaction writer. There is no new owner migration, role, table grant or runtime function EXECUTE. No Agent feedback route/scope is registered; old requirements keys cannot read feedback raw text. Agent issuer, readiness and machine grants remain unchanged.

`personalPermitBinding` includes the new boolean only when enabled. Existing flag-absent configurations retain their digest; when a finite write permit is used, activation needs the normally bound new permit. `owner-managed` mode retains its current owner guard; this slice does not change that policy.

## Fixed readback before real input

1. Read `/api/platform/personal/status` through the current owner session: require `requirementsEnabled: true`, `requirementSupportEnabled: true`, the exact owner/space and existing writable/storage state. Missing flag must report `false` and feedback HTTP must return 404.
2. Confirm the three pages `/personal/requirements/roadmap`, `/personal/requirements/updates`, `/personal/requirements/feedback` and the real pool entry links. Root adds the entry to the existing pool/workspace; no unfinished link is advertised by the old source.
3. Read `/api/platform/personal/requirement-support/releases`: current source/build comes from the image-local proof plus matching `LIFEOS_REVIEW_GIT_SHA`; absent/invalid proof returns `current: null`. Public notes explicitly remain source history; neither the source SHA nor an update read preference claims owner acceptance or a passed visual qualification.
4. On the declared synthetic native target only, verify create/restart/get, same-transaction conversion, exact retry after lost response, revision conflict/rollback, link/reverse lookup, archive/history, durable version read and unchanged generic task counts. Do not write synthetic rows into the real owner space. Memory tests are not native PostgreSQL acceptance.
5. With actual-image closed-default checks and synthetic evidence reviewed, root can activate the finite runtime delta and perform authorized owner UI readback. Final owner experience acceptance remains pending until the user performs it.

## Rollback and retained data

Remove only the new flag using the normal runtime CAS package and restore the prior reviewed image/binding if necessary. The routes clearly show unavailable persistence; public source notes may remain readable. Support rows and original source/history/receipts stay in the same restricted database and are ignored by generic personal task/overview classification. Do not delete them, reset the schema, widen keys or rewrite existing requirement evidence/acceptance as rollback.

The browser retains only an unresolved command under a versioned owner+space key and clears it after server readback. It does not supply business rows. Unknown requests must be recovered with the original key/body; a denied recovery does not clear an uncertain command.
