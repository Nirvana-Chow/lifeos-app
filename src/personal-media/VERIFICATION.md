# LO-LEARNING-001 media leaf delivery

Execution Issue: #13. Parent owns the sole requirements baseline/OpenSpec intake and all central integration. This leaf implements the approved first version on base `3caa9279ff6bee41159be8654f83758b334f5f74`; it does not create a second backlog or claim owner acceptance.

## Design and execution

Use the existing PersonalService writer and exact `{title,text,occurredOn,personal}` envelope. Implement complete, strict version-1 media fields with references and unknown nulls; project only confirmed website/manual records from an already authorized response. Compose an editable form and a four-state responsive book/film/series board. Explicit state moves go through a supplied parent callback. Provide neutral Open Library request/response adapters with no HTTP or inferred personal history. Keep source facts separate from personal status, progress, dates and rating, as in the inspected MIT Jelu implementation.

Files: `domain.ts` owns validation and pins; `projection.ts` owns summaries, filters and exact source projection; `fields.tsx` and `board.tsx` own controlled UI; `metadata.ts` owns neutral work data. Capitalized UI aliases and `model.ts` keep imports discoverable. No package, API, service, route, config, Agent or Skill files are changed by this leaf.

- [x] Domain validation and complete/unknown/date/unit/reference/ISBN/source boundary checks.
- [x] Exact manual-record projection, immutable filters and zero/unknown progress display.
- [x] Existing-theme form, status board, search/type filter, open and move callbacks.
- [x] Pure metadata request/parse/selection adapter; selection preserves owner history.
- [x] Final real browser and typecheck evidence.
- [ ] Independent root review and central integration/delivery gates (owned by parent).

## Integration contract

`domain.ts`: `MediaPersonal` (`PersonalMedia` alias), `MediaPersonalFields`, `emptyMediaPersonal(kind='book')`, `validateMediaPersonal`, `normalizeMediaPersonalFields`, `mediaPersonalReferences`. Personal dates are optional facts, not automatic side effects of changing state. A completed record may retain unknown dates and unknown progress. Ratings use 0–10. Page/episode counts are whole nonnegative numbers; totals are positive, progress cannot exceed a known total, and percent is 0–100. ISBNs validate their checksum. Platform-specific external URLs must match the chosen provider, work kind and supplied ID. Manual URLs are inert HTTP(S) references.

`fields.tsx`: `MediaFields({value,onChange,options,disabled?})`; `options` uses the existing `Record<string,PublicEntry[]>` relation contract.

`board.tsx`: `MediaBoard({records,onOpenRecord,onMoveRecord?,disabled?})`; records are readonly `{id,revision,fields:MediaPersonalFields}[]`. `disabled` prevents state changes but retains read-only open access. `onMoveRecord(id,state)` changes state only and relies on the parent for current-pin/CAS, errors and readback. No optimistic/persistent writer exists here.

`projection.ts`: `mediaSummary`, `mediaProgressLabel`, `mediaProgressPercent`, `projectMediaEntries(entries,spaceId,search?)`, `projectMediaBoard(records,{kind?,search?})`, `MediaEntry`, `MediaRow` and localized labels. The projection is a source-shape filter, never an owner authorization gate.

`metadata.ts`: `buildOpenLibrarySearchRequest({query,mode?:'search'|'isbn',limit?})`, `parseOpenLibrarySearchResponse(response,request?)`, `applyMediaMetadata(fields,candidate)`. These are pure. Search must be owner initiated; no arbitrary-URL fetch proxy or third-party account integration is provided.

## Evidence and remaining gates

Domain RED was observed against an unimplemented API; one added creator-null rejection was separately reproduced before its fix. Metadata's three behavior cases were observed RED before implementation. Targeted domain/projection/metadata checks passed 11/11 before the final creator-null case was added; final results are recorded below after verification. No source text test is used as UI evidence. The projection guard was also mutation checked: temporarily returning no entries failed the owner/source projection behavior test (`0 !== 1`), then the original implementation was restored and the targeted suite passed.

Parent retains responsibility for the sole PersonalService/PersonalObject/type/owner gate integration, owner-scoped API/Agent discovery/Skill, exact SHA CI, build, existing private CD, deployed version readback and real-record owner review. The local isolated synthetic fixture establishes UI behavior only. No personal records, credentials, production host or Keychain were accessed, and nothing was pushed by this leaf.

## Final local evidence, 2026-11-05

- `node --test test/personal-media-domain.test.ts test/personal-media-metadata.test.ts test/personal-media-projection.test.ts`: 11 passed, 0 failed, 0 skipped.
- `RUN_PERSONAL_MEDIA_BROWSER_TESTS=1 LIFEOS_TEST_CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node --test test/personal-media-browser.integration.test.ts`: 1 passed, 0 failed, 0 skipped. Actual native Chrome rendered 1366px desktop/light and 390px mobile/dark; covered empty state, controlled input, zero progress/rating, open callback, completion without invented date, kind/search filter, no horizontal overflow, mobile 16px/44px controls, and read-only field/move disabling while read access stays available. No page errors.
- Screenshots `.review-results/personal-media-desktop-light.png` and `.review-results/personal-media-mobile-dark.png` were visually inspected. They are isolated synthetic verification, excluded from source delivery.
- `npm run typecheck`: exit 0 after the final UI change.
- `git diff --check`: exit 0.
- Initial browser run exposed a test-locator difference (`getByLabel` on a nested select); accessible-tree evidence showed the valid combobox and the test now uses the accessible role. A separate browser RED caught read-only open being incorrectly disabled; removing that disabled flag produced GREEN.
- Full suite/build/CI are not repeated in this leaf; parent runs the appropriate integration checks after serial central integration at its fixed SHA. No production or real-record claim is made here.
