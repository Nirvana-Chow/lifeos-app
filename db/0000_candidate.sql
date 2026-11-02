-- Separate migration-owner proposal only. No role creation/grants are executed by this candidate.
-- HAND-AUTHORED, UNAPPLIED SCHEMA CANDIDATE, NOT A DRIZZLE JOURNAL.
-- Generate with pinned drizzle-kit and compare before acceptance.
CREATE SCHEMA lifeos_candidate AUTHORIZATION lifeos_migrator;
CREATE TABLE lifeos_candidate.article_index (
  source_id text PRIMARY KEY,
  payload jsonb NOT NULL,
  CONSTRAINT synthetic_only CHECK (payload->>'synthetic' = 'true' AND payload->>'sourceId' = source_id)
);
CREATE TABLE lifeos_candidate.site_state (
  key text PRIMARY KEY, value text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
