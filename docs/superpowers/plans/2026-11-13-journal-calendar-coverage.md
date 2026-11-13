# Journal calendar and period coverage implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans task-by-task. Root commissions the independent final review; this delegated worker does not spawn further agents.

**Goal:** Let the owner browse saved journal dates and inspect day/week/month/quarter/year source coverage with stable original-record references.

**Architecture:** Extend the existing owner-verified full journal snapshot projection once, then compose a read-only calendar/coverage panel inside `JournalHistoryPanel`. Reuse the canonical editor, the existing status/snapshot/status identity check, independent original GETs, navigation guard, visibility clearing and response generation. Calendar and period changes remain local filters and never remount or write the editor.

**Tech Stack:** Existing React 19.3.0, Next.js 16.4.1, TypeScript 6.0.2, ReUI Button, native HTML table/date/select controls and Node/Playwright tests; no dependency or lock update.

**Spec:** Existing [workspace specification](../../../openspec/changes/unified-business-ui/specs/workspace-interface/spec.md), [PersonalAgent coverage](../specs/2026-11-05-personal-agent-requirements-coverage.md), and bounded design below. Engineering mapping is LO-JOURNAL-001 / Issue #6 and LO-REPORT-001 / Issue #17, under the sole unified-business-ui 1.2/3.1/3.2 trail. This slice does not close those parent requirements or edit their checklist.

## Bounded design and reuse decision

- The existing `readJournalHistory` is the authoritative full owner-verified read. Its `observedAt` determines Beijing today. Add rows containing current fields, record/source IDs, revision and canonical original link; all views consume that same result.
- Reuse `validateCalendarDate`, `calendarDayNumber` and civil-date shifting semantics already in the calendar module. Calendar week starts Monday; date boundaries are inclusive and never use client timezone or `createdAt` to infer journal dates. Supported civil dates remain 0001-01-01 through 9999-12-31; extreme week boundaries clamp to that representable domain.
- The inventory has a native table calendar for schedules but no generic shared calendar primitive. Reuse its semantic-table/button approach and token conventions locally. Importing the schedule writer or adding a calendar library would add irrelevant scheduling state/dependencies. Native `input[type=date]` offers direct date access; month buttons and date buttons have visible accessible labels, focus and selected state.
- [W3C APG date-picker reference](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/examples/datepicker-dialog/) informs labels and keyboard semantics. This is a persistent browse table with native tabbable buttons, not an ARIA grid or modal date picker; it does not claim grid keyboard behavior.
- The calendar marks actual recorded days with textual counts. Selecting a date filters the period list. Day/week/month/quarter/year ranges show selected count, known recorded-day count, global dated/undated counts and known coverage boundaries. Unknown-date records are a separate visible collection and never allocated to a period.
- Each list row has title, date, excerpt, revision, record ID and source ID. Lists page locally with an explicit shown/total count; counts always use the complete validated snapshot. Original links use the existing guard and independent GET. A changed revision/source invalidates the old snapshot instead of presenting a stale reference as current.
- Private gallery/attachments, daily quote generation, AI summaries and semantic similar-day retrieval remain unavailable until their existing qualifications are met. No fabricated records, photos, analysis or new background/provider flow.

## Global constraints

- Preserve owner/MFA, no-store, existing save/unknown/conflict/draft guards and the unique authoritative editor.
- No API, schema, permissions, business baseline, OpenSpec checkbox, shared workspace/navigation, global CSS or dependency edits.
- Synthetic fixtures only. No real-record writes or credentials. Root owns integration, CI/release and production readback.
- Source implementation, synthetic/browser qualification, deployment and owner experience acceptance remain distinct.
- OpenSpec CLI stays 1.16.0 with `OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1 CI=1`; current apply is ready, 7/11, with inherited 1.2/3.1 and unfinished 3.2 preserved.

## Review focus

