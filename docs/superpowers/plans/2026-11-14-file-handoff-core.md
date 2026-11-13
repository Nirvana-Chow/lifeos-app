# LO-FILES-001 bounded file handoff core plan

> **For agentic workers:** Use superpowers:executing-plans and test-driven-development inline. Root owns independent review and shared-entry integration; do not spawn agents.

**Goal:** Persist actual authorized file bytes and owner/space-scoped metadata/command receipts, then independently download and acknowledge the verified original.

**Architecture:** A closed service composes a fixed-source native HTTPS downloader, atomic private filesystem blobs and a PostgreSQL metadata/command adapter. Every metadata transaction requires current authority and the existing requirement reader on the same SQL client. Transfer leases fence stale completion; completed commands recover without downloading again. The service returns opaque IDs/checksums, never disk paths or signed source URLs.

**Tech Stack:** Existing Node24 HTTPS/DNS/net/fs/crypto, TypeScript, Zod4 and pg8. No dependencies or lock changes.

**Spec:** personal-agent-foundation11.6 and [agent-mcp file scenarios](../../../openspec/changes/personal-agent-foundation/specs/agent-mcp/spec.md); [Issue16](https://github.com/Nirvana-Chow/lifeos-app/issues/16#issuecomment-6859767898). Root preserves the original checklist and business intake.

## Scope and interfaces

- New `src/file-handoff/{contracts,source,blob-store,service,postgres,operations}.ts`, focused tests and proposed `db/0022_file_handoff.proposed.sql` only. Root owns auth/runtime/registry/API/MCP/Skill and0021.
- Stage input uses top-level `file` with all official `download_url/file_id/mime_type/file_name` properties declared; only the first two are required. Add requirementId, explicit temporary/retained policy and original idempotencyKey. Do not pass bytes/Base64 through JSON.
- `FileHandoffActor` is trusted server input, bound to owner/space and a nonsecret authority reference; optional website/Codex consumer identity is server-derived. No actor or owner in tool arguments.
- Required SQL callbacks: current operation authorization and `readTarget(sqlClient,actor,requirementId)` through the original reader. Root must verify current owner/space/source, not trust arbitrary caller ticket IDs. No default permissive fence.
- Exact operations/scopes: stageFileHandoff (`file-handoff:read/write`), getFileHandoff and downloadFileHandoff (`file-handoff:read`), acknowledgeFileHandoff (`file-handoff:read/write` plus trusted consumer). These remain unregistered and unavailable until Root integrates and authorizes them.
- Actual source origins are an explicit server allowlist, default empty. No invented official host list; DNS must resolve only public addresses and the connection must use the checked address. No redirects, cookies, bearer forwarding, arbitrary ports or arbitrary fetch tool.
- Native private files use no-follow/exclusive temporary opens, bounded streaming, fsync, atomic no-overwrite publication and server SHA256/bytes. Preserve uncertain/orphan originals for reconciliation; no cleanup operation in this slice.
- PostgreSQL stores pending/ready file identity, bounded transfer lease, original intent/command receipt and acknowledgments. Signed URL is transport-only, excluded from durable intent so a confirmed command can recover after URL refresh without downloading again. Original file ID, metadata/target/retention changes with the same key conflict. An expired unconfirmed token is an unknown outcome, not permission to fetch potentially different bytes or assume the old process stopped; retain it for explicit reconciliation. Only an attempt released before publication is automatically retryable.
- website/Codex ack compares actual SHA/bytes and CAS revision. Temporary cleanup is only an eligibility result after retention and both consumers' matching acknowledgments; no file is automatically deleted. Acknowledgment is a client claim, not proof of permanent independent backup.

## Review focus

- URL parser quirks, DNS rebinding, private/mapped IPv6, redirects and oversized/truncated streams.
- Filename traversal, symlink/hardlink substitution, partial files, disk failure and publish-before-receipt unknown outcomes.
- Foreign owner/space/target, revoked authority between transfer and commit, read/download/ack after revocation.
- Duplicate commands, concurrent transfer claims, lease expiry/stale completion, historical receipts and later revisions.
- Expired temporary URL/retention, missing optional official file properties, no cleanup of unique originals.

## Task 1: Source and private-byte storage

- [x] Write RED tests for official file descriptors, configured-source/DNS/redirect/time/size rejection and real filesystem atomic bytes/SHA/readback/unsafe paths.
- [x] Implement bounded native HTTPS and private blob storage; rerun the tests until GREEN.

## Task 2: Durable handoff and acknowledgment

- [x] Write RED lifecycle tests using real synthetic file bytes and filesystem; simulate only external transport and metadata ports where PG is not allocated.
- [x] Implement PostgreSQL pending/receipt/lease/CAS/ack source and proposed forced owner/space RLS migration; keep grants/module/operations closed.
- [ ] Qualify actual PostgreSQL pending/receipt/lease/CAS/ack/ACL/rollback behavior on Root's fresh isolated target. No PostgreSQL connection or migration has run in this slice.
- [x] Non-PG checks: replay skips the source request, failed/unknown transfer never fabricates a checksum, mid-transfer and post-read revocation expose no successful result, independent download rehashes actual bytes, ack failure refuses writes, and retention never deletes originals. SQL lease races and real ack success remain in the PG gate above.
- [ ] Typecheck and proportionate original-consumer regression; independent review, fresh isolated PG, complete production build and same-output checks before PR.

## Integration handoff and acceptance

Root will serially wire the original Agent HTTP entry, discovery/Skill, the dedicated top-level `file` MCP descriptor and the OAuth/old-grant transaction fence. Native/source schemas alone do not activate any scope. Source completion is not11.6 completion: a genuinely newly generated ChatGPT file, actual authorization, website and Codex binary downloads/SHA/bytes/ack and controlled retention still require real acceptance.

Sources actually read: [OpenAI File APIs](https://developers.openai.com/plugins/reference#file-apis), native Node HTTPS/net/fs interfaces and [IANA special-purpose IPv4](https://www.iana.org/assignments/iana-ipv4-special-registry)/[IPv6](https://www.iana.org/assignments/iana-ipv6-special-registry). Existing Skill download storage is documentation-specific; storage-review is a checklist, not blob transfer. Native primitives fit this bounded missing capability without a new storage service or identity framework.

## Executed evidence and remaining integration

The first storage/source run failed7 assertions because the real modules were absent; service and PostgreSQL-port contracts also ran RED before implementation. Follow-up RED cases reproduced double response-close, unsanitized directory/connection errors, metadata reservation before a closed source allowlist, expired-token re-fetch and a post-link directory-fsync failure releasing an uncertain claim; all are corrected without weakening guards. Node strip-only mode required ordinary declared class fields and the existing Node type package's HTTPS options. Focused final command `node --test test/file-handoff*.test.ts test/mcp-http-compact-discovery.test.ts test/lifeos-mcp-api-parity.test.ts` passes31/31 with0 skipped; `npm run typecheck` and `git diff --check` pass. These are source and synthetic-byte checks, not production/owner acceptance.

The native HTTPS test reuses the repository's OpenSSL synthetic certificate pattern, tests a real loopback TLS socket with pinned lookup, denies untrusted TLS, omits cookies/authorization, verifies no redirect follow and aborts a stalled response. Temporary trust exists only inside that isolated test process and is restored; the ephemeral server and generated synthetic key/cert directory close/remove in teardown. Public-source policy independently rejects loopback/special-use/mapped/mixed DNS and non-allowlisted URLs; no production URL was fetched.

Root integration must (1) qualify restricted role/RLS/table/trigger ACLs and0022 on a fresh isolated target; (2) provide both mandatory current authorization and the original transaction-aware target reader on the supplied client, never borrow another pool checkout inside this transaction; (3) register the four operation IDs and explicit independent scopes with closed defaults; (4) mount actual scoped metadata/stage/binary-content/ack HTTP handlers; (5) use `stageFileTool` only as a dedicated top-level MCP file tool and exclude the binary-content operation from generic JSON/Base64 `lifeos_call`; (6) update discovery/Skill and qualify website/Codex binary clients that recompute SHA/bytes and provide a server-derived consumer identity. The adapter sets the existing owner context and its file owner/space context before the mandatory authority callback. Virtual unsaved requirement baselines with no real source/revision cannot be linked.

Use one reviewed maximum byte limit across downloader, blobs and PostgreSQL. Defaults are16MiB per transfer,256MiB reserved metadata budget,128 tracked files and120s transfer lease; source timeout is at most30s and temporary retention at most7 days. Filesystem publication checks128MiB additional free space, preserves no-overwrite originals and never stores source signed URLs. Temporary retention currently produces eligibility only: authorized physical cleanup is not implemented. Preserve the artifact/receipt if publication succeeded but metadata confirmation is uncertain. A process crash or post-publication failure without a confirmed metadata receipt remains pending/unknown; explicit original-byte reconciliation is not implemented or advertised by this core slice.

Full unit suite, actual PG/HTTP entry integration, independent review and actual production build/same-output checks remain for Root's coordinated slots before PR. No live scope/key/module change, new daemon, schema application, real private upload, public file exposure, migration or owner acceptance occurred.
