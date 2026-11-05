# One production build and controlled release

The routine path is source tests/types/audit → the existing native production image build → compiled default-closed checks in that exact image → the existing startup/health/version publisher and readback. Public CI never supplies the private production image and gains no production authority.

## Decision and scope

Keep `.github/workflows/ci.yml` and its workflow ID, but honestly rename its two jobs to `Unit, types and source contracts` and `Release eligibility`. Remove its webpack and public Docker builds. Move the complete reviewed PostgreSQL/HTTP/MFA/browser/TLS/history fixture body into independent `qualification.yml`. Its policy job actually runs; the two heavy jobs run only when full qualification is required. A skipped heavy job is explicitly not a full-green qualification.

The conservative first version makes only explicitly listed presentation files and Markdown documentation routine. Backend/auth/permissions/SQL/routes/theme/dependency/CI changes, unknown paths, additions/deletions/mode changes, missing evidence, divergent history, previous failure/cancellation/pending or uncertain results require same-source full qualification. This preserves the existing necessary security/data contracts; narrowing that sensitive matrix is a later change, not an implicit omission here.

Alternatives considered: keeping all history/browser builds on every push preserves the current latency; accepting a public image loses the reviewed private overlay build boundary. Neither meets the requested release behavior. No new service, daemon, dependency or scheduler is introduced.

## Baseline and evidence

Classification uses the complete two-tree diff from the fixed verified full-green record, never `event.before`, `HEAD~1` or only the latest successful fast run. The initial record is real run `41947417812` attempt `1`, source `8ccc33d78d490a67c8c799dfc4b236539f3d7c55`, tree `91b19b93553b4b20a12635e17c7b522cf8e6fc0a`. Failed `5bc` is not promoted. `8cd` remains pending until actually verified.

The public gate checks that historical run's actual repository, source, workflow, attempt, two successful jobs and historical workflow bytes. It then checks the prior release CI result and computes a cumulative Git diff. Full qualification verifies same source/run/attempt and all three actual successful jobs, not merely the workflow aggregate.

The native worker repeats the path decision from bounded, verified Git-tree manifests. The seed JSON, policy JSON, qualification workflow, Python adapter and seed manifest are individually pinned in root-owned configuration. The seed stays fixed; normal full-green advancement changes only runtime metadata, never server configuration or repository files.

Only the heavy qualification job uploads the constant public `lifeos-full-green-v1` marker. CI and the host use the artifact index solely to find run IDs; neither downloads or trusts the artifact body. They verify repository/main/push/source/workflow/attempt and all three actual successful jobs, then reviewed workflow bytes and ancestry. The host obtains a bounded public Git tree, rejects truncation/special modes, verifies its Merkle tree against the commit, writes its root-owned source manifest and atomically advances `automatic-cd/full-green.json` last. A partial manifest write leaves the old receipt authoritative; exact-byte retry is tested. An invalid receipt rejects instead of silently resetting it.

This records **verified full qualification**, independently of whether production publication has happened. A newer UI push can therefore use the tested ancestor even if it arrives before that ancestor's publication; actual production still requires its own unique image build and native startup/version readback. Failed/skipped/pending/foreign/nonancestor evidence cannot create the receipt. CI searches ten indexed full runs; host checks at most three newer pointers per tick. Missing/unavailable evidence is full/closed. The host retains its verified receipt when the public index no longer contains an old marker, so the seed does not make every later update full. There is no manual per-batch baseline/config edit.

## Minimal private adapter

The existing `automatic_cd.py` retains its finite tick, locks, reconciliation, source/tree verification, private overlays, CAS, rate budget and native publisher. The candidate changes only the two job names, includes failed runs in the bounded history lookup, adds the trusted pure classifier and verifies a separate same-source full run when required. Missing adapter/config/workflow ID or evidence rejects before profile mutation/build. Public source is never executed as host code.

The only `host_build.py` delta runs existing `scripts/check-built-platform.mjs` inside the already-built image with `--network none --read-only`, no runtime mount, user1000, dropped capabilities and bounded memory/time. It verifies `passed`, the exact build ID and zero external model calls before saving/publishing that same image. Startup/version checks stay in the existing native publisher. This hook is required before removing the public compiled-route gate.

The private source candidate and diff live outside Git under the task evidence directory; it has not been installed. Its qualification workflow ID is deliberately `null` in the template, which fails closed until the real newly registered ID is read back. No runtime JSON, secrets, grants, SQL or real records are read or changed.

## Verification and limits

Executed: eight source-policy/host-parity/full-run negative tests; the existing private worker's twenty synthetic tests; native Next type generation and TypeScript; YAML parsing/job/permission checks. The `8cd` optional relation-details fix and the reviewed lock-bound npm-cache candidate are included. No new workflow run, production build or host installation is claimed. Root actually ran the offline compiled check against the existing8ccc image: 44 checks passed with build `UKcuKamFSvDz-7J1T8lDt`, no runtime mount/network or rebuild. This proves the method, not the new artifact. Four synthetic automatic-receipt cases additionally verify advancement, next-UI reuse, invalid evidence and partial-write recovery.

The expected routine path saves all public application builds and avoids waiting for historical renderer/TLS/browser matrices. No measured end-to-end latency is claimed before a real run. The existing ten-minute timer+jitter can still add delay. A follow-up bounded idle-first lookup can support an independently reviewed shorter interval without exceeding the unchanged48/hour anonymous budget; that timer change is not included here. The candidate per-tick cap is24 GETs for the additional bounded evidence verification, with the existing48/hour budget/backoff unchanged. Critical/unknown changes are deliberately slower in this first slice.

References: [GitHub workflow conditions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax), [workflow run evidence](https://docs.github.com/en/rest/actions/workflow-runs), [attempt-specific job evidence](https://docs.github.com/en/rest/actions/workflow-jobs), [public artifact indexing](https://docs.github.com/en/rest/actions/artifacts).
