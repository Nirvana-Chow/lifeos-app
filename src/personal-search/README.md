# Owner record search

`/personal/search?q=<query>` reads the existing owner-authorized current snapshot through `GET /api/platform/personal/search`. Matching is a case-insensitive substring of the title or entered prose (`notes` for todos, `text` for other personal records). Schema keys, status values and relation IDs are not prose. Empty queries show all records in that authorized snapshot.

The page reports the exact enabled categories, scanned current-record count and matched count. It does not cover historical revisions, finance transactions, requirements, feedback, attachment contents or external services that have not been imported. Portfolio records remain distinct from finance transactions. Semantic search is unavailable; there is no embedding provider, new index, background job or external request.

Each result exposes its record type, explicit record/due date or unknown date, excerpt, stable record ID, source ID and revision. Opening a result preserves `q`, `type` and `id` in the URL and independently reads `GET /api/platform/personal/<type>/<id>`. This is a read-only detail of the original business record, not a canonical editing page. The explicit return link and browser Back preserve the search query. Missing original records are shown as unavailable.

All reads use `no-store` and the existing owner/MFA boundary. The client checks the same owner/space before and after reads and clears results during refresh, background navigation or authorization loss. No business write operation is added.

Focused checks: `node --test test/personal-search-*.test.ts`; the browser fixture is opt-in with `RUN_PERSONAL_SEARCH_BROWSER_TESTS=1` and `LIFEOS_TEST_CHROMIUM_PATH` pointing to an installed Chromium executable. The fixture uses disposable synthetic storage and checks desktop/mobile keyboard navigation, original-record readback, no-match/errors, identity loss, no mutation and no external traffic. It does not establish deployment or owner experience acceptance.