- Cross-year Monday weeks, leap February and quarter/year boundaries retain pure recorded dates.
- Undated and empty snapshots remain explicit; missing entries never imply an uneventful day or complete life history.
- Calendar/period filtering preserves an active editor draft; original navigation still honors its guard.
- Identity changes, authentication loss, page hiding and late responses cannot redisplay an old snapshot or original.
- Revised sources invalidate earlier references; lists disclose preview limits while complete coverage counts remain unchanged.

## Files and interfaces

- Modify `src/personal-journal/history.ts`: `JournalHistory.rows` and `JournalHistoryRow` with `id`, `sourceId`, `revision`, `href` and existing fields; optional reference verification for `readJournalOriginal`.
- Modify `src/personal-journal/history-panel.tsx`: same single load/open lifecycle; compose coverage panel, retain history view and canonical original display.
- Modify `src/personal-journal/history.module.css`: only parent composition/original metadata if needed.
- Create `src/personal-journal/journal-period.ts`: `journalPeriodRange(date,grain)`, `shiftJournalMonth(date,delta)`, `journalMonthDays(date,rows)`, `projectJournalPeriod(history,date,grain)`.
- Create `src/personal-journal/coverage-panel.tsx` and `coverage.module.css`: native month calendar, local period controls, bounded record/reference lists and unknown-date section. User-visible feature copy lives here.
- Create `test/journal-period.test.ts`, `test/journal-calendar-browser.integration.test.ts`; extend `test/personal-journal-history.test.ts` and precisely scope existing history-browser locators where duplicate links need region context.

### Task 1: Verified date/reference projection

**Consumes:** Existing `JournalHistory`, validated personal record fields and calendar pure-date primitives.

**Produces:** The row/reference and calendar/period interfaces above; no new network request.

- [ ] Add failing tests for complete row/source/revision projection, original-reference mismatch, leap/cross-year/quarter boundaries, unknown/empty data, date purity and boundary navigation.
- [ ] Run `node --test test/journal-period.test.ts test/personal-journal-history.test.ts`; observe the new behavior failing before implementation.
- [ ] Implement the projection and pure date functions; reuse existing date validation/arithmetic.
- [ ] Run the same focused command; expected: all enabled tests pass, no skips.
- [ ] Commit with LO-JOURNAL-001 / LO-REPORT-001.

### Task 2: Calendar and period browsing

**Consumes:** Task 1 projection and existing `onBeforeOpen` / original-reader boundary.

**Produces:** Browseable calendar/period lists in the canonical route; unchanged editor and authority boundary.

- [ ] Add an opt-in browser regression using the shipped composition and synthetic HTTP routes for day/month/period selection, unknown records, bounded lists, original links/versions, guard refusal, identity/auth changes and hidden/late response clearing.
- [ ] Request Root's unique browser/Next slot, verify the allocated port is free, then run the new test against the pre-feature composition; expected: missing-calendar assertion fails.
- [ ] Implement native controls, semantic/token CSS and composition. Re-read immediately clears old details; a changed reference requires fresh history.
- [ ] Run focused tests, `npm run typecheck`, and the allocated synthetic browser command; expected: zero enabled failures/errors/skips. Reuse the existing original-history browser where applicable. No full build or suite without a new reason/slot.
- [ ] Update this engineering evidence and commit with LO-JOURNAL-001 / LO-REPORT-001.

## Qualification record

- Baseline `node --test test/personal-journal-history.test.ts`: 6 passed, 0 failed/skipped.
- Worktree starts at remote default main `aa97063eeb7b6e23c35016302694b36cd7ed9b4f`, isolated branch `codex/LO-JOURNAL-001-calendar-coverage`; the dependency symlink targets only the approved storage-review worktree and its package-lock is identical.
- Official OpenSpec release source was checked; installed 1.16.0 is deliberately retained at the project pin. No installation or tool update occurs.
- Independent technical review, PR/merge, fixed-main CI/build/private release, actual Native + HTTPS readback and owner acceptance are Root-owned and remain unclaimed here.
