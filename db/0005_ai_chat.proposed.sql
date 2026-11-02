-- PROPOSED ONLY. Never run from build/start/API/tests. No DDL is authorized here.
-- Additive technical chat history in the existing isolated PostgreSQL database.
-- Core meta remains v2; no new database, role, key, facts, sources or provider calls.
-- A separately approved operator must set lifeos.chat_migration_approved=1.
BEGIN;
DO $$ BEGIN
 IF current_setting('lifeos.chat_migration_approved',true) IS DISTINCT FROM '1'
  OR current_database()<>'lifeos_platform_test_local'
  OR current_user IN ('lifeos_platform_candidate_runtime','lifeos_platform_candidate_bootstrap')
  OR (SELECT version FROM lifeos_platform.platform_meta) IS DISTINCT FROM 2 THEN
  RAISE EXCEPTION 'Explicit chat migration approval, exact isolated database, migration owner and core v2 required';
 END IF;
END $$;

CREATE TABLE lifeos_platform.platform_chat_meta(version integer PRIMARY KEY CHECK(version=1));
INSERT INTO lifeos_platform.platform_chat_meta(version) VALUES(1);
CREATE TABLE lifeos_platform.platform_chat_turn(
 owner_id text NOT NULL REFERENCES lifeos_platform.platform_user(id),
 id uuid NOT NULL,
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
 user_text text NOT NULL CHECK(length(btrim(user_text)) BETWEEN 1 AND 16000),
 assistant_text text NOT NULL CHECK(length(assistant_text)<=32000),
 state text NOT NULL CHECK(state IN ('pending','completed','failed','cancelled')),
 revision integer NOT NULL CHECK(revision IN (1,2)),
 created_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL,
 provenance jsonb NOT NULL,
 error_code text CHECK(error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]{0,79}$'),
 PRIMARY KEY(owner_id,id),
 CHECK(created_at>=TIMESTAMPTZ '0001-01-01 00:00:00+00' AND updated_at<TIMESTAMPTZ '10000-01-01 00:00:00+00' AND updated_at>=created_at),
 CHECK((CASE WHEN state='pending' THEN revision=1 AND assistant_text='' AND error_code IS NULL AND updated_at=created_at
  ELSE revision=2 AND (state<>'completed' OR error_code IS NULL) END) IS TRUE),
 CHECK((jsonb_typeof(provenance)='object'
  AND provenance ?& ARRAY['provider','model','configurationRevision','materialRevision','mode','dataScope','sources']
  AND provenance-ARRAY['provider','model','configurationRevision','materialRevision','mode','dataScope','sources']='{}'::jsonb
  AND provenance->>'provider'='volcengine-ark'
  AND jsonb_typeof(provenance->'model')='string' AND length(provenance->>'model') BETWEEN 1 AND 160 AND provenance->>'model' ~ '^[A-Za-z0-9_.:-]+$'
  AND jsonb_typeof(provenance->'configurationRevision')='number' AND (provenance->>'configurationRevision')::bigint BETWEEN 1 AND 2147483646
  AND jsonb_typeof(provenance->'materialRevision')='number' AND (provenance->>'materialRevision')::bigint BETWEEN 1 AND 2147483646
  AND provenance->>'mode' IN ('synthetic-sdk-test','approved-live')
  AND provenance->>'dataScope'='current-message-only' AND provenance->>'sources'='not-connected') IS TRUE)
);
CREATE INDEX chat_turn_owner_created_idx ON lifeos_platform.platform_chat_turn(owner_id,created_at DESC,id DESC);

ALTER TABLE lifeos_platform.platform_chat_turn ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifeos_platform.platform_chat_turn FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_turn_owner ON lifeos_platform.platform_chat_turn USING(owner_id=current_setting('lifeos.owner_id',true)) WITH CHECK(owner_id=current_setting('lifeos.owner_id',true));
REVOKE ALL ON lifeos_platform.platform_chat_meta,lifeos_platform.platform_chat_turn FROM PUBLIC,lifeos_platform_candidate_runtime;
GRANT SELECT ON lifeos_platform.platform_chat_meta TO lifeos_platform_candidate_runtime;
GRANT SELECT,INSERT ON lifeos_platform.platform_chat_turn TO lifeos_platform_candidate_runtime;
GRANT UPDATE(assistant_text,state,revision,updated_at,error_code) ON lifeos_platform.platform_chat_turn TO lifeos_platform_candidate_runtime;
-- owner/id/digest/input/provenance/creation-time have no UPDATE privilege.
-- No DELETE/TRUNCATE, core record/source/history writes, or schema creation granted.
-- Only pending and terminal state are durable. An interrupted pending turn is
-- unknown; do not automatically retry the model or claim midstream text survived.
COMMIT;
