# Current release summary Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for this single bounded task; root independently reviews the fixed source commit.

**Goal:** Continue LO-VERSION-001 / LO-REQ-001 under unified-business-ui1.2/3.1/3.2: show the actual image's owner-facing summary without a self-referential future commit SHA.
**Architecture:** The existing static public history cannot name its enclosing future commit. Add one finite image-local summary descriptor beside that history; project it with the existing validated actual source/build artifact into the same record contract. Preserve history, popup parsing and the authoritative read-preference writer.
**Tech Stack:** Existing TypeScript/Node built-ins; no dependency, transport, identity or runtime-setting change.
**Spec:** Existing delivery-visibility intake in `openspec/changes/unified-business-ui/tasks.md` and the bounded clarification below.

## Design and review focus

The chosen approach composes the existing `releaseNotes` record shape and `readReleaseNotice` consumer. Embedding the next Git SHA is impossible without changing the commit; GitHub lookup adds an unnecessary network truth source. The descriptor supplies only ID/title/changes/requirement IDs; source SHA and URL come from actual validated image proof, never from the descriptor or historical notes. Missing or malformed proof supplies no current summary. Existing exact historical matches remain authoritative instead of duplicating their record.

The current copy covers source-implemented owner calendar input, requirements roadmap/feedback/update navigation and saved-date Gantt. It does not attest module activation, external synchronization, all-business policy activation, Agent runtime, visual qualification or owner acceptance. Future releases must review/update this finite copy as part of their release source. Original history is retained. No UI, read writer, private activation template, credentials, SQL, host installation or background work is changed.

- [x] Add RED tests for a previously unknown actual source receiving a summary, invalid/missing proof staying closed, and the real owner HTTP response projecting through the existing notice parser without a business write.
- [x] Add the finite descriptor and minimal artifact-bound projection; preserve exact history, source/build identity, source URL, and evidence/acceptance metadata.
- [x] Run the bounded release/owner/support tests and diff checks, record RED→GREEN evidence, then prepare the public-identity source commit for root's independent review. Do not rerun full/build/Chrome for this bounded slice, per the explicit task instruction.

Rulings: use the existing TypeScript `records.ts` history (there is no `source-history.json` in this source); native worktree creation rejected this chat's declared visualization-only workspace, so the explicitly requested Git worktree fallback starts at648d4b8. Baseline release/owner pure tests passed3/3. Root retains CI/runtime delivery and user acceptance.

## Verification and handoff

The new valid-image summary and actual owner HTTP→existing notice projection tests each observed RED (`0 !== 1`) before production changes; the missing/invalid-proof negative was already closed. The minimal descriptor/projection then passed all4 new cases, including exact historical identity retaining its own older copy. The combined release/runtime, owner-module, support HTTP and support-client tests passed15/15 with zero skips. These are synthetic, in-memory owner/service tests; they invoked no real API, writer, SQL or host process.

The existing owner-module Chrome fixture previously asserted an empty summary for a valid new source; that stale oracle is aligned to require the finite current summary and exclude the historical note. Chrome was not rerun for this slice, so its new assertion is not represented as executed browser evidence. Strict OpenSpec1.16.0 validation of unified-business-ui and diff checks passed. No local dependency lease or global TypeScript executable was present; no dependency was installed or lease recreated, and standalone typecheck was not executed. Full suite/types/build/Chrome, actual target activation, independent root review and owner experience acceptance remain downstream; no default-wide green or release is claimed here. The data still reports `ownerAccepted:false` and `visualQualification:not-attested`; product UI remains unchanged.
