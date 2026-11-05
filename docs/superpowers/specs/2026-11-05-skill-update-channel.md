# Skill update channel — LO-AGENT-001 / Issue35

Owner addition (2026-11-05): automatically check/update the ordinary Skill documentation before using it and discover newly available API contracts without reissuing keys for routine compatible changes. Key all-data/future-module authority policy belongs to the separate authority slice. This source implements real publisher routes, a bounded downloader, recoverable installation and a callable pre-use entry; actual deployment/host installation remains separate evidence.

## Trust and format

Reuse existing scripts/agent-skill-artifact.ts and src/agent-api/skill-artifact.ts: exactly LICENSE, SKILL.md, references/credential-runtime.md and references/operations.md in deterministic tar.gz. No ZIP parser/dependency is needed. Generated public content never globs an installed Skill. The existing anonymous download remains compatible.

The owner-approved root is exactly https://lifeos.nirvanachow.com and the trusted local adapter hardcodes /api/platform/agent-skill/manifest. HTTPS/TLS and that publisher's authority authenticate documentation distribution; hashes are integrity checks, not independent signatures. Neither manifest, discovery nor business text can replace the root/path, select a signing key, run an installer, change binary/ACL/key or grant scope. No new identity/key/system setting is introduced. Trust in a compromised same-origin publisher is an explicit limitation; local executable/authority restrictions remain separate.

Manifest schema1 binds positive source releaseSequence (initial2026110501), SHA256 content-addressed release/archive path, archive bytes/hash, each allowlisted file bytes/hash and supported API catalogs1/2. Source maintainers must increment releaseSequence for every published manifest/package change. The current source serves only its own digest at /api/platform/agent-skill/releases/<sha256>.tar.gz; unknown historical or changed digest paths404. A deploy racing between manifest and artifact download fails closed and retries on a later explicit use, without mutating installed docs.

## Before-use execution

The reviewed local entry is scripts/lifeos-skill-before-use.ts, or withUpdatedLifeOSSkill for integrating hosts. It checks/downloads before loading the immutable returned version and before the caller receives permission to use those instructions. Source Skill instructions invoke an already-installed trusted updater; package code is never executed. This source does not register an actual Codex host hook or claim every model/host automatically intercepts Skill loading.

Use repository-pinned Node24.18.0. Downloads use fixed GET URLs, default TLS, no credentials/cookies, redirect:manual, no-store,10-second abort, bounded stream16KiB manifest/256KiB archive. Reject wrong status/type/final URL, origin/contract/API mismatch, wrong hashes, oversized data and nonallowlisted files. Tar inspection validates regular files only, exact paths, mode0644, checksum/size/padding, full file hashes, UTF-8 and exactly the expected trailer; decompression is bounded512KiB. No downloaded command executes.

A private durable high-water record refuses lower sequences and changed raw manifests at the same sequence, even when an attempted activation rolled back. Matching current versions still verify managed document hashes. First-ever installs have no prior high-water evidence; no signed freshness/transparency guarantee is claimed.

## Installation, recovery and local restrictions

The host selects absolute, separate Skill/state paths on the same filesystem. State is0700, staged files0600; unsafe directories/symlinks, unknown installed files or modified managed public documents stop overwrite. A per-store exclusive PID lock serializes updates, never steals a live writer, and serializes dead-PID recovery. A second crash while repairing that lock leaves recovery-lock for trusted operator inspection.

Existing local runtime/adoption Markdown references remain byte-preserved and receive priority through links in the installed SKILL header only when present. Generic installations do not inherit another host's operation count or unsupported-module claims. Runtime JSON, credential locators, Keychain, binary and ACL are not read or changed. Overlay edits during download are retained; changes during staging abort. Each completed immutable version and original directory remain recoverable.

First layout adoption of an existing real Skill directory has a short journaled recoverable gap: record/fsync bootstrap journal, rename original into a private legacy backup, atomically create its managed symlink, clear journal. Business use waits. This first bootstrap is explicitly **not** a single atomic rename; interruption restores the backup pointer before any new work. No actual machine layout conversion was performed here.

Ordinary later updates fully stage/fsync new docs, persist high-water and pending activation journal, then atomically replace the active symlink with one rename. Readback compares installed document hashes and target; optional trusted host validation can reject. Failure restores the old pointer; crash with pending activation rolls back before the next check/use. Old versions remain; no cleanup, background task or cron is installed. Callers load the immutable returned version, avoiding mixed references if a later caller updates the active pointer.

Dan's presently adopted local binary still has exactly13 reviewed operations and cannot execute requirements operations, as recorded in his preserved local-write-runtime overlay. This is a local fact, never hardcoded into the generic updater header. All machine calls continue to require user authority, current server discovery and reviewed local/runtime contract support. Documentation cannot make future operations executable or approve classification. Real writes require receipt plus independent readback; classification additionally needs owner approval and complete expected-ID coverage.

## Evidence and remaining delivery

Pure and real synthetic filesystem/transport tests exercise initial adoption, regular atomic activation, rollback, crash recovery, high-water/substitution, local edits/overlay preservation, unsafe symlinks/locks, malicious archives and real route content binding. Tests use no Keychain, real business API or private records. Actual live routes, host hook registration/layout adoption, runtime integration and owner experience acceptance remain open under personal-agent-foundation7.2/8.2; do not increase those task statuses from synthetic source tests.

Sources: existing public artifact implementation/tests; Node24 official createHash docs https://nodejs.org/docs/latest-v24.x/api/crypto.html (latest24.22.2 observed; local pinned24.18.0 unchanged), exact pinned zlib https://nodejs.org/download/release/v24.18.0/docs/api/zlib.html . Built-in crypto/zlib/fs/fetch avoid new dependencies. Fixed-origin HTTPS trust was explicitly selected by the coordinating owner-authorized scope; no independent signing identity is required for ordinary documentation.
