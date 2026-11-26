# LO-OVERVIEW-001 recent thoughts read

The owner overview uses a separately authorized, no-store recent-memos projection. It returns at most five current, verified memo entries with ID, title, body, occurrence date and original recorded time. Topics are verified by owner, space, ID, source ID and revision. The original record link opens the journal route. The PostgreSQL query orders by created_at DESC, id DESC and keeps a full-precision keyset when a stored candidate fails existing record validation. The owner session is rechecked before returning the projection.

The preview's empty classification message still distinguishes unresolved source pins. Journal history, activity review and task-workspace reads continue to use their own contracts. A failed preview read is shown as unavailable.

The restricted PostgreSQL fixture measures the old #164 path and the projection with the same 216 synthetic journal records, warming both paths and alternating five passes. It counts JSON bytes and gzip payload bytes separately from time to the usable result. The owner overview Chromium fixture verifies visibility/focus refresh, task-only entry, and permission denial. Measurements are synthetic loopback evidence.
