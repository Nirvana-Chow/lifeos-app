# Manual captured-source preflight

Continues LO-OPS-001 / [Issue #43](https://github.com/Nirvana-Chow/lifeos-app/issues/43), the existing release-path work and `unified-business-ui` 3.2. This is the later thin prepush check, not another deployment controller. It makes no checklist or owner-acceptance completion claim.

`node scripts/release-preflight.ts --candidate <exact-40-hex-commit> --metadata <private-capture-file> --metadata-sha256 <independently-reviewed-64-hex-digest>`

Run manually in the candidate repository. The script reads immutable local Git objects and one explicit metadata file, outputs one JSON object and performs no writes, network requests, credential discovery, SSH, hooks, tick or publish. No package or global setting is installed. It does not load a production config, `.env`, approval file or Key automatically. Metadata stays outside Git and public CI.

## Meaning and authority

- Exit 0 / `snapshot-compatible` means the source comparison matched the supplied captured snapshot only. It never means current authorization, current host readiness, CI success or deployment readiness. Every validator result has `publicationAuthorized:false`, `ci:not-checked` and `native:not-checked`.
- Exit 2 / `review-required` reports fixed, allowlisted paths and old/new hashes plus the existing Root review/adoption route. Unknown or unavailable evidence returns exit 2 / `unknown` with one next step.
- The separately supplied SHA256 binds the exact file bytes; it does **not** authenticate its author. `source.kind` is attribution, not a signature. Root must independently verify the capture's source, receipt and control identities before supplying its digest. Hashing arbitrary JSON or editing its timestamp cannot grant authority. A Root courier, its source authentication and actual installed-control readback are **not implemented by this slice**; no real metadata compatibility result has been claimed.
- Freshness is a fixed five minutes from `source.observedAt`; future, malformed or older captures are unknown. This is an early check, not a promise that the host will remain unchanged during CI. Existing worker controls, fixed-SHA CI, Native checks and independent runtime readback remain authoritative.

## Safe metadata contract (version 1)

The input is a reviewed safety projection, not the full worker config. All repository fixtures are synthetic. Required fields:

| Field | Contract |
| --- | --- |
| `version`, `repository` | `1`, the fixed public repository identity used by the validator |
| `source` | Exact fields: `kind:root-readonly-capture`, short nonempty `ref`, UTC ISO `observedAt`, `receiptSha256`, `matcherVersion:overlay-v1` |
| `controls` | `workerSha256`, `configurationSha256`; Root's review receipt must bind these to the reviewed matcher and adopted configuration |
| `workflowPins` | Exact three `WORKFLOW_PATHS` keys, SHA256 values; the visual pin needs explicit reviewed evidence too, even when the private worker itself pins fewer workflows |
| `publicBases`, `overlays` | Exact fifteen `OVERLAY_PATHS`; public absent files are null, all other values are SHA256 |
| `rebases` | At most 32 ordered reviewed origin-SHA records with `treeSha`, full `publicBases`, full `overlays`, optional boolean `allowDescendants` |
| `profile` | Captured `sourceSha`, string `runId`, string `runAttempt`, full actual overlay hash map |
| `approvedOverlays` | Optional origin-SHA → allowlisted path → artifact SHA256 map. Required for each selected overlay replacement that differs from the captured current profile |

Unknown fields, missing paths, raw full configurations, wrong identities/types, missing external digest or mismatched digest are not accepted. Metadata is capped at 64 KiB. Input text and unknown fields are never echoed. Differences contain only allowlisted paths and validated hashes/nulls. Missing Git objects and non-regular/symlink metadata files remain unknown; no fetch or production probe fills the gap.

## Matching behavior

The matcher follows the existing worker's `prepare` ordering without executing that worker:

1. An exact candidate rebase wins and must match the candidate tree and all public bases. Otherwise unchanged default public bases use the default overlay map without searching descendants.
2. With changed public bases, examine reviewed origins in captured order. An **adopted descendant** requires current profile overlays equal the reviewed origin overlays, origin equal to or a strict ancestor of the current profile, and origin a strict ancestor of candidate. This adopted branch does not require `allowDescendants:true`.
3. An **unadopted reviewed transition** requires `allowDescendants:true`, current profile overlays equal the configured default, current profile equal to or a strict ancestor of reviewed origin, and reviewed origin a strict ancestor of candidate. Unknown ancestry is unknown, not assumed true.
4. Current profile must equal the default or selected overlay map. Replacements require captured approved artifact hashes for that selected origin. This still does not prove that those artifacts are installed now or authorize their adoption.

Same-head profile/run/attempt metadata supplies no latest CI-run proof. Old attempt metadata can never promote this source comparison into publication eligibility. This tool does not duplicate Actions wait, job/guard, policy, SQL, permission, budget, build or health validation.

## Source qualification

Eight focused synthetic groups cover default/exact/adopted/transition matching, workflow drift, public-config drift and wrong exact tree, unknown overlay/missing artifact, stale/unpinned/malformed/unattributed input and numeric ID rejection, missing graph/exact-only unadopted descendants, same-head old-attempt non-authorization, and a real temporary Git/CLI fixture. That fixture proves dirty working-tree content is ignored, substituted metadata is rejected, a fresh synthetic capture can report snapshot compatibility, and no repository changes are made. Focused tests pass with no skips.

Run `node --test test/release-preflight.test.ts`. Strict targeted types use TypeScript's `--ignoreConfig --noEmit` with explicit Node/ES2022/bundler options and both script/test paths; no application or Next build is required. Independent source review and Root metadata-courier review remain separate. This does not mark the whole release requirement complete.

## Independent-review correction

The initial helper review reproduced two source-advisory defects: local Git replace refs could substitute the candidate tree or ancestry, and regular-expression coercion could accept non-string SHA/hash fields. All object and ancestry commands now use the same `--no-replace-objects` argument wrapper. Candidate identity is checked against a raw commit object and its Git SHA1 object hash; its tree comes from the raw commit header. No caller refs are edited. Central strict string predicates cover every SHA/hash field, including receipt, candidate/rebase tree identities and all maps; malformed candidate identity is returned as null.

The original eight passing groups remain, the reviewer's four fixed regressions are included, and three broader groups cover all same-class field locations, exported candidate/hash boundaries, and an actual CLI with forged replacement ancestry. Final focused qualification is 15 passed, zero failures/skips, plus strict targeted types. Original review failures and the earlier source are retained as history. This correction still performs no actual Root metadata authentication, CI check, Native check or publication authorization.
