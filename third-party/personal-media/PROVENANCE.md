# Personal media first version provenance

- Source: [bayang/jelu](https://github.com/bayang/jelu), Jelu 0.88.4.
- Fixed commit: `2aba1840c9d823851a5d219dcf9802e1a194a4e2` (release commit dated 2026-10-30; inspected 2026-11-05).
- License: MIT; full upstream copyright and license are retained verbatim in [LICENSE](LICENSE).
- Inspected implementation: [ReadingEvent.ts](https://github.com/bayang/jelu/blob/2aba1840c9d823851a5d219dcf9802e1a194a4e2/src/jelu-ui/src/model/ReadingEvent.ts) and [BookCard.vue](https://github.com/bayang/jelu/blob/2aba1840c9d823851a5d219dcf9802e1a194a4e2/src/jelu-ui/src/components/BookCard.vue).
- Actual reuse: `src/personal-media/projection.ts` adapts `BookCard.vue`'s `showProgressBar` condition: render quantitative progress only for a current reading record with known progress. The adapter supports books, films and series; preserves valid zero; returns null for unknown progress; and derives a percentage only from an explicitly supplied total or percent unit. The source excerpt is retained below for traceability.

```typescript
const showProgressBar = (book: UserBook) => {
  return book.percentRead
      && book.percentRead > 0
      && book.lastReadingEvent != null
      && book.lastReadingEvent === ReadingEventType.CURRENTLY_READING
}
```

Jelu separates work facts from a user's reading event, dates and rating. That existing business structure informed the local media model; this delivery does not import Jelu's Vue/Kotlin runtime, database, account system, data, dependency tree, event names or network layer. LifeOS retains its existing PersonalService, references and revision checks. `paused` is an explicit local state, not an inferred translation of Jelu's dropped event.

The React UI composes the existing `RelationFields`, lucide icons and LifeOS semantic theme tokens. No package or lockfile changes were made. No AGPL/GPL application code was imported. Jelu's full backend is not needed for owner-scoped records and would create a second writer.

## Metadata adapter

- Official contract inspected: [Open Library Search API](https://openlibrary.org/dev/docs/api/search) and [Books API](https://openlibrary.org/dev/docs/api/books), 2026-11-05.
- `src/personal-media/metadata.ts` is a local pure adapter, not copied SDK code. It builds only `https://openlibrary.org/search.json` requests, takes an explicit query, requests four bounded fields, and parses neutral work candidates. It makes no HTTP requests and cannot upload a shelf.
- Search works can group multiple editions. The adapter therefore retains no arbitrary ISBN from a work-level result; an ISBN is included only when it exactly matches an explicit ISBN query.
- No covers are loaded. TMDB, IMDb and Douban accept manual source links only; no API/account integration is advertised.
- Root integration must add any future HTTP operation to scoped capability discovery and the matching Agent/Skill contract before exposing network search.

## Removal and update

Remove `src/personal-media` and its centralized integration to revert. No data migration or background process is introduced. Any future upstream update requires a fixed-commit diff, license review and the local media regression tests; upstream application updates are not installed automatically.
