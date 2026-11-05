# MCP provenance and Skill source closeout — 2026-11-06

Base: independently reviewed integration source `1a5c9b75d461a2c9669240fb952d5ec78dc1a2cf`. This follow-up changes only `third-party/dependencies.json`, `THIRD_PARTY_NOTICES.md`, `skills/lifeos-agent/SKILL.md` and this note. MCP/native/Agent code, package/lock, Skill references/generated artifacts and release sequence remain byte-for-byte unchanged. There was no install, upgrade, push, host registration, Keychain/real-key access, live business API request or production activation.

## Dependency provenance

No checked-in generator for `third-party/dependencies.json` was found. The update preserves its existing `lifeos-locked-dependency-licenses-v1` shape, sorted package paths and all 289 prior rows without changes, adding precisely the eleven lock entries introduced by the original MCP candidate. The index now has 300 rows. New fields use the exact package name, version, declared license, official npm tarball URL, SRI integrity, development/optional flags and inspected license-file paths; `THIRD_PARTY_NOTICES.md` links each upstream repository or the fixed SDK release.

The fixed additions are SDK client/core/server 2.4.0 (declared Apache-2.0); cross-spawn 7.0.6, eventsource 3.0.7, path-key 3.1.1, pkce-challenge 5.0.1, shebang-command 2.0.0 and shebang-regex 3.0.0 (MIT); isexe 2.0.0 and which 2.0.2 (ISC). These license families already exist in the original index. The SDK LICENSE's documentation notice also references the already-present CC-BY-4.0 family.

All eleven official npm tarballs were fetched into memory without extraction or execution. Their bytes match the lock's SRI hashes. Tarball metadata (name/version/declared license/repository) and the complete license files match the actual installed distributions. No separate NOTICE files exist in these eleven archives. The retained SDK full LICENSE matches all three installed SDK copies exactly: SHA-256 `0382b0057770ca05e9c350a50aa3b1c1fea84da0bc81d723bf00b9aa841be58a`. Its Apache/MIT licensing-transition text and documentation CC-BY notice are retained and explicitly described in the notices; npm's declared Apache field is not substituted for the full terms.

The existing index does not include four pre-existing dnd-kit paths: accessibility/core/sortable/utilities. This is unchanged from the main base; `third-party/dnd-kit/provenance.json` separately lists the three direct packages. This narrow closeout does not claim complete lock-index coverage or silently expand into that earlier provenance gap. All 300 indexed rows match the current lock metadata, and all eleven newly added lock paths are covered.

## Skill source accuracy

Applied the current skill-creator guidance as a narrow correction. The false statement that the MCP server is unimplemented is replaced with the actual state: stdio adapter source for 50 reviewed business operations and isolated qualification exist, while the default CLI remains closed with `MCP_CREDENTIAL_RUNTIME_UNAVAILABLE`; trusted credential binding and actual MCP-host qualification remain unavailable through this package. No usable MCP installation command or production claim is added. The portable Skill carries no executable MCP transport.

HTTP use still requires all three: owner authorization, fresh discovery and the installed reviewed compiled credential runtime's support for the exact operation. The candidate MCP's v2-only/no-downgrade behavior is distinguished from the existing HTTP reference contract. A downloaded document cannot grant authority, change a runtime, load code or expand the approved origin/grant. Pending production/runtime work remains pending; this source edit does not complete 7.2/8.2.

## Checks and remaining integration

- Provenance comparison: exactly eleven additions, 289 original rows unchanged; 300 indexed rows match the lock. Eleven archive SRI/installed metadata/full-license comparisons passed; SDK full-license equality passed.
- Skill `quick_validate.py skills/lifeos-agent`: passed. All local Markdown links in the two edited documents resolve, and all nine new upstream links returned HTTP 200. Lock guard and `git diff --check` passed.
- `git diff --exit-code 1a5c9b75 -- src scripts package.json package-lock.json skills/lifeos-agent/references`: passed, preserving the reviewed executable source and fixed dependency versions.
- No code tests, typecheck, browser run, real PostgreSQL/API qualification or CI was repeated for this documentation-only change. The fixed-source 38 focused tests and independent 50-tuple/tamper review belong to `1a5c9b75`; they are not claimed as fresh checks of changed executable code.

Root must merge the source changes in order, regenerate the canonical Skill operation reference/artifact and assign a new release sequence before publication. The same sequence must not be reused for different package bytes. This writer intentionally does not regenerate those shared files or advance their sequence. Actual production MCP credential binding, host qualification and owner acceptance remain separate work.
