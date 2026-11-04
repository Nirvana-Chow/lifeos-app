# Credential runtime

Install this Skill directory with its references in your agent's supported Skill location. Sharing this package shares instructions only. Each user signs in to their own LifeOS instance, completes its required verification and issues their own least-privilege key in Settings → API keys.

Configure the exact approved HTTPS origin, API base `/api/platform/agent` and a credential-store reference in the local runtime. A store reference is not the key. Keep account-specific configuration outside the Skill package and Git. Prefer the operating system credential store or the agent platform's documented secret input; do not paste keys into chat, shell arguments, URLs, environment dumps, code or shared files. Do not share a configured credential with another user.

The credential reader must send the key only in the Authorization header, reject redirects, use normal TLS validation, disable persistent cookie/cache storage, bound responses and avoid logging headers or secret values. A downloaded Skill is not an executable credential reader and does not grant access by itself. If no approved runtime is available, explain the missing setup instead of extracting secrets or falling back to browser cookies.

Call discovery first and compare it with [operations.md](operations.md). Read-only grants cannot write; an existing grant never automatically gains a new business permission. The same still-valid key can use newly implemented operations within its granted scope. Other scopes require an explicit owner authorization in the website.

Use `snapshotTodos` for a complete classification inventory when discovery advertises it. It returns each todo's stable `id`, `sourceId`, `revision` and complete `fields`, plus total, observedAt and `truncated: false`; a failed read is not a partial success. Individual todo reads and mutation receipts carry the same source identity. Do not insert identity metadata into `fields` or guess the referenced source. The older `listTodos` is bounded and its `truncated: true` must never be presented as the whole inventory. This snapshot contains todos only, not projects, areas, calendars, journals, health or finance.

Prefer `GET /v2/capabilities` with catalog version `2`. Only a `404` permits discovery through the known version `1` todo-only catalog at `/v1/capabilities`; `401`/`403` require stopping, never an authorization fallback. Business operations keep the `/v1` paths listed in the generated reference.

The owner may explicitly change a current key's module read/write permissions on the website after verification. Write requires read in the same module. Every holder of the same key receives the changed permissions; the key bytes and expiry remain unchanged. The Skill must not call the account management API, use SQL, or acquire cookies to change permissions. An unavailable website control or missing operation is unavailable, not consent to bypass it.

For a complete organization inventory, use the separately advertised `snapshotOrganization` for projects, domains and topics. It shares the website business writer; operation availability still depends on the target site's enabled and qualified capabilities. No MCP transport is available in this package.
