# Credential runtime

Install this Skill directory with its references in your agent's supported Skill location. Sharing this package shares instructions only. Each user signs in to their own LifeOS instance, completes its required verification and issues their own least-privilege key in Settings → API keys.

Configure the exact approved HTTPS origin, API base `/api/platform/agent` and a credential-store reference in the local runtime. A store reference is not the key. Keep account-specific configuration outside the Skill package and Git. Prefer the operating system credential store or the agent platform's documented secret input; do not paste keys into chat, shell arguments, URLs, environment dumps, code or shared files. Do not share a configured credential with another user.

The credential reader must send the key only in the Authorization header, reject redirects, use normal TLS validation, disable persistent cookie/cache storage, bound responses and avoid logging headers or secret values. A downloaded Skill is not an executable credential reader and does not grant access by itself. If no approved runtime is available, explain the missing setup instead of extracting secrets or falling back to browser cookies.

Call discovery first and compare it with [operations.md](operations.md). Read-only and explicitly selected module grants retain their original permissions. A separate explicit owner policy, `all-personal-business-v1`, can cover later reviewed and enabled ordinary personal business modules with the same key, while preserving owner/space binding, expiry and revocation. It grants no account/key/system/payment/order or irreversible-operation authority. The website must show the policy and warn that every holder of the same key shares its coverage. Source support or downloading a newer Skill does not apply this policy to an existing grant.

New operations require both current server discovery and a reviewed matching Skill contract. Refresh the credential-free package from the same approved origin when needed; preserve separately configured credentials and private local files. Hosts without a qualified update mechanism must report the missing contract rather than guessing, using cookies/SQL, or requiring another key solely because a new reviewed module was added under the existing all-data policy.

Use `snapshotTodos` for a complete classification inventory when discovery advertises it. It returns each todo's stable `id`, `sourceId`, `revision` and complete `fields`, plus total, observedAt and `truncated: false`; a failed read is not a partial success. Individual todo reads and mutation receipts carry the same source identity. Do not insert identity metadata into `fields` or guess the referenced source. The older `listTodos` is bounded and its `truncated: true` must never be presented as the whole inventory. This snapshot contains todos only, not projects, areas, calendars, journals, health or finance.

Prefer `GET /v2/capabilities` with catalog version `2`. Only a `404` permits discovery through the known version `1` todo-only catalog at `/v1/capabilities`; `401`/`403` require stopping, never an authorization fallback. Business operations keep the `/v1` paths listed in the generated reference.

The owner may explicitly change a current key's module read/write permissions on the website after verification. Write requires read in the same module. Every holder of the same key receives the changed permissions; the key bytes and expiry remain unchanged. The Skill must not call the account management API, use SQL, or acquire cookies to change permissions. An unavailable website control or missing operation is unavailable, not consent to bypass it.

For a complete organization inventory, use the separately advertised `snapshotOrganization` for projects, domains and topics. It shares the website business writer; operation availability still depends on the target site's enabled and qualified capabilities. No MCP transport is available in this package.


## On-demand documentation updates

A separately reviewed POSIX local host adapter (owner/mode checks, same-filesystem symlink rename and directory fsync) may run before every Skill use:

```sh
node /absolute/path/to/reviewed/lifeos-app/scripts/lifeos-skill-before-use.ts /absolute/path/to/installed/lifeos-agent /absolute/path/to/private/skill-update-state
```

The script and its imported source are installed/reviewed local code, not downloaded package contents. An integrating host uses `withUpdatedLifeOSSkill` and loads the returned immutable version before proceeding. No cron, background process or business API/key access is involved. This package does not silently install that adapter or register a host hook; report whether the actual host has configured it.

The exact publisher origin and manifest path are fixed in the trusted adapter. HTTPS/TLS and that pre-authorized publisher are the documentation trust root. Hashes verify archive/file integrity, not an independent publisher signature. The server's same-origin compromise can therefore publish malicious documentation; it still cannot change the adapter's URL allowlist, local binary, ACL, credentials or granted authority. No record or remote manifest can substitute the publisher root.

Each publish increments the source release sequence when package bytes change. The private local high-water mark rejects older sequences and different manifests at the same sequence, including after a failed activation. An already installed matching version is still checked for local document modifications. A stale first-ever installation has no prior high-water evidence; no signed freshness/transparency guarantee is claimed. The HTTPS manifest is fetched without cache; a mid-release archive404 fails closed and can be checked again on the next explicit use.

Only LICENSE, SKILL.md, references/credential-runtime.md and references/operations.md may come from the package. Host-specific runtime restriction and adoption references remain byte-preserved, and a fixed local restriction header is prepended to the installed Skill. Nonsecret runtime JSON and all credentials remain outside the package and are never read or replaced. Unknown files or modified managed documents stop automatic overwrite. Version directories and update state remain private and preserve previous releases; do not clean them as part of an update.

The first transition from a real directory to the managed symlink has a short journaled recoverable gap; business use waits for it to finish. Later updates atomically replace the symlink only after file validation/fsync. Interrupted bootstrap/activation is recovered before new work; readback or a trusted host validation failure restores the old pointer. Concurrent updates fail closed, and a live updater lock is never stolen. A second crash while repairing a dead updater lock leaves a recovery-lock requiring trusted operator inspection; no unchecked lock deletion is prescribed. This source workflow does not claim actual host installation or production deployment.
